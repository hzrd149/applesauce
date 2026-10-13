import { ChainableObservable, withImmediateValueOrDefault } from "applesauce-core";
import { User } from "applesauce-core/casts/user";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  addRelayHintsToPointer,
  AddressPointer,
  encodePointer,
  EventPointer,
  getAddressPointerForEvent,
  getEventPointerForEvent,
} from "applesauce-core/helpers/pointers";
import { map, Observable, of } from "rxjs";
import {
  getNappletArchetypes,
  getNappletArtifactHash,
  getNappletDescription,
  getNappletIcon,
  getNappletIdentifier,
  getNappletIntents,
  getNappletOptionalDomains,
  getNappletParentPointer,
  getNappletRequiredDomains,
  getNappletRootPointer,
  getNappletServers,
  getNappletSource,
  getNappletTitle,
  isNamedNapplet,
  isNappletSnapshot,
  isRootNapplet,
  isValidNamedNapplet,
  isValidNapplet,
  isValidNappletSnapshot,
  isValidRootNapplet,
  NamedNappletEvent,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NAPPLET_SNAPSHOT_KIND,
  NappletEvent,
  NappletSnapshotEvent,
  RootNappletEvent,
} from "../helpers/napplet.js";
import { CommentsModel } from "../models/comments.js";
import { ReactionsModel } from "../models/reactions.js";
import { SharesModel } from "../models/shares.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import { Reaction } from "./reaction.js";
import { Share } from "./share.js";
import { Zap } from "./zap.js";

/** Cast for any NIP-5D napplet manifest (kinds 5129, 15129 and 35129) */
export class Napplet<T extends NappletEvent = NappletEvent> extends EventCast<T> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNapplet(event)) throw new Error("Invalid napplet manifest");
    super(event as T, store);
  }

  /** The sha256 of the napplet `index.html` artifact */
  get artifactHash() {
    return getNappletArtifactHash(this.event);
  }
  /** The plain-text description of the napplet */
  get description() {
    return getNappletDescription(this.event);
  }
  /** The short display label */
  get title() {
    return getNappletTitle(this.event);
  }
  /** The archetypes the napplet advertises */
  get archetypes() {
    return getNappletArchetypes(this.event);
  }
  /** The intents the napplet accepts */
  get intents() {
    return getNappletIntents(this.event);
  }
  /** The NAP domains required for full functionality */
  get requiredDomains() {
    return getNappletRequiredDomains(this.event);
  }
  /** The optional NAP domains */
  get optionalDomains() {
    return getNappletOptionalDomains(this.event);
  }
  /** The content-addressed icon, if valid */
  get icon() {
    return getNappletIcon(this.event);
  }
  /** The Blossom server hints for the artifact and icon blobs */
  get servers() {
    return getNappletServers(this.event);
  }
  /** The source URL */
  get source() {
    return getNappletSource(this.event);
  }

  /** Whether this is a kind 5129 snapshot */
  get isSnapshot() {
    return isNappletSnapshot(this.event);
  }
  /** Whether this is a kind 15129 root napplet */
  get isRoot() {
    return isRootNapplet(this.event);
  }
  /** Whether this is a kind 35129 named napplet */
  get isNamed() {
    return isNamedNapplet(this.event);
  }

  /** An address pointer for root and named napplets, or an event pointer for snapshots */
  get pointer(): AddressPointer | EventPointer {
    return getAddressPointerForEvent(this.event) ?? getEventPointerForEvent(this.event);
  }
  /** An observable of the pointer with relay hints from the authors outboxes */
  get pointer$(): Observable<AddressPointer | EventPointer> {
    return this.author.outboxes$.pipe(
      withImmediateValueOrDefault(undefined),
      map((outboxes) => (outboxes ? addRelayHintsToPointer(this.pointer, outboxes.slice(0, 3)) : this.pointer)),
    );
  }

  /** The NIP-19 naddr, or nevent for snapshots */
  get address() {
    return encodePointer(this.pointer);
  }
  /** An observable of the NIP-19 address with relay hints from the authors outboxes */
  get address$() {
    return this.pointer$.pipe(map((pointer) => encodePointer(pointer)));
  }

  /** Subscribes to the NIP-22 comments on this napplet */
  get comments$() {
    return this.$$ref("comments$", (store) =>
      store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
    );
  }
  /** Subscribes to the reactions to this napplet */
  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
  /** Subscribes to the zaps of this napplet */
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castTimelineStream(Zap, store)));
  }
  /** Subscribes to the shares of this napplet */
  get shares$() {
    return this.$$ref("shares$", (store) =>
      store.model(SharesModel, this.event).pipe(castTimelineStream(Share, store)),
    );
  }
}

/** Base class for root and named napplets that snapshots can derive from */
class AddressableNapplet<T extends RootNappletEvent | NamedNappletEvent> extends Napplet<T> {
  /** The `kind:pubkey:identifier` address used by snapshot `a` and `A` tags */
  get coordinate(): string {
    return super.coordinate!;
  }

  /** Subscribes to the snapshots that derive directly from this napplet */
  get snapshots$(): ChainableObservable<NappletSnapshot[]> {
    return this.$$ref("snapshots$", (store) =>
      store
        .timeline({ kinds: [NAPPLET_SNAPSHOT_KIND], "#a": [this.coordinate] })
        .pipe(castTimelineStream(NappletSnapshot, store)),
    );
  }
  /** Subscribes to every snapshot whose lineage originates from this napplet */
  get lineage$(): ChainableObservable<NappletSnapshot[]> {
    return this.$$ref("lineage$", (store) =>
      store
        .timeline({ kinds: [NAPPLET_SNAPSHOT_KIND], "#A": [this.coordinate] })
        .pipe(castTimelineStream(NappletSnapshot, store)),
    );
  }
}

/** Cast for a NIP-5D root napplet (kind 15129) */
export class RootNapplet extends AddressableNapplet<RootNappletEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRootNapplet(event)) throw new Error("Invalid root napplet");
    super(event, store);
  }
}

/** Cast for a NIP-5D named napplet (kind 35129) */
export class NamedNapplet extends AddressableNapplet<NamedNappletEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNamedNapplet(event)) throw new Error("Invalid named napplet");
    super(event, store);
  }

  /** The `d` tag identifier of the napplet */
  get identifier(): string {
    return getNappletIdentifier(this.event)!;
  }
}

/** Cast for a NIP-5D napplet snapshot (kind 5129) */
export class NappletSnapshot extends Napplet<NappletSnapshotEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNappletSnapshot(event)) throw new Error("Invalid napplet snapshot");
    super(event, store);
  }

  /** The address of the napplet this snapshot derives from */
  get parentPointer() {
    return getNappletParentPointer(this.event);
  }
  /** The address of the root napplet this snapshot's lineage originates from */
  get rootPointer() {
    return getNappletRootPointer(this.event);
  }

  /** Subscribes to the napplet this snapshot derives from */
  get parent$(): ChainableObservable<Napplet | undefined> {
    return this.$$ref("parent$", (store) => {
      const pointer = this.parentPointer;
      return pointer ? store.replaceable(pointer).pipe(castEventStream(Napplet, store)) : of(undefined);
    });
  }
  /** Alias for {@link parent$} */
  get upstream$() {
    return this.parent$;
  }
  /** Subscribes to the root napplet this snapshot's lineage originates from */
  get root$(): ChainableObservable<Napplet | undefined> {
    return this.$$ref("root$", (store) => {
      const pointer = this.rootPointer;
      return pointer ? store.replaceable(pointer).pipe(castEventStream(Napplet, store)) : of(undefined);
    });
  }
}

Object.defineProperty(User.prototype, "napplets$", {
  get(this: User) {
    return this.$$ref("napplets$", (store) =>
      store
        .timeline({ kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND], authors: [this.pubkey] })
        .pipe(castTimelineStream(Napplet, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

Object.defineProperty(User.prototype, "napplet$", {
  get(this: User) {
    return this.$$ref("napplet$", (store) =>
      store.replaceable({ kind: NAPPLET_ROOT_KIND, pubkey: this.pubkey }).pipe(castEventStream(RootNapplet, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    /** Subscribes to the user's root and named napplets */
    get napplets$(): ChainableObservable<Napplet[]>;
    /** Subscribes to the user's root (kind 15129) napplet */
    get napplet$(): ChainableObservable<RootNapplet | undefined>;
  }
}
