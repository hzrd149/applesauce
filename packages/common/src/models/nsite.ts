import { Model } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getReplaceableAddressForEvent,
  getReplaceableAddressFromPointer,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { map } from "rxjs";
import {
  isValidNsite,
  isValidNsiteSnapshot,
  isValidRootNsite,
  NsiteEvent,
  NsiteSnapshotEvent,
  RootNsiteEvent,
  NSITE_KIND,
  NSITE_ROOT_KIND,
  NSITE_SNAPSHOT_KIND,
} from "../helpers/nsite.js";

function coordinate(site: NostrEvent | AddressPointer | string): string {
  return typeof site === "string"
    ? site
    : "id" in site
      ? getReplaceableAddressForEvent(site)!
      : getReplaceableAddressFromPointer(site);
}
/** A model that resolves a site or snapshot pointer and validates its manifest */
export function NsiteModel(pointer: AddressPointer | EventPointer | string): Model<NsiteEvent | undefined> {
  return (store) => store.event(pointer).pipe(map((event) => (isValidNsite(event) ? event : undefined)));
}

/** A model that returns a user's root and named sites */
export function UserNsitesModel(user: string | ProfilePointer): Model<NsiteEvent[]> {
  const pubkey = typeof user === "string" ? user : user.pubkey;
  return (store) =>
    store
      .timeline({ kinds: [NSITE_ROOT_KIND, NSITE_KIND], authors: [pubkey] })
      .pipe(map((events) => events.filter(isValidNsite)));
}
/** A model that returns a user's root site */
export function RootNsiteModel(user: string | ProfilePointer): Model<RootNsiteEvent | undefined> {
  const pointer = typeof user === "string" ? { pubkey: user } : user;
  return (store) =>
    store
      .replaceable({ ...pointer, kind: NSITE_ROOT_KIND })
      .pipe(map((event) => (isValidRootNsite(event) ? event : undefined)));
}
/** A model that returns a user's manifest snapshots */
export function UserNsiteSnapshotsModel(user: string | ProfilePointer): Model<NsiteSnapshotEvent[]> {
  const pubkey = typeof user === "string" ? user : user.pubkey;
  return (store) =>
    store
      .timeline({ kinds: [NSITE_SNAPSHOT_KIND], authors: [pubkey] })
      .pipe(map((events) => events.filter(isValidNsiteSnapshot)));
}
/** A model that returns snapshots of a specific site */
export function NsiteSnapshotsModel(site: NostrEvent | AddressPointer | string): Model<NsiteSnapshotEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [NSITE_SNAPSHOT_KIND], "#a": [coordinate(site)] })
      .pipe(map((events) => events.filter(isValidNsiteSnapshot)));
}
/** A model that returns sites copied directly from a site */
export function NsiteCopiesModel(site: NostrEvent | AddressPointer | string): Model<NsiteEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [NSITE_ROOT_KIND, NSITE_KIND], "#a": [coordinate(site)] })
      .pipe(map((events) => events.filter(isValidNsite)));
}
/** A model that returns copied sites and snapshots with a shared lineage origin */
export function NsiteLineageModel(site: NostrEvent | AddressPointer | string): Model<NsiteEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [NSITE_ROOT_KIND, NSITE_KIND, NSITE_SNAPSHOT_KIND], "#A": [coordinate(site)] })
      .pipe(map((events) => events.filter(isValidNsite)));
}
/** A model that returns manifests belonging to an upstream app descriptor */
export function AppNsitesModel(app: NostrEvent | AddressPointer | string): Model<NsiteEvent[]> {
  const address = coordinate(app);
  // NIP-01 indexes only single-letter tags; app linkage must be filtered locally.
  return (store) =>
    store
      .timeline({ kinds: [NSITE_ROOT_KIND, NSITE_KIND, NSITE_SNAPSHOT_KIND] })
      .pipe(
        map((events) =>
          events.filter(
            (event): event is NsiteEvent =>
              isValidNsite(event) && event.tags.some((tag) => tag[0] === "app" && tag[1] === address),
          ),
        ),
      );
}
/** A model that returns manifests advertising an aggregate hash */
export function NsitesByHashModel(hash: string): Model<NsiteEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [NSITE_ROOT_KIND, NSITE_KIND, NSITE_SNAPSHOT_KIND], "#x": [hash] })
      .pipe(map((events) => events.filter(isValidNsite)));
}
