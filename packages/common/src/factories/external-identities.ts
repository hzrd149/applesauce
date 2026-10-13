import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { EXTERNAL_IDENTITIES_KIND, ExternalIdentitiesEvent, ExternalIdentity } from "../helpers/external-identities.js";
import {
  addExternalIdentity,
  removeExternalIdentity,
  setExternalIdentities,
} from "../operations/external-identities.js";

export type ExternalIdentitiesTemplate = KnownEventTemplate<typeof EXTERNAL_IDENTITIES_KIND>;

/** Factory for NIP-39 external identity lists */
export class ExternalIdentitiesFactory extends EventFactory<
  typeof EXTERNAL_IDENTITIES_KIND,
  ExternalIdentitiesTemplate
> {
  /** Creates an external identities factory */
  static create(identities: ExternalIdentity[] = []): ExternalIdentitiesFactory {
    return new ExternalIdentitiesFactory((res) => res(blankEventTemplate(EXTERNAL_IDENTITIES_KIND))).setIdentities(
      identities,
    );
  }

  /** Creates a factory configured to modify an existing external identities list */
  static modify(event: NostrEvent): ExternalIdentitiesFactory {
    if (event.kind !== EXTERNAL_IDENTITIES_KIND) throw new Error("Expected an external identities event");
    return new ExternalIdentitiesFactory((res) => res(toEventTemplate(event as ExternalIdentitiesEvent)));
  }

  /** Replaces all external identities */
  setIdentities(identities: ExternalIdentity[]) {
    return this.chain(setExternalIdentities(identities));
  }

  /** Adds or replaces an external identity */
  addIdentity(identity: ExternalIdentity) {
    return this.chain(addExternalIdentity(identity));
  }

  /** Removes an external identity */
  removeIdentity(platform: string, identity: string) {
    return this.chain(removeExternalIdentity(platform, identity));
  }
}
