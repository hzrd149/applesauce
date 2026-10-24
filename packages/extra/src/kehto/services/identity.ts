import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { KehtoAccount } from "../foundation/account.js";
import type { IdentityServiceOptions } from "@kehto/services";
import { castUser, type Profile, type User } from "applesauce-common/casts";
import { getZapAmount, getZapRequest, getZapSender } from "applesauce-common/helpers";
import { kinds } from "applesauce-core/helpers";
import { firstValueFrom, type Observable } from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { queryThroughStore } from "../foundation/pool.js";
import { getStoredInboxes, selectReadRelays } from "../foundation/relays.js";
import { createKehtoSigner } from "../foundation/signer.js";
import { configured$, settle } from "../helpers.js";

/** Options for {@link createIdentityOptions} */
export interface KehtoIdentityOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
}

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
export function createIdentityOptions(config: KehtoIdentityOptions): IdentityServiceOptions {
  const { eventStore } = config;
  function readUser<T>(pubkey: string, select: (user: User) => Observable<T | undefined>, fallback: T) {
    const user = castUser(pubkey, eventStore);
    return settle(select(user), fallback, config.timeout ?? 4000);
  }

  return {
    getSigner: () => ({
      getPublicKey: async () => (await firstValueFrom(kehtoAccount$(config)))?.pubkey ?? "",
      getRelays: async () => {
        const account = await firstValueFrom(kehtoAccount$(config));
        const signer = createKehtoSigner(account?.signer, config);
        return signer?.getRelays ? signer.getRelays() : {};
      },
    }),
    getProfile: async (pubkey) => {
      const profile = await readUser(pubkey, (user) => user.profile$, undefined);
      return profile ? toNapProfile(profile) : null;
    },
    getFollows: async (pubkey) => {
      const contacts = await readUser(pubkey, (user) => user.contacts$, []);
      return contacts.map((user) => user.pubkey);
    },
    getMutes: async (pubkey) => {
      const mutes = await readUser(pubkey, (user) => user.mutes$, undefined);
      return Array.from(mutes?.pubkeys ?? []);
    },
    getList: async (listType, pubkey) => {
      const kind = KEHTO_IDENTITY_LIST_KINDS[listType];
      if (kind === undefined) return [];
      const list = await settle(eventStore.replaceable(kind, pubkey), undefined, config.timeout ?? 4000);
      const tags = list?.tags.filter((tag) => tag[0] !== "d" && tag[1]);
      return tags?.map((tag) => tag[1]) ?? [];
    },
    getZaps: async (pubkey) => {
      const filters = [{ kinds: [kinds.Zap], "#p": [pubkey] }];
      // Zap receipts are sent to the recipient's inboxes
      const inboxes = getStoredInboxes(eventStore, pubkey);
      const account = await firstValueFrom(kehtoAccount$(config));
      const fallbackRelays = await firstValueFrom(configured$(config.fallbackRelays, []));
      const relays = inboxes.length ? inboxes : selectReadRelays(eventStore, filters, account?.pubkey, fallbackRelays);
      const zaps = await queryThroughStore(config, relays, filters, 100);
      return zaps.map((zap) => ({
        eventId: zap.id,
        sender: getZapSender(zap) ?? "",
        amount: getZapAmount(zap) ?? 0,
        content: getZapRequest(zap)?.content,
      }));
    },
    getBadges: async (pubkey) => {
      const slots = await readUser(pubkey, (user) => user.profileBadges$.badges$, []);
      return slots.flatMap(({ badge, award }) => {
        if (!badge) return [];

        return [
          {
            id: badge.id,
            name: badge.name,
            image: badge.image?.url,
            awardedBy: award?.author.pubkey ?? "",
          },
        ];
      });
    },
  };
}
