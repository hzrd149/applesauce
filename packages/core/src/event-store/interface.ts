import { Observable } from "rxjs";
import { NostrEvent, StoreEvent } from "../helpers/event.js";
import { Filter } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer, ProfilePointer } from "../helpers/pointers.js";
import { ProfileContent } from "../helpers/profile.js";

/** The read interface for an event store */
export interface IEventStoreRead<E extends StoreEvent = NostrEvent> {
  /** Check if the event store has an event with id */
  hasEvent(id: string): boolean;
  /** Get an event by id */
  getEvent(id: string): E | undefined;

  /** Check if the event store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  /** Get a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): E | undefined;
  /** Get the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): E[] | undefined;

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): E[];
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): E[];
}

/** The async read interface for an event store */
export interface IAsyncEventStoreRead<E extends StoreEvent = NostrEvent> {
  /** Check if the event store has an event with id */
  hasEvent(id: string): Promise<boolean>;
  /** Get an event by id */
  getEvent(id: string): Promise<E | undefined>;

  /** Check if the event store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean>;
  /** Get a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<E | undefined>;
  /** Get the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<E[] | undefined>;

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): Promise<E[]>;
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): Promise<E[]>;
}

/** An extended read interface for an event store that supports pointers */
export interface IEventStoreReadAdvanced<E extends StoreEvent = NostrEvent>
  extends Omit<IEventStoreRead<E>, "hasEvent" | "getEvent"> {
  /** Check if the event store has an event with id */
  hasEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): boolean;
  /** Get an event by id */
  getEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): E | undefined;
}

/** An extended async read interface for an event store that supports pointers */
export interface IAsyncEventStoreReadAdvanced<E extends StoreEvent = NostrEvent>
  extends Omit<IAsyncEventStoreRead<E>, "hasEvent" | "getEvent"> {
  /** Check if the event store has an event with id */
  hasEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): Promise<boolean>;
  /** Get an event by id */
  getEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): Promise<E | undefined>;
}

/** The stream interface for an event store */
export interface IEventStoreStreams<E extends StoreEvent = NostrEvent> {
  /** A stream of new events added to the store */
  insert$: Observable<E>;
  /** A stream of events that have been updated */
  update$: Observable<E>;
  /** A stream of events that have been removed */
  remove$: Observable<E>;
}

/** The actions for an event store */
export interface IEventStoreActions<E extends StoreEvent = NostrEvent> {
  /** Add an event to the store */
  add(event: E): E | null;
  /** Remove an event from the store */
  remove(event: string | E): boolean;
  /** Notify the store that an event has updated */
  update(event: E): void;
}

/** The async actions for an event store */
export interface IAsyncEventStoreActions<E extends StoreEvent = NostrEvent> {
  /** Add an event to the store */
  add(event: E): Promise<E | null>;
  /** Remove an event from the store */
  remove(event: string | E): Promise<boolean>;
  /** Notify the store that an event has updated */
  update(event: E): Promise<void>;
}

/** The claim interface for an event store */
export interface IEventClaims<E extends StoreEvent = NostrEvent> {
  /** Tell the store that this event was used */
  touch(event: E): void;
  /** Increments the claim count on the event */
  claim(event: E): void;
  /** Checks if an event is claimed by anything */
  isClaimed(event: E): boolean;
  /** Decrements the claim count on an event */
  removeClaim(event: E): void;
  /** Removes all claims on an event */
  clearClaim(event: E): void;
  /** Returns a generator of unclaimed events in order of least used */
  unclaimed(): Generator<E>;
}

/** An event store that can be subscribed to */
export interface IEventSubscriptions<E extends StoreEvent = NostrEvent> {
  /** Subscribe to an event by id or pointer */
  event(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): Observable<E | undefined>;
  /** Subscribe to a replaceable event by pointer */
  replaceable(pointer: AddressPointerWithoutD): Observable<E | undefined>;
  /** Subscribe to a replaceable event with legacy arguments */
  replaceable(kind: number, pubkey: string, identifier?: string): Observable<E | undefined>;
  /** Subscribe to an addressable event by pointer */
  addressable(pointer: AddressPointer): Observable<E | undefined>;
  /** Subscribe to a batch of events that match the filters */
  filters(filters: Filter | Filter[], onlyNew?: boolean): Observable<E>;
  /** Subscribe to a sorted timeline of events that match the filters */
  timeline(filters: Filter | Filter[], onlyNew?: boolean): Observable<E[]>;

  /** Subscribe to a users profile */
  profile(user: string | ProfilePointer): Observable<ProfileContent | undefined>;
  /** Subscribe to a users contacts */
  contacts(user: string | ProfilePointer): Observable<ProfilePointer[]>;
  /** Subscribe to a users mailboxes */
  mailboxes(user: string | ProfilePointer): Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;
}

/** Methods for creating common models */
export interface IEventModelMixin<TStore extends IEventStore | IAsyncEventStore> {
  // Core model method
  model<T extends unknown, Args extends Array<any>>(
    constructor: ModelConstructor<T, Args, TStore>,
    ...args: Args
  ): Observable<T>;
}

/** The interface that is passed to the model for creating subscriptions */
export type ModelEventStore<TStore extends IEventStore | IAsyncEventStore> = IEventStoreStreams &
  IEventSubscriptions &
  IEventModelMixin<TStore> &
  IMissingEventLoader &
  TStore;

/** A computed view of an event set or event store */
export type Model<T extends unknown, TStore extends IEventStore | IAsyncEventStore = IEventStore | IAsyncEventStore> = (
  events: ModelEventStore<TStore>,
) => Observable<T>;

/** A constructor for a {@link Model} */
export type ModelConstructor<
  T extends unknown,
  Args extends Array<any>,
  TStore extends IEventStore | IAsyncEventStore = IEventStore,
> = ((...args: Args) => Model<T, TStore>) & {
  getKey?: (...args: Args) => string;
};

export type DeleteEventNotification =
  | {
      /** the pointer that was deleted */
      pointer: EventPointer;
      /** The unix timestamp the event was deleted at */
      until: number;
    }
  | {
      /** the address pointer that replaced the event was deleted */
      pointer: AddressPointer;
      /** The unix timestamp the replaceable event was deleted at */
      until: number;
    };

/** Interface for managing event deletions */
export interface IDeleteManager<E extends StoreEvent = NostrEvent> {
  /** A stream of pointers that may have been deleted */
  deleted$: Observable<DeleteEventNotification>;
  /** Process a kind 5 delete event */
  add(deleteEvent: E): DeleteEventNotification[];
  /** Check if an event is deleted */
  check(event: E): boolean;
  /** filter out all deleted events from an array of events */
  filter(event: E[]): E[];
}

/** Async interface for managing event deletions */
export interface IAsyncDeleteManager<E extends StoreEvent = NostrEvent> {
  /** A stream of pointers that may have been deleted */
  deleted$: Observable<DeleteEventNotification>;
  /** Process a kind 5 delete event */
  add(deleteEvent: E): Promise<DeleteEventNotification[]>;
  /** Check if an event is deleted */
  check(event: E): Promise<boolean>;
  /** filter out all deleted events from an array of events */
  filter(event: E[]): Promise<E[]>;
}

/** Interface for managing event expirations */
export interface IExpirationManager<E extends StoreEvent = NostrEvent> {
  /** A stream of event IDs that have expired */
  expired$: Observable<string>;
  /** Add an event to the expiration manager to track */
  track(event: E): void;
  /** Remove an event from expiration tracking */
  forget(eventId: string): void;
  /** Check if an event is expired */
  check(event: E): boolean;
  /** Tears down the manager and cancels any pending timers */
  dispose?(): void;
}

/** The base interface for a database of events */
export interface IEventDatabase<E extends StoreEvent = NostrEvent> extends IEventStoreRead<E> {
  /** Add an event to the database */
  add(event: E): E;
  /** Remove an event from the database */
  remove(event: string | E): boolean;
  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number;
  /** Notifies the database that an event has updated */
  update?: (event: E) => void;
}

/** The async base interface for a set of events */
export interface IAsyncEventDatabase<E extends StoreEvent = NostrEvent> extends IAsyncEventStoreRead<E> {
  /** Add an event to the database */
  add(event: E): Promise<E>;
  /** Remove an event from the database */
  remove(event: string | E): Promise<boolean>;
  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): Promise<number>;
  /** Notifies the database that an event has updated */
  update?: (event: E) => void;
}

/** The base interface for the in-memory database of events */
export interface IEventMemory<E extends StoreEvent = NostrEvent> extends IEventStoreRead<E>, IEventClaims<E> {
  /** Add an event to the store */
  add(event: E): E;
  /** Remove an event from the store */
  remove(event: string | E): boolean;
}

/** A set of methods that an event store will use to load single events it does not have */
export interface IMissingEventLoader<E extends StoreEvent = NostrEvent> {
  /** A method that will be called when an event isn't found in the store */
  eventLoader?: (
    pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
  ) => Observable<E> | Promise<E | undefined>;
}

/** Generic async event store interface */
export interface IAsyncEventStore
  extends
    IAsyncEventStoreReadAdvanced,
    IEventStoreStreams,
    IEventSubscriptions,
    IAsyncEventStoreActions,
    IEventModelMixin<IAsyncEventStore>,
    IEventClaims,
    IMissingEventLoader {}

/** Generic sync event store interface */
export interface IEventStore
  extends
    IEventStoreReadAdvanced,
    IEventStoreStreams,
    IEventSubscriptions,
    IEventStoreActions,
    IEventModelMixin<IEventStore>,
    IEventClaims,
    IMissingEventLoader {}
