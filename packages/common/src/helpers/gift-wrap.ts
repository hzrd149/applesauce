import { logger } from "applesauce-core";
import { EventMemory } from "applesauce-core/event-store";
import { safeParse } from "applesauce-core/helpers";
import { setCachedValue } from "applesauce-core/helpers/cache";
import {
  EncryptedContentSigner,
  getEncryptedContent,
  isEncryptedContentUnlocked,
  lockEncryptedContent,
  unlockEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";
import {
  kinds,
  KnownEvent,
  NostrEvent,
  notifyEventUpdate,
  Rumor,
  verifyWrappedEvent,
} from "applesauce-core/helpers/event";
// GiftWrapSymbol/SealSymbol/RumorSymbol are owned by applesauce-core (members of
// PRESERVE_EVENT_SYMBOLS) and re-exported here so existing common consumers keep resolving
// them; Symbol.for() registry identity is unchanged regardless of which module imports it.
import { GiftWrapSymbol, RumorSymbol, SealSymbol } from "applesauce-core/helpers/gift-wrap";

/**
 * An internal event set to keep track of seals and rumors
 * This is intentionally isolated from the main applications event store so to prevent seals and rumors from being leaked
 */
export const internalGiftWrapEvents = new EventMemory();

const log = logger.extend("GiftWrap");

export type { Rumor };

export { GiftWrapSymbol, RumorSymbol, SealSymbol };

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
  // Mutated in place across calls (the Set gains members over time), the same shape as
  // applesauce-core's SeenRelaysSymbol — accumulated state (see cache.ts taxonomy), not a memo.
  if (!parents) setCachedValue(rumor, SealSymbol, new Set([seal]));
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

/**
 * Checks that an event is a seal and that its id and signature are valid.
 *
 * The seal's signature is the ONLY authorship proof in a NIP-59 envelope — the gift wrap is
 * signed by a throwaway key that says nothing about who wrote the message, and the rumor is
 * unsigned by definition. Everything downstream that attributes a rumor to an author (notably
 * getSealRumor's `rumor.pubkey !== seal.pubkey` binding) rests on this check having passed.
 *
 * Cheap to repeat: verifyWrappedEvent -> nostr-tools' verifyEvent memoises both outcomes on the
 * event via `verifiedSymbol`, so calls after the first are a symbol read. That is what makes it
 * affordable to re-assert this at every boundary a seal can enter through rather than trusting
 * the caller to have checked.
 */
export function isValidSeal(event: NostrEvent): event is KnownEvent<kinds.Seal> {
  return event.kind === kinds.Seal && verifyWrappedEvent(event);
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
    // Lazily initializes the same mutable Set addParentSealReference (line ~53) grows over
    // time — accumulated state (see cache.ts taxonomy), not a memo.
    setCachedValue(rumor, SealSymbol, set);
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

/**
 * Checks if a seal event is locked and casts it to the {@link UnlockedSeal} type
 *
 * The presence test is only sound because getSealRumor never writes an `undefined` RumorSymbol
 * — see the invariant documented there. If it did, this would narrow a seal that never yielded
 * a rumor to UnlockedSeal.
 */
export function isSealUnlocked(seal: NostrEvent): seal is UnlockedSeal {
  return RumorSymbol in seal || (isEncryptedContentUnlocked(seal) === true && getSealRumor(seal) !== undefined);
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
 *
 * Returns undefined for any seal that does not yield a usable rumor — an invalid seal signature,
 * unparseable content, or a rumor whose author does not match its seal. All three are things a
 * stranger can put in your inbox, so none of them throw.
 */
export function getSealRumor(seal: UnlockedSeal): Rumor;
export function getSealRumor(seal: NostrEvent): Rumor | undefined;
export function getSealRumor(seal: NostrEvent): Rumor | undefined {
  // Non seal events, and seals whose id/signature do not check out, cant have rumors. Seals
  // reached via getGiftWrapSeal were already verified there, and the verdict is memoised, so
  // this costs a symbol read on that path. It earns its place on the other one: getSealRumor
  // and unlockSeal are exported and take any NostrEvent, so a consumer can hand in a seal that
  // never passed through getGiftWrapSeal. Without this, the `rumor.pubkey !== seal.pubkey`
  // check below would be comparing against an unverified `seal.pubkey` and would prove nothing.
  if (!isValidSeal(seal)) return undefined;

  // If unlocked return the rumor
  if (RumorSymbol in seal) return seal[RumorSymbol] as Rumor;

  // Get the encrypted content plaintext
  const content = getEncryptedContent(seal);

  // Return undefined if the content is not found
  if (!content) return undefined;

  // Parse the content as a rumor event
  let rumor = safeParse<Rumor>(content);

  // Failed to parse rumor — return WITHOUT caching anything.
  //
  // INVARIANT: RumorSymbol is only ever written with a real Rumor, never with `undefined`.
  // Both readers below depend on it, because both test for presence rather than value:
  //   - isSealUnlocked's `RumorSymbol in seal` would report a seal that never yielded a rumor
  //     as unlocked, and narrow it to UnlockedSeal.
  //   - unlockSeal then returns `seal[RumorSymbol]` — `undefined` typed as `Rumor` — walking
  //     past its own `if (!rumor) throw` guard and handing the caller a value its signature
  //     says cannot exist.
  // A negative memo would also be permanent: the seal could never be re-read even once its
  // content became parseable.
  if (!rumor) return undefined;

  // Check if the rumor event already exists in the internal event set. Resolve the instance
  // first but do NOT record it yet — the author check below has to run against whatever we are
  // actually about to return, and a rejected rumor must not be left behind in the set.
  const existing = internalGiftWrapEvents.getEvent(rumor.id);
  // Reuse the existing rumor instance
  if (existing) rumor = existing;

  // A rumor whose author does not match its seal proves nothing about authorship, so it is
  // dropped. Returning undefined rather than throwing: this is sender-controlled input that any
  // stranger can put in your inbox, and every caller reaches it from inside an RxJS pipe —
  // WrappedMessagesModel maps getGiftWrapRumor over the WHOLE gift-wrap timeline. A throw there
  // errors the observable, which is terminal, so one malformed wrap would permanently kill the
  // user's entire message list rather than skipping one message. Those call sites already
  // `.filter((e) => !!e)`, so undefined is the contract they were written for.
  if (rumor.pubkey !== seal.pubkey) {
    log("Dropping rumor %s: author does not match its seal %s", rumor.id, seal.id);
    return undefined;
  }

  // Add to the internal event set, now that the rumor has been accepted
  if (!existing) internalGiftWrapEvents.add(rumor as NostrEvent);

  // Save a reference to the parent seal event
  addParentSealReference(rumor, seal);

  // Cache the rumor event. Propagated by reference across duplicate seal events rather than
  // by spread — accumulated state (see cache.ts taxonomy).
  setCachedValue(seal, RumorSymbol, rumor);

  return rumor;
}

/** Returns the seal event in a gift-wrap -> seal (downstream) */
export function getGiftWrapSeal(gift: UnlockedGiftWrapEvent): UnlockedSeal;
export function getGiftWrapSeal(gift: NostrEvent): NostrEvent | undefined;
export function getGiftWrapSeal(gift: NostrEvent): NostrEvent | undefined {
  // Returned cached seal if it exists (downstream)
  if (SealSymbol in gift) return gift[SealSymbol] as UnlockedSeal;

  // Get the encrypted content
  const content = getEncryptedContent(gift);

  // Return undefined if the content is not found
  if (!content) return undefined;

  // Parse seal as nostr event
  const parsed = safeParse<NostrEvent>(content);
  if (!parsed) return undefined;

  // Verify BEFORE the seal is used for anything else, including as a lookup key. verifyEvent
  // rejects unless the event hashes to its own `id`, so passing this is what makes `parsed.id`
  // trustworthy. Checking after the lookup below would let a sender write any id they like into
  // the seal JSON and be handed back a seal they never signed — no signature checked, and the
  // wrap then caches a reference to it. This is the sole insertion point for seals into
  // internalGiftWrapEvents (EventMemory.add does no verification of its own), so gating here is
  // what makes that set a set of authenticated seals.
  if (!isValidSeal(parsed)) return undefined;

  let seal: NostrEvent = parsed;

  // Check if the seal event already exists in the internal event set
  const existing = internalGiftWrapEvents.getEvent(seal.id);
  if (existing) {
    // Reuse the existing seal instance
    seal = existing;
  } else {
    // Add to the internal event set
    internalGiftWrapEvents.add(seal);

    // Set the reference to the parent gift wrap event (upstream). Propagated by reference
    // across duplicate events, not by spread — accumulated state (see cache.ts taxonomy).
    setCachedValue(seal, GiftWrapSymbol, gift);
  }

  // Save a reference to the seal on the gift wrap (downstream). Propagated by reference
  // across duplicate events, not by spread — accumulated state (see cache.ts taxonomy).
  setCachedValue(gift, SealSymbol, seal);

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
 *
 * Unlike the getters, this throws rather than returning undefined: it is an imperative operation
 * on one caller-chosen event with a non-optional return type, not a read applied across a
 * timeline, so there is no observable for a throw to tear down.
 * @throws {Error} If the seal does not yield a usable rumor — including an invalid seal
 * signature, unparseable content, or a rumor whose author does not match its seal
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
 *
 * Throws for the same reason unlockSeal does — see the note there.
 * @throws {Error} If the gift wrap does not yield a usable rumor — including an invalid seal
 * signature, unparseable content, or a rumor whose author does not match its seal
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
