import { EncryptionMethod } from "./encrypted-content.js";
import { kinds } from "./event.js";
import {
  canHaveHiddenContent,
  getHiddenContent,
  getHiddenContentEncryptionMethods,
  hasHiddenContent,
  HiddenContentSigner,
  isHiddenContentUnlocked,
  lockHiddenContent,
  setHiddenContentCache,
  setHiddenContentEncryptionMethod,
  UnlockedHiddenContent,
  unlockHiddenContent,
} from "./hidden-content.js";

/** NIP-29 groups list kind */
const GROUPS_LIST_KIND = 10009;

/** Symbol for caching hidden tags. */
export const HiddenTagsSymbol = Symbol.for("hidden-tags");

/** Type for events with unlocked hidden tags */
export type UnlockedHiddenTags = UnlockedHiddenContent & {
  [HiddenTagsSymbol]: string[][];
};

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

/** Returns either nip04 or nip44 encryption method depending on list kind */
export function getHiddenTagsEncryptionMethods(kind: number, signer: HiddenContentSigner) {
  return getHiddenContentEncryptionMethods(kind, signer);
}

/** Checks if the hidden tags are locked and casts it to the {@link UnlockedHiddenTags} type */
export function isHiddenTagsUnlocked<T extends { kind: number }>(event: T): event is T & UnlockedHiddenTags {
  if (!canHaveHiddenTags(event.kind)) return false;
  // Wrap in try catch to avoid throwing validation errors
  try {
    return HiddenTagsSymbol in event || (isHiddenContentUnlocked(event) && getHiddenTags(event) !== undefined);
  } catch {}
  return false;
}

/**
 * Returns the hidden tags for an event if they are unlocked
 * @throws {Error} If the hidden content is not an array of tags
 */
export function getHiddenTags<T extends { kind: number } & UnlockedHiddenTags>(event: T): string[][];
export function getHiddenTags<T extends { kind: number }>(event: T): string[][] | undefined;
export function getHiddenTags<T extends { kind: number }>(event: T): string[][] | undefined {
  if (!canHaveHiddenTags(event.kind)) return undefined;

  // If the hidden tags are already unlocked, return the cached value
  if (HiddenTagsSymbol in event) return event[HiddenTagsSymbol] as string[][];

  // unlock hidden content is needed
  const content = getHiddenContent(event);

  // Return undefined if the hidden content is not unlocked
  if (content === undefined) return undefined;

  // Parse the hidden content as an array of tags
  const parsed = JSON.parse(content) as string[][];

  // Throw error if content is not an array of tags
  if (!Array.isArray(parsed)) throw new Error("Content is not an array of tags");

  // Convert array to tags array string[][]
  const tags = parsed.filter((t) => Array.isArray(t)).map((t) => t.map((v) => String(v)));

  // Set the cached value
  Reflect.set(event, HiddenTagsSymbol, tags);

  return tags;
}

/**
 * Decrypts the private list
 * @param event The list event to decrypt
 * @param signer A signer to use to decrypt the tags
 * @param override The encryption method to use instead of the default
 * @throws {Error} If the event kind does not support hidden tags
 * @throws {Error} If the hidden content is not an array of tags
 */
export async function unlockHiddenTags<T extends { kind: number; pubkey: string; content: string }>(
  event: T,
  signer: HiddenContentSigner,
  override?: EncryptionMethod,
): Promise<string[][]> {
  if (!canHaveHiddenTags(event.kind)) throw new Error("Event kind does not support hidden tags");

  // Return the cached value if the hidden tags are already unlocked
  if (isHiddenTagsUnlocked(event)) return event[HiddenTagsSymbol];

  // Unlock hidden content
  await unlockHiddenContent(event, signer, override);

  // Parse the hidden tags
  const tags = getHiddenTags(event);
  if (tags === undefined) throw new Error("Failed to unlock hidden tags");

  // Set cache an notify event store
  setHiddenTagsCache(event, tags);

  return tags;
}

/**
 * Sets the hidden tags on an event and updates it if its part of an event store
 * @throws If the event kind does not support hidden tags
 */
export function setHiddenTagsCache<T extends { kind: number }>(event: T, tags: string[][]) {
  if (!canHaveHiddenTags(event.kind)) throw new Error("Event kind does not support hidden tags");

  // Set the cached value
  Reflect.set(event, HiddenTagsSymbol, tags);

  // Set the cached content
  setHiddenContentCache(event, JSON.stringify(tags));
}

/** Clears the cached hidden tags on an event */
export function lockHiddenTags<T extends object>(event: T) {
  Reflect.deleteProperty(event, HiddenTagsSymbol);
  lockHiddenContent(event);
}
