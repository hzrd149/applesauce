// Epoch-atomic sync for ONE private channel (a sub-community, CORD-06).
//
// A private channel is keyed independently of the community_root at its own
// epoch, so its message-plane address is stable across community Refoundings and
// it rotates on its own schedule. Its history lives at the message-plane
// addresses for the current + every held channel epoch (all known up front from
// the ChannelKey); new rotations are discovered FORWARD by reading the
// channel-rekey address at `epoch + 1`. This mirrors the community walk's atomic
// barrier (`syncAuthors` awaits full decrypt) but the "chain" grows forward via
// rekeys rather than from a pre-known held list.

import { hexToBytes } from "@noble/hashes/utils.js";
import type { PlaneInfo } from "../helpers/keys.js";
import { deriveChannelKeys, readChannelRekey } from "../helpers/keys.js";
import { decodeWrapCached } from "../helpers/gift-wrap.js";
import { isStrictlyLowerKey } from "../helpers/rekey.js";
import type { ChannelKey, DecodedEvent, JoinMaterial } from "../types.js";
import { syncAuthors, type SyncContext } from "./sync.js";

/** The sync context for a private channel: the community walk's context plus the
 *  community `material` (the root(s) the channel-rekey address keys on) and the
 *  channel-rekey authority predicate (`MANAGE_CHANNELS` + outranks the target). */
export interface ChannelSyncContext extends SyncContext {
  material: JoinMaterial;
  isAuthorized: (rotator: string) => boolean;
  /** May `rotator` remove US from the channel — `MANAGE_CHANNELS` AND strictly
   *  outranks us (CORD-04/CORD-06 §3 "in both"). Fail-closed when absent —
   *  mirrors {@link ConcordPrivateChannelOptions.canRemoveSelf}'s live-check use. */
  canRemoveSelf?: (rotator: string) => boolean;
  /** vac verification against the folded Roster (CORD-04 D-08/D-12) — mirrors
   *  {@link ConcordPrivateChannelOptions.verifyVac}'s live-check use. */
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean;
}

/** The outcome of walking a private channel to its tip. */
export interface ChannelWalkResult {
  /** The latest channel key we still hold — open live here. Undefined if removed. */
  tipKey?: ChannelKey;
  /** True when a channel Rekey excluded us from the channel (CORD-06). */
  removed: boolean;
}

/** Full-sync the message planes for the given channel stream keys (current + held),
 *  routing every decoded rumor. Atomic (awaits `syncAuthors`). */
async function syncMessagePlanes(ctx: ChannelSyncContext, channel: ChannelKey): Promise<void> {
  const keys = deriveChannelKeys(ctx.material, channel);
  const streamKeys = [keys.current, ...keys.held.map((h) => h.key)];
  ctx.relayAuth.registerStreamKeys(streamKeys);
  ctx.ensureAuth(ctx.relays);
  const fetched = await syncAuthors(
    ctx,
    streamKeys.map((k) => k.pk),
  );
  let decodedCount = 0;
  let dropped = 0;
  for (const ev of fetched) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel") continue;
    const decoded = decodeWrapCached(ev, info.convKey);
    if (decoded) {
      decodedCount++;
      ctx.route(info, decoded);
    } else {
      dropped++;
      ctx.logger.extend("decode")("dropped wrap=%s plane=%s epoch=%d", ev.id.slice(0, 8), "channel", channel.epoch);
    }
  }
  // D-05 litmus: always-on, even when fetched.length === 0.
  ctx.logger(
    "message planes epoch=%d fetched=%d decoded=%d dropped=%d",
    channel.epoch,
    fetched.length,
    decodedCount,
    dropped,
  );
}

/**
 * Full-sync the channel-rekey address(es) for `channel`'s next epoch and decide
 * whether to advance. Reads the rekey blobs sealed under the current root and
 * each held root (CORD-06 §94), then folds them with {@link readChannelRekey}.
 */
async function syncRekeyAndAdvance(
  ctx: ChannelSyncContext,
  channel: ChannelKey,
): Promise<{ next?: ChannelKey; removed: boolean; done: boolean }> {
  const keys = deriveChannelKeys(ctx.material, channel);
  ctx.relayAuth.registerStreamKeys(keys.nextRekey.map((r) => r.key));
  ctx.ensureAuth(ctx.relays);
  const rekeyEvents: DecodedEvent[] = [];
  const fetched = await syncAuthors(
    ctx,
    keys.nextRekey.map((r) => r.key.pk),
  );
  let decodedCount = 0;
  let dropped = 0;
  for (const ev of fetched) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "rekey") continue;
    const decoded = decodeWrapCached(ev, info.convKey);
    if (decoded) {
      decodedCount++;
      rekeyEvents.push(decoded);
      ctx.route(info, decoded); // let the sub-engine retain it for the live check too
    } else {
      dropped++;
      ctx.logger.extend("decode")("dropped wrap=%s plane=%s epoch=%d", ev.id.slice(0, 8), "channel", channel.epoch);
    }
  }
  // D-05 litmus: always-on, even when fetched.length === 0.
  ctx.logger(
    "rekey plane epoch=%d fetched=%d decoded=%d dropped=%d",
    channel.epoch,
    fetched.length,
    decodedCount,
    dropped,
  );
  const outcome = await readChannelRekey(
    channel,
    rekeyEvents,
    ctx.isAuthorized,
    ctx.self,
    ctx.signer,
    ctx.canRemoveSelf,
    ctx.verifyVac,
  );
  if (outcome.kind === "adopt") return { next: outcome.next, removed: false, done: false };
  if (outcome.kind === "removed") return { removed: true, done: true };
  return { removed: false, done: true }; // "none" → this is the tip
}

/**
 * D-04 backward re-read pass (Pitfall 3, channel scope): walk `channel.held`
 * oldest-first, re-deriving each held epoch's channel keys and re-invoking the
 * {@link syncRekeyAndAdvance} fold against THAT held epoch's rekey plane — so a
 * strictly-lower authorized sibling for a PAST channel epoch is discovered on a
 * later full sync, not just the forward tip (mirrors the root scope's re-read
 * spine, sync.ts's `syncEpoch`/`syncEpochs`). A strictly-lower re-adoption
 * discards the forward continuation from that epoch and re-walks FORWARD from
 * the corrected key — symmetric to the root cascade, regenerating any later
 * epochs fresh rather than retroactively patching them. An equal-or-higher
 * re-read is ignored (down-only — the same `isStrictlyLowerKey` gate the root
 * scope and the live `checkRekey` latch use; a settled epoch never re-forks).
 */
async function reReadHeldChannelEpochs(
  ctx: ChannelSyncContext,
  channel: ChannelKey,
): Promise<{ channel: ChannelKey; removed: boolean }> {
  const held = [...(channel.held ?? [])].sort((a, b) => a.epoch - b.epoch); // oldest-first
  for (let i = 0; i < held.length; i++) {
    if (ctx.alive && !ctx.alive()) return { channel, removed: false };
    const h = held[i];
    // Re-derive this held epoch as a standalone ChannelKey, carrying forward
    // its OWN older held history (untouched, since only h.epoch+1-and-later is
    // ever in question here) so a later correction doesn't lose it.
    const olderHeld = held
      .filter((x) => x.epoch < h.epoch)
      .slice()
      .reverse(); // newest-first, mirrors rollForwardChannel's convention
    const heldKey: ChannelKey = { id: channel.id, key: h.key, epoch: h.epoch, name: channel.name, held: olderHeld };
    const step = await syncRekeyAndAdvance(ctx, heldKey);
    if (!step.next) continue; // "none"/"removed" for a past epoch: nothing to re-adopt here

    const nextEpoch = h.epoch + 1;
    const recordedKey = nextEpoch === channel.epoch ? channel.key : held.find((x) => x.epoch === nextEpoch)?.key;
    if (recordedKey === undefined || !isStrictlyLowerKey(hexToBytes(recordedKey), hexToBytes(step.next.key))) continue;

    // Strictly lower: chain[h.epoch+1..] was built on the abandoned branch —
    // discard it and re-walk forward from the corrected key exactly like the
    // normal forward loop below, until the (possibly new) tip or a removal.
    let current = step.next;
    for (;;) {
      if (ctx.alive && !ctx.alive()) return { channel: current, removed: false };
      const next = await syncRekeyAndAdvance(ctx, current);
      if (next.removed) return { channel: current, removed: true };
      if (next.done) return { channel: current, removed: false };
      if (next.next) current = next.next;
    }
  }
  return { channel, removed: false };
}

/**
 * Walk a private channel to its tip: re-read every held epoch's rekey plane
 * backward for a down-only correction (D-04), sync every known message plane
 * (current + held) once, then follow forward channel Rekeys — full-syncing each
 * new epoch's message plane before reading the next rekey — until the tip or a
 * removal.
 */
export async function syncChannelEpochs(ctx: ChannelSyncContext, channelKey: ChannelKey): Promise<ChannelWalkResult> {
  const reRead = await reReadHeldChannelEpochs(ctx, channelKey);
  if (reRead.removed) return { removed: true };

  let current = reRead.channel;
  await syncMessagePlanes(ctx, current);
  for (;;) {
    if (ctx.alive && !ctx.alive()) return { tipKey: current, removed: false };
    const step = await syncRekeyAndAdvance(ctx, current);
    if (step.removed) return { removed: true };
    if (step.done) return { tipKey: current, removed: false };
    if (step.next) {
      current = step.next;
      await syncMessagePlanes(ctx, current); // the newly-adopted epoch's plane
    }
  }
}

/** The stream pubkeys a channel holder subscribes live: the current message plane
 *  plus the next-epoch rekey address(es). Held planes are past (no new messages). */
export function channelLiveAuthors(
  material: JoinMaterial,
  channel: ChannelKey,
): { authors: string[]; planes: Map<string, PlaneInfo> } {
  const keys = deriveChannelKeys(material, channel);
  const authors = [keys.current.pk, ...keys.nextRekey.map((r) => r.key.pk)];
  return { authors, planes: keys.planes };
}
