import { Filter, NostrEvent } from "nostr-tools";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";
import { Observable } from "rxjs";

import { Mutes } from "../helpers/mutes.js";
import { AddressPointerWithoutD } from "../helpers/pointers.js";
import { ProfileContent } from "../helpers/profile.js";
import { Thread } from "../models/thread.js";

/** The read interface for an event store */
export interface IEventStoreRead {
  /** Check if the event store has an event with id */
  hasEvent(id: string): boolean;
  /** Get an event by id */
  getEvent(id: string): NostrEvent | undefined;

  /** Check if the event store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  /** Get a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined;
  /** Get the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined;

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): Set<NostrEvent>;
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[];
}

/** The stream interface for an event store */
export interface IEventStoreStreams {
  /** A stream of new events added to the store */
  insert$: Observable<NostrEvent>;
  /** A stream of events that have been updated */
  update$: Observable<NostrEvent>;
  /** A stream of events that have been removed */
  remove$: Observable<NostrEvent>;
}

/** The actions for an event store */
export interface IEventStoreActions {
  /** Add an event to the store */
  add(event: NostrEvent): NostrEvent | null;
  /** Remove an event from the store */
  remove(event: string | NostrEvent): boolean;
  /** Notify the store that an event has updated */
  update(event: NostrEvent): void;
}

/** The claim interface for an event store */
export interface IEventClaims {
  /** Tell the store that this event was used */
  touch(event: NostrEvent): void;
  /** Sets the claim on the event and touches it */
  claim(event: NostrEvent, claim: any): void;
  /** Checks if an event is claimed by anything */
  isClaimed(event: NostrEvent): boolean;
  /** Removes a claim from an event */
  removeClaim(event: NostrEvent, claim: any): void;
  /** Removes all claims on an event */
  clearClaim(event: NostrEvent): void;
  /** Returns a generator of unclaimed events in order of least used */
  unclaimed(): Generator<NostrEvent>;
}

/** An event store that can be subscribed to */
export interface IEventSubscriptions {
  /** Susbscribe to an event by id */
  event(id: string | EventPointer): Observable<NostrEvent | undefined>;
  /** Subscribe to a replaceable event by pointer */
  replaceable(pointer: AddressPointerWithoutD): Observable<NostrEvent | undefined>;
  /** Subscribe to an addressable event by pointer */
  addressable(pointer: AddressPointer): Observable<NostrEvent | undefined>;
  /** Subscribe to a batch of events that match the filters */
  filter(filters: Filter | Filter[]): Observable<NostrEvent[]>;
}

/** @deprecated use {@link IEventSubscriptions} instead */
export interface IEventStoreSubscriptions extends IEventSubscriptions {}

/** Methods for creating common models */
export interface IEventStoreModels {
  // Core model method
  model<T extends unknown, Args extends Array<any>>(
    constructor: ModelConstructor<T, Args>,
    ...args: Args
  ): Observable<T>;

  // Base models
  event(id: string): Observable<NostrEvent | undefined>;
  replaceable(pointer: AddressPointerWithoutD): Observable<NostrEvent | undefined>;
  addressable(pointer: AddressPointer): Observable<NostrEvent | undefined>;
  timeline(filters: Filter | Filter[], includeOldVersion?: boolean): Observable<NostrEvent[]>;

  // Deprecated models
  events(ids: string[]): Observable<Record<string, NostrEvent | undefined>>;
  replaceableSet(
    pointers: (AddressPointer | AddressPointerWithoutD)[],
  ): Observable<Record<string, NostrEvent | undefined>>;
}

/** A computed view of an event set or event store */
export type Model<T extends unknown> = (events: IEventStore) => Observable<T>;

/** A constructor for a {@link Model} */
export type ModelConstructor<T extends unknown, Args extends Array<any>> = ((...args: Args) => Model<T>) & {
  getKey?: (...args: Args) => string;
};

/** The base interface for a set of events */
export interface IEventDatabase extends IEventStoreRead, IEventStoreActions, IEventClaims {}

/** @deprecated use {@link IEventDatabase} instead */
export interface IEventSet extends IEventDatabase {}

// TODO: this interface should be removed, or broken into smaller interfaces
export interface IEventStore
  extends IEventStoreRead,
    IEventStoreStreams,
    IEventStoreActions,
    IEventStoreModels,
    IEventClaims {
  /** Enable this to keep old versions of replaceable events */
  keepOldVersions: boolean;
  /** Enable this to keep expired events */
  keepExpired: boolean;

  filters(filters: Filter | Filter[]): Observable<NostrEvent>;
  updated(id: string | NostrEvent): Observable<NostrEvent>;
  removed(id: string): Observable<never>;

  // Legacy arguments
  replaceable(kind: number, pubkey: string, identifier?: string): Observable<NostrEvent | undefined>;
  replaceable(pointer: AddressPointerWithoutD): Observable<NostrEvent | undefined>;

  // Experimental loaders
  eventLoader?: (pointer: EventPointer) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;
  replaceableLoader?: (pointer: AddressPointerWithoutD) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;
  addressableLoader?: (pointer: AddressPointer) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  // Common user models
  profile(user: string | ProfilePointer): Observable<ProfileContent | undefined>;
  contacts(user: string | ProfilePointer): Observable<ProfilePointer[]>;
  mutes(user: string | ProfilePointer): Observable<Mutes | undefined>;
  mailboxes(user: string | ProfilePointer): Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;
  blossomServers(user: string | ProfilePointer): Observable<URL[]>;

  // Common event models
  reactions(event: NostrEvent): Observable<NostrEvent[]>;
  thread(root: string | EventPointer | AddressPointer): Observable<Thread>;
}
