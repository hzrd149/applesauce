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

import type { PlaneInfo } from "../helpers/keys.js";
import { deriveChannelKeys, readChannelRekey } from "../helpers/keys.js";
import { decodeWrapCached } from "../helpers/gift-wrap.js";
import type { ChannelKey, DecodedEvent, JoinMaterial } from "../types.js";
import { syncAuthors, type SyncContext } from "./sync.js";

/** The sync context for a private channel: the community walk's context plus the
 *  community `material` (the root(s) the channel-rekey address keys on) and the
 *  channel-rekey authority predicate (`MANAGE_CHANNELS` + outranks the target). */
export interface ChannelSyncContext extends SyncContext {
  material: JoinMaterial;
  isAuthorized: (rotator: string) => boolean;
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
  for (const ev of await syncAuthors(ctx, streamKeys.map((k) => k.pk))) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel") continue;
    const decoded = decodeWrapCached(ev, info.convKey);
    if (decoded) ctx.route(info, decoded);
  }
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
  for (const ev of await syncAuthors(ctx, keys.nextRekey.map((r) => r.key.pk))) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "rekey") continue;
    const decoded = decodeWrapCached(ev, info.convKey);
    if (decoded) {
      rekeyEvents.push(decoded);
      ctx.route(info, decoded); // let the sub-engine retain it for the live check too
    }
  }
  const outcome = await readChannelRekey(channel, rekeyEvents, ctx.isAuthorized, ctx.self, ctx.signer);
  if (outcome.kind === "adopt") return { next: outcome.next, removed: false, done: false };
  if (outcome.kind === "removed") return { removed: true, done: true };
  return { removed: false, done: true }; // "none" → this is the tip
}

/**
 * Walk a private channel to its tip: sync every known message plane (current +
 * held) once, then follow forward channel Rekeys — full-syncing each new epoch's
 * message plane before reading the next rekey — until the tip or a removal.
 */
export async function syncChannelEpochs(ctx: ChannelSyncContext, channelKey: ChannelKey): Promise<ChannelWalkResult> {
  let current = channelKey;
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
export function channelLiveAuthors(material: JoinMaterial, channel: ChannelKey): { authors: string[]; planes: Map<string, PlaneInfo> } {
  const keys = deriveChannelKeys(material, channel);
  const authors = [keys.current.pk, ...keys.nextRekey.map((r) => r.key.pk)];
  return { authors, planes: keys.planes };
}
