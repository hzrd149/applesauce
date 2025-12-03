import { Observable } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { Filter } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer } from "../helpers/pointers.js";
import { IEventStoreModels } from "./event-models.js";

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
  getByFilters(filters: Filter | Filter[]): NostrEvent[];
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[];
}

/** The async read interface for an event store */
export interface IAsyncEventStoreRead {
  /** Check if the event store has an event with id */
  hasEvent(id: string): Promise<boolean>;
  /** Get an event by id */
  getEvent(id: string): Promise<NostrEvent | undefined>;

  /** Check if the event store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean>;
  /** Get a replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent | undefined>;
  /** Get the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent[] | undefined>;

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): Promise<NostrEvent[]>;
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): Promise<NostrEvent[]>;
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

/** The async actions for an event store */
export interface IAsyncEventStoreActions {
  /** Add an event to the store */
  add(event: NostrEvent): Promise<NostrEvent | null>;
  /** Remove an event from the store */
  remove(event: string | NostrEvent): Promise<boolean>;
  /** Notify the store that an event has updated */
  update(event: NostrEvent): Promise<void>;
}

/** The claim interface for an event store */
export interface IEventClaims {
  /** Tell the store that this event was used */
  touch(event: NostrEvent): void;
  /** Increments the claim count on the event */
  claim(event: NostrEvent): void;
  /** Checks if an event is claimed by anything */
  isClaimed(event: NostrEvent): boolean;
  /** Decrements the claim count on an event */
  removeClaim(event: NostrEvent): void;
  /** Removes all claims on an event */
  clearClaim(event: NostrEvent): void;
  /** Returns a generator of unclaimed events in order of least used */
  unclaimed(): Generator<NostrEvent>;
}

/** An event store that can be subscribed to */
export interface IEventSubscriptions {
  /** Subscribe to an event by id */
  event(id: string | EventPointer): Observable<NostrEvent | undefined>;
  /** Subscribe to a replaceable event by pointer */
  replaceable(pointer: AddressPointerWithoutD): Observable<NostrEvent | undefined>;
  /** Subscribe to a replaceable event with legacy arguments */
  replaceable(kind: number, pubkey: string, identifier?: string): Observable<NostrEvent | undefined>;
  /** Subscribe to an addressable event by pointer */
  addressable(pointer: AddressPointer): Observable<NostrEvent | undefined>;
  /** Subscribe to a batch of events that match the filters */
  filters(filters: Filter | Filter[], onlyNew?: boolean): Observable<NostrEvent>;
  /** Subscribe to a sorted timeline of events that match the filters */
  timeline(filters: Filter | Filter[], onlyNew?: boolean): Observable<NostrEvent[]>;
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

/** The base interface for a database of events */
export interface IEventDatabase extends IEventStoreRead {
  /** Add an event to the database */
  add(event: NostrEvent): NostrEvent;
  /** Remove an event from the database */
  remove(event: string | NostrEvent): boolean;
  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number;
  /** Notifies the database that an event has updated */
  update?: (event: NostrEvent) => void;
}

/** The async base interface for a set of events */
export interface IAsyncEventDatabase extends IAsyncEventStoreRead {
  /** Add an event to the database */
  add(event: NostrEvent): Promise<NostrEvent>;
  /** Remove an event from the database */
  remove(event: string | NostrEvent): Promise<boolean>;
  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): Promise<number>;
  /** Notifies the database that an event has updated */
  update?: (event: NostrEvent) => void;
}

/** The base interface for the in-memory database of events */
export interface IEventMemory extends IEventStoreRead, IEventClaims {
  /** Add an event to the store */
  add(event: NostrEvent): NostrEvent;
  /** Remove an event from the store */
  remove(event: string | NostrEvent): boolean;
}

/** A set of methods that an event store will use to load single events it does not have */
export interface IMissingEventLoader {
  /** A method that will be called when an event isn't found in the store */
  eventLoader?: (
    pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
  ) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;
}

/** Generic async event store interface */
export interface IAsyncEventStore
  extends
    IAsyncEventStoreRead,
    IEventStoreStreams,
    IEventSubscriptions,
    IAsyncEventStoreActions,
    IEventModelMixin<IAsyncEventStore>,
    IEventClaims,
    IMissingEventLoader,
    IEventStoreModels {}

/** Generic sync event store interface */
export interface IEventStore
  extends
    IEventStoreRead,
    IEventStoreStreams,
    IEventSubscriptions,
    IEventStoreActions,
    IEventModelMixin<IEventStore>,
    IEventClaims,
    IMissingEventLoader,
    IEventStoreModels {}
