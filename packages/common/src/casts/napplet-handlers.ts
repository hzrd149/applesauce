import { ChainableObservable } from "applesauce-core";
import { User } from "applesauce-core/casts/user";
import { NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { hasHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { watchEventUpdates } from "applesauce-core/observable";
import { combineLatest, map, Observable, of, switchMap } from "rxjs";
import {
  getHiddenNappletHandlers,
  getNappletHandlerCandidates,
  getNappletHandlersArchetype,
  getPublicNappletHandlers,
  isHiddenNappletHandlersUnlocked,
  isValidNappletHandlers,
  NAPPLET_HANDLERS_KIND,
  NappletHandlerCandidate,
  NappletHandlerRef,
  NappletHandlersEvent,
  unlockHiddenNappletHandlers,
} from "../helpers/napplet-handlers.js";
import { createNappletConvention } from "../helpers/napplet.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Napplet, NappletSnapshot } from "./napplet.js";

/** Cast for napplet handler preferences (kind 31129) */
export class NappletHandlers extends EventCast<NappletHandlersEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNappletHandlers(event)) throw new Error("Invalid napplet handler preferences");
    super(event, store);
  }

  /** The archetype the preferences apply to */
  get archetype() {
    return getNappletHandlersArchetype(this.event);
  }
  /** The public entries, which other users read as recommendations */
  get publicEntries() {
    return getPublicNappletHandlers(this.event);
  }
  /** The private entries if unlocked, otherwise undefined */
  get hiddenEntries() {
    return getHiddenNappletHandlers(this.event);
  }
  /** An observable of the private entries that emits undefined until they are unlocked */
  get hiddenEntries$() {
    return this.$$ref("hiddenEntries$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => (event ? getHiddenNappletHandlers(event) : undefined)),
      ),
    );
  }
  /** Whether the event has encrypted private entries */
  get hasHidden() {
    return hasHiddenTags(this.event);
  }
  /** Whether the private entries are unlocked */
  get unlocked() {
    return isHiddenNappletHandlersUnlocked(this.event);
  }
  /** Decrypts the private entries */
  unlock(signer: HiddenContentSigner) {
    return unlockHiddenNappletHandlers(this.event, signer);
  }

  /** Returns the handlers to try for an intent name or convention identity, in resolution order */
  candidates(intent: string): NappletHandlerCandidate[] {
    return getNappletHandlerCandidates(this.event, this.#identity(intent));
  }

  /** Subscribes to the archetype-wide handlers, private entries first once unlocked */
  get handlers$(): ChainableObservable<(Napplet | undefined)[]> {
    return this.$$ref("handlers$", (store) =>
      this.hiddenEntries$.pipe(
        map((hidden) => [...(hidden?.handlers ?? []), ...this.publicEntries.handlers]),
        switchMap((refs) => this.#napplets$(refs, store)),
      ),
    );
  }

  /** Subscribes to the handler candidates for an intent name or convention identity, in resolution order */
  candidates$(intent: string): ChainableObservable<(Napplet | undefined)[]> {
    const identity = this.#identity(intent);

    return this.$$ref(`candidates$:${identity}`, (store) =>
      this.hiddenEntries$.pipe(
        map(() => getNappletHandlerCandidates(this.event, identity).map((candidate) => candidate.ref)),
        switchMap((refs) => this.#napplets$(refs, store)),
      ),
    );
  }

  /** Expands a bare intent name into a convention identity for this archetype */
  #identity(intent: string): string {
    return intent.startsWith("napplet:") ? intent : createNappletConvention(this.archetype, intent);
  }

  /** Subscribes to the napplets for a list of references, in the same order */
  #napplets$(refs: NappletHandlerRef[], store: CastRefEventStore): Observable<(Napplet | undefined)[]> {
    if (refs.length === 0) return of([]);

    return combineLatest(
      refs.map((ref) =>
        // A pin only resolves to a snapshot, never to the napplet it derives from
        ref.type === "snapshot"
          ? store.event(ref.pointer).pipe(castEventStream(NappletSnapshot, store))
          : store.replaceable(ref.pointer).pipe(castEventStream(Napplet, store)),
      ),
    );
  }
}

Object.defineProperty(User.prototype, "nappletHandlers$", {
  get(this: User) {
    return this.$$ref("nappletHandlers$", (store) =>
      store
        .timeline({ kinds: [NAPPLET_HANDLERS_KIND], authors: [this.pubkey] })
        .pipe(castTimelineStream(NappletHandlers, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

Object.defineProperty(User.prototype, "nappletHandlers", {
  value(this: User, archetype: string) {
    return this.$$ref(`nappletHandlers:${archetype}`, (store) =>
      store
        .addressable({ kind: NAPPLET_HANDLERS_KIND, pubkey: this.pubkey, identifier: archetype })
        .pipe(castEventStream(NappletHandlers, store)),
    );
  },
  configurable: true,
  enumerable: false,
  writable: true,
});

declare module "applesauce-core/casts" {
  interface User {
    /** Subscribes to the user's napplet handler preferences for every archetype */
    get nappletHandlers$(): ChainableObservable<NappletHandlers[]>;
    /** Subscribes to the user's own napplet handler preferences for an archetype */
    nappletHandlers(archetype: string): ChainableObservable<NappletHandlers | undefined>;
  }
}
