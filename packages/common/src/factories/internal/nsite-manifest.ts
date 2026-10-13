import { EventFactory } from "applesauce-core/factories";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { NsiteKind } from "../../helpers/nsite.js";
import {
  addNsiteApp,
  addNsiteServer,
  removeNsiteApp,
  removeNsiteFile,
  removeNsiteServer,
  setNsiteDescription,
  setNsiteFile,
  setNsiteParent,
  setNsiteRoot,
  setNsiteSource,
  setNsiteTitle,
  updateNsiteAggregateHash,
} from "../../operations/nsite.js";

/** A shared implementation of nsite manifest operations */
export class NsiteManifestFactory<K extends NsiteKind> extends EventFactory<K> {
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
