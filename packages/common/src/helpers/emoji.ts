import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, parseReplaceableAddress } from "applesauce-core/helpers/pointers";

export type Emoji = {
  /** The emoji shortcode (without the ::) */
  shortcode: string;
  /** The URL to the emoji image */
  url: string;
  /** The NIP-01 "a" tag address of the emoji pack this emoji belongs to */
  address?: AddressPointer;
};

/** Gets an "emoji" tag that matches an emoji code */
export function getEmojiTag(
  tags: { tags: string[][] } | string[][],
  code: string,
): ["emoji", string, string, ...string[]] | undefined {
  code = code.replace(/^:|:$/g, "").toLowerCase();

  return (Array.isArray(tags) ? tags : tags.tags).find(
    (t) => t[0] === "emoji" && t.length >= 3 && t[1].toLowerCase() === code,
  ) as ["emoji", string, string] | undefined;
}

/** Gets an emoji for a shortcode from an array of tags or event */
export function getEmojiFromTags(event: { tags: string[][] } | string[][], code: string): Emoji | undefined {
  const tag = getEmojiTag(event, code);
  if (!tag) return undefined;

  const address = tag[3] ? parseReplaceableAddress(tag[3]) : undefined;
  return address ? { shortcode: tag[1], url: tag[2], address } : { shortcode: tag[1], url: tag[2] };
}

/** Returns the custom emoji for a reaction event */
export function getReactionEmoji(event: NostrEvent): Emoji | undefined {
  // Trim and strip colons
  const shortcode = /^:+(.+?):+$/g.exec(event.content.trim().toLowerCase())?.[1];
  if (!shortcode) return undefined;

  return getEmojiFromTags(event, shortcode);
}
