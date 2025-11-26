import { nanoid } from "nanoid";

import { EventOperation } from "../event-factory/types.js";
import { getTagValue } from "../helpers/event-tags.js";
import { EventTemplate, isAddressableKind, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import { eventPipe, skip } from "../helpers/pipeline.js";
import { ensureSingletonTag } from "../helpers/tags.js";
import { unixNow } from "../helpers/time.js";
import { removeSingletonTag, setSingletonTag } from "./tag/common.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

/** An operation that removes the signature from the event template */
export function stripSignature<Input extends NostrEvent | UnsignedEvent | EventTemplate>(): EventOperation<
  Input,
  Omit<Input, "sig">
> {
  return (draft) => {
    const newDraft = { ...draft };
    Reflect.deleteProperty(newDraft, "sig");
    return newDraft;
  };
}

/** An operation that removes the id and pubkey from the event template */
export function stripStamp<Input extends NostrEvent | UnsignedEvent | EventTemplate>(): EventOperation<
  Input,
  Omit<Input, "id" | "pubkey">
> {
  return (draft) => {
    const newDraft = { ...draft };
    Reflect.deleteProperty(newDraft, "id");
    Reflect.deleteProperty(newDraft, "pubkey");
    return newDraft;
  };
}

/** An operation that updates the created_at timestamp */
export function updateCreatedAt(): EventOperation {
  return (draft) => ({ ...draft, created_at: unixNow() });
}

/** An operation that removes all symbols from the event */
export function stripSymbols(preserve?: symbol[]): EventOperation {
  return (draft) => {
    const newDraft = { ...draft };
    for (const symbol of Reflect.ownKeys(newDraft)) {
      if (typeof symbol !== "string" && !preserve?.includes(symbol)) Reflect.deleteProperty(newDraft, symbol);
    }
    return newDraft;
  };
}

/** Ensures parameterized replaceable kinds have "d" tags */
export function includeReplaceableIdentifier(identifier: string | (() => string) = nanoid): EventOperation {
  return (draft) => {
    if (!isAddressableKind(draft.kind)) return draft;

    // Add a "d" tag if it doesn't exist
    if (!getTagValue(draft, "d")) {
      let tags = Array.from(draft.tags);
      const id = typeof identifier === "string" ? identifier : identifier();

      tags = ensureSingletonTag(tags, ["d", id], true);
      return { ...draft, tags };
    }

    return draft;
  };
}

/** Includes a NIP-31 alt tag in an events public tags */
export function includeAltTag(description: string): EventOperation {
  return includeSingletonTag(["alt", description]);
}

/** Sets the NIP-40 expiration timestamp for an event */
export function setExpirationTimestamp(timestamp: number): EventOperation {
  return includeSingletonTag(["expiration", timestamp.toString()], true);
}

/** Adds or removes the NIP-70 "-" tag from an event */
export function setProtected(set = true): EventOperation {
  return modifyPublicTags(set ? setSingletonTag(["-"]) : removeSingletonTag("-"));
}

/** Options for {@link setMetaTags} */
export type MetaTagOptions = {
  /** Unix timestamp when the event expires */
  expiration?: number;
  /** Whether the event is protected (can only be published by author) */
  protected?: boolean;
  /** Alt description for clients that can't render the event */
  alt?: string;
};

/** Creates the necessary operations for meta tag options */
export function setMetaTags(options?: MetaTagOptions): EventOperation {
  return eventPipe(
    options?.protected ? setProtected(true) : skip(),
    options?.expiration ? setExpirationTimestamp(options.expiration) : skip(),
    options?.alt ? includeAltTag(options.alt) : skip(),
  );
}
