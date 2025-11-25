import { Expressions } from "applesauce-content/helpers";
import {
  EncryptedContentSymbol,
  EncryptionMethod,
  getEncryptedContentEncryptionMethods,
  getPubkeyFromDecodeResult,
} from "applesauce-core/helpers";
import { Emoji } from "applesauce-common/helpers/emoji";

import { ensureProfilePointerTag } from "../helpers/common-tags.js";
import { getContentPointers } from "../helpers/content.js";
import { eventPipe, skip } from "../helpers/pipeline.js";
import { ensureQuoteEventPointerTag } from "../helpers/quote.js";
import { ensureNamedValueTag } from "../helpers/tag.js";
import { EventOperation } from "../types.js";

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
      /(?<=^|\s)(?:@)?((?:npub|note|nprofile|nevent|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58})/gi,
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

/** Adds "emoji" tags for NIP-30 emojis used in the content */
export function includeEmojis(emojis?: Emoji[]): EventOperation {
  return (draft, ctx) => {
    const all = [...(ctx.emojis ?? []), ...(emojis ?? [])];
    const tags = Array.from(draft.tags);

    // create tags for all occurrences of #hashtag
    const matches = draft.content.matchAll(Expressions.emoji);
    for (const [_, name] of matches) {
      const emoji = all.find((e) => e.shortcode === name);

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

/** Sets the content to be encrypted to the pubkey with optional override method */
export function setEncryptedContent(pubkey: string, content: string, override?: EncryptionMethod): EventOperation {
  return async (draft, { signer }) => {
    if (!signer) throw new Error("Signer required for encrypted content");

    // Set method based on kind if not provided
    const methods = getEncryptedContentEncryptionMethods(draft.kind, signer, override);

    // add the plaintext content on the draft so it can be carried forward
    const encrypted = await methods.encrypt(pubkey, content);
    return { ...draft, content: encrypted, [EncryptedContentSymbol]: content };
  };
}

/** Sets the hidden content on an event */
export function setHiddenContent(content: string, override?: EncryptionMethod): EventOperation {
  return async (draft, ctx) => {
    if (!ctx.signer) throw new Error("Signer required for encrypted content");

    const pubkey = await ctx.signer.getPublicKey();
    return setEncryptedContent(pubkey, content, override)(draft, ctx);
  };
}
