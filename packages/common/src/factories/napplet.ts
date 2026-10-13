import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getReplaceableAddressForEvent } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import {
  isNappletSnapshot,
  isValidNapplet,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NAPPLET_SNAPSHOT_KIND,
  NappletIconType,
  NappletKind,
} from "../helpers/napplet.js";
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
  setNappletIdentifier,
  setNappletParent,
  setNappletRoot,
  setNappletSource,
  setNappletTitle,
} from "../operations/napplet.js";

/** An event template for a NIP-5D napplet manifest */
export type NappletTemplate = KnownEventTemplate<NappletKind>;

/** Factory for NIP-5D napplet manifests (kinds 5129, 15129 and 35129) */
export class NappletFactory extends EventFactory<NappletKind, NappletTemplate> {
  /** Creates a named (kind 35129) napplet manifest */
  static create(identifier: string, artifactHash: string, description: string): NappletFactory {
    return new NappletFactory((res) => res(blankEventTemplate(NAPPLET_KIND)))
      .identifier(identifier)
      .artifact(artifactHash)
      .description(description);
  }

  /** Creates a root (kind 15129) napplet manifest */
  static createRoot(artifactHash: string, description: string): NappletFactory {
    return new NappletFactory((res) => res(blankEventTemplate(NAPPLET_ROOT_KIND)))
      .artifact(artifactHash)
      .description(description);
  }

  /**
   * Creates a snapshot (kind 5129) that pins the current version of a napplet and records its lineage
   * @throws if the event is not a valid napplet manifest
   */
  static snapshot(napplet: NostrEvent): NappletFactory {
    if (!isValidNapplet(napplet)) throw new Error("Expected a napplet manifest event");

    // A snapshot of a snapshot keeps the source lineage since snapshots cannot be addressed
    const coordinate = getReplaceableAddressForEvent(napplet);
    const lineage = (name: string) => napplet.tags.find((t) => t[0] === name && t[1])?.[1];
    const parent = isNappletSnapshot(napplet) ? lineage("a") : coordinate;
    const root = isNappletSnapshot(napplet) ? lineage("A") : coordinate;

    const tags = napplet.tags.filter((t) => t[0] !== "d" && t[0] !== "a" && t[0] !== "A");
    let factory = new NappletFactory((res) =>
      res({ kind: NAPPLET_SNAPSHOT_KIND, created_at: unixNow(), content: napplet.content, tags }),
    );
    if (parent) factory = factory.parent(parent);
    if (root) factory = factory.root(root);
    return factory;
  }

  /**
   * Creates a factory configured to modify an existing napplet manifest
   * @throws if the event is not a valid napplet manifest
   */
  static modify(event: NostrEvent): NappletFactory {
    if (!isValidNapplet(event)) throw new Error("Expected a napplet manifest event");
    return new NappletFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the `d` tag identifier of a named napplet */
  identifier(value: string) {
    return this.chain(setNappletIdentifier(value));
  }
  /** Sets the sha256 of the `index.html` artifact */
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

  /** Sets or removes the icon */
  icon(sha256: string | null, type?: NappletIconType) {
    return this.chain(setNappletIcon(sha256, type));
  }
  /** Sets or removes the address of the napplet a snapshot derives from */
  parent(parent: AddressPointer | string | null) {
    return this.chain(setNappletParent(parent));
  }
  /** Sets or removes the address of the root napplet a snapshot's lineage originates from */
  root(root: AddressPointer | string | null) {
    return this.chain(setNappletRoot(root));
  }
}
