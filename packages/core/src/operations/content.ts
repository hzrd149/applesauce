import { Emoji, EventOperation } from "../event-factory/types.js";
import { EncryptedContentSymbol } from "../helpers/encrypted-content.js";
import { ensureProfilePointerTag, ensureQuoteEventPointerTag } from "../helpers/factory.js";
import { eventPipe, skip } from "../helpers/pipeline.js";
import { getContentPointers, getPubkeyFromDecodeResult } from "../helpers/pointers.js";
import { Expressions } from "../helpers/regexp.js";
import { ensureNamedValueTag } from "../helpers/tags.js";

/** Override the event content */
export function setContent(content: string): EventOperation {
  return async (draft) => {
    draft = { ...draft, content };
    Reflect.deleteProperty(draft, EncryptedContentSymbol);
    return draft;
  };
}

/** Replaces any `@npub` or bare npub mentions with nostr: prefix */
export function repairNostrLinks(): EventOperation {
  return (draft) => ({
    ...draft,
    content: draft.content.replaceAll(
      /(?<=^|\s)(?:@)?((?:npub|note|nprofile|nevent|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58,})/gi,
      "nostr:$1",
    ),
  });
}

/** "p" tag any pubkey mentioned in the content using nostr: links */
export function tagPubkeyMentions(): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);
    const mentions = getContentPointers(draft.content);

    for (const mention of mentions) {
      const pubkey = getPubkeyFromDecodeResult(mention);
      if (pubkey) tags = ensureProfilePointerTag(tags, mention.type === "nprofile" ? mention.data : { pubkey });
    }

    return { ...draft, tags };
  };
}

/** Sets the NIP-36 content-warning tag */
export function setContentWarning(warning: boolean | string): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // remove existing content warning
    tags = tags.filter((t) => t[0] !== "content-warning");

    if (typeof warning === "string") tags.push(["content-warning", warning]);
    else if (warning === true) tags.push(["content-warning"]);

    return { ...draft, tags };
  };
}

/** Include "q" quote tags for any nostr event mentioned in the content */
export function includeQuoteTags(): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);
    const mentions = getContentPointers(draft.content);

    for (const mention of mentions) {
      switch (mention.type) {
        case "note":
          tags = ensureQuoteEventPointerTag(tags, { id: mention.data });
          break;
        case "nevent":
          tags = ensureQuoteEventPointerTag(tags, mention.data);
          break;
      }
    }

    return { ...draft, tags };
  };
}

/** Adds "t" tags for every #hashtag in the content */
export function includeContentHashtags(): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // create tags for all occurrences of #hashtag
    const matches = draft.content.matchAll(Expressions.hashtag);
    for (const [_, hashtag] of matches) {
      const lower = hashtag.toLocaleLowerCase();
      tags = ensureNamedValueTag(tags, ["t", lower]);
    }

    return { ...draft, tags };
  };
}

/**
 * Adds "emoji" tags for NIP-30 emojis used in the content
 * @param emojis - Array of custom emojis to check for in content
 */
export function includeEmojis(emojis: Emoji[] = []): EventOperation {
  return (draft) => {
    const tags = Array.from(draft.tags);

    // create tags for all occurrences of :emoji:
    const matches = draft.content.matchAll(Expressions.emoji);
    for (const [_, name] of matches) {
      const emoji = emojis.find((e) => e.shortcode === name);

      if (emoji?.url) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    return { ...draft, tags };
  };
}

export type TextContentOptions = {
  emojis?: Emoji[];
  contentWarning?: boolean | string;
};

/** Sets the text for a short text note and include hashtags and mentions */
export function setShortTextContent(content: string, options?: TextContentOptions): EventOperation {
  return eventPipe(
    // set text content
    setContent(content),
    // fix @ mentions
    repairNostrLinks(),
    // include "p" tags for pubkeys mentioned
    tagPubkeyMentions(),
    // include event "q" tags
    includeQuoteTags(),
    // include "t" tags for hashtags
    includeContentHashtags(),
    // include "emoji" tags
    options?.emojis ? includeEmojis(options.emojis) : skip(),
    // set "content-warning" tag
    options?.contentWarning !== undefined ? setContentWarning(options.contentWarning) : skip(),
  );
}
