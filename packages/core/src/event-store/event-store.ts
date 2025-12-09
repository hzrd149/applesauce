import { verifyEvent as coreVerifyEvent } from "nostr-tools/pure";
import { Observable, Subject } from "rxjs";
import {
  EventStoreSymbol,
  FromCacheSymbol,
  getReplaceableIdentifier,
  isReplaceable,
  kinds,
  NostrEvent,
} from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { Filter } from "../helpers/filter.js";
import {
  AddressPointer,
  AddressPointerWithoutD,
  eventMatchesPointer,
  EventPointer,
  isAddressPointer,
  isEventPointer,
} from "../helpers/pointers.js";
import { addSeenRelay, getSeenRelays } from "../helpers/relays.js";
import { unixNow } from "../helpers/time.js";
import { DeleteManager } from "./delete-manager.js";
import { EventMemory } from "./event-memory.js";
import { EventModels } from "./event-models.js";
import { ExpirationManager } from "./expiration-manager.js";
import {
  DeleteEventNotification,
  IDeleteManager,
  IEventDatabase,
  IEventStore,
  IExpirationManager,
} from "./interface.js";

export type EventStoreOptions = {
  /** Keep deleted events in the store */
  keepDeleted?: boolean;
  /** Keep expired events in the store */
  keepExpired?: boolean;
  /** Enable this to keep old versions of replaceable events */
  keepOldVersions?: boolean;
  /** The database to use for storing events */
  database?: IEventDatabase;
  /** Custom {@link IDeleteManager} implementation */
  deleteManager?: IDeleteManager;
  /** Custom {@link IExpirationManager} implementation */
  expirationManager?: IExpirationManager;
  /** The method used to verify events */
  verifyEvent?: (event: NostrEvent) => boolean;
};

/** A wrapper around an event database that handles replaceable events, deletes, and models */
export class EventStore extends EventModels implements IEventStore {
  database: IEventDatabase;

  /** Optional memory database for ensuring single event instances */
  memory: EventMemory;

  /** Manager for handling event deletions with authorization */
  private deletes: IDeleteManager;

  /** Manager for handling event expirations */
  private expiration: IExpirationManager;

  /** Enable this to keep old versions of replaceable events */
  keepOldVersions = false;

  /** Keep expired events in the store */
  keepExpired = false;

  /** Keep deleted events in the store */
  keepDeleted = false;

  /** The method used to verify events */
  private _verifyEventMethod?: (event: NostrEvent) => boolean = coreVerifyEvent;

  /** Get the method used to verify events */
  get verifyEvent(): undefined | ((event: NostrEvent) => boolean) {
    return this._verifyEventMethod;
  }

  /** Sets the method used to verify events */
  set verifyEvent(method: undefined | ((event: NostrEvent) => boolean)) {
    this._verifyEventMethod = method;

    if (method === undefined)
      console.warn("[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.");
  }

  /** A stream of new events added to the store */
  insert$ = new Subject<NostrEvent>();

  /** A stream of events that have been updated */
  update$ = new Subject<NostrEvent>();

  /** A stream of events that have been removed */
  remove$ = new Subject<NostrEvent>();

  /** A method that will be called when an event isn't found in the store */
  eventLoader?: (
    pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
  ) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  constructor(options?: EventStoreOptions) {
    super();
    if (options?.database) {
      this.database = options.database;
      this.memory = new EventMemory();
    } else {
      // If no database is provided, its the same as having a memory database
      this.database = this.memory = new EventMemory();
    }

    // Set options if provided
    if (options?.keepDeleted !== undefined) this.keepDeleted = options.keepDeleted;
    if (options?.keepExpired !== undefined) this.keepExpired = options.keepExpired;
    if (options?.keepOldVersions !== undefined) this.keepOldVersions = options.keepOldVersions;
    if (options?.verifyEvent) this.verifyEvent = options.verifyEvent;

    // Use provided delete manager or create a default one
    this.deletes = options?.deleteManager ?? new DeleteManager();

    // Listen to delete notifications and remove matching events
    this.deletes.deleted$.subscribe(this.handleDeleteNotification.bind(this));

    // Create expiration manager
    this.expiration = options?.expirationManager ?? new ExpirationManager();

    // Listen to expired events and remove them from the store
    this.expiration.expired$.subscribe(this.handleExpiredNotification.bind(this));

    // when events are added to the database, add the symbol
    this.insert$.subscribe((event) => {
      Reflect.set(event, EventStoreSymbol, this);
    });

    // when events are removed from the database, remove the symbol
    this.remove$.subscribe((event) => {
      Reflect.deleteProperty(event, EventStoreSymbol);
    });
  }

  /** A method to add all events to memory to ensure there is only ever a single instance of an event */
  private mapToMemory(event: NostrEvent): NostrEvent;
  private mapToMemory(event: NostrEvent | undefined): NostrEvent | undefined;
  private mapToMemory(event: NostrEvent | undefined): NostrEvent | undefined {
    if (event === undefined) return undefined;
    if (!this.memory) return event;
    return this.memory.add(event);
  }

  /** Handle a delete event by pointer */
  private handleDeleteNotification({ pointer, until }: DeleteEventNotification) {
    // Skip if keeping deleted events
    if (this.keepDeleted) return;

    if (isEventPointer(pointer)) {
      // For event pointers, get the event by ID and remove if it exists
      const event = this.getEvent(pointer.id);
      if (event && until >= event.created_at && eventMatchesPointer(event, pointer)) {
        this.remove(event);
      }
    } else if (isAddressPointer(pointer)) {
      // For address pointers, get all events matching the address and remove if deleted
      const events = this.getReplaceableHistory(pointer.kind, pointer.pubkey, pointer.identifier);
      if (events) {
        for (const event of events) {
          // Remove the event if its older than the delete notification and matches the pointer
          if (until >= event.created_at && eventMatchesPointer(event, pointer)) {
            this.remove(event);
          }
        }
      }
    }
  }

  /** Handle an expired event by id */
  private handleExpiredNotification(id: string) {
    // Skip if keeping expired events
    if (this.keepExpired) return;

    this.remove(id);
  }

  /** Copies important metadata from and identical event to another */
  static mergeDuplicateEvent(source: NostrEvent, dest: NostrEvent) {
    const relays = getSeenRelays(source);
    if (relays) {
      for (const relay of relays) addSeenRelay(dest, relay);
    }

    // copy the from cache symbol only if its true
    const fromCache = Reflect.get(source, FromCacheSymbol);
    if (fromCache && !Reflect.get(dest, FromCacheSymbol)) Reflect.set(dest, FromCacheSymbol, fromCache);
  }

  /**
   * Adds an event to the store and update subscriptions
   * @returns The existing event or the event that was added, if it was ignored returns null
   */
  add(event: NostrEvent, fromRelay?: string): NostrEvent | null {
    // Handle delete events differently
    if (event.kind === kinds.EventDeletion) {
      this.deletes.add(event);
      return event;
    }

    // Ignore if the event was deleted
    if (this.deletes.check(event)) return event;

    // Reject expired events if keepExpired is false
    const expiration = getExpirationTimestamp(event);
    if (this.keepExpired === false && expiration && expiration <= unixNow()) return null;

    // Get the replaceable identifier
    const identifier = isReplaceable(event.kind) ? getReplaceableIdentifier(event) : undefined;

    // Don't insert the event if there is already a newer version
    if (this.keepOldVersions === false && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      // If there is already a newer version, copy cached symbols and return existing event
      if (existing && existing.length > 0 && existing[0].created_at >= event.created_at) {
        EventStore.mergeDuplicateEvent(event, existing[0]);
        return existing[0];
      }
    }

    // Verify event before inserting into the database
    if (this.verifyEvent && this.verifyEvent(event) === false) return null;

    // Always add event to memory
    const existing = this.memory?.add(event);

    // If the memory returned a different instance, this is a duplicate event
    if (existing && existing !== event) {
      // Copy cached symbols and return existing event
      EventStore.mergeDuplicateEvent(event, existing);
      // attach relay this event was from
      if (fromRelay) addSeenRelay(existing, fromRelay);

      return existing;
    }

    // Insert event into database
    const inserted = this.mapToMemory(this.database.add(event));

    // Copy cached data if its a duplicate event
    if (event !== inserted) EventStore.mergeDuplicateEvent(event, inserted);

    // attach relay this event was from
    if (fromRelay) addSeenRelay(inserted, fromRelay);

    // Emit insert$ signal
    if (inserted === event) this.insert$.next(inserted);

    // remove all old version of the replaceable event
    if (this.keepOldVersions === false && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      if (existing && existing.length > 0) {
        const older = Array.from(existing).filter((e) => e.created_at < event.created_at);
        for (const old of older) this.remove(old);

        // return the newest version of the replaceable event
        // most of the time this will be === event, but not always
        if (existing.length !== older.length) return existing[0];
      }
    }

    // Add event to expiration manager if it has an expiration tag
    if (this.keepExpired === false && expiration !== undefined) this.expiration.track(inserted);

    return inserted;
  }

  /** Removes an event from the store and updates subscriptions */
  remove(event: string | NostrEvent): boolean {
    const eventId = typeof event === "string" ? event : event.id;
    let instance = this.memory?.getEvent(eventId);

    // Remove from expiration manager
    this.expiration.forget(eventId);

    // Remove from memory if available
    if (this.memory) this.memory.remove(event);

    // Remove the event from the database
    const removed = this.database.remove(event);

    // If the event was removed, notify the subscriptions
    if (removed && instance) {
      this.remove$.next(instance);
    }

    return removed;
  }

  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number {
    // Get events that will be removed for notification
    const eventsToRemove = this.getByFilters(filters);

    // Remove from expiration manager
    for (const event of eventsToRemove) this.expiration.forget(event.id);

    // Remove from memory if available
    if (this.memory) this.memory.removeByFilters(filters);

    // Remove from database
    const removedCount = this.database.removeByFilters(filters);

    // Notify subscriptions for each removed event
    for (const event of eventsToRemove) {
      this.remove$.next(event);
    }

    return removedCount;
  }

  /** Add an event to the store and notifies all subscribes it has updated */
  update(event: NostrEvent): boolean {
    // Map the event to the current instance in the database
    const e = this.database.add(event);
    if (!e) return false;

    // Notify the database that the event has updated
    this.database.update?.(event);

    this.update$.next(event);
    return true;
  }

  /** Check if the store has an event by id */
  hasEvent(id: string): boolean {
    // Check if the event exists in memory first, then in the database
    return this.memory?.hasEvent(id) || this.database.hasEvent(id);
  }

  /** Get an event by id from the store */
  getEvent(id: string): NostrEvent | undefined {
    // Get the event from memory first, then from the database
    return this.memory?.getEvent(id) ?? this.mapToMemory(this.database.getEvent(id));
  }

  /** Check if the store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, d?: string): boolean {
    // Check if the event exists in memory first, then in the database
    return this.memory?.hasReplaceable(kind, pubkey, d) || this.database.hasReplaceable(kind, pubkey, d);
  }

  /** Gets the latest version of a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined {
    // Get the event from memory first, then from the database
    return (
      this.memory?.getReplaceable(kind, pubkey, identifier) ??
      this.mapToMemory(this.database.getReplaceable(kind, pubkey, identifier))
    );
  }

  /** Returns all versions of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined {
    // Get the events from memory first, then from the database
    return (
      this.memory?.getReplaceableHistory(kind, pubkey, identifier) ??
      this.database.getReplaceableHistory(kind, pubkey, identifier)?.map((e) => this.mapToMemory(e) ?? e)
    );
  }

  /** Get all events matching a filter */
  getByFilters(filters: Filter | Filter[]): NostrEvent[] {
    // NOTE: no way to read from memory since memory won't have the full set of events
    const events = this.database.getByFilters(filters);
    // Map events to memory if available for better performance
    if (this.memory) return events.map((e) => this.mapToMemory(e));
    else return events;
  }

  /** Returns a timeline of events that match filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[] {
    const events = this.database.getTimeline(filters);
    if (this.memory) return events.map((e) => this.mapToMemory(e));
    else return events;
  }

  /** Passthrough method for the database.touch */
  touch(event: NostrEvent) {
    return this.memory?.touch(event);
  }
  /** Increments the claim count on the event and touches it */
  claim(event: NostrEvent): void {
    return this.memory?.claim(event);
  }
  /** Checks if an event is claimed by anything */
  isClaimed(event: NostrEvent): boolean {
    return this.memory?.isClaimed(event) ?? false;
  }
  /** Decrements the claim count on an event */
  removeClaim(event: NostrEvent): void {
    return this.memory?.removeClaim(event);
  }
  /** Removes all claims on an event */
  clearClaim(event: NostrEvent): void {
    return this.memory?.clearClaim(event);
  }
  /** Pass through method for the database.unclaimed */
  unclaimed(): Generator<NostrEvent> {
    return this.memory?.unclaimed() || (function* () {})();
  }
  /** Removes any event that is not being used by a subscription */
  prune(limit?: number): number {
    return this.memory?.prune(limit) ?? 0;
  }
}
