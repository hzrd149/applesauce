import type { IdentityServiceOptions } from "@kehto/services";
import { castUser, type Profile, type User } from "applesauce-common/casts";
import { getZapAmount, getZapRequest, getZapSender } from "applesauce-common/helpers";
import { kinds } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { createKehtoSigner } from "../foundation/signer.js";
import { getStoredInboxes, selectReadRelays } from "../foundation/relays.js";
import { queryThroughStore } from "../foundation/pool.js";
import type { KehtoState } from "../foundation/state.js";
import { settle } from "../helpers.js";

/** NAP-IDENTITY list types mapped to their NIP-51 list kinds */
export const KEHTO_IDENTITY_LIST_KINDS: Record<string, number> = {
  bookmarks: kinds.BookmarkList,
  pins: kinds.Pinlist,
  interests: kinds.InterestsList,
  communities: kinds.CommunitiesList,
  emojis: kinds.UserEmojiList,
};

/** Maps a profile cast to the NAP profile shape */
export function toNapProfile(profile: Profile) {
  const { name, about, picture, banner, nip05, lud16, website } = profile.metadata;
  return { name, displayName: profile.displayName, about, picture, banner, nip05, lud16, website };
}

/** Creates {@link IdentityServiceOptions} that answer identity reads from the event store and its loaders */
export function createIdentityOptions(state: KehtoState): IdentityServiceOptions {
  const { eventStore } = state.ctx;
  const read = <T>(pubkey: string, fn: (user: User) => Observable<T | undefined>, fallback: T) =>
    settle(fn(castUser(pubkey, eventStore)), fallback, state.timeout);

  return {
    getSigner: () => createKehtoSigner(state),
    getProfile: async (pubkey) => {
      const profile = await read(pubkey, (u) => u.profile$, undefined);
      return profile ? toNapProfile(profile) : null;
    },
    getFollows: async (pubkey) => (await read(pubkey, (u) => u.contacts$, [])).map((u) => u.pubkey),
    getMutes: async (pubkey) => Array.from((await read(pubkey, (u) => u.mutes$, undefined))?.pubkeys ?? []),
    getList: async (listType, pubkey) => {
      const kind = KEHTO_IDENTITY_LIST_KINDS[listType];
      if (kind === undefined) return [];
      const list = await settle(eventStore.replaceable(kind, pubkey), undefined, state.timeout);
      return list?.tags.filter((t) => t[0] !== "d" && t[1]).map((t) => t[1]) ?? [];
    },
    getZaps: async (pubkey) => {
      const filters = [{ kinds: [kinds.Zap], "#p": [pubkey] }];
      // Zap receipts are sent to the recipient's inboxes
      const relays = getStoredInboxes(state, pubkey);
      const zaps = await queryThroughStore(
        state,
        relays.length ? relays : selectReadRelays(state, filters),
        filters,
        100,
      );
      return zaps.map((zap) => ({
        eventId: zap.id,
        sender: getZapSender(zap) ?? "",
        amount: getZapAmount(zap) ?? 0,
        content: getZapRequest(zap)?.content,
      }));
    },
    getBadges: async (pubkey) => {
      const slots = await read(pubkey, (u) => u.profileBadges$.badges$, []);
      return slots.flatMap(({ badge, award }) =>
        badge
          ? [{ id: badge.id, name: badge.name, image: badge.image?.url, awardedBy: award?.author.pubkey ?? "" }]
          : [],
      );
    },
  };
}
