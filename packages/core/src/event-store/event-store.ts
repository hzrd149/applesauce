import { EMPTY, filter, mergeMap, Observable, Subject, take } from "rxjs";
import { NostrEvent, kinds } from "../helpers/event.js";
import { isAddressableKind } from "../helpers/event.js";
import { getDeleteCoordinates, getDeleteIds } from "../helpers/delete.js";
import { createReplaceableAddress, EventStoreSymbol, FromCacheSymbol, isReplaceable } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { Filter } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer, parseCoordinate } from "../helpers/pointers.js";
import { addSeenRelay, getSeenRelays } from "../helpers/relays.js";
import { unixNow } from "../helpers/time.js";
import { EventMemory } from "./event-memory.js";
import { IEventDatabase, IEventStore } from "./interface.js";
import { verifyEvent as coreVerifyEvent } from "nostr-tools/pure";
import { EventModels } from "./event-models.js";

/** A wrapper around an event database that handles replaceable events, deletes, and models */
export class EventStore extends EventModels implements IEventStore {
  database: IEventDatabase;

  /** Optional memory database for ensuring single event instances */
  memory: EventMemory;

  /** Enable this to keep old versions of replaceable events */
  keepOldVersions = false;

  /** Enable this to keep expired events */
  keepExpired = false;

  /** The method used to verify events */
  private _verifyEventMethod?: (event: NostrEvent) => boolean = coreVerifyEvent;

  /** Get the method used to verify events */
  get verifyEvent(): undefined | ((event: NostrEvent) => boolean) {
    return this._verifyEventMethod;
  }

  /** Sets the method used to verify events */
  set verifyEvent(method: undefined | ((event: NostrEvent) => boolean)) {
    this._verifyEventMethod = method;

    if (method === undefined) {
      console.warn("[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.");
    }
  }

  /** A stream of new events added to the store */
  insert$ = new Subject<NostrEvent>();

  /** A stream of events that have been updated */
  update$ = new Subject<NostrEvent>();

  /** A stream of events that have been removed */
  remove$ = new Subject<NostrEvent>();

  /**
   * A method that will be called when an event isn't found in the store
   * @experimental
   */
  eventLoader?: (pointer: EventPointer) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  /**
   * A method that will be called when a replaceable event isn't found in the store
   * @experimental
   */
  replaceableLoader?: (pointer: AddressPointerWithoutD) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  /**
   * A method that will be called when an addressable event isn't found in the store
   * @experimental
   */
  addressableLoader?: (pointer: AddressPointer) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  constructor(database: IEventDatabase = new EventMemory()) {
    super();
    if (database) {
      this.database = database;
      this.memory = new EventMemory();
    } else {
      // If no database is provided, its the same as having a memory database
      this.database = this.memory = new EventMemory();
    }

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

  // delete state
  protected deletedIds = new Set<string>();
  protected deletedCoords = new Map<string, number>();
  protected checkDeleted(event: string | NostrEvent) {
    if (typeof event === "string") return this.deletedIds.has(event);
    else {
      if (this.deletedIds.has(event.id)) return true;

      if (isAddressableKind(event.kind)) {
        const identifier = event.tags.find((t) => t[0] === "d")?.[1];
        const deleted = this.deletedCoords.get(createReplaceableAddress(event.kind, event.pubkey, identifier));
        if (deleted) return deleted > event.created_at;
      }
    }

    return false;
  }

  protected expirations = new Map<string, number>();

  /** Adds an event to the expiration map */
  protected addExpiration(event: NostrEvent) {
    const expiration = getExpirationTimestamp(event);
    if (expiration && Number.isFinite(expiration)) this.expirations.set(event.id, expiration);
  }

  protected expirationTimeout: number | null = null;
  protected nextExpirationCheck: number | null = null;
  protected handleExpiringEvent(event: NostrEvent) {
    const expiration = getExpirationTimestamp(event);
    if (!expiration) return;

    // Add event to expiration map
    this.expirations.set(event.id, expiration);

    // Exit if the next check is already less than the next expiration
    if (this.expirationTimeout && this.nextExpirationCheck && this.nextExpirationCheck < expiration) return;

    // Set timeout to prune expired events
    if (this.expirationTimeout) clearTimeout(this.expirationTimeout);
    const timeout = expiration - unixNow();
    this.expirationTimeout = setTimeout(this.pruneExpired.bind(this), timeout * 1000 + 10);
    this.nextExpirationCheck = expiration;
  }

  /** Remove expired events from the store */
  protected pruneExpired() {
    const now = unixNow();
    for (const [id, expiration] of this.expirations) {
      if (expiration <= now) {
        this.expirations.delete(id);
        this.remove(id);
      }
    }

    // Cleanup timers
    if (this.expirationTimeout) clearTimeout(this.expirationTimeout);
    this.nextExpirationCheck = null;
    this.expirationTimeout = null;
  }

  // handling delete events
  protected handleDeleteEvent(deleteEvent: NostrEvent) {
    const ids = getDeleteIds(deleteEvent);
    for (const id of ids) {
      this.deletedIds.add(id);

      // remove deleted events in the database
      this.remove(id);
    }

    const coords = getDeleteCoordinates(deleteEvent);
    for (const coord of coords) {
      this.deletedCoords.set(coord, Math.max(this.deletedCoords.get(coord) ?? 0, deleteEvent.created_at));

      // Parse the nostr address coordinate
      const parsed = parseCoordinate(coord);
      if (!parsed) continue;

      // Remove older versions of replaceable events
      const events = this.database.getReplaceableHistory(parsed.kind, parsed.pubkey, parsed.identifier) ?? [];
      for (const event of events) {
        if (event.created_at < deleteEvent.created_at) this.remove(event);
      }
    }
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
    if (event.kind === kinds.EventDeletion) this.handleDeleteEvent(event);

    // Ignore if the event was deleted
    if (this.checkDeleted(event)) return event;

    // Reject expired events if keepExpired is false
    const expiration = getExpirationTimestamp(event);
    if (this.keepExpired === false && expiration && expiration <= unixNow()) return null;

    // Get the replaceable identifier
    const identifier = isReplaceable(event.kind) ? event.tags.find((t) => t[0] === "d")?.[1] : undefined;

    // Don't insert the event if there is already a newer version
    if (!this.keepOldVersions && isReplaceable(event.kind)) {
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
    if (!this.keepOldVersions && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      if (existing && existing.length > 0) {
        const older = Array.from(existing).filter((e) => e.created_at < event.created_at);
        for (const old of older) this.remove(old);

        // return the newest version of the replaceable event
        // most of the time this will be === event, but not always
        if (existing.length !== older.length) return existing[0];
      }
    }

    // Add event to expiration map
    if (this.keepExpired === false && expiration) this.handleExpiringEvent(inserted);

    return inserted;
  }

  /** Removes an event from the store and updates subscriptions */
  remove(event: string | NostrEvent): boolean {
    let instance = this.memory?.getEvent(typeof event === "string" ? event : event.id);

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

  /** Returns an observable that completes when an event is removed */
  removed(id: string): Observable<never> {
    const deleted = this.checkDeleted(id);
    if (deleted) return EMPTY;

    return this.remove$.pipe(
      // listen for removed events
      filter((e) => e.id === id),
      // complete as soon as we find a matching removed event
      take(1),
      // switch to empty
      mergeMap(() => EMPTY),
    );
  }

  /** Creates an observable that emits when event is updated */
  updated(event: string | NostrEvent): Observable<NostrEvent> {
    return this.update$.pipe(filter((e) => e.id === event || e === event));
  }
}
