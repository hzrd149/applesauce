import { Observable, Subject } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { unixNow } from "../helpers/time.js";
import { IExpirationManager } from "./interface.js";

/** Manages expiration state for events with expiration tags */
export class ExpirationManager implements IExpirationManager {
  /** A stream of event IDs that have expired */
  public readonly expired$: Observable<string>;

  /** Internal subject for expired$ observable */
  private expiredSubject: Subject<string>;

  /** Maps event ID to expiration timestamp */
  private expirations = new Map<string, number>();

  /** Current timeout for the next expiration check */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Timestamp of the next expiration check */
  private nextCheck: number | null = null;

  constructor() {
    this.expiredSubject = new Subject<string>();
    this.expired$ = this.expiredSubject.asObservable();
  }

  /**
   * Add an event to the expiration manager if it has an expiration tag
   * @param event The event to track for expiration
   */
  track(event: NostrEvent): void {
    const expiration = getExpirationTimestamp(event);
    if (!expiration || !Number.isFinite(expiration)) return;

    const now = unixNow();

    // Ingore already expired events
    if (expiration <= now) return;

    // Add event to expiration map
    this.expirations.set(event.id, expiration);

    // Exit if the next check is already before expiration
    if (this.timer && this.nextCheck && this.nextCheck <= expiration) return;

    // Clear any existing timer
    if (this.timer) clearTimeout(this.timer);

    // Set timer for next check
    const timeout = expiration - now;
    if (timeout > 0) {
      this.timer = setTimeout(this.emitNotifications.bind(this), timeout * 1000 + 10);
      this.nextCheck = expiration;
    }
  }

  /**
   * Remove an event from expiration tracking
   * @param eventId The ID of the event to remove
   */
  forget(eventId: string): void {
    this.expirations.delete(eventId);
  }

  /**
   * Check if an event is expired
   * @param event The event to check
   * @returns true if the event has expired, false otherwise
   */
  check(event: NostrEvent): boolean {
    const expiration = getExpirationTimestamp(event);
    if (!expiration) return false;
    return expiration <= unixNow();
  }

  /**
   * Remove expired events from the store and emit them
   */
  private emitNotifications(): void {
    const now = unixNow();
    let nextExpiration = Infinity;
    for (const [id, expiration] of this.expirations) {
      // Remove expired event
      if (expiration <= now) {
        this.expirations.delete(id);

        // Emit expired event ID
        this.expiredSubject.next(id);
      }
      // Else find the next expiration timestamp
      else if (expiration < nextExpiration) {
        nextExpiration = expiration;
      }
    }

    // Schedule next check if there are remaining expirations
    if (nextExpiration !== Infinity) {
      // Cleanup timers
      if (this.timer) clearTimeout(this.timer);
      this.nextCheck = null;
      this.timer = null;

      const timeout = nextExpiration - now;
      if (timeout > 0) {
        this.timer = setTimeout(this.emitNotifications.bind(this), timeout * 1000 + 10);
        this.nextCheck = nextExpiration;
      }
    }
  }
}
