// Epoch-atomic sync engine for a Concord community.
//
// A community rotates its root frequently (CORD-06). Each epoch derives its OWN
// stream addresses (control/guestbook/channel/dissolved/rekey), and the decision
// to advance to epoch N+1 lives in epoch N's rekey plane — which can only be read
// once epoch N is FULLY synced. Processing epochs out of order, or opening a live
// subscription before the tip is reached, drops messages.
//
// So sync is a strict sequential walk: for each epoch we NIP-42 authenticate (if
// the relay gates), fully sync every plane (a hard barrier — every gift wrap is
// fetched, decrypted, and routed before we read the rekey plane), then decide how
// the walk continues. Only the latest (tip) epoch gets a live subscription.
//
// This promotes the manual `loadEpoch`/`buildChain` walk from the examples
// (concord/rumor-stores, concord/models) to first-class engine functions, using
// `createSyncLoader` for the per-plane full sync so NIP-77 negentropy is used
// when a relay supports it and paginated backward REQ otherwise.

import { firstValueFrom, toArray } from "rxjs";
import { createSyncLoader } from "applesauce-loaders/loaders";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "applesauce-core/helpers/event";

import type { ConcordRelayAuth } from "./relay-auth.js";
import { deriveConcordKeys, readRekey, type ConcordKeys, type PlaneInfo } from "../helpers/keys.js";
import { decodeWrapCached, EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND } from "../helpers/gift-wrap.js";
import { foldControl } from "../helpers/control.js";
import { foldMembers } from "../helpers/guestbook.js";
import { refoundAuthority, resolveStanding } from "../helpers/permissions.js";
import type { CommunityState, DecodedEvent, JoinMaterial, Role } from "../types.js";

/** How the walk continues past an epoch. */
export type EpochTransition = "known" | "adopt" | "removed" | "tip" | "cannot-follow";

/** The outcome of fully syncing one epoch. */
export interface EpochResult {
  epoch: number;
  keys: ConcordKeys;
  transition: EpochTransition;
  /** Present when `transition === "adopt"`: the material for the next epoch. */
  adoptedMaterial?: JoinMaterial;
  /** Number of rumors routed while syncing this epoch. */
  rumors: number;
}

/** The outcome of walking every epoch to the tip. */
export interface EpochWalkResult {
  epochs: EpochResult[];
  /** The keys for the latest epoch we still belong to — open the live subscription
   *  here. Undefined when we were removed. */
  tipKeys?: ConcordKeys;
  /** True when a Refounding excluded us (CORD-06). */
  removed: boolean;
}

/** Everything the sync walk needs, injected by the {@link ConcordCommunity}. */
export interface SyncContext {
  pool: RelayPool;
  relayAuth: ConcordRelayAuth;
  /** Wrap-level store: dedups kind-1059 wraps and doubles as the NIP-77 local store. */
  eventStore: EventStore;
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  self: string;
  relays: string[];
  /** Route one decoded plane event into its plane's RumorStore (the community applies
   *  the CORD-03 channel binding + voice-presence filters). */
  route: (info: PlaneInfo, decoded: DecodedEvent) => void;
  /** Register the per-relay NIP-42 auth drivers for the currently-held stream keys. */
  ensureAuth: (relays: string[]) => void;
  /** Cooperative cancellation: return false to abort the walk between epochs. */
  alive?: () => boolean;
}

/**
 * Fully sync every gift wrap at `authors` across the context relays and RESOLVE
 * only when done (the atomic barrier). Uses `createSyncLoader`, which probes each
 * relay for NIP-77 and reconciles via negentropy when supported, otherwise pages
 * backward through REQ blocks. Passing `waitForAuth: authors` makes an auth-gating
 * relay hold BOTH the negentropy sync and the paginated REQ until the derived
 * stream keys are NIP-42-authenticated (by the already-registered
 * {@link ConcordRelayAuth} driver) and retry once they are, rather than erroring.
 */
export async function syncAuthors(ctx: SyncContext, authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  const loader = createSyncLoader({ eventStore: ctx.eventStore, pool: ctx.pool });
  const { events$ } = loader({
    relays: ctx.relays,
    filter: { kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors },
    waitForAuth: authors,
  });
  // events$ completes when every relay has finished (completed or errored), so this
  // awaits the whole epoch's traffic — nothing advances until it resolves.
  return firstValueFrom(events$.pipe(toArray()));
}

/**
 * Fully sync ONE epoch and decide how the walk continues. Mirrors the examples'
 * `loadEpoch`, but drains every decoded wrap into the caller's stores (via
 * `ctx.route`) and awaits each plane's full sync before reading the rekey plane.
 */
export async function syncEpoch(
  ctx: SyncContext,
  epochMaterial: JoinMaterial,
  prior: ConcordKeys | undefined,
  chainHasNext: boolean,
): Promise<EpochResult> {
  let rumors = 0;
  const emit = (info: PlaneInfo, d: DecodedEvent) => {
    ctx.route(info, d);
    rumors++;
  };

  // 1. Derive with no channels yet; register the core planes and authenticate.
  let keys = deriveConcordKeys(epochMaterial, [], prior);
  ctx.relayAuth.registerStreamKeys([keys.control, keys.guestbook, keys.dissolved, keys.nextBaseRekey.key]);
  ctx.ensureAuth(ctx.relays);

  // 2. Full-sync control / guestbook / dissolved / next-rekey (ATOMIC), routing by plane.
  const coreAuthors = [keys.control.pk, keys.guestbook.pk, keys.dissolved.pk, keys.nextBaseRekey.key.pk];
  const control: DecodedEvent[] = [];
  const guestbook: DecodedEvent[] = [];
  const dissolved: DecodedEvent[] = [];
  const rekey: DecodedEvent[] = [];
  for (const ev of await syncAuthors(ctx, coreAuthors)) {
    const info = keys.planes.get(ev.pubkey);
    if (!info) continue;
    const d = decodeWrapCached(ev, info.convKey);
    if (!d) continue;
    if (info.type === "control") (control.push(d), emit(info, d));
    else if (info.type === "guestbook") (guestbook.push(d), emit(info, d));
    else if (info.type === "dissolved") (dissolved.push(d), emit(info, d));
    else if (info.type === "rekey") (rekey.push(d), emit(info, d));
  }

  // 3. Fold control → channels, re-derive to reveal the channel addresses, then
  //    full-sync only the PUBLIC channel planes. Public channels derive from the
  //    community_root, so they rotate with the base and belong to this walk;
  //    PRIVATE channels are independently keyed and sync on their own lifecycle
  //    (ConcordPrivateChannel), lifted out of the community walk entirely.
  const state0 = foldControl(control, epochMaterial);
  keys = deriveConcordKeys(epochMaterial, state0.channels, prior);
  const publicIds = new Set(state0.channels.filter((c) => !c.private && !c.deleted).map((c) => c.channel_id));
  const publicKeys = [...keys.channels.entries()].filter(([id]) => publicIds.has(id)).map(([, k]) => k);
  ctx.relayAuth.registerStreamKeys(publicKeys);
  ctx.ensureAuth(ctx.relays);
  const channelDecoded: DecodedEvent[] = [];
  for (const ev of await syncAuthors(ctx, publicKeys.map((k) => k.pk))) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel") continue;
    const d = decodeWrapCached(ev, info.convKey);
    if (!d) continue;
    channelDecoded.push(d);
    emit(info, d);
  }

  // 4. Decide the transition (fold members for standing/authority, exactly as the walk does).
  const observed = new Map<string, number>();
  for (const d of [...control, ...guestbook, ...channelDecoded, ...dissolved])
    if (d.ms > (observed.get(d.author) ?? 0)) observed.set(d.author, d.ms);
  const rolesMap = new Map<string, Role>(state0.roles.map((r) => [r.role_id, r]));
  const members = foldMembers(
    guestbook,
    observed,
    state0.banlist,
    (m) => resolveStanding(m, epochMaterial.owner, rolesMap, state0.grants),
    Date.now(),
    epochMaterial.refounder,
  );
  const state: CommunityState = { ...state0, members };

  let transition: EpochTransition = "tip";
  let adoptedMaterial: JoinMaterial | undefined;
  if (chainHasNext) {
    transition = "known";
  } else if (!ctx.signer.nip44) {
    transition = "cannot-follow";
  } else {
    const outcome = await readRekey(keys, rekey, refoundAuthority(state), ctx.self, ctx.signer, state.channels);
    if (outcome.kind === "adopt") {
      transition = "adopt";
      adoptedMaterial = outcome.next.material;
    } else if (outcome.kind === "removed") {
      transition = "removed";
    }
  }

  return { epoch: epochMaterial.root_epoch, keys, transition, adoptedMaterial, rumors };
}

/**
 * Walk every epoch from the seed forward — fully syncing each (auth → all planes →
 * fold → rekey) before advancing — until we reach the tip, are removed, or can no
 * longer follow. Returns the tip keys so the caller can open the live subscription
 * there (and nowhere else).
 */
export async function syncEpochs(ctx: SyncContext, material: JoinMaterial): Promise<EpochWalkResult> {
  const epochs: EpochResult[] = [];
  let prior: ConcordKeys | undefined;
  let chain = buildChain(material);
  let tipKeys: ConcordKeys | undefined;
  let removed = false;

  for (let i = 0; i < chain.length; i++) {
    if (ctx.alive && !ctx.alive()) break;
    const result = await syncEpoch(ctx, chain[i], prior, i + 1 < chain.length);
    prior = result.keys;
    epochs.push(result);

    if (result.transition === "adopt" && result.adoptedMaterial) {
      chain = [...chain, result.adoptedMaterial];
      continue;
    }
    if (result.transition === "known") continue;
    // tip / cannot-follow: we still belong here → open live at these keys.
    // removed: a Refounding excluded us → no live subscription.
    if (result.transition === "removed") removed = true;
    else tipKeys = result.keys;
    break;
  }

  return { epochs, tipKeys, removed };
}

/**
 * The ordered chain of held roots an invite/material grants — epoch 0..current.
 * Each element is a per-epoch {@link JoinMaterial} carrying only the roots at or
 * before that epoch, so `deriveConcordKeys` addresses the right generation.
 */
export function buildChain(material: JoinMaterial): JoinMaterial[] {
  const roots = [
    ...(material.held_roots ?? []),
    { epoch: material.root_epoch, key: material.community_root },
  ].sort((a, b) => a.epoch - b.epoch);
  const seen = new Set<number>();
  const uniq = roots.filter((r) => (seen.has(r.epoch) ? false : (seen.add(r.epoch), true)));
  return uniq.map((r) => ({
    ...material,
    community_root: r.key,
    root_epoch: r.epoch,
    held_roots: uniq
      .filter((o) => o.epoch < r.epoch)
      .map((o) => ({ epoch: o.epoch, key: o.key }))
      .reverse(),
  }));
}

/** The logical plane a decoded wrap belongs to — the RumorStore key. Community
 *  planes key by kind; channels key by their stable id (shared across epochs). */
export function planeStoreKey(info: PlaneInfo): string {
  return info.type === "channel" ? `channel:${info.channelId}` : info.type;
}
