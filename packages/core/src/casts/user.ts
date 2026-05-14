import hash_sum from "hash-sum";
import { Observable } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { Filter } from "../helpers/filter.js";
import { nprofileEncode, npubEncode, ProfilePointer } from "../helpers/pointers.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import type { CastConstructor, CastRefEventStore, EventCast } from "./cast.js";
import { castPubkey, PubkeyCast } from "./pubkey.js";
import { castTimelineStream } from "../observable/cast-stream.js";

/** Cast a Nostr event or pointer into a {@link User} */
export function castUser(event: NostrEvent, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer | NostrEvent, store: CastRefEventStore): User {
  return castPubkey(user, User, store);
}

/** A class representing a Nostr user */
export class User extends PubkeyCast {
  /** A global cache of pubkey -> {@link User} */
  static cache = new Map<string, User>();

  get npub() {
    return npubEncode(this.pubkey);
  }

  get nprofile() {
    return nprofileEncode(this.pointer);
  }

  /** Subscribe to a replaceable event for this user */
  replaceable(kind: number, identifier?: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.store.replaceable({ kind, pubkey: this.pointer.pubkey, identifier, relays }));
  }

  /** Subscribe to an addressable event for this user */
  addressable(kind: number, identifier: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.store.addressable({ kind, pubkey: this.pointer.pubkey, identifier, relays }));
  }

  /**
   * Creates an observable of a timeline of events created by this user
   * @param input - The filter(s) for the timeline or kind(s)
   * @returns A timeline observable of events by the user rom the event store
   */
  timeline$(input: Omit<Filter, "authors"> | Omit<Filter, "authors">[] | number | number[]): Observable<NostrEvent[]>;
  timeline$<T extends EventCast>(
    input: Omit<Filter, "authors"> | Omit<Filter, "authors">[] | number | number[],
    cast?: CastConstructor<T>,
  ): Observable<T[]>;
  timeline$<T extends EventCast>(
    input: Omit<Filter, "authors"> | Omit<Filter, "authors">[] | number | number[],
    cast?: CastConstructor<T>,
  ): Observable<T[]> | Observable<NostrEvent[]> {
    let filters: Filter[] = [];

    if (typeof input === "number") {
      filters.push({ kinds: [input] });
    } else if (Array.isArray(input)) {
      filters.push(...input.map((f) => (typeof f === "number" ? { kinds: [f] } : f)));
    } else if (input instanceof Object) {
      filters.push(input);
    }

    // Use hash_sum to create a unique key for the timeline observable
    const key = "timeline$|" + hash_sum(filters);
    const base$ = this.$$ref(key, (store) => store.timeline(filters.map((f) => ({ ...f, authors: [this.pubkey] }))));

    // Cast the timeline stream into a cast if provided
    if (cast) return base$.pipe(castTimelineStream(cast));
    else return base$;
  }
}
