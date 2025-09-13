import { NostrEvent, UnsignedEvent, verifyEvent } from "nostr-tools";
import { InMemoryEventDatabase } from "../event-store/event-database.js";
import {
  EncryptedContentSigner,
  getEncryptedContent,
  isEncryptedContentLocked,
  lockEncryptedContent,
  unlockEncryptedContent,
} from "./encrypted-content.js";
import { notifyEventUpdate } from "./event.js";

/**
 * An internal event set to keep track of seals and rumors
 * This is intentionally isolated from the main applications event store so to prevent seals and rumors from being leaked
 */
export const internalGiftWrapEvents = new InMemoryEventDatabase();

export type Rumor = UnsignedEvent & {
  id: string;
};

/** Used to store a reference to the seal event on gift wraps (downstream) or the seal event on rumors (upstream[]) */
export const SealSymbol = Symbol.for("seal");

/** Used to store a reference to the rumor on seals (downstream) */
export const RumorSymbol = Symbol.for("rumor");

/** Used to store a reference to the parent gift wrap event on seals (upstream) */
export const GiftWrapSymbol = Symbol.for("gift-wrap");

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
export function getSealGiftWrap(seal: NostrEvent): NostrEvent | undefined {
  return Reflect.get(seal, GiftWrapSymbol);
}

/** Returns all the parent seals for a rumor event */
export function getRumorSeals(rumor: Rumor): NostrEvent[] {
  let set = Reflect.get(rumor, SealSymbol);
  if (!set) {
    set = new Set();
    Reflect.set(rumor, SealSymbol, set);
  }
  return Array.from(set);
}

/** Returns all the parent gift wraps for a rumor event */
export function getRumorGiftWraps(rumor: Rumor): NostrEvent[] {
  const giftWraps = new Set<NostrEvent>();
  const seals = getRumorSeals(rumor);
  for (const seal of seals) {
    const upstream = getSealGiftWrap(seal);
    if (upstream) giftWraps.add(upstream);
  }
  return Array.from(giftWraps);
}

/** Checks if a seal event is locked */
export function isSealLocked(seal: NostrEvent): boolean {
  return isEncryptedContentLocked(seal);
}

/** Gets the rumor from a seal event */
export function getSealRumor(seal: NostrEvent): Rumor | undefined {
  // Returned cached rumor if it exists (downstream)
  const cached = Reflect.get(seal, RumorSymbol) as Rumor | undefined;
  if (cached) return cached;

  // Get the encrypted content plaintext
  const plaintext = getEncryptedContent(seal);
  if (!plaintext) return undefined;

  let rumor = JSON.parse(plaintext) as Rumor;

  // Check if the rumor event already exists in the internal event set
  const existing = internalGiftWrapEvents.getEvent(rumor.id);
  if (existing)
    // Reuse the existing rumor instance
    rumor = existing;
  else
    // Add to the internal event set
    internalGiftWrapEvents.add(rumor as NostrEvent);

  // Save a reference to the parent seal event
  addParentSealReference(rumor, seal);

  // Save a reference to the rumor on the seal (downstream)
  Reflect.set(seal, RumorSymbol, rumor);

  return rumor;
}

/** Returns the seal event in a gift-wrap event */
export function getGiftWrapSeal(gift: NostrEvent): NostrEvent | undefined {
  // Returned cached seal if it exists (downstream)
  const cached = Reflect.get(gift, SealSymbol) as NostrEvent | undefined;
  if (cached) return cached;

  // Get the encrypted content plaintext
  const plaintext = getEncryptedContent(gift);
  if (!plaintext) return undefined;

  let seal = JSON.parse(plaintext) as NostrEvent;

  // Check if the seal event already exists in the internal event set
  const existing = internalGiftWrapEvents.getEvent(seal.id);
  if (existing) {
    // Reuse the existing seal instance
    seal = existing;
  } else {
    // Verify the seal event
    verifyEvent(seal);
    // Add to the internal event set
    internalGiftWrapEvents.add(seal);

    // Set the reference to the parent gift wrap event (upstream)
    Reflect.set(seal, GiftWrapSymbol, gift);
  }

  // Save a reference to the seal on the gift wrap (downstream)
  Reflect.set(gift, SealSymbol, seal);

  return seal;
}

/** Returns the unsigned rumor in the gift-wrap */
export function getGiftWrapRumor(gift: NostrEvent): Rumor | undefined {
  const seal = getGiftWrapSeal(gift);
  if (!seal) return undefined;

  return getSealRumor(seal);
}

/** Returns if a gift-wrap event or gift-wrap seal is locked */
export function isGiftWrapLocked(gift: NostrEvent): boolean {
  if (isEncryptedContentLocked(gift)) return true;
  else {
    const seal = getGiftWrapSeal(gift);
    if (!seal || isSealLocked(seal)) return true;
    else return false;
  }
}

/**
 * Unlocks a seal event and returns the rumor event
 * @throws {Error} If the author of the rumor event does not match the author of the seal
 */
export async function unlockSeal(seal: NostrEvent, signer: EncryptedContentSigner): Promise<Rumor> {
  if (isEncryptedContentLocked(seal)) await unlockEncryptedContent(seal, seal.pubkey, signer);

  // Parse the rumor event
  const rumor = getSealRumor(seal);
  if (!rumor) throw new Error("Failed to read rumor in gift wrap");

  // Check if the seal and rumor authors match
  if (rumor.pubkey !== seal.pubkey) throw new Error("Seal author does not match rumor author");

  return rumor;
}

/**
 * Unlocks and returns the unsigned seal event in a gift-wrap
 * @throws {Error} If the author of the rumor event does not match the author of the seal
 */
export async function unlockGiftWrap(gift: NostrEvent, signer: EncryptedContentSigner): Promise<Rumor> {
  // First unlock the gift-wrap event
  if (isEncryptedContentLocked(gift)) await unlockEncryptedContent(gift, gift.pubkey, signer);

  // Get the seal event
  const seal = getGiftWrapSeal(gift);
  if (!seal) throw new Error("Failed to read seal in gift wrap");

  // Unlock the seal event
  const rumor = await unlockSeal(seal, signer);

  // if the event has been added to an event store, notify it
  notifyEventUpdate(gift);

  return rumor;
}

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
