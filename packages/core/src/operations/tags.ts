import type { EventOperation, TagOperation } from "../factories/types.js";
import { eventPipe, skip, tagPipe } from "../helpers/pipeline.js";
import { setCachedValue } from "../helpers/cache.js";
import { EncryptedContentSymbol } from "../helpers/encrypted-content.js";
import { EventTemplate, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import {
  canHaveHiddenTags,
  getHiddenTags,
  getHiddenTagsEncryptionMethods,
  hasHiddenTags,
  unlockHiddenTags,
} from "../helpers/hidden-tags.js";
import { addNameValueTag, setSingletonTag } from "./tag/common.js";

/** Includes only a single instance of tag in an events public tags */
export function includeSingletonTag(tag: [string, ...string[]], replace = true): EventOperation {
  return modifyPublicTags(setSingletonTag(tag, replace));
}

/**
 * Builds a shallow copy of `draft` that preserves every own property descriptor — including
 * non-enumerable symbols — then overrides `pubkey` on the copy. Used to build the throwaway
 * temp object passed into {@link unlockHiddenTags} (Site-1, out-of-pipe spread): a plain
 * `{ ...draft, pubkey }` spread only copies own ENUMERABLE properties, silently dropping any
 * non-enumerable symbol (e.g. `HiddenTagsSymbol`/`EncryptedContentSymbol`) already cached on
 * `draft`, which would force `unlockHiddenTags` to take its "not yet unlocked" branch and
 * re-decrypt unnecessarily. This copy is genuinely out-of-pipe (never the pipe operation's own
 * return value), so the pipe-level symbol carry-forward cannot cover it — the fix must be local.
 *
 * Note: gift-wrap's `toRumor`'s `{ ...draft }` (`common/operations/gift-wrap.ts`) is deliberately
 * NOT changed to this pattern — it IS a pipe operation's return value, so the pipe carry-forward
 * restores any dropped symbol for that site (RESEARCH out-of-pipe spread audit, Site 2).
 */
function copyDraftWithPubkey<T extends EventTemplate | UnsignedEvent | NostrEvent>(
  draft: T,
  pubkey: string,
): T & { pubkey: string } {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(draft)) as T;
  Object.defineProperty(copy, "pubkey", { value: pubkey, enumerable: true, writable: true, configurable: true });
  return copy as T & { pubkey: string };
}

/** Includes only a single name / value tag in an events public tags */
export function includeNameValueTag(tag: [string, string, ...string[]], replace = true): EventOperation {
  return modifyPublicTags(addNameValueTag(tag, replace));
}

/** An event operation that modifies the public tags with {@link TagOperation}s */
export function modifyPublicTags<E extends EventTemplate | UnsignedEvent | NostrEvent>(
  ...operations: (TagOperation | undefined)[]
): EventOperation<E, E> {
  return async (draft) => {
    return { ...draft, tags: await tagPipe(...operations)(Array.from(draft.tags)) };
  };
}

/**
 * Creates an event operation that modifies the hidden tags on an event with {@link TagOperation}s
 * @param signer - EventSigner for encrypting/decrypting hidden tags
 * @param operations - Tag operations to apply to hidden tags
 * @throws {Error} if no signer is provided
 * @throws {Error} if the event kind does not support hidden tags
 */
export function modifyHiddenTags<E extends EventTemplate | UnsignedEvent | NostrEvent>(
  signer: import("../factories/types.js").EventSigner | undefined,
  ...operations: (TagOperation | undefined)[]
): EventOperation<E, E> {
  operations = operations.filter((o) => !!o);
  if (operations.length === 0) return skip();

  return async (draft) => {
    if (!signer) throw new Error("Missing signer for hidden tags");
    if (!canHaveHiddenTags(draft.kind)) throw new Error("Event kind does not support hidden tags");

    // Create var to store pubkey
    let pubkey: string | undefined = undefined;

    // Read hidden tags from event or create a new array
    let hidden: string[][] | undefined = undefined;
    if (hasHiddenTags(draft)) {
      // Attempt to read hidden tags from the event
      hidden = getHiddenTags(draft);

      // If that failed, attempt to unlock the tags
      if (hidden === undefined) {
        if (hasHiddenTags(draft)) {
          // draft is an existing event, attempt to unlock tags
          pubkey = await signer.getPublicKey();
          // draft is constrained (EventTemplate | UnsignedEvent | NostrEvent) to always carry
          // kind/content; the cast only affirms what copyDraftWithPubkey's descriptor-preserving
          // copy already guarantees at runtime (every own property of draft, plus pubkey).
          hidden = await unlockHiddenTags(
            copyDraftWithPubkey(draft, pubkey) as EventTemplate & { pubkey: string },
            signer,
          );
        }
        // create a new array of hidden tags
        else hidden = [];
      }
    }
    // this is a fresh draft, create a new hidden tags
    else hidden = [];

    // Make sure hidden tags where found
    if (hidden === undefined) throw new Error("Failed to find hidden tags");

    // Create the new hidden tags
    const tags = await tagPipe(...operations)(hidden);

    // Encrypt new hidden tags
    const methods = getHiddenTagsEncryptionMethods(draft.kind, signer);
    if (!pubkey) pubkey = await signer.getPublicKey();
    const plaintext = JSON.stringify(tags);
    const content = await methods.encrypt(pubkey, plaintext);

    // carry-forward payload (see cache.ts one-rule doc block): construct the object first, then
    // write EncryptedContentSymbol non-enumerably via setCachedValue. It survives downstream
    // pipe steps' own spreads because pipeFromAsyncArray's carry-forward loop (helpers/pipeline.ts)
    // explicitly restores any PRESERVE_EVENT_SYMBOLS member the previous step's value had that the
    // new result is missing — not because this write happens to be enumerable.
    const result = { ...draft, content };
    setCachedValue(result, EncryptedContentSymbol, plaintext);
    return result;
  };
}

export type ModifyTagsOptions =
  | TagOperation
  | TagOperation[]
  | { public?: TagOperation | TagOperation[]; hidden?: TagOperation | TagOperation[] };

/**
 * A flexible method for creating an event operation that modifies the tags
 * @param tagOperations - Tag operations for public and/or hidden tags
 * @param signer - Optional signer (required if modifying hidden tags)
 */
export function modifyTags(
  tagOperations?: ModifyTagsOptions,
  signer?: import("../factories/types.js").EventSigner,
): EventOperation {
  let publicOperations: TagOperation[] = [];
  let hiddenOperations: TagOperation[] = [];

  // normalize tag operation arg
  if (tagOperations === undefined) publicOperations = hiddenOperations = [];
  else if (Array.isArray(tagOperations)) publicOperations = tagOperations;
  else if (typeof tagOperations === "function") publicOperations = [tagOperations];
  else {
    if (typeof tagOperations.public === "function") publicOperations = [tagOperations.public];
    else if (tagOperations.public) publicOperations = tagOperations.public;

    if (typeof tagOperations.hidden === "function") hiddenOperations = [tagOperations.hidden];
    else if (tagOperations.hidden) hiddenOperations = tagOperations.hidden;
  }

  // return a new event operation that modifies the tags
  return eventPipe(
    publicOperations.length > 0 ? modifyPublicTags(...publicOperations) : undefined,
    hiddenOperations.length > 0 ? modifyHiddenTags(signer, ...hiddenOperations) : undefined,
  );
}
