import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { TRUSTED_PROVIDER_LIST_KIND, TrustedProvider } from "../helpers/trusted-assertions.js";
import {
  addProviderTag,
  removeProviderTag,
  removeServiceTags,
  setProviderTag,
  TrustedProviderSelector,
} from "../operations/trusted-providers.js";

export type TrustedProviderListTemplate = KnownEventTemplate<typeof TRUSTED_PROVIDER_LIST_KIND>;

/** A factory class for building NIP-85 kind 10040 trusted provider list events */
export class TrustedProviderListFactory extends EventFactory<
  typeof TRUSTED_PROVIDER_LIST_KIND,
  TrustedProviderListTemplate
> {
  /** Creates a new trusted provider list factory */
  static create(): TrustedProviderListFactory {
    return new TrustedProviderListFactory((res) =>
      res(blankEventTemplate(TRUSTED_PROVIDER_LIST_KIND) as TrustedProviderListTemplate),
    );
  }

  /**
   * Creates a new trusted provider list factory from an existing kind 10040 event
   * @throws if the event is not a trusted provider list
   */
  static modify(event: NostrEvent | KnownEvent<typeof TRUSTED_PROVIDER_LIST_KIND>): TrustedProviderListFactory {
    if (event.kind !== TRUSTED_PROVIDER_LIST_KIND) throw new Error("Event is not a trusted provider list event");
    return new TrustedProviderListFactory((res) => res(toEventTemplate(event) as TrustedProviderListTemplate));
  }

  /** Adds a provider to the list, or updates its relay hint if it already exists */
  addProvider(provider: TrustedProvider, hidden = false) {
    const op = addProviderTag(provider);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Removes a provider, or every provider in the `kind:tag` slot if no pubkey is given */
  removeProvider(selector: TrustedProviderSelector, hidden = false) {
    const op = removeProviderTag(selector);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Replaces every provider in the `kind:tag` slot with a single provider */
  setProvider(provider: TrustedProvider, hidden = false) {
    const op = setProviderTag(provider);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Removes a service pubkey from every slot */
  removeService(servicePubkey: string, hidden = false) {
    const op = removeServiceTags(servicePubkey);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }
}
