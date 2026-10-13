import { toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidNappletSnapshot, NAPPLET_SNAPSHOT_KIND } from "../helpers/napplet.js";
import { NappletManifestFactory } from "./internal/napplet-manifest.js";
import { getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import { isValidNapplet, isNappletSnapshot } from "../helpers/napplet.js";

/** An event template for a snapshot napplet manifest */
export type NappletSnapshotTemplate = KnownEventTemplate<typeof NAPPLET_SNAPSHOT_KIND>;

/** A factory for snapshot napplet manifests (kind 5129) */
export class NappletSnapshotFactory extends NappletManifestFactory<typeof NAPPLET_SNAPSHOT_KIND> {
  /**
   * Creates a snapshot of the current manifest and preserves its lineage
   * @throws if the source is invalid
   */
  static create(napplet: NostrEvent): NappletSnapshotFactory {
    if (!isValidNapplet(napplet)) throw new Error("Expected a napplet manifest event");

    // A snapshot of a snapshot keeps the source lineage since snapshots cannot be addressed
    const coordinate = getReplaceableAddressForEvent(napplet);
    const lineage = (name: string) => napplet.tags.find((t) => t[0] === name && t[1])?.[1];
    const parent = isNappletSnapshot(napplet) ? lineage("a") : coordinate;
    const root = isNappletSnapshot(napplet) ? lineage("A") : coordinate;

    const tags = napplet.tags.filter((t) => t[0] !== "d" && t[0] !== "a" && t[0] !== "A");
    let factory = new NappletSnapshotFactory((res) =>
      res({ kind: NAPPLET_SNAPSHOT_KIND, created_at: unixNow(), content: napplet.content, tags }),
    );
    if (parent) factory = factory.parent(parent);
    if (root) factory = factory.root(root);
    return factory;
  }

  /**
   * Creates a factory for modifying a snapshot napplet manifest
   * @throws if the event is not a valid snapshot napplet manifest
   */
  static modify(event: NostrEvent): NappletSnapshotFactory {
    if (!isValidNappletSnapshot(event)) throw new Error("Expected a snapshot napplet manifest");
    return new NappletSnapshotFactory((res) => res(toEventTemplate(event)));
  }
}
