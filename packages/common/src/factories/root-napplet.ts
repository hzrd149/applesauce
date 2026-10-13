import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { isValidRootNapplet, NAPPLET_ROOT_KIND } from "../helpers/napplet.js";
import { NappletManifestFactory } from "./internal/napplet-manifest.js";

/** An event template for a root napplet manifest */
export type RootNappletTemplate = KnownEventTemplate<typeof NAPPLET_ROOT_KIND>;

/** A factory for root napplet manifests (kind 15129) */
export class RootNappletFactory extends NappletManifestFactory<typeof NAPPLET_ROOT_KIND> {
  /**
   * Creates a root napplet manifest
   * @throws if the artifact hash is invalid
   */
  static create(artifactHash: string, description: string): RootNappletFactory {
    return new RootNappletFactory((res) => res(blankEventTemplate(NAPPLET_ROOT_KIND)))
      .artifact(artifactHash)
      .description(description);
  }
  /**
   * Creates a factory for modifying a root napplet manifest
   * @throws if the event is not a valid root napplet manifest
   */
  static modify(event: NostrEvent): RootNappletFactory {
    if (!isValidRootNapplet(event)) throw new Error("Expected a root napplet manifest");
    return new RootNappletFactory((res) => res(toEventTemplate(event)));
  }
}
