import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import {
  getNsiteRootPointer,
  isValidNsite,
  isNsiteSnapshot,
  NsiteFile,
  NsiteKind,
  NSITE_KIND,
  NSITE_ROOT_KIND,
  NSITE_SNAPSHOT_KIND,
} from "../helpers/nsite.js";
import {
  addNsiteApp,
  addNsiteServer,
  removeNsiteApp,
  removeNsiteFile,
  removeNsiteServer,
  setNsiteDescription,
  setNsiteFile,
  setNsiteIdentifier,
  setNsiteParent,
  setNsiteRoot,
  setNsiteSource,
  setNsiteTitle,
  updateNsiteAggregateHash,
} from "../operations/nsite.js";

/** An event template for an nsite manifest */
export type NsiteTemplate = KnownEventTemplate<NsiteKind>;
/** A factory for NIP-5A root sites, named sites and snapshots */
export class NsiteFactory extends EventFactory<NsiteKind, NsiteTemplate> {
  /**
   * Creates a named site with an initial file manifest
   * @throws if the identifier, paths or hashes are invalid, or the manifest is empty
   */
  static create(identifier: string, files: NsiteFile[]): NsiteFactory {
    return NsiteFactory.createManifest(NSITE_KIND, files).identifier(identifier);
  }
  /**
   * Creates a root site with an initial file manifest
   * @throws if any path or hash is invalid, or the manifest is empty
   */
  static createRoot(files: NsiteFile[]): NsiteFactory {
    return NsiteFactory.createManifest(NSITE_ROOT_KIND, files);
  }
  private static createManifest(kind: NsiteKind, files: NsiteFile[]): NsiteFactory {
    if (!files.length) throw new Error("An nsite must include at least one file");
    let factory = new NsiteFactory((res) => res(blankEventTemplate(kind)));
    for (const file of files) factory = factory.file(file.path, file.sha256);
    return factory;
  }
  /**
   * Creates a snapshot of a site's current manifest and preserves its origin tag
   * @throws if the source is invalid, is a snapshot, or lacks an aggregate hash
   */
  static snapshot(site: NostrEvent): NsiteFactory {
    if (!isValidNsite(site) || isNsiteSnapshot(site) || !site.tags.some((t) => t[0] === "x" && t[2] === "aggregate"))
      throw new Error("Expected a root or named nsite with an aggregate hash");
    // Preserve the source x and A tags unchanged; a identifies the site being snapshotted.
    const tags = site.tags.filter((t) => t[0] !== "d" && t[0] !== "a").map((t) => [...t]);
    return new NsiteFactory((res) =>
      res({ kind: NSITE_SNAPSHOT_KIND, created_at: unixNow(), content: site.content, tags }),
    ).parent(getReplaceableAddressForEvent(site)!);
  }
  /**
   * Copies a root or named site into a new root or named manifest with copy lineage
   * @throws if the source is invalid or is a snapshot, or the identifier is invalid
   */
  static copy(site: NostrEvent, identifier?: string): NsiteFactory {
    if (!isValidNsite(site) || isNsiteSnapshot(site)) throw new Error("Expected a root or named nsite");
    const kind = identifier === undefined ? NSITE_ROOT_KIND : NSITE_KIND;
    const tags = site.tags.filter((t) => t[0] !== "d" && t[0] !== "a").map((t) => [...t]);
    let factory = new NsiteFactory((res) => res({ kind, created_at: unixNow(), content: site.content, tags })).parent(
      getReplaceableAddressForEvent(site)!,
    );
    if (!getNsiteRootPointer(site)) factory = factory.root(getReplaceableAddressForEvent(site)!);
    if (identifier !== undefined) factory = factory.identifier(identifier);
    return factory;
  }
  /**
   * Creates a factory for modifying an existing manifest
   * @throws if the manifest is invalid
   */
  static modify(event: NostrEvent): NsiteFactory {
    if (!isValidNsite(event)) throw new Error("Expected an nsite manifest");
    return new NsiteFactory((res) => res(toEventTemplate(event)));
  }
  /**
   * Sets the named site's identifier
   * @throws if the identifier is invalid or the draft is not a named site
   */
  identifier(value: string) {
    return this.chain(setNsiteIdentifier(value));
  }
  /**
   * Adds or replaces a file mapping and refreshes the aggregate hash
   * @throws if the path or hash is invalid
   */
  file(path: string, hash: string) {
    return this.chain(setNsiteFile(path, hash));
  }
  /** Removes a file mapping and refreshes the aggregate hash */
  removeFile(path: string) {
    return this.chain(removeNsiteFile(path));
  }
  /** Updates the aggregate hash from the current manifest */
  aggregate() {
    return this.chain(updateNsiteAggregateHash());
  }
  /** Sets or removes the site's title */
  title(value: string | null) {
    return this.chain(setNsiteTitle(value));
  }
  /** Sets or removes the site's description */
  description(value: string | null) {
    return this.chain(setNsiteDescription(value));
  }
  /** Sets or removes the site's source URL */
  source(value: string | null) {
    return this.chain(setNsiteSource(value));
  }
  /** Adds a Blossom server hint */
  server(url: string) {
    return this.chain(addNsiteServer(url));
  }
  /** Removes a Blossom server hint */
  removeServer(url: string) {
    return this.chain(removeNsiteServer(url));
  }
  /**
   * Adds or replaces an upstream app descriptor reference
   * @throws if the address is not addressable
   */
  app(pointer: AddressPointer | string) {
    return this.chain(addNsiteApp(pointer));
  }
  /**
   * Removes an upstream app descriptor reference
   * @throws if the address is not addressable
   */
  removeApp(pointer: AddressPointer | string) {
    return this.chain(removeNsiteApp(pointer));
  }
  /**
   * Sets or removes the immediate parent site
   * @throws if the address does not reference a root or named site
   */
  parent(pointer: AddressPointer | string | null) {
    return this.chain(setNsiteParent(pointer));
  }
  /**
   * Sets or removes the origin site of the copy lineage
   * @throws if the address does not reference a root or named site
   */
  root(pointer: AddressPointer | string | null) {
    return this.chain(setNsiteRoot(pointer));
  }
}
