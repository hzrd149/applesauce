import { Observable, Subject } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { unixNow } from "../helpers/time.js";
import { IExpirationManager } from "./interface.js";

/** Node's 32-bit signed timer limit (~24.8 days); setTimeout delays beyond this overflow and clamp to ~1ms. */
const MAX_TIMER_DELAY = 2_147_483_647;

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

    this.scheduleNextCheck(expiration, now);
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
   * Tears down the manager: cancels any pending timer and completes the expired$ stream
   * @note This is a terminal operation; the manager should be discarded after calling it.
   */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextCheck = null;
    this.expirations.clear();
    this.expiredSubject.complete();
  }

  /** Allows the manager to be used with the `using` keyword */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Sole owner of the `timer` / `nextCheck` pair: clears any live handle, then arms a
   * new one for the given expiration. The scheduled delay is capped to MAX_TIMER_DELAY
   * to avoid Node's 32-bit setTimeout overflow, but `nextCheck` stores the true target
   * expiration (not the capped wake time) — track()'s early-exit guard reads it as the
   * semantic "next check target". A capped early wake is a harmless no-op:
   * emitNotifications() recomputes the minimum over remaining entries and expires
   * nothing when nothing is due, re-arming the next chunk each time.
   */
  private scheduleNextCheck(expiration: number, now = unixNow()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextCheck = null;

    const timeout = expiration - now;
    if (timeout <= 0) return;

    this.timer = setTimeout(this.emitNotifications.bind(this), Math.min(timeout * 1000 + 10, MAX_TIMER_DELAY));
    this.nextCheck = expiration;
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

    // The fired timer handle is spent and must not be left visible to track()'s guard,
    // whether or not there's a next expiration to schedule.
    if (nextExpiration !== Infinity) {
      this.scheduleNextCheck(nextExpiration, now);
    } else {
      this.timer = null;
      this.nextCheck = null;
    }
  }
}
