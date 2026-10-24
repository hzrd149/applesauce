import type { CommonServiceOptions } from "@kehto/services";
import { type CommonContext, toPubkey } from "./context.js";
import { castUser } from "applesauce-common/casts";
import { errorMessage, settle } from "../../helpers.js";
import { toNapProfile } from "../identity.js";
import { toRelayEventResult } from "../outbox.js";

/** Creates store-backed profile lookups */
export function createProfileService({
  timeout,
  eventStore,
}: Pick<CommonContext, "timeout" | "eventStore">): Pick<CommonServiceOptions, "getProfile"> {
  return {
    getProfile: async (target) => {
      try {
        const pubkey = toPubkey(target);
        const profile = await settle(castUser(pubkey, eventStore).profile$, undefined, timeout);
        return {
          ok: true,
          pubkey,
          profile: profile ? toNapProfile(profile) : null,
          result: profile && toRelayEventResult(profile.event),
        };
      } catch (err) {
        return { ok: false, pubkey: "", error: errorMessage(err) };
      }
    },
  };
}
