import { TrustedProviderListFactory } from "applesauce-common/factories";
import { TRUSTED_PROVIDER_LIST_KIND, TrustedProvider } from "applesauce-common/helpers/trusted-assertions";
import type { TrustedProviderSelector } from "applesauce-common/operations/trusted-providers";
import { hasHiddenTags } from "applesauce-core/helpers/hidden-tags";
import type { Action, ActionContext } from "../action-runner.js";

async function modifyTrustedProviders({
  user,
}: ActionContext): Promise<[TrustedProviderListFactory, string[] | undefined, boolean]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(TRUSTED_PROVIDER_LIST_KIND).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  const factory = event ? TrustedProviderListFactory.modify(event) : TrustedProviderListFactory.create();
  return [factory, outboxes, !!event && hasHiddenTags(event)];
}

/** An action that adds NIP-85 trusted providers to the kind 10040 list, or updates their relay hints */
export function AddTrustedProvider(provider: TrustedProvider | TrustedProvider[], hidden = false): Action {
  const providers = Array.isArray(provider) ? provider : [provider];
  return async (context) => {
    const [factory, outboxes] = await modifyTrustedProviders(context);
    const signed = await providers.reduce((f, p) => f.addProvider(p, hidden), factory).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes NIP-85 trusted providers from the kind 10040 list */
export function RemoveTrustedProvider(
  selector: TrustedProviderSelector | TrustedProviderSelector[],
  hidden = false,
): Action {
  const selectors = Array.isArray(selector) ? selector : [selector];
  return async (context) => {
    const [factory, outboxes] = await modifyTrustedProviders(context);
    const signed = await selectors.reduce((f, s) => f.removeProvider(s, hidden), factory).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that replaces every provider in a `kind:tag` slot with a single provider */
export function SetTrustedProvider(provider: TrustedProvider, hidden = false): Action {
  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyTrustedProviders(context);
    let f = factory.setProvider(provider, hidden);
    // Clear the slot on the other side so the provider is the only one in use
    const slot = { kind: provider.kind, tag: provider.tag };
    if (hidden) f = f.removeProvider(slot);
    else if (hasHidden) f = f.removeProvider(slot, true);
    await context.publish(await f.sign(context.signer), outboxes);
  };
}

/** An action that removes a service pubkey from every public and private slot */
export function RemoveTrustedService(servicePubkey: string): Action {
  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyTrustedProviders(context);
    let f = factory.removeService(servicePubkey);
    if (hasHidden) f = f.removeService(servicePubkey, true);
    await context.publish(await f.sign(context.signer), outboxes);
  };
}

/** An action that moves a trusted provider between the public tags and the private encrypted tags */
export function MoveTrustedProvider(provider: TrustedProvider, hidden: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyTrustedProviders(context);
    const signed = await factory.removeProvider(provider, !hidden).addProvider(provider, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
