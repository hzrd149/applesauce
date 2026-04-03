import { getOrComputeCachedValue, notifyEventUpdate } from "applesauce-core/helpers";
import { getReplaceableIdentifier, getTagValue, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import {
  getHiddenTags,
  isHiddenTagsUnlocked,
  setHiddenTagsEncryptionMethod,
  unlockHiddenTags,
} from "applesauce-core/helpers/hidden-tags";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { processTags } from "applesauce-core/helpers/tags";
import { Emoji, getEmojiFromTags } from "./emoji.js";
import { getListTags, ReadListTags } from "./lists.js";

export const FAVORITE_EMOJI_PACKS_KIND = kinds.UserEmojiList;
export const EMOJI_PACK_KIND = kinds.Emojisets;

setHiddenTagsEncryptionMethod(FAVORITE_EMOJI_PACKS_KIND, "nip44");

export type FavoriteEmojisEvent = KnownEvent<typeof FAVORITE_EMOJI_PACKS_KIND>;
export type EmojiPackEvent = KnownEvent<typeof EMOJI_PACK_KIND>;

export const FavoriteEmojiPacksPublicSymbol = Symbol.for("favorite-emojis-public");
export const FavoriteEmojiPacksPublicPointersSymbol = Symbol.for("favorite-emoji-packs-public-pointers");
export const FavoriteEmojiPacksHiddenSymbol = Symbol.for("favorite-emojis-hidden");
export const FavoriteEmojiPacksHiddenPointersSymbol = Symbol.for("favorite-emoji-packs-hidden-pointers");

export type UnlockedFavoriteEmojiPacks = {
  [FavoriteEmojiPacksHiddenSymbol]: Emoji[];
  [FavoriteEmojiPacksHiddenPointersSymbol]: AddressPointer[];
};

function parseEmojiTags(tags: string[][]): Emoji[] {
  return processTags(tags, (tag) => {
    if (tag[0] !== "emoji" || !tag[1] || !tag[2]) return undefined;
    return getEmojiFromTags([tag], tag[1]);
  });
}

function parseEmojiPackPointers(tags: string[][]): AddressPointer[] {
  return processTags(tags, (tag) => {
    if (tag[0] !== "a") return undefined;

    const pointer = getAddressPointerFromATag(tag);
    if (pointer?.kind !== EMOJI_PACK_KIND) return undefined;

    return pointer;
  });
}

/** Validates that an event is a valid favorite emoji packs list (kind 10030) */
export function isValidFavoriteEmojiPacks(event: NostrEvent): event is FavoriteEmojisEvent {
  return event.kind === FAVORITE_EMOJI_PACKS_KIND;
}

/** Validates that an event is a valid emoji pack (kind 30030) */
export function isValidEmojiPack(event: NostrEvent): event is EmojiPackEvent {
  return event.kind === EMOJI_PACK_KIND && !!getReplaceableIdentifier(event);
}

/** Returns the name of a NIP-30 emoji pack */
export function getEmojiPackName(pack: NostrEvent): string | undefined {
  return getTagValue(pack, "title") || getTagValue(pack, "d");
}

export function getEmojiPackDescription(pack: NostrEvent): string | undefined {
  return getTagValue(pack, "description");
}

/** Returns an array of emojis from a NIP-30 emoji pack */
export function getEmojiPackEmojis(pack: NostrEvent): Emoji[] {
  return parseEmojiTags(pack.tags);
}

/** Returns the favorite emojis from a kind 10030 list */
export function getFavoriteEmojis(list: NostrEvent, type?: ReadListTags): Emoji[] {
  const tags = getListTags(list, type);

  if (type) return parseEmojiTags(tags);

  return getOrComputeCachedValue(list, FavoriteEmojiPacksPublicSymbol, () => parseEmojiTags(tags));
}

/** Returns the emoji pack pointers from a kind 10030 list */
export function getFavoriteEmojiPackPointers(list: NostrEvent, type?: ReadListTags): AddressPointer[] {
  const tags = getListTags(list, type);

  if (type) return parseEmojiPackPointers(tags);

  return getOrComputeCachedValue(list, FavoriteEmojiPacksPublicPointersSymbol, () => parseEmojiPackPointers(tags));
}

/** Returns the hidden favorite emojis if the list is unlocked */
export function getHiddenFavoriteEmojis<T extends NostrEvent & UnlockedFavoriteEmojiPacks>(list: T): Emoji[];
export function getHiddenFavoriteEmojis<T extends NostrEvent>(list: T): Emoji[] | undefined;
export function getHiddenFavoriteEmojis<T extends NostrEvent>(list: T): Emoji[] | undefined {
  if (FavoriteEmojiPacksHiddenSymbol in list) return list[FavoriteEmojiPacksHiddenSymbol] as Emoji[];

  const tags = getHiddenTags(list);
  if (!tags) return undefined;

  const emojis = parseEmojiTags(tags);
  Reflect.set(list, FavoriteEmojiPacksHiddenSymbol, emojis);
  return emojis;
}

/** Returns the hidden emoji pack pointers if the list is unlocked */
export function getHiddenFavoriteEmojiPackPointers<T extends NostrEvent & UnlockedFavoriteEmojiPacks>(
  list: T,
): AddressPointer[];
export function getHiddenFavoriteEmojiPackPointers<T extends NostrEvent>(list: T): AddressPointer[] | undefined;
export function getHiddenFavoriteEmojiPackPointers<T extends NostrEvent>(list: T): AddressPointer[] | undefined {
  if (FavoriteEmojiPacksHiddenPointersSymbol in list)
    return list[FavoriteEmojiPacksHiddenPointersSymbol] as AddressPointer[];

  const tags = getHiddenTags(list);
  if (!tags) return undefined;

  const pointers = parseEmojiPackPointers(tags);
  Reflect.set(list, FavoriteEmojiPacksHiddenPointersSymbol, pointers);
  return pointers;
}

/** Checks if the hidden favorite emoji packs are unlocked */
export function isHiddenFavoriteEmojiPacksUnlocked<T extends NostrEvent>(
  list: T,
): list is T & UnlockedFavoriteEmojiPacks {
  return (
    isHiddenTagsUnlocked(list) &&
    (FavoriteEmojiPacksHiddenSymbol in list ||
      FavoriteEmojiPacksHiddenPointersSymbol in list ||
      getHiddenFavoriteEmojis(list) !== undefined ||
      getHiddenFavoriteEmojiPackPointers(list) !== undefined)
  );
}

/** Unlocks the hidden favorite emojis and pack pointers on a kind 10030 list */
export async function unlockHiddenFavoriteEmojiPacks(
  list: NostrEvent,
  signer: HiddenContentSigner,
): Promise<{ emojis: Emoji[]; packPointers: AddressPointer[] }> {
  if (isHiddenFavoriteEmojiPacksUnlocked(list)) {
    return {
      emojis: list[FavoriteEmojiPacksHiddenSymbol],
      packPointers: list[FavoriteEmojiPacksHiddenPointersSymbol],
    };
  }

  await unlockHiddenTags(list, signer);

  const emojis = getHiddenFavoriteEmojis(list);
  const packPointers = getHiddenFavoriteEmojiPackPointers(list);

  if (!emojis || !packPointers) throw new Error("Failed to unlock hidden favorite emoji packs");

  notifyEventUpdate(list);

  return { emojis, packPointers };
}
