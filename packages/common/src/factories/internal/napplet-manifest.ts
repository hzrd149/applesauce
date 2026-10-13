import { EventFactory } from "applesauce-core/factories";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { NappletKind, NappletIconType } from "../../helpers/napplet.js";
import {
  addNappletArchetype,
  addNappletIntent,
  addNappletOptionalDomain,
  addNappletRequiredDomain,
  addNappletServer,
  removeNappletArchetype,
  removeNappletIntent,
  removeNappletOptionalDomain,
  removeNappletRequiredDomain,
  removeNappletServer,
  setNappletArtifactHash,
  setNappletDescription,
  setNappletIcon,
  setNappletParent,
  setNappletRoot,
  setNappletSource,
  setNappletTitle,
} from "../../operations/napplet.js";

/** A shared implementation of napplet manifest operations */
export class NappletManifestFactory<K extends NappletKind> extends EventFactory<K> {
  /**
   * Sets the sha256 of the `index.html` artifact
   * @throws if the hash is not a lowercase hex sha256
   */
  artifact(sha256: string) {
    return this.chain(setNappletArtifactHash(sha256));
  }
  /** Sets the plain-text description */
  description(value: string) {
    return this.chain(setNappletDescription(value));
  }
  /** Sets or removes the display title */
  title(value: string | null) {
    return this.chain(setNappletTitle(value));
  }
  /** Sets or removes the source URL */
  source(url: string | null) {
    return this.chain(setNappletSource(url));
  }

  /** Adds an archetype */
  archetype(archetype: string) {
    return this.chain(addNappletArchetype(archetype));
  }
  /** Removes an archetype */
  removeArchetype(archetype: string) {
    return this.chain(removeNappletArchetype(archetype));
  }
  /** Adds or replaces an accepted intent and its parameter names */
  intent(intent: string, params?: string[]) {
    return this.chain(addNappletIntent(intent, params));
  }
  /** Removes an accepted intent */
  removeIntent(intent: string) {
    return this.chain(removeNappletIntent(intent));
  }
  /** Adds a required NAP domain */
  requires(domain: string) {
    return this.chain(addNappletRequiredDomain(domain));
  }
  /** Removes a required NAP domain */
  removeRequires(domain: string) {
    return this.chain(removeNappletRequiredDomain(domain));
  }
  /** Adds an optional NAP domain */
  optional(domain: string) {
    return this.chain(addNappletOptionalDomain(domain));
  }
  /** Removes an optional NAP domain */
  removeOptional(domain: string) {
    return this.chain(removeNappletOptionalDomain(domain));
  }
  /** Adds a Blossom server hint */
  server(url: string) {
    return this.chain(addNappletServer(url));
  }
  /** Removes a Blossom server hint */
  removeServer(url: string) {
    return this.chain(removeNappletServer(url));
  }

  /**
   * Sets or removes the icon
   * @throws if the hash or MIME type is invalid
   */
  icon(sha256: string | null, type?: NappletIconType) {
    return this.chain(setNappletIcon(sha256, type));
  }
  /**
   * Sets or removes the address of the napplet a snapshot derives from
   * @throws if the address cannot be parsed
   */
  parent(parent: AddressPointer | string | null) {
    return this.chain(setNappletParent(parent));
  }
  /**
   * Sets or removes the address of the root napplet a snapshot's lineage originates from
   * @throws if the address cannot be parsed
   */
  root(root: AddressPointer | string | null) {
    return this.chain(setNappletRoot(root));
  }
}
