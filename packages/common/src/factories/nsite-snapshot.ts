import { toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidNsiteSnapshot, NSITE_SNAPSHOT_KIND } from "../helpers/nsite.js";
import { NsiteManifestFactory } from "./internal/nsite-manifest.js";
import { getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import { isValidNsite, isNsiteSnapshot } from "../helpers/nsite.js";

/** An event template for a snapshot nsite manifest */
export type NsiteSnapshotTemplate = KnownEventTemplate<typeof NSITE_SNAPSHOT_KIND>;

/** A factory for snapshot nsite manifests (kind 5128) */
export class NsiteSnapshotFactory extends NsiteManifestFactory<typeof NSITE_SNAPSHOT_KIND> {
  /**
   * Creates a snapshot of the current manifest and preserves its lineage
   * @throws if the source is invalid, is a snapshot, or lacks an aggregate hash
   */
  static create(site: NostrEvent): NsiteSnapshotFactory {
    if (!isValidNsite(site) || isNsiteSnapshot(site) || !site.tags.some((t) => t[0] === "x" && t[2] === "aggregate"))
      throw new Error("Expected a root or named nsite with an aggregate hash");
    // Preserve the source x and A tags unchanged; a identifies the site being snapshotted.
    const tags = site.tags.filter((t) => t[0] !== "d" && t[0] !== "a").map((t) => [...t]);
    return new NsiteSnapshotFactory((res) =>
      res({ kind: NSITE_SNAPSHOT_KIND, created_at: unixNow(), content: site.content, tags }),
    ).parent(getReplaceableAddressForEvent(site)!);
  }
  /**
   * Creates a factory for modifying a snapshot nsite manifest
   * @throws if the event is not a valid snapshot nsite manifest
   */
  static modify(event: NostrEvent): NsiteSnapshotFactory {
    if (!isValidNsiteSnapshot(event)) throw new Error("Expected a snapshot nsite manifest");
    return new NsiteSnapshotFactory((res) => res(toEventTemplate(event)));
  }
}
