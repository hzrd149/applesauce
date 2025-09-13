import hash_sum from "hash-sum";
import { Filter, kinds, NostrEvent } from "nostr-tools";
import { isAddressableKind } from "nostr-tools/kinds";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";
import {
  EMPTY,
  filter,
  finalize,
  from,
  merge,
  mergeMap,
  Observable,
  ReplaySubject,
  share,
  Subject,
  take,
  timer,
} from "rxjs";

import { getDeleteCoordinates, getDeleteIds } from "../helpers/delete.js";
import { createReplaceableAddress, EventStoreSymbol, FromCacheSymbol, isReplaceable } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { matchFilters } from "../helpers/filter.js";
import { AddressPointerWithoutD, parseCoordinate } from "../helpers/pointers.js";
import { addSeenRelay, getSeenRelays } from "../helpers/relays.js";
import { unixNow } from "../helpers/time.js";
import { IEventDatabase, IEventStore, ModelConstructor } from "./interface.js";

// Import common models
import { UserBlossomServersModel } from "../models/blossom.js";
import { EventModel, EventsModel, ReplaceableModel, ReplaceableSetModel, TimelineModel } from "../models/common.js";
import { ContactsModel } from "../models/contacts.js";
import { CommentsModel, ThreadModel } from "../models/index.js";
import { MailboxesModel } from "../models/mailboxes.js";
import { MuteModel } from "../models/mutes.js";
import { ProfileModel } from "../models/profile.js";
import { ReactionsModel } from "../models/reactions.js";
import { InMemoryEventDatabase } from "./event-database.js";

/** An extended {@link InMemoryEventDatabase} that handles replaceable events, delets, and models */
export class EventStore implements IEventStore {
  database: IEventDatabase;

  /** Enable this to keep old versions of replaceable events */
  keepOldVersions = false;

  /** Enable this to keep expired events */
  keepExpired = false;

  /**
   * A method used to verify new events before added them
   * @returns true if the event is valid, false if it should be ignored
   */
  verifyEvent?: (event: NostrEvent) => boolean;

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

  constructor(database = new InMemoryEventDatabase()) {
    this.database = database;

    // when events are added to the database, add the symbol
    this.insert$.subscribe((event) => {
      Reflect.set(event, EventStoreSymbol, this);
    });

    // when events are removed from the database, remove the symbol
    this.remove$.subscribe((event) => {
      Reflect.deleteProperty(event, EventStoreSymbol);
    });
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
    } else if (this.database.hasEvent(event.id)) {
      // Duplicate event, copy symbols and return existing event
      const existing = this.database.getEvent(event.id);
      if (existing) {
        EventStore.mergeDuplicateEvent(event, existing);
        return existing;
      }
    }

    // Verify event before inserting into the database
    if (this.verifyEvent && this.verifyEvent(event) === false) return null;

    // Insert event into database
    const inserted = this.database.add(event);

    // If the event was ignored, return null
    if (inserted === null) return null;

    // Copy cached data if its a duplicate event
    if (event !== inserted) EventStore.mergeDuplicateEvent(event, inserted);

    // attach relay this event was from
    if (fromRelay) addSeenRelay(inserted, fromRelay);

    // Emit insert$ signal
    if (inserted === event) this.insert$.next(inserted);

    // remove all old version of the replaceable event
    if (!this.keepOldVersions && isReplaceable(event.kind)) {
      const existing = this.database.getReplaceableHistory(event.kind, event.pubkey, identifier);

      if (existing) {
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
    // Get the current instance from the database
    const e = this.database.getEvent(typeof event === "string" ? event : event.id);
    if (!e) return false;

    const removed = this.database.remove(event);
    if (removed && e) this.remove$.next(e);
    return removed;
  }

  /** Add an event to the store and notifies all subscribes it has updated */
  update(event: NostrEvent): boolean {
    // Map the event to the current instance in the database
    const e = this.database.add(event);
    if (!e) return false;

    this.database.update(event);
    this.update$.next(event);
    return true;
  }

  /** Passthrough method for the database.touch */
  touch(event: NostrEvent) {
    this.database.touch(event);
  }

  /** Pass through method for the database.unclaimed */
  unclaimed(): Generator<NostrEvent> {
    return this.database.unclaimed();
  }

  /** Removes any event that is not being used by a subscription */
  prune(limit?: number): number {
    let removed = 0;

    const unclaimed = this.database.unclaimed();
    for (const event of unclaimed) {
      this.remove(event);

      removed++;
      if (limit && removed >= limit) break;
    }

    return removed;
  }

  /** Check if the store has an event by id */
  hasEvent(id: string): boolean {
    return this.database.hasEvent(id);
  }

  /** Get an event by id from the store */
  getEvent(id: string): NostrEvent | undefined {
    return this.database.getEvent(id);
  }

  /** Check if the store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, d?: string): boolean {
    return this.database.hasReplaceable(kind, pubkey, d);
  }

  /** Gets the latest version of a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined {
    return this.database.getReplaceable(kind, pubkey, identifier);
  }

  /** Returns all versions of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined {
    return this.database.getReplaceableHistory(kind, pubkey, identifier);
  }

  /** Get all events matching a filter */
  getByFilters(filters: Filter | Filter[]): Set<NostrEvent> {
    return this.database.getByFilters(filters);
  }

  /** Returns a timeline of events that match filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[] {
    return this.database.getTimeline(filters);
  }

  /** Sets the claim on the event and touches it */
  claim(event: NostrEvent, claim: any): void {
    this.database.claim(event, claim);
  }
  /** Checks if an event is claimed by anything */
  isClaimed(event: NostrEvent): boolean {
    return this.database.isClaimed(event);
  }
  /** Removes a claim from an event */
  removeClaim(event: NostrEvent, claim: any): void {
    this.database.removeClaim(event, claim);
  }
  /** Removes all claims on an event */
  clearClaim(event: NostrEvent): void {
    this.database.clearClaim(event);
  }

  /** A directory of all active models */
  protected models = new Map<ModelConstructor<any, any[]>, Map<string, Observable<any>>>();

  /** How long a model should be kept "warm" while nothing is subscribed to it */
  modelKeepWarm = 60_000;

  /** Get or create a model on the event store */
  model<T extends unknown, Args extends Array<any>>(
    constructor: ModelConstructor<T, Args>,
    ...args: Args
  ): Observable<T> {
    let models = this.models.get(constructor);
    if (!models) {
      models = new Map();
      this.models.set(constructor, models);
    }

    const key = constructor.getKey ? constructor.getKey(...args) : hash_sum(args);
    let model: Observable<T> | undefined = models.get(key);

    // Create the model if it does not exist
    if (!model) {
      const cleanup = () => {
        // Remove the model from the cache if its the same one
        if (models.get(key) === model) models.delete(key);
      };

      model = constructor(...args)(this).pipe(
        // remove the model when its unsubscribed
        finalize(cleanup),
        // only subscribe to models once for all subscriptions
        share({
          connector: () => new ReplaySubject(1),
          resetOnComplete: () => timer(this.modelKeepWarm),
          resetOnRefCountZero: () => timer(this.modelKeepWarm),
        }),
      );

      // Add the model to the cache
      models.set(key, model);
    }

    return model;
  }

  /**
   * Creates an observable that streams all events that match the filter
   * @param filters
   * @param [onlyNew=false] Only subscribe to new events
   */
  filters(filters: Filter | Filter[], onlyNew = false): Observable<NostrEvent> {
    filters = Array.isArray(filters) ? filters : [filters];

    return merge(
      // merge existing events
      onlyNew ? EMPTY : from(this.getByFilters(filters)),
      // subscribe to future events
      this.insert$.pipe(filter((e) => matchFilters(filters, e))),
    );
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

  // Helper methods for creating models

  /** Creates a {@link EventModel} */
  event(pointer: string | EventPointer): Observable<NostrEvent | undefined> {
    if (typeof pointer === "string") pointer = { id: pointer };

    return this.model(EventModel, pointer);
  }

  /** Creates a {@link ReplaceableModel} */
  replaceable(pointer: AddressPointer | AddressPointerWithoutD): Observable<NostrEvent | undefined>;
  replaceable(kind: number, pubkey: string, identifier?: string): Observable<NostrEvent | undefined>;
  replaceable(...args: any[]): Observable<NostrEvent | undefined> {
    let pointer: AddressPointer | AddressPointerWithoutD | undefined;

    // Parse arguments
    if (args.length === 1) {
      pointer = args[0] as AddressPointer | AddressPointerWithoutD;
    } else if (args.length === 3 || args.length === 2) {
      let [kind, pubkey, identifier] = args as [number, string, string | undefined];
      pointer = { kind, pubkey, identifier };
    }

    if (!pointer) throw new Error("Invalid arguments, expected address pointer or kind, pubkey, identifier");

    return this.model(ReplaceableModel, pointer);
  }

  /** Subscribe to an addressable event by pointer */
  addressable(pointer: AddressPointer): Observable<NostrEvent | undefined> {
    return this.model(ReplaceableModel, pointer);
  }

  /** Creates a {@link TimelineModel} */
  timeline(filters: Filter | Filter[], includeOldVersion = false): Observable<NostrEvent[]> {
    return this.model(TimelineModel, filters, includeOldVersion);
  }

  /** Subscribe to a users profile */
  profile(user: string | ProfilePointer) {
    return this.model(ProfileModel, user);
  }

  /** Subscribe to a users contacts */
  contacts(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(ContactsModel, user);
  }

  /** Subscribe to a users mutes */
  mutes(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(MuteModel, user);
  }

  /** Subscribe to a users NIP-65 mailboxes */
  mailboxes(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(MailboxesModel, user);
  }

  /** Subscribe to a users blossom servers */
  blossomServers(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(UserBlossomServersModel, user);
  }

  /** Subscribe to an event's reactions */
  reactions(event: NostrEvent) {
    return this.model(ReactionsModel, event);
  }

  /** Subscribe to a thread */
  thread(root: string | EventPointer | AddressPointer) {
    return this.model(ThreadModel, root);
  }

  /** Subscribe to a event's comments */
  comments(event: NostrEvent) {
    return this.model(CommentsModel, event);
  }

  /** @deprecated use multiple {@link EventModel} instead */
  events(ids: string[]): Observable<Record<string, NostrEvent | undefined>> {
    return this.model(EventsModel, ids);
  }

  /** @deprecated use multiple {@link ReplaceableModel} instead */
  replaceableSet(
    pointers: { kind: number; pubkey: string; identifier?: string }[],
  ): Observable<Record<string, NostrEvent | undefined>> {
    return this.model(ReplaceableSetModel, pointers);
  }
}
