// CORD-01 Private Streams — the create half of the wrap / seal / rumor envelope.
//
// Mirrors applesauce-common's operations/gift-wrap.ts (rumor -> seal -> wrap) as
// composable `EventOperation`s so a factory can build a rumor and chain the
// envelope straight onto it (`eventPipe(...rumorOps, sealRumor(...), wrapSeal(...))`).
// The rumor step is common's `toRumor` verbatim — the rumor shape is identical;
// only the seal/wrap crypto is Concord's: the seal and wrap are NIP-44-encrypted
// under the plane's self-ECDH conversation key (`convKey`), the wrap is signed by
// the plane's derived stream key (not a throwaway key), the outer `p` tag is a
// decoy, and a seal may be plaintext (kind 20014, signed over the rumor JSON
// verbatim so it survives a re-wrap) or encrypted (kind 20013).

import { GiftWrap } from "applesauce-common/operations";
import type { EventOperation, EventSigner } from "applesauce-core/factories";
import { nip44 } from "applesauce-core/helpers/encryption";
import { type EventTemplate, finalizeEvent, type NostrEvent, type UnsignedEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { eventPipe } from "applesauce-core/helpers/pipeline";
import { unixNow } from "applesauce-core/helpers/time";
import { sign } from "applesauce-core/operations/event";

import type { Rumor } from "../types.js";
import {
  ENCRYPTED_SEAL_KIND,
  EPHEMERAL_GIFT_WRAP_KIND,
  GIFT_WRAP_KIND,
  PLAINTEXT_SEAL_KIND,
} from "../helpers/gift-wrap.js";

/**
 * Stamp an event template into an unsigned rumor (pubkey + id, no sig) — the
 * first step of the envelope pipeline. Re-exported from applesauce-common: a
 * Concord rumor is a plain NIP-59 rumor, so there is nothing Concord-specific to
 * add. The stamped `created_at` (from the template) flows into the seal and wrap.
 */
export const toRumor = GiftWrap.toRumor;

export type SealOptions = { plaintext?: boolean };
export type WrapOptions = { ephemeral?: boolean; created_at?: number };
export type GiftWrapOptions = SealOptions & Pick<WrapOptions, "ephemeral">;

/**
 * Seal a rumor in a CORD-01 seal signed by the author's real key. Encrypted
 * seals (the default) hide the rumor under the plane's `convKey`; plaintext
 * seals (kind 20014) carry it verbatim so their signature survives a re-wrap
 * into another plane (CORD-06 compaction). The second step of the pipeline.
 */
export function sealRumor(
  convKey: Uint8Array,
  signer?: EventSigner,
  opts: SealOptions = {},
): EventOperation<Rumor, NostrEvent> {
  return async (rumor) => {
    if (!signer) throw new Error("A signer is required to seal a rumor");
    const rumorJson = JSON.stringify(rumor);
    const kind = opts.plaintext ? PLAINTEXT_SEAL_KIND : ENCRYPTED_SEAL_KIND;
    const content = opts.plaintext ? rumorJson : nip44.encrypt(rumorJson, convKey);
    const seal: EventTemplate = { kind, content, tags: [], created_at: rumor.created_at };

    // Sign the seal
    return sign(signer)(seal);
  };
}

/** Build a wrap synchronously — shared by the {@link wrapSeal} op and {@link rewrapSeal}. */
function buildWrap(seal: NostrEvent, streamSk: Uint8Array, convKey: Uint8Array, opts: WrapOptions): NostrEvent {
  const decoyPubkey = getPublicKey(generateSecretKey());
  return finalizeEvent(
    {
      kind: opts.ephemeral ? EPHEMERAL_GIFT_WRAP_KIND : GIFT_WRAP_KIND,
      content: nip44.encrypt(JSON.stringify(seal), convKey),
      tags: [["p", decoyPubkey]],
      created_at: opts.created_at ?? seal.created_at,
    },
    streamSk,
  );
}

/**
 * Wrap a seal in a durable (kind 1059) or ephemeral (kind 21059) Stream event
 * addressed at the plane's `streamPk`: the seal is NIP-44-encrypted under
 * `convKey`, the outer `p` tag is a fresh decoy key, and the whole wrap is signed
 * by the plane's stream key. `created_at` defaults to the seal's time. The final
 * step of the pipeline. No async work — resolves synchronously.
 */
export function wrapSeal(
  streamSk: Uint8Array,
  convKey: Uint8Array,
  opts: WrapOptions = {},
): EventOperation<NostrEvent, NostrEvent> {
  return (seal) => buildWrap(seal, streamSk, convKey, opts);
}

/**
 * Seal + gift-wrap operation for a plane (rumor template -> signed kind-1059
 * wrap), composing {@link toRumor} -> {@link sealRumor} -> {@link wrapSeal}. Chain
 * it onto any rumor factory or apply it to a resolved template. Mirrors
 * applesauce-common's `giftWrap`, with Concord's `streamSk`/`convKey` keying.
 */
export function giftWrap(
  streamSk: Uint8Array,
  convKey: Uint8Array,
  signer?: EventSigner,
  opts: GiftWrapOptions = {},
): EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent> {
  return eventPipe(
    toRumor(signer),
    // @ts-expect-error the rumor -> seal step changes the event type mid-pipe
    sealRumor(convKey, signer, opts),
    wrapSeal(streamSk, convKey, opts),
  ) as EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent>;
}

/**
 * Re-wrap an already-verified PLAINTEXT seal into another plane (a compaction,
 * CORD-06 §3): only plaintext seals (kind 20014) survive, because their
 * signature is over the rumor JSON verbatim and doesn't depend on the outer
 * stream key. Used by a Refounding to re-anchor each Control-Plane head edition
 * under the new epoch without re-signing (the author's proof carries forward).
 */
export function rewrapSeal(seal: NostrEvent, targetStreamSk: Uint8Array, targetConvKey: Uint8Array): NostrEvent {
  if (seal.kind !== PLAINTEXT_SEAL_KIND) throw new Error("only plaintext seals survive a re-wrap");
  return buildWrap(seal, targetStreamSk, targetConvKey, { created_at: unixNow() });
}
