import { Observable } from "rxjs";
import { getEventUID, isAddressableKind, isReplaceableKind, NostrEvent } from "../helpers/event.js";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  getEventPointerForEvent,
  getReplaceableAddressForEvent,
} from "../helpers/pointers.js";
import { getSeenRelays } from "../helpers/relays.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { CastRefEventStore } from "./cast.js";
import { castUser, User } from "./user.js";

/** The base class for all casts */
export class EventCast<T extends NostrEvent = NostrEvent> {
  /** Alias for event.id */
  get id() {
    return this.event.id;
  }
  /** Alias for event.kind */
  get kind() {
    return this.event.kind;
  }
  /** Returns the unique identifier for this event */
  get uid() {
    return getEventUID(this.event);
  }

  /** Returns the created_at timestamp as a Date object */
  get createdAt(): Date {
    return new Date(this.event.created_at * 1000);
  }

  /** Get the {@link User} that authored this event */
  get author(): User {
    return castUser(this.event, this.store);
  }

  /** Return the set of relays this event was seen on */
  get seen() {
    return getSeenRelays(this.event);
  }

  /** Returns the NIP-01 address string for this event if its replaceable or addressable, otherwise returns null */
  get coordinate(): string | null {
    return getReplaceableAddressForEvent(this.event);
  }
  /** Alias for {@link coordinate} */
  get replaceableAddress() {
    return this.coordinate;
  }

  /** Returns a single {@link EventPointer} or {@link AddressPointer} for this event */
  get pointer(): EventPointer | AddressPointer {
    if (isReplaceableKind(this.kind) || isAddressableKind(this.kind))
      return getAddressPointerForEvent(this.event) || getEventPointerForEvent(this.event);
    return getEventPointerForEvent(this.event);
  }

  // Enfore kind check in constructor. this will force child classes to verify the event before calling super()
  constructor(
    readonly event: T,
    public readonly store: CastRefEventStore,
  ) {}

  /** A cache of observable references */
  #refs: Record<string, ChainableObservable<unknown>> = {};

  /** Internal method for creating a reference */
  protected $$ref<Return extends unknown>(
    key: string,
    builder: (store: CastRefEventStore) => Observable<Return>,
  ): ChainableObservable<Return> {
    // Return cached observable
    if (this.#refs[key]) return this.#refs[key] as ChainableObservable<Return>;

    // Build a new observable and cache it
    const observable = chainable(builder(this.store));
    this.#refs[key] = observable;
    return observable;
  }
}
