import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidNamedNsite, NSITE_KIND, NsiteFile } from "../helpers/nsite.js";
import { NsiteManifestFactory } from "./internal/nsite-manifest.js";
import { setNsiteIdentifier } from "../operations/nsite.js";
import { getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import { isValidNsite, isNsiteSnapshot, getNsiteRootPointer } from "../helpers/nsite.js";

/** An event template for a named nsite manifest */
export type NamedNsiteTemplate = KnownEventTemplate<typeof NSITE_KIND>;

/** A factory for named nsite manifests (kind 35128) */
export class NamedNsiteFactory extends NsiteManifestFactory<typeof NSITE_KIND> {
  /**
   * Creates a named nsite manifest
   * @throws if the manifest is empty or a path, hash or identifier is invalid
   */
  static create(identifier: string, files: NsiteFile[]): NamedNsiteFactory {
    if (!files.length) throw new Error("An nsite must include at least one file");
    let factory = new NamedNsiteFactory((res) => res(blankEventTemplate(NSITE_KIND)));
    for (const file of files) factory = factory.file(file.path, file.sha256);
    return factory.identifier(identifier);
  }
  /**
   * Copies a root or named site into a new named manifest with copy lineage
   * @throws if the source is invalid or is a snapshot, or the identifier is invalid
   */
  static copy(site: NostrEvent, identifier: string): NamedNsiteFactory {
    if (!isValidNsite(site) || isNsiteSnapshot(site)) throw new Error("Expected a root or named nsite");
    const kind = NSITE_KIND;
    const tags = site.tags.filter((t) => t[0] !== "d" && t[0] !== "a").map((t) => [...t]);
    let factory = new NamedNsiteFactory((res) =>
      res({ kind, created_at: unixNow(), content: site.content, tags }),
    ).parent(getReplaceableAddressForEvent(site)!);
    if (!getNsiteRootPointer(site)) factory = factory.root(getReplaceableAddressForEvent(site)!);
    factory = factory.identifier(identifier);
    return factory;
  }
  /**
   * Creates a factory for modifying a named nsite manifest
   * @throws if the event is not a valid named nsite manifest
   */
  static modify(event: NostrEvent): NamedNsiteFactory {
    if (!isValidNamedNsite(event)) throw new Error("Expected a named nsite manifest");
    return new NamedNsiteFactory((res) => res(toEventTemplate(event)));
  }
  /**
   * Sets the named nsite's identifier
   * @throws if the identifier is invalid
   */
  identifier(value: string) {
    return this.chain(setNsiteIdentifier(value));
  }
}
