import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidNamedNapplet, NAPPLET_KIND } from "../helpers/napplet.js";
import { NappletManifestFactory } from "./internal/napplet-manifest.js";
import { setNappletIdentifier } from "../operations/napplet.js";

/** An event template for a named napplet manifest */
export type NamedNappletTemplate = KnownEventTemplate<typeof NAPPLET_KIND>;

/** A factory for named napplet manifests (kind 35129) */
export class NamedNappletFactory extends NappletManifestFactory<typeof NAPPLET_KIND> {
  /**
   * Creates a named napplet manifest
   * @throws if the artifact hash is invalid
   */
  static create(identifier: string, artifactHash: string, description: string): NamedNappletFactory {
    return new NamedNappletFactory((res) => res(blankEventTemplate(NAPPLET_KIND)))
      .identifier(identifier)
      .artifact(artifactHash)
      .description(description);
  }
  /**
   * Creates a factory for modifying a named napplet manifest
   * @throws if the event is not a valid named napplet manifest
   */
  static modify(event: NostrEvent): NamedNappletFactory {
    if (!isValidNamedNapplet(event)) throw new Error("Expected a named napplet manifest");
    return new NamedNappletFactory((res) => res(toEventTemplate(event)));
  }
  /** Sets the named napplet's identifier */
  identifier(value: string) {
    return this.chain(setNappletIdentifier(value));
  }
}
