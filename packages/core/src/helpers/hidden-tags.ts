import { setCachedValue } from "./cache.js";
import { EncryptionMethod } from "./encrypted-content.js";
import { kinds } from "./event.js";
import { safeParse } from "./json.js";
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
  // No try/catch needed: `event` is typed, so the `in` test cannot throw, and neither
  // isHiddenContentUnlocked nor getHiddenTags throws — getHiddenTags returns undefined for
  // malformed content rather than raising. The defensive catch this used to carry was
  // masking that throw and silently reporting a malformed list as merely locked.
  return HiddenTagsSymbol in event || (isHiddenContentUnlocked(event) && getHiddenTags(event) !== undefined);
}

/**
 * Returns the hidden tags for an event if they are unlocked
 *
 * Returns undefined for anything that does not yield usable tags — a kind that cannot have
 * hidden tags, content that is still locked, content that is not valid JSON, or JSON that is
 * not an array. None of these throw: this getter is read across whole timelines from inside
 * RxJS pipes, where a throw errors the observable and takes down every event, not just the
 * malformed one. `unlockHiddenTags` is the imperative counterpart that does throw.
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

  // Parse the hidden content as an array of tags. safeParse (not JSON.parse) so malformed
  // ciphertext-turned-garbage returns undefined instead of throwing out of a getter.
  const parsed = safeParse<string[][]>(content);

  // Return undefined if the content is not an array of tags. Deliberately NOT cached: the
  // rejection describes the content we can see right now, and caching it would make a list
  // permanently unreadable even after correct content is decrypted into it. Returning before
  // setCachedValue keeps the invariant the six hidden-tag getters rely on — HiddenTagsSymbol
  // only ever holds real tags, so isHiddenTagsUnlocked's presence check stays sound.
  if (!parsed || !Array.isArray(parsed)) return undefined;

  // Convert array to tags array string[][]
  const tags = parsed.filter((t) => Array.isArray(t)).map((t) => t.map((v) => String(v)));

  // Identity memo per cache.ts's one rule: written non-enumerable via setCachedValue, so a copy
  // with different content does not inherit the stale parsed tags — it re-parses on next access.
  setCachedValue(event, HiddenTagsSymbol, tags);

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

  // Identity memo per cache.ts's one rule: written non-enumerable via setCachedValue, so a copy
  // spread onto a differently-keyed draft does not inherit the stale tags — it re-derives them.
  setCachedValue(event, HiddenTagsSymbol, tags);

  // Set the cached content
  setHiddenContentCache(event, JSON.stringify(tags));
}

/** Clears the cached hidden tags on an event */
export function lockHiddenTags<T extends object>(event: T) {
  Reflect.deleteProperty(event, HiddenTagsSymbol);
  lockHiddenContent(event);
}
