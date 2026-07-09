import { verifyEvent as coreVerifyEvent, verifiedSymbol } from "nostr-tools/pure";
import { Observable, Subject, Subscription } from "rxjs";
import { EncryptedContentSymbol } from "../helpers/encrypted-content.js";
import {
  EventStoreSymbol,
  FromCacheSymbol,
  getReplaceableIdentifier,
  isRegularKind,
  isReplaceable,
  kinds,
  NostrEvent,
  StoreEvent,
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

export type EventStoreOptions<E extends StoreEvent = NostrEvent> = {
  /** Keep deleted events in the store */
  keepDeleted?: boolean;
  /** Keep expired events in the store */
  keepExpired?: boolean;
  /** Enable this to keep old versions of replaceable events */
  keepOldVersions?: boolean;
  /** The database to use for storing events */
  database?: IEventDatabase<E>;
  /** Custom {@link IDeleteManager} implementation */
  deleteManager?: IDeleteManager<E>;
  /** Custom {@link IExpirationManager} implementation */
  expirationManager?: IExpirationManager<E>;
  /** The method used to verify events */
  verifyEvent?: (event: E) => boolean;
};

/** A wrapper around an event database that handles replaceable events, deletes, and models */
export class EventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IEventStore<E> {
  database: IEventDatabase<E>;

  /** Optional memory database for ensuring single event instances */
  memory: EventMemory<E>;

  /** Manager for handling event deletions with authorization */
  private deletes: IDeleteManager<E>;

  /** Manager for handling event expirations */
  private expiration: IExpirationManager<E>;

  /** Enable this to keep old versions of replaceable events */
  keepOldVersions = false;

  /** Keep expired events in the store */
  keepExpired = false;

  /** Keep deleted events in the store */
  keepDeleted = false;

  /** The method used to verify events */
  // nostr-tools' verifyEvent is hard-typed to NostrEvent; this bridge re-types the default
  // verifier for the store's generic E (it is exactly nostr-tools' verifyEvent at the
  // NostrEvent default, per D-04).
  private _verifyEventMethod?: (event: E) => boolean = coreVerifyEvent as unknown as (event: E) => boolean;

  /** Get the method used to verify events */
  get verifyEvent(): undefined | ((event: E) => boolean) {
    return this._verifyEventMethod;
  }

  /** Sets the method used to verify events */
  set verifyEvent(method: undefined | ((event: E) => boolean)) {
    this._verifyEventMethod = method;

    if (method === undefined)
      console.warn("[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.");
  }

  /** A stream of new events added to the store */
  insert$ = new Subject<E>();

  /** A stream of events that have been updated (Warning: this is a very noisy stream, use with caution) */
  update$ = new Subject<E>();

  /** A stream of events that have been removed */
  remove$ = new Subject<E>();

  /** A method that will be called when an event isn't found in the store */
  eventLoader?: (
    pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
  ) => Observable<E> | Promise<E | undefined>;

  /** Internal subscriptions (delete + expiration managers) torn down on dispose */
  private internalSubscriptions = new Subscription();

  constructor(options?: EventStoreOptions<E>) {
    super();
    if (options?.database) {
      this.database = options.database;
      this.memory = new EventMemory<E>();
    } else {
      // If no database is provided, its the same as having a memory database
      this.database = this.memory = new EventMemory<E>();
    }

    // Set options if provided
    if (options?.keepDeleted !== undefined) this.keepDeleted = options.keepDeleted;
    if (options?.keepExpired !== undefined) this.keepExpired = options.keepExpired;
    if (options?.keepOldVersions !== undefined) this.keepOldVersions = options.keepOldVersions;

    // CORE-03 fix — the one intentional runtime change in this phase: honor an explicit
    // `verifyEvent: undefined` to disable verification, while still routing through the
    // setter so the D-01 console.warn fires.
    if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;

    // Use provided delete manager or create a default one
    this.deletes = options?.deleteManager ?? new DeleteManager();

    // Listen to delete notifications and remove matching events
    this.internalSubscriptions.add(this.deletes.deleted$.subscribe(this.handleDeleteNotification.bind(this)));

    // Create expiration manager
    this.expiration = options?.expirationManager ?? new ExpirationManager();

    // Listen to expired events and remove them from the store
    this.internalSubscriptions.add(this.expiration.expired$.subscribe(this.handleExpiredNotification.bind(this)));
  }

  /** A method to add all events to memory to ensure there is only ever a single instance of an event */
  private mapToMemory(event: E): E;
  private mapToMemory(event: E | undefined): E | undefined;
  private mapToMemory(event: E | undefined): E | undefined {
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
  static copySymbolsToDuplicateEvent<E extends StoreEvent = NostrEvent>(source: E, dest: E) {
    if (source.kind !== dest.kind) throw new Error("Source and destination events must have the same kind");
    if (isRegularKind(source.kind) && source.id !== dest.id)
      throw new Error("Source and destination events must have the same ID");
    if (
      isReplaceable(source.kind) &&
      source.pubkey !== dest.pubkey &&
      getReplaceableIdentifier(source) !== getReplaceableIdentifier(dest)
    )
      throw new Error("Source and destination events must have the same pubkey and replaceable identifier");

    let changed = false;

    // Merge seen relays
    const relays = getSeenRelays(source);
    if (relays) {
      for (const relay of relays) addSeenRelay(dest, relay);
      changed = true;
    }

    const symbols = [FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol];
    for (const symbol of symbols) {
      if (symbol in source && !(symbol in dest)) {
        Reflect.set(dest, symbol, Reflect.get(source, symbol));
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Adds an event to the store and update subscriptions
   * @returns The existing event or the event that was added, if it was ignored returns null
   */
  add(event: E, fromRelay?: string): E | null {
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

    // Attach relay this event was from
    if (fromRelay) addSeenRelay(event, fromRelay);

    // Get the replaceable identifier
    const identifier = isReplaceable(event.kind) ? getReplaceableIdentifier(event) : undefined;

    // Don't insert the event if there is already a winning version
    // (NIP-01: newer created_at wins; on tie, lexicographically lower id wins).
    if (this.keepOldVersions === false && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      // If the existing set has any event that beats the incoming one per
      // NIP-01, the incoming event is rejected.
      if (existing && existing.length > 0) {
        let winner = existing[0];
        for (const e of existing) {
          if (e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id)) winner = e;
        }
        const incomingBeatsWinner =
          event.created_at > winner.created_at || (event.created_at === winner.created_at && event.id < winner.id);
        if (!incomingBeatsWinner) {
          if (EventStore.copySymbolsToDuplicateEvent(event, winner)) this.update(winner);
          return winner;
        }
      }
    }

    // Verify event before inserting into the database
    if (this.verifyEvent && this.verifyEvent(event) === false) return null;

    // Always add event to memory
    const existing = this.memory.add(event);

    // If the memory returned a different instance, this is a duplicate event
    if (existing && existing !== event) {
      // Copy cached symbols and return existing event
      if (EventStore.copySymbolsToDuplicateEvent(event, existing)) this.update(existing);

      return existing;
    }

    // Insert event into database
    const inserted = this.mapToMemory(this.database.add(event));

    // If the event is the same as the inserted event, its a new event
    if (inserted === event) {
      // Set the event store on the event
      Reflect.set(inserted, EventStoreSymbol, this);

      // Emit insert$ signal
      this.insert$.next(inserted);
    } else {
      // Copy cached data if its a duplicate event
      if (EventStore.copySymbolsToDuplicateEvent(event, inserted)) this.update(inserted);
    }

    // remove all losing versions of the replaceable event
    // (NIP-01: keep newest created_at; on tie, keep lowest id).
    if (this.keepOldVersions === false && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      if (existing && existing.length > 0) {
        // Find the NIP-01 winner across all stored versions.
        let winner = existing[0];
        for (const e of existing) {
          if (e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id)) winner = e;
        }
        const losers = existing.filter((e) => e !== winner);
        for (const old of losers) this.remove(old);

        // return the winning version of the replaceable event
        // most of the time this will be === event, but not always
        if (losers.length > 0) return winner;
      }
    }

    // Add event to expiration manager if it has an expiration tag
    if (this.keepExpired === false && expiration !== undefined) this.expiration.track(inserted);

    return inserted;
  }

  /** Removes an event from the store and updates subscriptions */
  remove(event: string | E): boolean {
    const eventId = typeof event === "string" ? event : event.id;
    let instance = this.memory.getEvent(eventId);

    // Remove from expiration manager
    this.expiration.forget(eventId);

    // Remove the event store from the event
    if (instance) Reflect.deleteProperty(instance, EventStoreSymbol);

    // Remove from memory if it's not the same as the database
    if (this.memory !== this.database) this.memory.remove(event);

    // Remove the event from the database
    const removed = this.database.remove(event);

    // If the event was removed, notify the subscriptions
    if (removed && instance) this.remove$.next(instance);

    return removed;
  }

  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number {
    // Get events that will be removed for notification
    const eventsToRemove = this.getByFilters(filters);

    // Remove from expiration manager
    for (const event of eventsToRemove) this.expiration.forget(event.id);

    // Remove from memory if it's not the same as the database
    if (this.memory !== this.database) this.memory.removeByFilters(filters);

    // Remove from database
    const removedCount = this.database.removeByFilters(filters);

    // Notify subscriptions for each removed event
    for (const event of eventsToRemove) {
      this.remove$.next(event);
    }

    return removedCount;
  }

  /** Add an event to the store and notifies all subscribes it has updated */
  update(event: E): boolean {
    // Map the event to the current instance in the database
    const e = this.database.add(event);
    if (!e) return false;

    // Notify the database that the event has updated
    this.database.update?.(event);

    this.update$.next(event);
    return true;
  }

  /** Check if the store has an event by id */
  hasEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): boolean {
    if (typeof id === "string") return this.memory.hasEvent(id) || this.database.hasEvent(id);
    // If its a pointer, use the advanced has event method to resolve
    else if (isEventPointer(id)) return this.memory.hasEvent(id.id) || this.database.hasEvent(id.id);
    else return this.hasReplaceable(id.kind, id.pubkey, id.identifier);
  }

  /** Get an event by id from the store */
  getEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): E | undefined {
    // Get the event from memory first, then from the database
    if (typeof id === "string") return this.memory.getEvent(id) ?? this.mapToMemory(this.database.getEvent(id));
    // If its a pointer, use the advanced get event method to resolve
    else if (isEventPointer(id)) return this.memory.getEvent(id.id) ?? this.mapToMemory(this.database.getEvent(id.id));
    else return this.getReplaceable(id.kind, id.pubkey, id.identifier);
  }

  /** Check if the store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, d?: string): boolean {
    // Check if the event exists in memory first, then in the database
    return this.memory.hasReplaceable(kind, pubkey, d) || this.database.hasReplaceable(kind, pubkey, d);
  }

  /** Gets the latest version of a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): E | undefined {
    // Get the event from memory first, then from the database
    return (
      this.memory.getReplaceable(kind, pubkey, identifier) ??
      this.mapToMemory(this.database.getReplaceable(kind, pubkey, identifier))
    );
  }

  /** Returns all versions of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): E[] | undefined {
    // Get the events from memory first, then from the database
    return (
      this.memory.getReplaceableHistory(kind, pubkey, identifier) ??
      this.database.getReplaceableHistory(kind, pubkey, identifier)?.map((e) => this.mapToMemory(e) ?? e)
    );
  }

  /** Get all events matching a filter */
  getByFilters(filters: Filter | Filter[]): E[] {
    // NOTE: no way to read from memory since memory won't have the full set of events
    const events = this.database.getByFilters(filters);
    // Map events to memory if available for better performance
    if (this.memory) return events.map((e) => this.mapToMemory(e));
    else return events;
  }

  /** Returns a timeline of events that match filters */
  getTimeline(filters: Filter | Filter[]): E[] {
    const events = this.database.getTimeline(filters);
    if (this.memory) return events.map((e) => this.mapToMemory(e));
    else return events;
  }

  /** Passthrough method for the database.touch */
  touch(event: E) {
    return this.memory.touch(event);
  }
  /** Increments the claim count on the event and touches it */
  claim(event: E): void {
    return this.memory.claim(event);
  }
  /** Checks if an event is claimed by anything */
  isClaimed(event: E): boolean {
    return this.memory.isClaimed(event) ?? false;
  }
  /** Decrements the claim count on an event */
  removeClaim(event: E): void {
    return this.memory.removeClaim(event);
  }
  /** Removes all claims on an event */
  clearClaim(event: E): void {
    return this.memory.clearClaim(event);
  }
  /** Pass through method for the database.unclaimed */
  unclaimed(): Generator<E> {
    return this.memory.unclaimed() || (function* () {})();
  }
  /** Removes any event that is not being used by a subscription */
  prune(limit?: number): number {
    return this.memory.prune(limit) ?? 0;
  }

  /**
   * Tears down the store: disposes the attached event loader, completes the event streams, releases
   * model keep-warm timers, and unsubscribes internal manager listeners.
   * @note This is a terminal operation; the store should be discarded after calling it.
   */
  override dispose(): void {
    // Tear down the attached event loader if it supports disposal
    const loader = this.eventLoader as { [Symbol.dispose]?: () => void } | undefined;
    if (loader && typeof loader[Symbol.dispose] === "function") loader[Symbol.dispose]!();
    this.eventLoader = undefined;

    // Complete all models and release their keep-warm timers
    super.dispose();

    // Tear down internal manager subscriptions
    this.internalSubscriptions.unsubscribe();

    // Cancel any pending expiration timer
    this.expiration.dispose?.();

    // Complete the event streams
    this.insert$.complete();
    this.update$.complete();
    this.remove$.complete();
  }

  /** Allows the store to be used with the `using` keyword */
  [Symbol.dispose](): void {
    this.dispose();
  }
}
