import { Action } from "applesauce-actions";
import { modifyPublicTags } from "applesauce-factory/operations";
import { addNameValueTag, removeNameValueTag, setSingletonTag } from "applesauce-factory/operations/tag";

import { NUTZAP_INFO_KIND } from "../helpers/zap-info.js";
import { setNutzapInfoMints, setNutzapInfoPubkey, setNutzapInfoRelays } from "../operations/zap-info.js";

/** An action to add a relay to the kind 10019 nutzap info event */
export function AddNutzapInfoRelay(relay: string | string[]): Action {
  return async function* ({ events, factory, self }) {
    if (typeof relay === "string") relay = [relay];

    const operations = relay.map((r) => addNameValueTag(["relay", r], false));
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modifyTags(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, modifyPublicTags(...operations));

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

    const draft = await factory.modifyTags(nutzapInfo, ...relay.map((r) => removeNameValueTag(["relay", r])));
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

    const operations = mints.map((m) => {
      const tag = m.units ? ["mint", m.url, ...m.units] : ["mint", m.url];
      return addNameValueTag(tag as [string, string, ...string[]], false);
    });
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modifyTags(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, modifyPublicTags(...operations));

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

    const draft = await factory.modifyTags(nutzapInfo, ...mint.map((m) => removeNameValueTag(["mint", m])));
    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to set the pubkey for the kind 10019 nutzap info event */
export function SetNutzapInfoPubkey(pubkey: string): Action {
  return async function* ({ events, factory, self }) {
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modifyTags(nutzapInfo, setSingletonTag(["pubkey", pubkey], true))
      : await factory.build({ kind: NUTZAP_INFO_KIND }, modifyPublicTags(setSingletonTag(["pubkey", pubkey], true)));

    const signed = await factory.sign(draft);

    yield signed;
  };
}

/** An action to update the entire nutzap info event */
export function UpdateNutzapInfo(
  relays: string[],
  mints: Array<{ url: string; units?: string[] }>,
  pubkey: string,
): Action {
  return async function* ({ events, factory, self }) {
    const operations = [setNutzapInfoRelays(relays), setNutzapInfoMints(mints), setNutzapInfoPubkey(pubkey)];

    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const draft = nutzapInfo
      ? await factory.modify(nutzapInfo, ...operations)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, ...operations);

    const signed = await factory.sign(draft);

    yield signed;
  };
}
