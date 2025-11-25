import { getReplaceableUID, getTagValue } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isAddressableKind } from "nostr-tools/kinds";
import {
  COMMENT_KIND,
  CommentPointer,
  getCommentRootPointer,
  isCommentAddressPointer,
  isCommentEventPointer,
} from "applesauce-common/helpers/comment";

import { fillAndTrimTag } from "./tag.js";

/** Create a set fo tags for a single CommentPointer */
export function createCommentTagsFromCommentPointer(pointer: CommentPointer, root = false): string[][] {
  if (isCommentEventPointer(pointer)) {
    // Event pointer
    return [
      fillAndTrimTag([root ? "E" : "e", pointer.id, pointer.relay, pointer.pubkey]),
      [root ? "K" : "k", String(pointer.kind)],
      pointer.pubkey ? fillAndTrimTag([root ? "P" : "p", pointer.pubkey]) : undefined,
    ].filter((t) => !!t);
  } else if (isCommentAddressPointer(pointer)) {
    // Address pointer
    return [
      fillAndTrimTag([
        root ? "A" : "a",
        getReplaceableUID(pointer.kind, pointer.pubkey, pointer.identifier),
        pointer.relay,
      ]),
      pointer.id ? fillAndTrimTag([root ? "E" : "e", pointer.id, pointer.relay, pointer.pubkey]) : undefined,
      [root ? "K" : "k", String(pointer.kind)],
      pointer.pubkey ? fillAndTrimTag([root ? "P" : "p", pointer.pubkey]) : undefined,
    ].filter((t) => !!t);
  } else {
    // External pointer
    return [
      [root ? "I" : "i", pointer.identifier],
      [root ? "K" : "k", pointer.kind],
    ];
  }

  throw new Error("Unknown comment pointer kind");
}

/** Returns an array of NIP-22 tags for a kind 1111 comment event */
export function createCommentTagsForEvent(parent: NostrEvent, relayHint?: string) {
  const tags: string[][] = [];

  let parentPointer: CommentPointer;
  if (isAddressableKind(parent.kind)) {
    const identifier = getTagValue(parent, "d");
    if (!identifier) throw new Error("Event missing identifier");
    parentPointer = {
      type: "address",
      id: parent.id,
      pubkey: parent.pubkey,
      kind: parent.kind,
      relay: relayHint,
      identifier,
    };
  } else {
    parentPointer = { type: "event", id: parent.id, pubkey: parent.pubkey, kind: parent.kind, relay: relayHint };
  }

  // check if parent event is a comment
  if (parent.kind === COMMENT_KIND) {
    // comment is a reply to another comment
    const pointer = getCommentRootPointer(parent);
    if (!pointer) throw new Error("Comment missing root pointer");

    // recreate the root tags
    tags.push(...createCommentTagsFromCommentPointer(pointer, true));
  } else {
    // comment is root comment
    tags.push(...createCommentTagsFromCommentPointer(parentPointer, true));
  }

  // add reply tags
  tags.push(...createCommentTagsFromCommentPointer(parentPointer, false));

  return tags;
}
