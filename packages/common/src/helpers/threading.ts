import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";

export type ThreadReferences = {
  root?:
    | { e: EventPointer; a: undefined }
    | { e: undefined; a: AddressPointer }
    | { e: EventPointer; a: AddressPointer };
  reply?:
    | { e: EventPointer; a: undefined }
    | { e: undefined; a: AddressPointer }
    | { e: EventPointer; a: AddressPointer };
};

export const Nip10ThreadRefsSymbol = Symbol.for("nip10-thread-refs");

/**
 * Gets an EventPointer form a NIP-10 threading "e" tag
 * @throws
 */
export function getEventPointerFromThreadTag(tag: string[]): EventPointer {
  if (!tag[1]) throw new Error("Missing event id in tag");
  let pointer: EventPointer = { id: tag[1] };
  if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [tag[2]];

  // get author from NIP-18 quote tags, nip-22 comments tags, or nip-10 thread tags
  if (
    tag[0] === "e" &&
    (tag[3] === "root" || tag[3] === "reply" || tag[3] === "mention") &&
    tag[4] &&
    tag[4].length === 64
  ) {
    // NIP-10 "e" tag
    pointer.author = tag[4];
  }

  return pointer;
}

/** Parses NIP-10 tags and handles legacy behavior */
export function interpretThreadTags(tags: string[][]) {
  const eTags = tags.filter((t) => t[0] === "e" && t[1]);
  const aTags = tags.filter((t) => t[0] === "a" && t[1]);

  // find the root and reply tags.
  let rootETag = eTags.find((t) => t[3] === "root");
  let replyETag = eTags.find((t) => t[3] === "reply");

  let rootATag = aTags.find((t) => t[3] === "root");
  let replyATag = aTags.find((t) => t[3] === "reply");

  if (!rootETag || !replyETag) {
    // a direct reply does not need a "reply" reference
    // https://github.com/nostr-protocol/nips/blob/master/10.md

    // this is not necessarily to spec. but if there is only one id (root or reply) then assign it to both
    // this handles the cases where a client only set a "reply" tag and no root
    rootETag = replyETag = rootETag || replyETag;
  }
  if (!rootATag || !replyATag) {
    rootATag = replyATag = rootATag || replyATag;
  }

  if (!rootETag && !replyETag) {
    // legacy behavior
    // https://github.com/nostr-protocol/nips/blob/master/10.md#positional-e-tags-deprecated
    const legacyETags = eTags.filter((t) => {
      // ignore it if there is a marker
      if (t[3]) return false;
      return true;
    });

    if (legacyETags.length >= 1) {
      // first tag is the root
      rootETag = legacyETags[0];
      // last tag is reply
      replyETag = legacyETags[legacyETags.length - 1] ?? rootETag;
    }
  }

  return {
    root: rootETag || rootATag ? { e: rootETag, a: rootATag } : undefined,
    reply: replyETag || replyATag ? { e: replyETag, a: replyATag } : undefined,
  } as {
    root?: { e: string[]; a: undefined } | { e: undefined; a: string[] } | { e: string[]; a: string[] };
    reply?: { e: string[]; a: undefined } | { e: undefined; a: string[] } | { e: string[]; a: string[] };
  };
}

/** Returns the parsed NIP-10 tags for an event */
export function getNip10References(event: NostrEvent | EventTemplate): ThreadReferences {
  return getOrComputeCachedValue(event, Nip10ThreadRefsSymbol, () => {
    const tags = interpretThreadTags(event.tags);

    let root: ThreadReferences["root"];
    if (tags.root) {
      try {
        root = {
          e: tags.root.e && getEventPointerFromThreadTag(tags.root.e),
          a: tags.root.a && getAddressPointerFromATag(tags.root.a),
        } as ThreadReferences["root"];
      } catch (error) {}
    }

    let reply: ThreadReferences["reply"];
    if (tags.reply) {
      try {
        reply = {
          e: tags.reply.e && getEventPointerFromThreadTag(tags.reply.e),
          a: tags.reply.a && getAddressPointerFromATag(tags.reply.a),
        } as ThreadReferences["reply"];
      } catch (error) {}
    }

    return {
      root,
      reply,
    } as ThreadReferences;
  });
}
