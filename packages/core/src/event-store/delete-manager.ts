import { Observable, Subject } from "rxjs";
import { getDeleteAddressPointers, getDeleteEventPointers } from "../helpers/delete.js";
import { getReplaceableIdentifier, isAddressableKind, isReplaceableKind, kinds, NostrEvent } from "../helpers/event.js";
import { DeleteEventNotification, IDeleteManager } from "./interface.js";

/** Manages deletion state for events, ensuring users can only delete their own events */
export class DeleteManager implements IDeleteManager {
  /** A stream of pointers that may have been deleted */
  public readonly deleted$: Observable<DeleteEventNotification>;

  /** Internal subject for deleted$ observable */
  private deletedSubject = new Subject<DeleteEventNotification>();

  /** Maps author pubkey to Set of event IDs they have deleted */
  private deletedIds = new Map<string, Set<string>>();

  /** Maps of author pubkey to Map of kind + "|" + identifier and timestamp of the delete event */
  private deletedIdentifiers = new Map<string, Map<string, number>>();

  constructor() {
    this.deleted$ = this.deletedSubject.asObservable();
  }

  /**
   * Process a kind 5 delete event
   * Extracts event pointers and address pointers from the delete event
   * Enforces that users can only delete their own events
   */
  add(deleteEvent: NostrEvent): DeleteEventNotification[] {
    // SKip non-delete events
    if (deleteEvent.kind !== kinds.EventDeletion) return [];

    const author = deleteEvent.pubkey;
    const notifications: DeleteEventNotification[] = [];

    // Extract event pointers from "e" tags (already filtered and author set by helper)
    const eventPointers = getDeleteEventPointers(deleteEvent);
    if (eventPointers.length > 0) {
      let ids = this.deletedIds.get(author);
      if (!ids) {
        ids = new Set();
        this.deletedIds.set(author, ids);
      }

      for (const pointer of eventPointers) {
        ids.add(pointer.id);

        const notification: DeleteEventNotification = {
          pointer,
          until: deleteEvent.created_at,
        };
        notifications.push(notification);
        this.deletedSubject.next(notification);
      }
    }

    // Add address pointers to memory
    const addressPointers = getDeleteAddressPointers(deleteEvent);
    if (addressPointers.length > 0) {
      let identifiers = this.deletedIdentifiers.get(author);
      if (!identifiers) {
        identifiers = new Map();
        this.deletedIdentifiers.set(author, identifiers);
      }

      for (const pointer of addressPointers) {
        const key = pointer.kind + "|" + pointer.identifier;
        identifiers.set(key, deleteEvent.created_at);

        const notification: DeleteEventNotification = {
          pointer,
          until: deleteEvent.created_at,
        };
        notifications.push(notification);
        this.deletedSubject.next(notification);
      }
    }

    return notifications;
  }

  /**
   * Check if an event is deleted
   * Verifies the event was deleted by its own author
   */
  check(event: NostrEvent): boolean {
    const author = event.pubkey;

    if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
      const identifiers = this.deletedIdentifiers.get(author);
      if (!identifiers) return false;
      const identifier = getReplaceableIdentifier(event);
      const key = event.kind + "|" + identifier;
      const timestamp = identifiers.get(key);
      if (timestamp === undefined) return false;

      // Check that the delete event timestamp is newer than the event
      return timestamp >= event.created_at;
    } else {
      const ids = this.deletedIds.get(author);
      if (!ids) return false;

      // Check if that event id was deleted by the author
      return ids.has(event.id);
    }
  }

  /**
   * Filter out all deleted events from an array of events
   */
  filter(events: NostrEvent[]): NostrEvent[] {
    return events.filter((event) => !this.check(event));
  }
}
