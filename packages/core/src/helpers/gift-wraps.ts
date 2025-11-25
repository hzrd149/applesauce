import { EventMemory } from "../event-store/event-memory.js";
import {
  EncryptedContentSigner,
  getEncryptedContent,
  isEncryptedContentUnlocked,
  lockEncryptedContent,
  unlockEncryptedContent,
} from "./encrypted-content.js";
import { kinds, KnownEvent, NostrEvent, notifyEventUpdate, UnsignedEvent, verifyWrappedEvent } from "./event.js";

/**
 * An internal event set to keep track of seals and rumors
 * This is intentionally isolated from the main applications event store so to prevent seals and rumors from being leaked
 */
export const internalGiftWrapEvents = new EventMemory();

export type Rumor = UnsignedEvent & {
  id: string;
};

/** Used to store a reference to the seal event on gift wraps (downstream) or the seal event on rumors (upstream[]) */
export const SealSymbol = Symbol.for("seal");

/** Used to store a reference to the rumor on seals (downstream) */
export const RumorSymbol = Symbol.for("rumor");

/** Used to store a reference to the parent gift wrap event on seals (upstream) */
export const GiftWrapSymbol = Symbol.for("gift-wrap");

/** A gift wrap event that knows its seal event */
export type UnlockedGiftWrapEvent = KnownEvent<kinds.GiftWrap> & {
  /** Downstream seal event */
  [SealSymbol]: UnlockedSeal;
};

/** A seal that knows its parent gift wrap event */
export type UnlockedSeal = KnownEvent<kinds.Seal> & {
  /** Upstream gift wrap event */
  [SealSymbol]: UnlockedGiftWrapEvent;
  /** Downstream rumor event */
  [RumorSymbol]: Rumor;
};

/** Adds a parent reference to a seal or rumor */
function addParentSealReference(rumor: Rumor, seal: NostrEvent): void {
  const parents = Reflect.get(rumor, SealSymbol);
  if (!parents) Reflect.set(rumor, SealSymbol, new Set([seal]));
  else parents.add(seal);
}

/** Removes a parent reference from a seal or rumor */
function removeParentSealReference(rumor: Rumor, seal: NostrEvent): void {
  const parents = Reflect.get(rumor, SealSymbol);
  if (parents) parents.delete(seal);
}

/** Checks if an event is a rumor (normal event with "id" and no "sig") */
export function isRumor(event: any): event is Rumor {
  if (event === undefined || event === null) return false;

  return (
    event.id?.length === 64 &&
    !("sig" in event) &&
    typeof event.pubkey === "string" &&
    event.pubkey.length === 64 &&
    typeof event.content === "string" &&
    Array.isArray(event.tags) &&
    typeof event.created_at === "number" &&
    event.created_at > 0
  );
}

/** Returns all the parent gift wraps for a seal event */
export function getSealGiftWrap(seal: UnlockedSeal): UnlockedGiftWrapEvent;
export function getSealGiftWrap(seal: NostrEvent): UnlockedGiftWrapEvent | undefined;
export function getSealGiftWrap(seal: NostrEvent): UnlockedGiftWrapEvent | undefined {
  return Reflect.get(seal, GiftWrapSymbol);
}

/** Returns all the parent seals for a rumor event */
export function getRumorSeals(rumor: Rumor): UnlockedSeal[] {
  let set = Reflect.get(rumor, SealSymbol);
  if (!set) {
    set = new Set();
    Reflect.set(rumor, SealSymbol, set);
  }
  return Array.from(set);
}

/** Returns all the parent gift wraps for a rumor event */
export function getRumorGiftWraps(rumor: Rumor): UnlockedGiftWrapEvent[] {
  const giftWraps = new Set<UnlockedGiftWrapEvent>();
  const seals = getRumorSeals(rumor);
  for (const seal of seals) {
    const upstream = getSealGiftWrap(seal);
    if (upstream) giftWraps.add(upstream);
  }
  return Array.from(giftWraps);
}

/** Checks if a seal event is locked and casts it to the {@link UnlockedSeal} type */
export function isSealUnlocked(seal: NostrEvent): seal is UnlockedSeal {
  return isEncryptedContentUnlocked(seal) === true && Reflect.has(seal, RumorSymbol) === true;
}

/** Returns if a gift-wrap event or gift-wrap seal is locked */
export function isGiftWrapUnlocked(gift: NostrEvent): gift is UnlockedGiftWrapEvent {
  if (isEncryptedContentUnlocked(gift) === false) return false;

  // Get the seal event
  const seal = getGiftWrapSeal(gift);
  if (!seal) return false;

  // If seal is locked, return false
  if (!isSealUnlocked(seal)) return false;

  return true;
}

/**
 * Gets the rumor from a seal event
 * @throws {Error} If the author of the rumor event does not match the author of the seal
 */
export function getSealRumor(seal: UnlockedSeal): Rumor;
export function getSealRumor(seal: NostrEvent): Rumor | undefined;
export function getSealRumor(seal: NostrEvent): Rumor | undefined {
  // Non seal events cant have rumors
  if (seal.kind !== kinds.Seal) return undefined;

  // If unlocked return the rumor
  if (isSealUnlocked(seal)) return seal[RumorSymbol];

  // Get the encrypted content plaintext
  const content = getEncryptedContent(seal);

  // Return undefined if the content is not found
  if (!content) return undefined;

  // Parse the content as a rumor event
  let rumor = JSON.parse(content) as Rumor;

  // Check if the rumor event already exists in the internal event set
  const existing = internalGiftWrapEvents.getEvent(rumor.id);
  if (existing)
    // Reuse the existing rumor instance
    rumor = existing;
  else
    // Add to the internal event set
    internalGiftWrapEvents.add(rumor as NostrEvent);

  // Throw an error if the seal and rumor authors do not match
  if (rumor.pubkey !== seal.pubkey) throw new Error("Seal author does not match rumor author");

  // Save a reference to the parent seal event
  addParentSealReference(rumor, seal);

  // Cache the rumor event
  Reflect.set(seal, RumorSymbol, rumor);

  return rumor;
}

/** Returns the seal event in a gift-wrap -> seal (downstream) */
export function getGiftWrapSeal(gift: UnlockedGiftWrapEvent): UnlockedSeal;
export function getGiftWrapSeal(gift: NostrEvent): NostrEvent | undefined;
export function getGiftWrapSeal(gift: NostrEvent): NostrEvent | undefined {
  // Returned cached seal if it exists (downstream)
  if (Reflect.has(gift, SealSymbol)) return Reflect.get(gift, SealSymbol);

  // Get the encrypted content
  const content = getEncryptedContent(gift);

  // Return undefined if the content is not found
  if (!content) return undefined;

  // Parse seal as nostr event
  let seal = JSON.parse(content) as NostrEvent;

  // Check if the seal event already exists in the internal event set
  const existing = internalGiftWrapEvents.getEvent(seal.id);
  if (existing) {
    // Reuse the existing seal instance
    seal = existing;
  } else {
    // Verify the seal event
    verifyWrappedEvent(seal);
    // Add to the internal event set
    internalGiftWrapEvents.add(seal);

    // Set the reference to the parent gift wrap event (upstream)
    Reflect.set(seal, GiftWrapSymbol, gift);
  }

  // Save a reference to the seal on the gift wrap (downstream)
  Reflect.set(gift, SealSymbol, seal);

  return seal;
}

/** Returns the unsigned rumor in the gift-wrap -> seal -> rumor (downstream) */
export function getGiftWrapRumor(gift: UnlockedGiftWrapEvent): Rumor;
export function getGiftWrapRumor(gift: NostrEvent): Rumor | undefined;
export function getGiftWrapRumor(gift: NostrEvent): Rumor | undefined {
  const seal = getGiftWrapSeal(gift);
  if (!seal) return undefined;
  return getSealRumor(seal);
}

/**
 * Unlocks a seal event and returns the rumor event
 * @throws {Error} If the author of the rumor event does not match the author of the seal
 */
export async function unlockSeal(seal: NostrEvent, signer: EncryptedContentSigner): Promise<Rumor> {
  // If already unlocked, return the rumor
  if (isSealUnlocked(seal)) return seal[RumorSymbol];

  // unlock encrypted content as needed
  await unlockEncryptedContent(seal, seal.pubkey, signer);

  const rumor = getSealRumor(seal);
  if (!rumor) throw new Error("Failed to read rumor in gift wrap");

  // Notify event store
  notifyEventUpdate(seal);

  return rumor;
}

/**
 * Unlocks and returns the unsigned seal event in a gift-wrap
 * @throws {Error} If the author of the rumor event does not match the author of the seal
 */
export async function unlockGiftWrap(gift: NostrEvent, signer: EncryptedContentSigner): Promise<Rumor> {
  // If already unlocked, return the rumor
  if (isGiftWrapUnlocked(gift)) return getGiftWrapRumor(gift);

  // Unlock the encrypted content
  await unlockEncryptedContent(gift, gift.pubkey, signer);

  // Parse seal as nostr event
  let seal = getGiftWrapSeal(gift);
  if (!seal) throw new Error("Failed to read seal in gift wrap");

  // Unlock the seal event
  const rumor = await unlockSeal(seal, signer);

  // if the event has been added to an event store, notify it
  notifyEventUpdate(gift);

  return rumor;
}

/** Locks a gift-wrap event and seals its seal event */
export function lockGiftWrap(gift: NostrEvent) {
  const seal = getGiftWrapSeal(gift);
  if (seal) {
    const rumor = getSealRumor(seal);

    // Remove the rumors parent seal reference (upstream)
    if (rumor) removeParentSealReference(rumor, seal);

    // Remove the seal's parent gift wrap reference (upstream)
    Reflect.deleteProperty(seal, GiftWrapSymbol);

    // Remove the seal's rumor reference (downstream)
    Reflect.deleteProperty(seal, RumorSymbol);

    // Lock the seal's encrypted content
    lockEncryptedContent(seal);
  }

  // Remove the gift wrap's seal reference (downstream)
  Reflect.deleteProperty(gift, SealSymbol);

  // Lock the gift wrap's encrypted content
  lockEncryptedContent(gift);
}
