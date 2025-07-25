import { EventTemplate, NostrEvent, UnsignedEvent } from "nostr-tools";
import { EventOperation } from "../types.js";
import { EncryptedContentSymbol } from "applesauce-core/helpers/encrypted-content";

/**
 * An operation that adds the signers pubkey to the event
 * @throws {Error} if no signer is provided
 */
export function stamp(): EventOperation<EventTemplate, UnsignedEvent> {
  return async (draft, ctx) => {
    if (!ctx.signer) throw new Error("Missing signer");

    // Remove old fields from signed nostr event
    Reflect.deleteProperty(draft, "id");
    Reflect.deleteProperty(draft, "sig");

    const pubkey = await ctx.signer.getPublicKey();
    const newDraft = { ...draft, pubkey };

    // copy the plaintext hidden content if its on the draft
    if (Reflect.has(draft, EncryptedContentSymbol))
      Reflect.set(newDraft, EncryptedContentSymbol, Reflect.get(draft, EncryptedContentSymbol)!);

    return newDraft;
  };
}

/**
 * An operation that signs the event
 * @throws {Error} if no signer is provided
 */
export function sign(): EventOperation<EventTemplate | UnsignedEvent, NostrEvent> {
  return async (draft, ctx) => {
    if (!ctx.signer) throw new Error("Missing signer");
    draft = await stamp()(draft, ctx);
    const signed = await ctx.signer.signEvent(draft);

    // copy the plaintext hidden content if its on the draft
    if (Reflect.has(draft, EncryptedContentSymbol))
      Reflect.set(signed, EncryptedContentSymbol, Reflect.get(draft, EncryptedContentSymbol)!);

    return signed;
  };
}
