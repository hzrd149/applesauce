import { kinds, NostrEvent } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import { getHiddenTags, isHiddenTagsUnlocked } from "./hidden-tags.js";
import { getIndexableTags, getNip10References } from "./index.js";
import { isETag, isPTag, isTTag } from "./tags.js";

export const MutePublicSymbol = Symbol.for("mute-public");
export const MuteHiddenSymbol = Symbol.for("mute-hidden");

export type Mutes = {
  pubkeys: Set<string>;
  threads: Set<string>;
  hashtags: Set<string>;
  words: Set<string>;
};

/** Merges any number of mute sets */
export function mergeMutes(...mutes: Mutes[]): Mutes {
  const mute: Mutes = { pubkeys: new Set(), threads: new Set(), hashtags: new Set(), words: new Set() };
  for (const m of mutes) {
    for (const pubkey of m.pubkeys) mute.pubkeys.add(pubkey);
    for (const thread of m.threads) mute.threads.add(thread);
    for (const hashtag of m.hashtags) mute.hashtags.add(hashtag);
    for (const word of m.words) mute.words.add(word);
  }
  return mute;
}

/** Parses mute tags */
export function parseMutedTags(tags: string[][]): Mutes {
  const pubkeys = new Set(tags.filter(isPTag).map((t) => t[1]));
  const threads = new Set(tags.filter(isETag).map((t) => t[1]));
  const hashtags = new Set(tags.filter(isTTag).map((t) => t[1].toLocaleLowerCase()));
  const words = new Set(tags.filter((t) => t[0] === "word" && t[1]).map((t) => t[1].toLocaleLowerCase()));

  return { pubkeys, threads, hashtags, words };
}

/** Returns muted things */
export function getMutedThings(mute: NostrEvent): Mutes {
  const hidden = getHiddenMutedThings(mute);
  const mutes = getPublicMutedThings(mute);

  if (hidden) return mergeMutes(hidden, mutes);
  return mutes;
}

/** Returns only the public muted things from a mute event */
export function getPublicMutedThings(mute: NostrEvent): Mutes {
  return getOrComputeCachedValue(mute, MutePublicSymbol, () => parseMutedTags(mute.tags));
}

/** Returns the hidden muted content if the event is unlocked */
export function getHiddenMutedThings(mute: NostrEvent): Mutes | undefined {
  if (isHiddenTagsUnlocked(mute)) return undefined;

  return getOrComputeCachedValue(mute, MuteHiddenSymbol, () => parseMutedTags(getHiddenTags(mute)!));
}

/** Creates a RegExp for matching muted words */
export function createMutedWordsRegExp(mutedWords: string[]): RegExp {
  // Escape special characters and join with |
  const escapedWords = mutedWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Create the RegExp with word boundaries and case insensitive flag
  return new RegExp(`\\b(${escapedWords.join("|")})\\b`, "gi");
}

/** Returns true if the event matches the mutes */
export function matchMutes(mutes: Mutes, event: NostrEvent): boolean {
  // Filter on muted pubkeys
  if (mutes.pubkeys.size > 0) {
    if (mutes.pubkeys.has(event.pubkey)) return true;
  }

  // Filter on muted hashtags`
  if (mutes.hashtags.size > 0) {
    const tags = getIndexableTags(event);
    for (let tag of mutes.hashtags) {
      if (tags.has("t:" + tag)) return true;
    }
  }

  // Filter on muted threads
  if (mutes.threads.size > 0 && event.kind === kinds.ShortTextNote) {
    const refs = getNip10References(event);
    if (refs.root?.e && mutes.threads.has(refs.root.e.id)) return true;
  }

  // Filter on muted words
  if (mutes.words.size > 0) {
    const regExp = createMutedWordsRegExp(Array.from(mutes.words));
    if (regExp.test(event.content)) return true;
  }

  // Event does not match any mutes
  return false;
}
