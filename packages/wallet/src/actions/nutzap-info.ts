import { Action } from "applesauce-actions";
import { getNutzapInfoRelays, NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import {
  addNutzapInfoMint,
  addNutzapInfoRelay,
  removeNutzapInfoMint,
  removeNutzapInfoRelay,
  setNutzapInfoMints,
  setNutzapInfoPubkey,
  setNutzapInfoRelays,
} from "../operations/nutzap-info.js";

// Make sure the nutzap$ is registered on the user class
import "../casts/__register__.js";

/** An action to add a relay to the kind 10019 nutzap info event */
export function AddNutzapInfoRelay(relay: string | string[]): Action {
  return async ({ events, factory, self, sign, publish }) => {
    if (typeof relay === "string") relay = [relay];

    const operations = relay.map((r) => addNutzapInfoRelay(r));
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const signed = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations).then(sign)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}

/** An action to remove a relay from the kind 10019 nutzap info event */
export function RemoveNutzapInfoRelay(relay: string | string[]): Action {
  return async ({ events, factory, self, sign, publish }) => {
    if (typeof relay === "string") relay = [relay];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    const operations = relay.map((r) => removeNutzapInfoRelay(r));
    const signed = await factory.modify(nutzapInfo, ...operations).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}

/** An action to add a mint to the kind 10019 nutzap info event */
export function AddNutzapInfoMint(
  mint: { url: string; units?: string[] } | Array<{ url: string; units?: string[] }>,
): Action {
  return async ({ events, factory, self, sign, publish }) => {
    const mints = Array.isArray(mint) ? mint : [mint];

    const operations = mints.map((m) => addNutzapInfoMint(m));
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const signed = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations).then(sign)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}

/** An action to remove a mint from the kind 10019 nutzap info event */
export function RemoveNutzapInfoMint(mint: string | string[]): Action {
  return async ({ events, factory, self, sign, publish }) => {
    if (typeof mint === "string") mint = [mint];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    const operations = mint.map((m) => removeNutzapInfoMint(m));
    const signed = await factory.modify(nutzapInfo, ...operations).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}

/** An action to update the entire nutzap info event */
export function UpdateNutzapInfo(relays: string[], mints: Array<{ url: string; units?: string[] }>): Action {
  return async ({ events, factory, self, sign, publish }) => {
    const operations = [setNutzapInfoRelays(relays), setNutzapInfoMints(mints)];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const signed = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations).then(sign)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations).then(sign);

    await publish(signed, relays);
  };
}

/**
 * Sets the mints on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoMints(mints: Array<{ url: string; units?: string[] }>): Action {
  return async ({ events, self, factory, sign, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await factory.modify(nutzapInfo, setNutzapInfoMints(mints)).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}

/**
 * Sets the relays on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoRelays(relays: string[]): Action {
  return async ({ events, self, factory, sign, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await factory.modify(nutzapInfo, setNutzapInfoRelays(relays)).then(sign);

    await publish(signed, relays);
  };
}

/**
 * Sets the pubkey on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoPubkey(privateKey: Uint8Array): Action {
  return async ({ events, self, factory, sign, publish }) => {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const signed = await factory.modify(nutzapInfo, setNutzapInfoPubkey(privateKey)).then(sign);

    // Use relays from the updated event
    const relays = getNutzapInfoRelays(signed);
    await publish(signed, relays);
  };
}
