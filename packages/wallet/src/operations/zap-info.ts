import { EventOperation } from "applesauce-core";
import { modifyPublicTags } from "applesauce-core/operations";
import { addNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";

/** Sets the relays for a nutzap info event */
export function setNutzapInfoRelays(relays: string[]): EventOperation {
  return modifyPublicTags(...relays.map((relay) => addNameValueTag(["relay", relay], false)));
}

/** Sets the mints for a nutzap info event */
export function setNutzapInfoMints(mints: Array<{ url: string; units?: string[] }>): EventOperation {
  return modifyPublicTags(
    ...mints.map((mint) => {
      const tag = mint.units ? ["mint", mint.url, ...mint.units] : ["mint", mint.url];
      return addNameValueTag(tag as [string, string, ...string[]], false);
    }),
  );
}

/** Sets the pubkey for a nutzap info event */
export function setNutzapInfoPubkey(pubkey: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["pubkey", pubkey], true));
}
