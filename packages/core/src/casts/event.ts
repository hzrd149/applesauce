import { Observable } from "rxjs";
import { getEventUID, isAddressableKind, isReplaceableKind, NostrEvent, StoreEvent } from "../helpers/event.js";
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

/**
 * The base class for all casts. `T` is bounded by {@link StoreEvent} (not `NostrEvent`) so a
 * cast can wrap an unsigned {@link Rumor} as well as a signed event — `EventCast` never reads
 * `.sig`. The event-reading helpers below are still typed `NostrEvent`, so they are bridged
 * with a localized `as NostrEvent`; each reads only fields present on a rumor.
 */
export class EventCast<T extends StoreEvent = NostrEvent> {
  /**
   * The event viewed as a signed `NostrEvent`, for the event-reading helpers that are still
   * typed `NostrEvent` but only touch fields a rumor already has (id/kind/pubkey/created_at/
   * tags). A documented internal bridge until those helpers are genericized over StoreEvent.
   */
  private get signedView(): NostrEvent {
    return this.event as unknown as NostrEvent;
  }

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
    return getEventUID(this.signedView);
  }

  /** Returns the created_at timestamp as a Date object */
  get createdAt(): Date {
    return new Date(this.event.created_at * 1000);
  }

  /** Get the {@link User} that authored this event */
  get author(): User {
    // Route via the pubkey string overload: result-identical for signed events and correct for
    // rumors (passing the event would hit `isEvent`, which requires `sig` and misroutes a rumor).
    return castUser(this.event.pubkey, this.store);
  }

  /** Return the set of relays this event was seen on */
  get seen() {
    return getSeenRelays(this.signedView);
  }

  /** Returns the NIP-01 address string for this event if its replaceable or addressable, otherwise returns null */
  get coordinate(): string | null {
    return getReplaceableAddressForEvent(this.signedView);
  }
  /** Alias for {@link coordinate} */
  get replaceableAddress() {
    return this.coordinate;
  }

  /** Returns a single {@link EventPointer} or {@link AddressPointer} for this event */
  get pointer(): EventPointer | AddressPointer {
    if (isReplaceableKind(this.kind) || isAddressableKind(this.kind))
      return getAddressPointerForEvent(this.signedView) || getEventPointerForEvent(this.signedView);
    return getEventPointerForEvent(this.signedView);
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
