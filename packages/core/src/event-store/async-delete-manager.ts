import { Observable } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { DeleteManager } from "./delete-manager.js";
import { DeleteEventNotification, IAsyncDeleteManager } from "./interface.js";

/** Async manager for deletion state, ensuring users can only delete their own events */
export class AsyncDeleteManager implements IAsyncDeleteManager {
  /** A stream of pointers that may have been deleted */
  public readonly deleted$: Observable<DeleteEventNotification>;

  /** Internal sync delete manager instance for state */
  private internal: DeleteManager;

  constructor() {
    this.internal = new DeleteManager();
    this.deleted$ = this.internal.deleted$;
  }

  /**
   * Process a kind 5 delete event
   * Extracts event pointers and address pointers from the delete event
   * Enforces that users can only delete their own events
   */
  async add(deleteEvent: NostrEvent): Promise<DeleteEventNotification[]> {
    return this.internal.add(deleteEvent);
  }

  /**
   * Check if an event is deleted
   * Verifies the event was deleted by its own author
   */
  async check(event: NostrEvent): Promise<boolean> {
    return this.internal.check(event);
  }

  /**
   * Filter out all deleted events from an array of events
   */
  async filter(events: NostrEvent[]): Promise<NostrEvent[]> {
    return this.internal.filter(events);
  }
}
