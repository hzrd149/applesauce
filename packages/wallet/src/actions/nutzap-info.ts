import { Action } from "applesauce-actions";
import { getNutzapInfoRelays, NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import { NutzapInfoFactory } from "../factories/nutzap-info.js";

// Make sure the nutzap$ is registered on the user class
import "../casts/__register__.js";

/** An action to add a relay to the kind 10019 nutzap info event */
export function AddNutzapInfoRelay(relay: string | string[]): Action {
  return async ({ events, signer, self, publish }) => {
    if (typeof relay === "string") relay = [relay];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    let factory = nutzapInfo ? NutzapInfoFactory.modify(nutzapInfo) : NutzapInfoFactory.create();
    for (const r of relay) factory = factory.addRelay(r);
    const signed = await factory.sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}

/** An action to remove a relay from the kind 10019 nutzap info event */
export function RemoveNutzapInfoRelay(relay: string | string[]): Action {
  return async ({ events, signer, self, publish }) => {
    if (typeof relay === "string") relay = [relay];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    let factory = NutzapInfoFactory.modify(nutzapInfo);
    for (const r of relay) factory = factory.removeRelay(r);
    const signed = await factory.sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}

/** An action to add a mint to the kind 10019 nutzap info event */
export function AddNutzapInfoMint(
  mint: { url: string; units?: string[] } | Array<{ url: string; units?: string[] }>,
): Action {
  return async ({ events, signer, self, publish }) => {
    const mints = Array.isArray(mint) ? mint : [mint];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    let factory = nutzapInfo ? NutzapInfoFactory.modify(nutzapInfo) : NutzapInfoFactory.create();
    for (const m of mints) factory = factory.addMint(m);
    const signed = await factory.sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}

/** An action to remove a mint from the kind 10019 nutzap info event */
export function RemoveNutzapInfoMint(mint: string | string[]): Action {
  return async ({ events, signer, self, publish }) => {
    if (typeof mint === "string") mint = [mint];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    let factory = NutzapInfoFactory.modify(nutzapInfo);
    for (const m of mint) factory = factory.removeMint(m);
    const signed = await factory.sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}

/** An action to update the entire nutzap info event */
export function UpdateNutzapInfo(relays: string[], mints: Array<{ url: string; units?: string[] }>): Action {
  return async ({ events, signer, self, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const signed = await (nutzapInfo ? NutzapInfoFactory.modify(nutzapInfo) : NutzapInfoFactory.create())
      .setRelays(relays)
      .setMints(mints)
      .sign(signer);

    await publish(signed, relays);
  };
}

/**
 * Sets the mints on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoMints(mints: Array<{ url: string; units?: string[] }>): Action {
  return async ({ events, self, signer, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await NutzapInfoFactory.modify(nutzapInfo).setMints(mints).sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}

/**
 * Sets the relays on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoRelays(relays: string[]): Action {
  return async ({ events, self, signer, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await NutzapInfoFactory.modify(nutzapInfo).setRelays(relays).sign(signer);

    await publish(signed, relays);
  };
}

/**
 * Sets the pubkey on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoPubkey(privateKey: Uint8Array): Action {
  return async ({ events, self, signer, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await NutzapInfoFactory.modify(nutzapInfo).setPubkey(privateKey).sign(signer);

    await publish(signed, getNutzapInfoRelays(signed));
  };
}
