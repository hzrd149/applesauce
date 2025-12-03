import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import {
  createReplaceableAddress,
  getTagValue,
  isAddressableKind,
  KnownEvent,
  NostrEvent,
} from "applesauce-core/helpers/event";
import { ExternalIdentifiers, ExternalPointer, getExternalPointerFromTag } from "applesauce-core/helpers/external-id";
import { getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { fillAndTrimTag } from "applesauce-core/helpers/tags";

export const COMMENT_KIND = 1111;

/** Type for validated comment events */
export type CommentEvent = KnownEvent<typeof COMMENT_KIND>;

export type CommentEventPointer = {
  type: "event";
  id: string;
  kind: number;
  pubkey?: string;
  relay?: string;
};
export type CommentAddressPointer = {
  type: "address";
  // address pointer can have optional event id if there is an "E" or "e" tag
  id?: string;
  kind: number;
  pubkey: string;
  identifier: string;
  relay?: string;
};

export type CommentExternalPointer<T extends keyof ExternalIdentifiers> = ExternalPointer<T> & { type: "external" };

export type CommentPointer =
  | CommentEventPointer
  | CommentAddressPointer
  | CommentExternalPointer<keyof ExternalIdentifiers>;

export const CommentRootPointerSymbol = Symbol.for("comment-root-pointer");
export const CommentReplyPointerSymbol = Symbol.for("comment-reply-pointer");

/** Gets the EventPointer from an array of tags */
export function getCommentEventPointer(tags: string[][], root = false): CommentEventPointer | null {
  const eTag = tags.find((t) => t[0] === (root ? "E" : "e"));
  const kind = tags.find((t) => t[0] === (root ? "K" : "k"))?.[1];

  if (eTag) {
    // Missing kind tag, return null
    if (!kind) return null;

    // only the root pubkey can be gotten from the tags, since due to quotes and mentions there will be many "p" tags for replies
    const rootPubkey = root ? tags.find((t) => t[0] === "P")?.[1] : undefined;

    const pointer: CommentPointer = {
      type: "event",
      id: eTag[1],
      kind: parseInt(kind),
      pubkey: eTag[3] || rootPubkey || undefined,
      relay: eTag[2] && isSafeRelayURL(eTag[2]) ? eTag[2] : undefined,
    };

    return pointer;
  }
  return null;
}

/** Gets the AddressPointer from an array of tags */
export function getCommentAddressPointer(tags: string[][], root = false): CommentAddressPointer | null {
  const aTag = tags.find((t) => t[0] === (root ? "A" : "a"));
  const eTag = tags.find((t) => t[0] === (root ? "E" : "e"));
  const kind = tags.find((t) => t[0] === (root ? "K" : "k"))?.[1];

  if (aTag) {
    // Missing kind tag, return null
    if (!kind) return null;

    const addressPointer = getAddressPointerFromATag(aTag);
    const pointer: CommentAddressPointer = {
      type: "address",
      id: eTag?.[1],
      pubkey: addressPointer.pubkey,
      identifier: addressPointer.identifier,
      kind: addressPointer.kind || parseInt(kind),
      relay: addressPointer.relays?.[0] || eTag?.[2],
    };

    return pointer;
  }
  return null;
}

/** Gets the ExternalPointer from an array of tags */
export function getCommentExternalPointer(
  tags: string[][],
  root = false,
): CommentExternalPointer<keyof ExternalIdentifiers> | null {
  const iTag = tags.find((t) => t[0] === (root ? "I" : "i"));

  if (iTag) {
    return {
      type: "external",
      ...getExternalPointerFromTag(iTag),
    };
  }
  return null;
}

/** Returns the root pointer for a comment */
export function getCommentRootPointer(comment: CommentEvent): CommentPointer;
export function getCommentRootPointer(comment: NostrEvent): CommentPointer | null;
export function getCommentRootPointer(comment: NostrEvent): CommentPointer | null {
  if (comment.kind !== COMMENT_KIND) return null;

  return getOrComputeCachedValue(comment, CommentRootPointerSymbol, () => {
    // check for address pointer first since it can also have E tags
    const A = getCommentAddressPointer(comment.tags, true);
    if (A) return A;

    const E = getCommentEventPointer(comment.tags, true);
    if (E) return E;

    const I = getCommentExternalPointer(comment.tags, true);
    if (I) return I;

    return null;
  });
}

/** Returns the reply pointer for a comment */
export function getCommentReplyPointer(comment: NostrEvent): CommentPointer | null {
  if (comment.kind !== COMMENT_KIND) return null;

  return getOrComputeCachedValue(comment, CommentReplyPointerSymbol, () => {
    // check for address pointer first since it can also have E tags
    const A = getCommentAddressPointer(comment.tags, false);
    if (A) return A;

    const E = getCommentEventPointer(comment.tags, false);
    if (E) return E;

    const I = getCommentExternalPointer(comment.tags, false);
    if (I) return I;

    return null;
  });
}

/** Checks if a pointer is a {@link CommentEventPointer} */
export function isCommentEventPointer(pointer: any): pointer is CommentEventPointer {
  return (
    Reflect.has(pointer, "id") &&
    Reflect.has(pointer, "kind") &&
    !Reflect.has(pointer, "identifier") &&
    typeof pointer.kind === "number"
  );
}

/** Checks if a pointer is a {@link CommentAddressPointer} */
export function isCommentAddressPointer(pointer: any): pointer is CommentAddressPointer {
  return (
    Reflect.has(pointer, "identifier") &&
    Reflect.has(pointer, "pubkey") &&
    Reflect.has(pointer, "kind") &&
    typeof pointer.kind === "number"
  );
}

/** Checks if a comment event is valid */
export function isValidComment(comment: NostrEvent): comment is CommentEvent {
  return (
    comment.kind === COMMENT_KIND && getCommentRootPointer(comment) !== null && getCommentReplyPointer(comment) !== null
  );
}

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
        createReplaceableAddress(pointer.kind, pointer.pubkey, pointer.identifier),
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
