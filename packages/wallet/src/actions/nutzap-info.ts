import { Action } from "applesauce-actions";
import { NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import {
  addNutzapInfoMint,
  addNutzapInfoRelay,
  removeNutzapInfoMint,
  removeNutzapInfoRelay,
  setNutzapInfoMints,
  setNutzapInfoRelays,
  setNutzapInfoPubkey,
} from "../operations/nutzap-info.js";

/** An action to add a relay to the kind 10019 nutzap info event */
export function AddNutzapInfoRelay(relay: string | string[]): Action {
  return async function* ({ events, factory, self }) {
    if (typeof relay === "string") relay = [relay];

    const operations = relay.map((r) => addNutzapInfoRelay(r));
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations);

    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to remove a relay from the kind 10019 nutzap info event */
export function RemoveNutzapInfoRelay(relay: string | string[]): Action {
  return async function* ({ events, factory, self }) {
    if (typeof relay === "string") relay = [relay];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    const operations = relay.map((r) => removeNutzapInfoRelay(r));
    const draft = await factory.modify(nutzapInfo, ...operations);
    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to add a mint to the kind 10019 nutzap info event */
export function AddNutzapInfoMint(
  mint: { url: string; units?: string[] } | Array<{ url: string; units?: string[] }>,
): Action {
  return async function* ({ events, factory, self }) {
    const mints = Array.isArray(mint) ? mint : [mint];

    const operations = mints.map((m) => addNutzapInfoMint(m));
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations);

    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to remove a mint from the kind 10019 nutzap info event */
export function RemoveNutzapInfoMint(mint: string | string[]): Action {
  return async function* ({ events, factory, self }) {
    if (typeof mint === "string") mint = [mint];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) return;

    const operations = mint.map((m) => removeNutzapInfoMint(m));
    const draft = await factory.modify(nutzapInfo, ...operations);
    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to update the entire nutzap info event */
export function UpdateNutzapInfo(relays: string[], mints: Array<{ url: string; units?: string[] }>): Action {
  return async function* ({ events, factory, self }) {
    const operations = [setNutzapInfoRelays(relays), setNutzapInfoMints(mints)];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations);

    const signed = await factory.sign(draft);

    yield signed;
  };
}

/**
 * Sets the mints on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoMints(mints: Array<{ url: string; units?: string[] }>): Action {
  return async function* ({ events, self, factory }) {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const draft = await factory.modify(nutzapInfo, setNutzapInfoMints(mints));
    const signed = await factory.sign(draft);

    yield signed;
  };
}

/**
 * Sets the relays on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoRelays(relays: string[]): Action {
  return async function* ({ events, self, factory }) {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const draft = await factory.modify(nutzapInfo, setNutzapInfoRelays(relays));
    const signed = await factory.sign(draft);

    yield signed;
  };
}

/**
 * Sets the pubkey on a nutzap info event
 * @throws if the nutzap info does not exist
 */
export function SetNutzapInfoPubkey(privateKey: Uint8Array): Action {
  return async function* ({ events, self, factory }) {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    if (!nutzapInfo) throw new Error("Nutzap info does not exist");

    const draft = await factory.modify(nutzapInfo, setNutzapInfoPubkey(privateKey));
    const signed = await factory.sign(draft);

    yield signed;
  };
}
