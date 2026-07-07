// CORD-02 §8 Community List (kind 13302) — liveness semantics.
//
// A member's memberships sync across devices/clients as one self-encrypted
// replaceable event. Nothing is ever deleted: every community joined AND every
// one left stays in the document, and liveness is DERIVED — a re-join
// legitimately resurrects a tombstoned id, while a stale device can never
// re-add one it never re-joined. This mirrors armada `concord-v2/lib/
// communityList.ts` (`isLive`) so both clients agree on which memberships show.

import type { JoinMaterial } from "../types.js";

export interface CommunityListEntry {
  community_id: string;
  /** Earliest epoch held — the backfill anchor (only ever moves backward on merge). */
  seed: JoinMaterial;
  /** Freshest snapshot — replaced on every Refounding or rename. */
  current: JoinMaterial;
  /** ms; tiebreaks against a tombstone's removed_at. */
  added_at: number;
  [k: string]: unknown;
}

export interface CommunityTombstone {
  community_id: string;
  /** ms. Permanent — pruning would let a long-offline device resurrect a leave. */
  removed_at: number;
  [k: string]: unknown;
}

export interface CommunityList {
  entries: CommunityListEntry[];
  tombstones: CommunityTombstone[];
  [k: string]: unknown;
}

/** The newest `added_at` for a community across (possibly un-merged) entries, or undefined if absent. */
function newestAdd(list: CommunityList, communityId: string): number | undefined {
  let added: number | undefined;
  for (const e of list.entries ?? []) {
    if (e?.community_id !== communityId) continue;
    const at = typeof e.added_at === "number" ? e.added_at : 0;
    added = added === undefined ? at : Math.max(added, at);
  }
  return added;
}

/** The newest removal; a tombstone lacking a valid `removed_at` is treated as terminal (+∞). */
function newestRemoval(list: CommunityList, communityId: string): number | undefined {
  let removed: number | undefined;
  for (const t of list.tombstones ?? []) {
    if (t?.community_id !== communityId) continue;
    const at = typeof t.removed_at === "number" ? t.removed_at : Infinity;
    removed = removed === undefined ? at : Math.max(removed, at);
  }
  return removed;
}

/**
 * Whether a membership is live: it has an entry, and either no tombstone or its
 * newest add postdates the newest removal (CORD-02 §8). A re-join resurrects; a
 * pure leave stays dead.
 */
export function isCommunityLive(list: CommunityList, communityId: string): boolean {
  const added = newestAdd(list, communityId);
  if (added === undefined) return false;
  const removed = newestRemoval(list, communityId);
  return removed === undefined || added > removed;
}

/** The live memberships, derived (deduped by community_id, newest-add snapshot). */
export function liveCommunityEntries(list: CommunityList): CommunityListEntry[] {
  const live = new Map<string, CommunityListEntry>();
  for (const e of list.entries ?? []) {
    if (!e?.community_id || !isCommunityLive(list, e.community_id)) continue;
    const prev = live.get(e.community_id);
    if (!prev || (e.added_at ?? 0) >= (prev.added_at ?? 0)) live.set(e.community_id, e);
  }
  return [...live.values()];
}

// ── Merge + mutation (CORD-02 §8, mirrors armada communityList.ts) ───────────

export const EMPTY_COMMUNITY_LIST: CommunityList = { entries: [], tombstones: [] };

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

function mergeEntry(x: CommunityListEntry, y: CommunityListEntry): CommunityListEntry {
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
 * Deterministically merge two Community Lists — commutative, idempotent, nothing
 * deleted (liveness is derived). The token here is the community_id; a tombstone
 * always stays in the document, and the newest add vs newest removal decides
 * liveness (CORD-02 §8).
 */
export function mergeCommunityLists(a: CommunityList, b: CommunityList): CommunityList {
  const entries = new Map<string, CommunityListEntry>();
  for (const e of [...(a.entries ?? []), ...(b.entries ?? [])]) {
    if (!e || typeof e.community_id !== "string") continue;
    const prev = entries.get(e.community_id);
    entries.set(e.community_id, prev ? mergeEntry(prev, e) : e);
  }
  const tombstones = new Map<string, CommunityTombstone>();
  for (const t of [...(a.tombstones ?? []), ...(b.tombstones ?? [])]) {
    if (!t || typeof t.community_id !== "string") continue;
    const prev = tombstones.get(t.community_id);
    if (!prev || t.removed_at > prev.removed_at) tombstones.set(t.community_id, t);
  }
  return {
    ...a,
    ...b,
    entries: [...entries.values()].sort((x, y) => x.community_id.localeCompare(y.community_id)),
    tombstones: [...tombstones.values()].sort((x, y) => x.community_id.localeCompare(y.community_id)),
  };
}

/** Add/refresh a membership (pure). */
export function addToList(list: CommunityList, entry: CommunityListEntry): CommunityList {
  return mergeCommunityLists(list, { entries: [entry], tombstones: [] });
}

/** Tombstone a membership on leave/removal (pure). */
export function removeFromList(list: CommunityList, communityId: string, removedAt: number): CommunityList {
  return mergeCommunityLists(list, { entries: [], tombstones: [{ community_id: communityId, removed_at: removedAt }] });
}

/**
 * Replace a membership's `current` snapshot in place (an authoritative local
 * refresh — a caught-up rename or a channel-key addition). Bypasses the
 * epoch-keyed `freshest` so a same-epoch update can't lose the canonical-bytes
 * tiebreak (pure).
 */
export function refreshCurrent(list: CommunityList, current: JoinMaterial): CommunityList {
  const idx = (list.entries ?? []).findIndex((e) => e.community_id === current.community_id);
  if (idx === -1) return list;
  const entries = list.entries.map((e, i) => (i === idx ? { ...e, current } : e));
  return { ...list, entries };
}

/** Whether the serialized (JSON) list fits under the NIP-44 plaintext cap. */
export function withinByteCap(list: CommunityList): boolean {
  return new TextEncoder().encode(JSON.stringify(list)).length <= LIST_MAX_BYTES;
}
