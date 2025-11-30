// Read https://github.com/nostr-protocol/nips/blob/master/59.md#overview for details on rumors and seals
// Gift wrap (signed random key) -> seal (signed sender key) -> rumor (unsigned)

import { buildEvent, EventOperation } from "applesauce-core/event-factory";
import { EncryptedContentSymbol } from "applesauce-core/helpers/encrypted-content";
import { nip44 } from "applesauce-core/helpers/encryption";
import {
  EventTemplate,
  finalizeEvent,
  getEventHash,
  kinds,
  NostrEvent,
  UnsignedEvent,
} from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { eventPipe, PRESERVE_EVENT_SYMBOLS } from "applesauce-core/helpers/pipeline";
import { unixNow } from "applesauce-core/helpers/time";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { MetaTagOptions, setMetaTags, stamp } from "applesauce-core/operations/event";
import { GiftWrapSymbol, Rumor, RumorSymbol, SealSymbol } from "../helpers/gift-wrap.js";

// Preserve gift-wrap and seal symbols when building gift-wrap events
PRESERVE_EVENT_SYMBOLS.add(GiftWrapSymbol);
PRESERVE_EVENT_SYMBOLS.add(SealSymbol);
PRESERVE_EVENT_SYMBOLS.add(RumorSymbol);

/** Create a timestamp with a random offset of an hour */
function randomNow() {
  return unixNow() - Math.floor(Math.random() * 60 * 60);
}

/** Converts an event to a rumor. The first operation in the gift wrap pipeline */
export function toRumor(): EventOperation<EventTemplate | UnsignedEvent | NostrEvent, Rumor> {
  return async (draft, ctx) => {
    // @ts-expect-error
    const rumor: Rumor = { ...draft };

    // Ensure rumor has pubkey
    if (!Reflect.has(rumor, "pubkey")) {
      if (!ctx.signer) throw new Error("A signer is required to create a rumor");
      rumor.pubkey = await ctx.signer.getPublicKey();
    }

    // Ensure rumor has id
    if (!Reflect.has(rumor, "id")) rumor.id = getEventHash(rumor as UnsignedEvent);

    // Ensure rumor does not have signature
    Reflect.deleteProperty(rumor, "sig");

    return rumor;
  };
}

/** Seals a rumor in a NIP-59 seal. The second operation in the gift wrap pipeline */
export function sealRumor(pubkey: string): EventOperation<Rumor, NostrEvent> {
  return async (rumor, ctx) => {
    if (!ctx.signer) throw new Error("A signer is required to create a seal");

    const plaintext = JSON.stringify(rumor);
    const unsigned = await buildEvent(
      { kind: kinds.Seal, created_at: randomNow() },
      ctx,
      // Set the encrypted content
      setEncryptedContent(pubkey, plaintext),
      // Stamp the seal with the signers's pubkey
      stamp(),
    );

    const seal = await ctx.signer.signEvent(unsigned);

    // Set the downstream reference on the seal
    Reflect.set(seal, RumorSymbol, rumor);

    // Add the upstream reference to the rumor
    const seals = Reflect.get(rumor, SealSymbol);
    if (seals) seals.add(seal);
    else Reflect.set(rumor, SealSymbol, new Set([seal]));

    return seal;
  };
}

export type GiftWrapOptions = MetaTagOptions;

/** Gift wraps a seal to a pubkey. The third operation in the gift wrap pipeline */
export function wrapSeal(pubkey: string, opts?: GiftWrapOptions): EventOperation<NostrEvent, NostrEvent> {
  return async (seal) => {
    const key = generateSecretKey();
    const plaintext = JSON.stringify(seal);

    const draft = await buildEvent(
      {
        kind: kinds.GiftWrap,
        created_at: randomNow(),
        content: nip44.encrypt(plaintext, nip44.getConversationKey(key, pubkey)),
        tags: [["p", pubkey]],
      },
      // Pass an empty context here so here there is no chance to use the users pubkey
      {},
      // Set meta tags on the gift wrap
      setMetaTags(opts),
    );

    const gift = finalizeEvent(draft, key);

    // Set the upstream references on the seal
    Reflect.set(seal, GiftWrapSymbol, gift);

    // Set the downstream reference on the gift wrap
    Reflect.set(gift, SealSymbol, seal);

    // Set the encrypted content on the gift wrap
    Reflect.set(gift, EncryptedContentSymbol, plaintext);

    return gift;
  };
}

/** An operation that gift wraps an event to a pubkey */
export function giftWrap(
  pubkey: string,
  opts?: GiftWrapOptions,
): EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent> {
  return eventPipe(
    toRumor(),
    // @ts-expect-error
    sealRumor(pubkey),
    wrapSeal(pubkey, opts),
  ) as EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent>;
}
