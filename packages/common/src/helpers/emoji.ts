import { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event-tags";

/** Gets an "emoji" tag that matches an emoji code */
export function getEmojiTag(
  tags: { tags: string[][] } | string[][],
  code: string,
): ["emoji", string, string] | undefined {
  code = code.replace(/^:|:$/g, "").toLowerCase();

  return (Array.isArray(tags) ? tags : tags.tags).find(
    (t) => t[0] === "emoji" && t.length >= 3 && t[1].toLowerCase() === code,
  ) as ["emoji", string, string] | undefined;
}

/** Gets an emoji for a shortcode from an array of tags or event */
export function getEmojiFromTags(event: { tags: string[][] } | string[][], code: string): Emoji | undefined {
  const tag = getEmojiTag(event, code);
  if (!tag) return undefined;

  return {
    shortcode: tag[1],
    url: tag[2],
  };
}

/** Returns the name of a NIP-30 emoji pack */
export function getPackName(pack: NostrEvent): string | undefined {
  return getTagValue(pack, "title") || getTagValue(pack, "d");
}

export type Emoji = {
  /** The emoji shortcode (without the ::) */
  shortcode: string;
  /** The URL to the emoji image */
  url: string;
};

/** Returns an array of emojis from a NIP-30 emoji pack */
export function getEmojis(pack: NostrEvent): Emoji[] {
  return pack.tags
    .filter((t) => t[0] === "emoji" && t[1] && t[2])
    .map((t) => ({ shortcode: t[1] as string, url: t[2] as string }));
}

/** Returns the custom emoji for a reaction event */
export function getReactionEmoji(event: NostrEvent): Emoji | undefined {
  // Trim and strip colons
  const shortcode = /^:+(.+?):+$/g.exec(event.content.trim().toLowerCase())?.[1];
  if (!shortcode) return undefined;

  return getEmojiFromTags(event, shortcode);
}
