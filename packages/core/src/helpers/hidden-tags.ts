import { kinds } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import {
  canHaveHiddenContent,
  getHiddenContent,
  getHiddenContentEncryptionMethods,
  hasHiddenContent,
  HiddenContentSigner,
  isHiddenContentLocked,
  lockHiddenContent,
  setHiddenContentCache,
  setHiddenContentEncryptionMethod,
  unlockHiddenContent,
} from "./hidden-content.js";
import { GROUPS_LIST_KIND } from "./groups.js";
import { EncryptionMethod } from "./encrypted-content.js";

export const HiddenTagsSymbol = Symbol.for("hidden-tags");

/** Various event kinds that can have hidden tags */
export const HiddenTagsKinds = new Set<number>([
  // NIP-51 lists
  setHiddenContentEncryptionMethod(kinds.BookmarkList, "nip04"),
  setHiddenContentEncryptionMethod(kinds.InterestsList, "nip04"),
  setHiddenContentEncryptionMethod(kinds.Mutelist, "nip04"),
  setHiddenContentEncryptionMethod(kinds.CommunitiesList, "nip04"),
  setHiddenContentEncryptionMethod(kinds.PublicChatsList, "nip04"),
  setHiddenContentEncryptionMethod(kinds.SearchRelaysList, "nip04"),
  setHiddenContentEncryptionMethod(GROUPS_LIST_KIND, "nip04"),
  // NIP-51 sets
  setHiddenContentEncryptionMethod(kinds.Bookmarksets, "nip04"),
  setHiddenContentEncryptionMethod(kinds.Relaysets, "nip04"),
  setHiddenContentEncryptionMethod(kinds.Followsets, "nip04"),
  setHiddenContentEncryptionMethod(kinds.Curationsets, "nip04"),
  setHiddenContentEncryptionMethod(kinds.Interestsets, "nip04"),
]);

/** Checks if an event can have hidden tags */
export function canHaveHiddenTags(kind: number): boolean {
  return canHaveHiddenContent(kind) && HiddenTagsKinds.has(kind);
}

/** Sets the type of encryption to use for hidden tags on a kind */
export function setHiddenTagsEncryptionMethod(kind: number, method: EncryptionMethod) {
  HiddenTagsKinds.add(setHiddenContentEncryptionMethod(kind, method));
  return kind;
}

/** Checks if an event has hidden tags */
export function hasHiddenTags<T extends { kind: number; content: string }>(event: T): boolean {
  return canHaveHiddenTags(event.kind) && hasHiddenContent(event);
}

/** Returns the hidden tags for an event if they are unlocked */
export function getHiddenTags<T extends { kind: number; content: string }>(event: T): string[][] | undefined {
  if (!canHaveHiddenTags(event.kind) || isHiddenTagsLocked(event)) return undefined;

  return getOrComputeCachedValue(event, HiddenTagsSymbol, () => {
    const plaintext = getHiddenContent(event)!;

    const parsed = JSON.parse(plaintext) as string[][];
    if (!Array.isArray(parsed)) throw new Error("Content is not an array of tags");

    // Convert array to tags array string[][]
    return parsed.filter((t) => Array.isArray(t)).map((t) => t.map((v) => String(v)));
  });
}

/** Checks if the hidden tags are locked */
export function isHiddenTagsLocked<T extends object>(event: T): boolean {
  return isHiddenContentLocked(event);
}

/** Returns either nip04 or nip44 encryption method depending on list kind */
export function getHiddenTagsEncryptionMethods(kind: number, signer: HiddenContentSigner) {
  return getHiddenContentEncryptionMethods(kind, signer);
}

/**
 * Decrypts the private list
 * @param event The list event to decrypt
 * @param signer A signer to use to decrypt the tags
 * @param override The encryption method to use instead of the default
 * @throws
 */
export async function unlockHiddenTags<T extends { kind: number; pubkey: string; content: string }>(
  event: T,
  signer: HiddenContentSigner,
  override?: EncryptionMethod,
): Promise<string[][]> {
  if (!canHaveHiddenTags(event.kind)) throw new Error("Event kind does not support hidden tags");

  // unlock hidden content is needed
  if (isHiddenContentLocked(event)) await unlockHiddenContent(event, signer, override);

  return getHiddenTags(event)!;
}

/**
 * Sets the hidden tags on an event and updates it if its part of an event store
 * @throws
 */
export function setHiddenTagsCache<T extends { kind: number }>(event: T, tags: string[][]) {
  if (!canHaveHiddenTags(event.kind)) throw new Error("Event kind does not support hidden tags");

  const plaintext = JSON.stringify(tags);
  setHiddenContentCache(event, plaintext);
}

/** Clears the cached hidden tags on an event */
export function lockHiddenTags<T extends object>(event: T) {
  Reflect.deleteProperty(event, HiddenTagsSymbol);
  lockHiddenContent(event);
}
