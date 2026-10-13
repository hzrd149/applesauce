import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidRootNsite, NSITE_ROOT_KIND, NsiteFile } from "../helpers/nsite.js";
import { NsiteManifestFactory } from "./internal/nsite-manifest.js";
import { getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import { isValidNsite, isNsiteSnapshot, getNsiteRootPointer } from "../helpers/nsite.js";

/** An event template for a root nsite manifest */
export type RootNsiteTemplate = KnownEventTemplate<typeof NSITE_ROOT_KIND>;

/** A factory for root nsite manifests (kind 15128) */
export class RootNsiteFactory extends NsiteManifestFactory<typeof NSITE_ROOT_KIND> {
  /**
   * Creates a root nsite manifest
   * @throws if the manifest is empty or a path or hash is invalid
   */
  static create(files: NsiteFile[]): RootNsiteFactory {
    if (!files.length) throw new Error("An nsite must include at least one file");
    let factory = new RootNsiteFactory((res) => res(blankEventTemplate(NSITE_ROOT_KIND)));
    for (const file of files) factory = factory.file(file.path, file.sha256);
    return factory;
  }
  /**
   * Copies a root or named site into a new root manifest with copy lineage
   * @throws if the source is invalid or is a snapshot
   */
  static copy(site: NostrEvent): RootNsiteFactory {
    if (!isValidNsite(site) || isNsiteSnapshot(site)) throw new Error("Expected a root or named nsite");
    const kind = NSITE_ROOT_KIND;
    const tags = site.tags.filter((t) => t[0] !== "d" && t[0] !== "a").map((t) => [...t]);
    let factory = new RootNsiteFactory((res) =>
      res({ kind, created_at: unixNow(), content: site.content, tags }),
    ).parent(getReplaceableAddressForEvent(site)!);
    if (!getNsiteRootPointer(site)) factory = factory.root(getReplaceableAddressForEvent(site)!);

    return factory;
  }
  /**
   * Creates a factory for modifying a root nsite manifest
   * @throws if the event is not a valid root nsite manifest
   */
  static modify(event: NostrEvent): RootNsiteFactory {
    if (!isValidRootNsite(event)) throw new Error("Expected a root nsite manifest");
    return new RootNsiteFactory((res) => res(toEventTemplate(event)));
  }
}
