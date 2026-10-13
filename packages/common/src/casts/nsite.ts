import "./user.js";
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
import { combineLatest, map, Observable, of } from "rxjs";
import { normalizeBlossomServer } from "../helpers/blossom.js";
import {
  AppNsitesModel,
  NsiteCopiesModel,
  NsiteLineageModel,
  NsiteSnapshotsModel,
  RootNsiteModel,
  UserNsitesModel,
  UserNsiteSnapshotsModel,
} from "../models/nsite.js";
import { Profile } from "./profile.js";
import {
  getNsiteFiles,
  getNsiteAggregateHash,
  getComputedNsiteAggregateHash,
  getNsiteAppPointers,
  getNsiteDescription,
  getNsiteIdentifier,
  getNsiteParentPointer,
  getNsiteRootPointer,
  getNsiteServers,
  getNsiteSource,
  getNsiteTitle,
  getNsiteHostLabel,
  getNsiteURL,
  resolveNsitePath,
  isNamedNsite,
  isNsiteSnapshot,
  isRootNsite,
  isValidNamedNsite,
  isValidNsite,
  isValidNsiteSnapshot,
  isValidRootNsite,
  NamedNsiteEvent,
  NsiteEvent,
  NsiteSnapshotEvent,
  RootNsiteEvent,
} from "../helpers/nsite.js";
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

/** Cast for any NIP-5A nsite manifest (kinds 5128, 15128 and 35128) */
export class Nsite<T extends NsiteEvent = NsiteEvent> extends EventCast<T> {
  /**
   * Creates a cast for a validated manifest
   * @throws if the event is not a valid manifest of this cast
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNsite(event)) throw new Error("Invalid nsite manifest");
    super(event as T, store);
  }

  /** The valid file mappings */
  get files() {
    return getNsiteFiles(this.event);
  }
  /** The advertised aggregate hash */
  get aggregateHash() {
    return getNsiteAggregateHash(this.event);
  }
  /** The computed aggregate hash */
  get computedAggregateHash() {
    return getComputedNsiteAggregateHash(this.event);
  }
  /** The site description */
  get description() {
    return getNsiteDescription(this.event);
  }
  /** The site's display title */
  get title() {
    return getNsiteTitle(this.event);
  }
  /** The Blossom server hints */
  get servers() {
    return getNsiteServers(this.event);
  }
  /** The source repository or archive URL */
  get source() {
    return getNsiteSource(this.event);
  }
  /** The upstream app descriptor pointers */
  get appPointers() {
    return getNsiteAppPointers(this.event);
  }
  /** The canonical DNS label on an nsite host */
  get hostLabel() {
    return getNsiteHostLabel(this.event);
  }
  /**
   * Returns the site's URL on an nsite host
   * @throws if the host URL is invalid
   */
  url(host: string | URL) {
    return getNsiteURL(this.event, host);
  }
  /** Resolves a request path with index and not-found fallbacks */
  resolvePath(path: string) {
    return resolveNsitePath(this.event, path);
  }
  /** Subscribes to upstream app descriptor events */
  get apps$(): ChainableObservable<(NostrEvent | undefined)[]> {
    return this.$$ref("apps$", (store) =>
      this.appPointers.length ? combineLatest(this.appPointers.map((p) => store.replaceable(p))) : of([]),
    );
  }
  /** Subscribes to manifest server hints followed by the author's Blossom servers */
  get servers$(): ChainableObservable<URL[]> {
    return this.$$ref("servers$", () =>
      this.author.blossomServers$.pipe(
        map((servers) => {
          const hints: URL[] = [];
          for (const server of this.servers) {
            try {
              hints.push(normalizeBlossomServer(server));
            } catch {}
          }
          return [...new Map([...hints, ...(servers ?? [])].map((url) => [url.href, url])).values()];
        }),
      ),
    );
  }
  /** The immediate parent site's address */
  get parentPointer() {
    return getNsiteParentPointer(this.event);
  }
  /** The origin site address of the copy lineage */
  get rootPointer() {
    return getNsiteRootPointer(this.event);
  }
  /** Subscribes to the immediate parent site */
  get parent$(): ChainableObservable<Nsite | undefined> {
    return this.$$ref("parent$", (store) =>
      this.parentPointer ? store.replaceable(this.parentPointer).pipe(castEventStream(Nsite, store)) : of(undefined),
    );
  }
  /** Subscribes to the origin site of the copy lineage */
  get root$(): ChainableObservable<Nsite | undefined> {
    return this.$$ref("root$", (store) =>
      this.rootPointer ? store.replaceable(this.rootPointer).pipe(castEventStream(Nsite, store)) : of(undefined),
    );
  }
  /** An alias for the immediate parent site */
  get upstream$() {
    return this.parent$;
  }

  /** Whether this is a kind 5128 snapshot */
  get isSnapshot() {
    return isNsiteSnapshot(this.event);
  }
  /** Whether this is a kind 15128 root nsite */
  get isRoot() {
    return isRootNsite(this.event);
  }
  /** Whether this is a kind 35128 named nsite */
  get isNamed() {
    return isNamedNsite(this.event);
  }

  /** An address pointer for root and named nsites, or an event pointer for snapshots */
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

  /** Subscribes to the NIP-22 comments on this nsite */
  get comments$() {
    return this.$$ref("comments$", (store) =>
      store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
    );
  }
  /** Subscribes to the reactions to this nsite */
  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
  /** Subscribes to the zaps of this nsite */
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castTimelineStream(Zap, store)));
  }
  /** Subscribes to the shares of this nsite */
  get shares$() {
    return this.$$ref("shares$", (store) =>
      store.model(SharesModel, this.event).pipe(castTimelineStream(Share, store)),
    );
  }
}

/** Base class for root and named nsites that snapshots can derive from */
class AddressableNsite<T extends RootNsiteEvent | NamedNsiteEvent> extends Nsite<T> {
  /** The `kind:pubkey:identifier` address used by snapshot `a` and `A` tags */
  get coordinate(): string {
    return super.coordinate!;
  }

  /** Subscribes to snapshots of this site */
  get snapshots$(): ChainableObservable<NsiteSnapshot[]> {
    return this.$$ref("snapshots$", (store) =>
      store.model(NsiteSnapshotsModel, this.event).pipe(castTimelineStream(NsiteSnapshot, store)),
    );
  }
  /** Subscribes to sites copied directly from this site */
  get copies$(): ChainableObservable<Nsite[]> {
    return this.$$ref("copies$", (store) =>
      store.model(NsiteCopiesModel, this.event).pipe(castTimelineStream(Nsite, store)),
    );
  }
  /** Subscribes to copied sites and snapshots whose lineage originates from this site */
  get lineage$(): ChainableObservable<Nsite[]> {
    return this.$$ref("lineage$", (store) =>
      store.model(NsiteLineageModel, this.event).pipe(castTimelineStream(Nsite, store)),
    );
  }
}

/** Cast for a NIP-5A root nsite (kind 15128) */
export class RootNsite extends AddressableNsite<RootNsiteEvent> {
  /**
   * Creates a cast for a validated manifest
   * @throws if the event is not a valid manifest of this cast
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRootNsite(event)) throw new Error("Invalid root nsite");
    super(event, store);
  }
}

/** Cast for a NIP-5A named nsite (kind 35128) */
export class NamedNsite extends AddressableNsite<NamedNsiteEvent> {
  /**
   * Creates a cast for a validated manifest
   * @throws if the event is not a valid manifest of this cast
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNamedNsite(event)) throw new Error("Invalid named nsite");
    super(event, store);
  }

  /** The `d` tag identifier of the nsite */
  get identifier(): string {
    return getNsiteIdentifier(this.event)!;
  }
}

/** Cast for a NIP-5A nsite snapshot (kind 5128) */
export class NsiteSnapshot extends Nsite<NsiteSnapshotEvent> {
  /**
   * Creates a cast for a validated manifest
   * @throws if the event is not a valid manifest of this cast
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNsiteSnapshot(event)) throw new Error("Invalid nsite snapshot");
    super(event, store);
  }
}

Object.defineProperty(User.prototype, "nsites$", {
  get(this: User) {
    return this.$$ref("nsites$", (store) =>
      store.model(UserNsitesModel, this.pubkey).pipe(castTimelineStream(Nsite, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

Object.defineProperty(User.prototype, "nsite$", {
  get(this: User) {
    return this.$$ref("nsite$", (store) =>
      store.model(RootNsiteModel, this.pointer).pipe(castEventStream(RootNsite, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

Object.defineProperty(User.prototype, "nsiteSnapshots$", {
  get(this: User) {
    return this.$$ref("nsiteSnapshots$", (store) =>
      store.model(UserNsiteSnapshotsModel, this.pubkey).pipe(castTimelineStream(NsiteSnapshot, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    /** Subscribes to the user's root and named nsites */
    get nsites$(): ChainableObservable<Nsite[]>;
    /** Subscribes to the user's root (kind 15128) nsite */
    get nsite$(): ChainableObservable<RootNsite | undefined>;
    /** Subscribes to the user's nsite snapshots */
    get nsiteSnapshots$(): ChainableObservable<NsiteSnapshot[]>;
  }
}

Object.defineProperty(Profile.prototype, "nsite$", {
  get(this: Profile) {
    return this.author.nsite$;
  },
  configurable: true,
  enumerable: false,
});
Object.defineProperty(Profile.prototype, "nsites$", {
  get(this: Profile) {
    return this.author.nsites$;
  },
  configurable: true,
  enumerable: false,
});

// App descriptor kinds are generic, so every addressable cast can discover its linked manifests.
Object.defineProperty(EventCast.prototype, "nsites$", {
  get(this: EventCast) {
    return this.$$ref("nsites$", (store) =>
      this.coordinate ? store.model(AppNsitesModel, this.coordinate).pipe(castTimelineStream(Nsite, store)) : of([]),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "./profile.js" {
  interface Profile {
    /** Subscribes to the author's root site */
    get nsite$(): ChainableObservable<RootNsite | undefined>;
    /** Subscribes to the author's root and named sites */
    get nsites$(): ChainableObservable<Nsite[]>;
  }
}
declare module "applesauce-core/casts/event" {
  interface EventCast {
    /** Subscribes to nsite manifests linked to this app descriptor */
    get nsites$(): ChainableObservable<Nsite[]>;
  }
}
