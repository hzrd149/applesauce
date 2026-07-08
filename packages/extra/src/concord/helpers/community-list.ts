// CORD-02 §8 Community List (kind 13302) — liveness semantics.
//
// A member's memberships sync across devices/clients as one self-encrypted
// replaceable event. Nothing is ever deleted: every community joined AND every
// one left stays in the document, and liveness is DERIVED — a re-join
// legitimately resurrects a tombstoned id, while a stale device can never
// re-add one it never re-joined. This mirrors armada `concord-v2/lib/
// communityList.ts` (`isLive`) so both clients agree on which memberships show.
//
// There is no combined "document" type: communities and tombstones are two
// separate arrays that the cast/factory/operation manage independently (mirroring the
// Invite List, CORD-05 §4). Consumers mutate the list with atomic operations
// (add/leave/refresh) instead of handing the whole object back and forth.

import {
  getHiddenContent,
  getOrComputeCachedValue,
  isHiddenContentUnlocked,
  KnownEvent,
  notifyEventUpdate,
  unlockHiddenContent,
  type HiddenContentSigner,
  type NostrEvent,
} from "applesauce-core/helpers";

import type { CommunityListCommunity, CommunityTombstone, JoinMaterial } from "../types.js";

/** Concord community list kind (CORD-02 §8). */
export const COMMUNITY_LIST_KIND = 13302;

/** The newest `added_at` for a community across (possibly un-merged) communities, or undefined if absent. */
function newestAdd(communities: CommunityListCommunity[], communityId: string): number | undefined {
  let added: number | undefined;
  for (const e of communities ?? []) {
    if (e?.community_id !== communityId) continue;
    const at = typeof e.added_at === "number" ? e.added_at : 0;
    added = added === undefined ? at : Math.max(added, at);
  }
  return added;
}

/** The newest removal; a tombstone lacking a valid `removed_at` is treated as terminal (+∞). */
function newestRemoval(tombstones: CommunityTombstone[], communityId: string): number | undefined {
  let removed: number | undefined;
  for (const t of tombstones ?? []) {
    if (t?.community_id !== communityId) continue;
    const at = typeof t.removed_at === "number" ? t.removed_at : Infinity;
    removed = removed === undefined ? at : Math.max(removed, at);
  }
  return removed;
}

/**
 * Whether a membership is live: it has a community, and either no tombstone or
 * its newest add postdates the newest removal (CORD-02 §8). A re-join
 * resurrects; a pure leave stays dead.
 */
export function isCommunityLive(
  communities: CommunityListCommunity[],
  tombstones: CommunityTombstone[],
  communityId: string,
): boolean {
  const added = newestAdd(communities, communityId);
  if (added === undefined) return false;
  const removed = newestRemoval(tombstones, communityId);
  return removed === undefined || added > removed;
}

/** The live memberships, derived (deduped by community_id, newest-add snapshot). */
export function liveCommunities(
  communities: CommunityListCommunity[],
  tombstones: CommunityTombstone[],
): CommunityListCommunity[] {
  const live = new Map<string, CommunityListCommunity>();
  for (const e of communities ?? []) {
    if (!e?.community_id || !isCommunityLive(communities, tombstones, e.community_id)) continue;
    const prev = live.get(e.community_id);
    if (!prev || (e.added_at ?? 0) >= (prev.added_at ?? 0)) live.set(e.community_id, e);
  }
  return [...live.values()];
}

// ── Merge + mutation (CORD-02 §8, mirrors armada communityList.ts) ───────────

/** The NIP-44 plaintext cap the serialized list must fit under (CORD-02 §8). */
export const LIST_MAX_BYTES = 65_535;

/** JSON with recursively-sorted keys — a total order for equal-epoch tiebreaks. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Higher root_epoch wins; tie → lexicographically-lowest canonical bytes. */
function freshest(a: JoinMaterial, b: JoinMaterial): JoinMaterial {
  if (a.root_epoch !== b.root_epoch) return a.root_epoch > b.root_epoch ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}
/** Lower root_epoch wins; tie → lowest canonical bytes (the backfill anchor). */
function earliest(a: JoinMaterial, b: JoinMaterial): JoinMaterial {
  if (a.root_epoch !== b.root_epoch) return a.root_epoch < b.root_epoch ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}

function mergeCommunity(x: CommunityListCommunity, y: CommunityListCommunity): CommunityListCommunity {
  return {
    ...x,
    ...y,
    community_id: x.community_id,
    current: freshest(x.current, y.current),
    seed: earliest(x.seed, y.seed),
    added_at: Math.max(x.added_at, y.added_at),
  };
}

/**
 * Deterministically merge two arrays of communities — commutative, idempotent,
 * nothing deleted. The community_id is the merge key: `current` keeps the
 * freshest snapshot, `seed` the earliest, and `added_at` the newest add
 * (CORD-02 §8).
 */
export function mergeCommunities(a: CommunityListCommunity[], b: CommunityListCommunity[]): CommunityListCommunity[] {
  const communities = new Map<string, CommunityListCommunity>();
  for (const e of [...(a ?? []), ...(b ?? [])]) {
    if (!e || typeof e.community_id !== "string") continue;
    const prev = communities.get(e.community_id);
    communities.set(e.community_id, prev ? mergeCommunity(prev, e) : e);
  }
  return [...communities.values()].sort((x, y) => x.community_id.localeCompare(y.community_id));
}

/**
 * Deterministically union two arrays of tombstones by community_id, keeping the
 * newest removal (commutative, idempotent). A tombstone always stays in the
 * document — liveness is derived from the newest add vs newest removal
 * (CORD-02 §8).
 */
export function mergeCommunityTombstones(a: CommunityTombstone[], b: CommunityTombstone[]): CommunityTombstone[] {
  const tombstones = new Map<string, CommunityTombstone>();
  for (const t of [...(a ?? []), ...(b ?? [])]) {
    if (!t || typeof t.community_id !== "string") continue;
    const prev = tombstones.get(t.community_id);
    if (!prev || t.removed_at > prev.removed_at) tombstones.set(t.community_id, t);
  }
  return [...tombstones.values()].sort((x, y) => x.community_id.localeCompare(y.community_id));
}

/**
 * The atomic membership mutations (join/leave/refresh) live as composable
 * `CommunityListOperation`s in ../operations/community-list.js; they are built on
 * the `mergeCommunities`/`mergeCommunityTombstones` primitives above.
 */

/** Whether the serialized (JSON) list fits under the NIP-44 plaintext cap. */
export function communityListWithinByteCap(
  communities: CommunityListCommunity[],
  tombstones: CommunityTombstone[],
): boolean {
  // The wire document keys the array as `entries` (armada-compatible).
  const bytes = new TextEncoder().encode(JSON.stringify({ entries: communities, tombstones }));
  return bytes.length <= LIST_MAX_BYTES;
}

// ── Event-level helpers (self-encrypted list; hidden-content family) ─────────

/** A validated Concord Community List event (kind 13302). */
export type CommunityListEvent = KnownEvent<typeof COMMUNITY_LIST_KIND>;

/** Validates that an event is a Concord community list (kind 13302). */
export function isValidCommunityList(event: NostrEvent): event is CommunityListEvent {
  return event.kind === COMMUNITY_LIST_KIND;
}

/** Symbol for caching the parsed (decrypted) community list on an event. */
export const CommunityListSymbol = Symbol.for("concord-community-list");

/** The decrypted community list split into its two independent arrays. */
export interface ParsedCommunityList {
  communities: CommunityListCommunity[];
  tombstones: CommunityTombstone[];
}

/**
 * Parse the self-encrypted community list JSON into its two arrays (empty on
 * absent/blank). The stored document keys the array as `entries`; the parsed
 * object exposes it as `communities`.
 */
export function parseCommunityList(json: string | undefined): ParsedCommunityList {
  if (!json) return { communities: [], tombstones: [] };
  const doc = JSON.parse(json) as { entries?: CommunityListCommunity[]; tombstones?: CommunityTombstone[] };
  return { communities: doc.entries ?? [], tombstones: doc.tombstones ?? [] };
}

/** Whether the self-encrypted community list plaintext is unlocked on the event. */
export function isCommunityListUnlocked(event: NostrEvent): boolean {
  return isHiddenContentUnlocked(event);
}

/** Returns the parsed community list if the event has been unlocked, otherwise undefined. */
export function getCommunityList(event: NostrEvent): ParsedCommunityList | undefined {
  const json = getHiddenContent(event);
  if (json === undefined) return undefined;
  return getOrComputeCachedValue(event, CommunityListSymbol, () => parseCommunityList(json));
}

/** The live community memberships derived from the unlocked list, or undefined if locked. */
export function getLiveCommunities(event: NostrEvent): CommunityListCommunity[] | undefined {
  const parsed = getCommunityList(event);
  return parsed && liveCommunities(parsed.communities, parsed.tombstones);
}

/** Unlocks and parses the self-encrypted community list using the owning user's signer. */
export async function unlockCommunityList(
  event: NostrEvent,
  signer: HiddenContentSigner,
): Promise<ParsedCommunityList> {
  if (!isCommunityListUnlocked(event)) {
    await unlockHiddenContent(event, signer);
    notifyEventUpdate(event);
  }
  return getCommunityList(event) ?? { communities: [], tombstones: [] };
}
