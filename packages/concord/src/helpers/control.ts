// CORD-04 Control Plane — folding versioned editions into community state.
//
// Every authority action is a kind 3308 edition sealed by the actor's real
// npub. Clients fold the highest-version edition per entity, refuse downgrades,
// and drop editions whose signer isn't authorised. Authority is rooted at the
// owner (proven by community_id) and resolved outward, so the roster is folded
// owner-first to break the apparent circularity (CORD-04 §1).

import { PERM, VSK } from "../types.js";
import type {
  ChannelMetadata,
  CommunityMetadata,
  CommunityState,
  DecodedEvent,
  Grant,
  JoinMaterial,
  Role,
} from "../types.js";
import { hasPerm, resolveStanding } from "./permissions.js";
import { isHexKey } from "applesauce-core/helpers/string";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { banlistLocator, editionHash, grantLocator, inviteLinksLocator } from "./crypto.js";

/** Concord control-plane edition kind (CORD-04). */
export const CONTROL_KIND = 3308;

/** A Community folds only the 100 lowest `role_id`s, ignoring the rest (CORD-04 §2). */
export const MAX_ROLES = 100;

interface Edition {
  vsk: number;
  eid: string;
  version: number;
  prev?: string;
  /** edition_hash of THIS edition — what the next edition's `ep` must cite. */
  selfHash: string;
  content: string;
  author: string;
  rumorId: string;
  ms: number;
  /** The decoded stream event this edition arrived in (carries the re-wrappable seal). */
  source: DecodedEvent;
}

function parseEdition(d: DecodedEvent): Edition | null {
  const r = d.rumor;
  const get = (name: string) => r.tags.find((t) => t[0] === name)?.[1];
  const vsk = get("vsk");
  const eid = get("eid");
  if (vsk === undefined || eid === undefined || !isHexKey(eid)) return null;
  const ev = get("ev");
  const version = ev ? parseInt(ev, 10) : 1;
  if (!Number.isInteger(version) || version < 1) return null;
  const prev = get("ep");
  if (prev !== undefined && !isHexKey(prev)) return null;
  return {
    vsk: parseInt(vsk, 10),
    eid,
    version,
    prev,
    selfHash: editionHash(hexToBytes(eid), version, prev ? hexToBytes(prev) : undefined, utf8ToBytes(r.content)),
    content: r.content,
    author: d.author,
    rumorId: r.id,
    ms: d.ms,
    source: d,
  };
}

/**
 * Per-entity head candidates, matching armada's CORD-04 fold (`version.fold` +
 * `headCandidates`): the chain-verified head first — the top of the CONTIGUOUS
 * `prev`-linked chain walked up from the lowest present version, so a dangling
 * `prev` holds the head at the last linked edition rather than jumping to a
 * higher-versioned orphan — then the remaining per-version winners descending
 * as authority-gated bootstrap fallbacks. The caller takes the first candidate
 * that passes its authority gate.
 */
function headCandidates(editions: Edition[]): Edition[] {
  if (editions.length === 0) return [];
  // Per-version winner: equal version → lower rumor id (deterministic tiebreak).
  const byVersion = new Map<number, Edition>();
  for (const e of editions) {
    const w = byVersion.get(e.version);
    if (!w || e.rumorId < w.rumorId) byVersion.set(e.version, e);
  }
  const versions = [...byVersion.keys()].sort((a, b) => a - b);
  // Walk the contiguous chain up from the lowest present version.
  let headVersion = versions[0];
  for (let k = 0; k + 1 < versions.length; k++) {
    const cur = byVersion.get(versions[k])!;
    const next = byVersion.get(versions[k + 1])!;
    if (versions[k + 1] === versions[k] + 1 && next.prev === cur.selfHash) headVersion = versions[k + 1];
    else break;
  }
  const ordered: Edition[] = [byVersion.get(headVersion)!];
  const seen = new Set<number>([headVersion]);
  for (const v of [...versions].sort((a, b) => b - a)) {
    if (seen.has(v)) continue;
    seen.add(v);
    ordered.push(byVersion.get(v)!);
  }
  return ordered;
}

/** Group editions by eid and return, per eid, the ordered head candidates. */
function groupByEntity(editions: Edition[]): Map<string, Edition[]> {
  const byEid = new Map<string, Edition[]>();
  for (const e of editions) {
    const arr = byEid.get(e.eid) ?? [];
    arr.push(e);
    byEid.set(e.eid, arr);
  }
  const out = new Map<string, Edition[]>();
  for (const [eid, arr] of byEid) out.set(eid, headCandidates(arr));
  return out;
}

/** Keep only the {@link MAX_ROLES} lowest role_ids (the eid *is* the role_id). */
function capRoles(candidates: Map<string, Edition[]>): Map<string, Edition[]> {
  if (candidates.size <= MAX_ROLES) return candidates;
  const lowest = [...candidates.keys()].sort().slice(0, MAX_ROLES);
  return new Map(lowest.map((eid) => [eid, candidates.get(eid)!]));
}

export function foldControl(events: DecodedEvent[], material: JoinMaterial): CommunityState {
  const editions = events.map(parseEdition).filter((e): e is Edition => e !== null);

  const byVsk = (vsk: number) => editions.filter((e) => e.vsk === vsk);

  // Fold only the 100 lowest role_ids so every client converges on the same set
  // regardless of how many extra roles a relay serves (CORD-04 §2).
  const roleCandidates = capRoles(groupByEntity(byVsk(VSK.ROLE)));
  const grantCandidates = groupByEntity(byVsk(VSK.GRANT));

  // ---- Fold the roster owner-first, iterating to a fixpoint (CORD-04 §1). --
  const roles = new Map<string, Role>();
  const grants = new Map<string, string[]>();
  const owner = material.owner;
  // The winning head edition per entity (by eid), retained for CORD-06
  // compaction — a Refounding re-wraps each of these plaintext seals.
  const heads = new Map<string, DecodedEvent>();

  const standing = (member: string) => resolveStanding(member, owner, roles, grants);

  const cidBytes = hexToBytes(material.community_id);

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;

    // Roles: signer needs MANAGE_ROLES and may not mint a position at/above self.
    for (const [eid, cands] of roleCandidates) {
      for (const cand of cands) {
        const s = standing(cand.author);
        if (!s.isOwner && !hasPerm(s.permissions, PERM.MANAGE_ROLES)) continue;
        let role: Role;
        try {
          role = JSON.parse(cand.content) as Role;
        } catch {
          continue;
        }
        if (!role.role_id) role.role_id = eid;
        // AUTH-06: position must be a positive integer strictly below the
        // roleless sentinel (CORD-04 §3, `"position": <u32>`). Inserted
        // BEFORE the two `<=` checks below — `NaN <= x` is always false and
        // a float passes an integer-shaped `<=` bound, so those checks alone
        // let a malformed position slip through and confer permission bits.
        if (!Number.isInteger(role.position) || role.position <= 0 || role.position >= 0xffffffff) continue;
        // No edition may claim a position at or above its own signer.
        if (!s.isOwner && role.position <= s.position) continue;
        if (role.position <= 0) continue; // position 0 is the owner alone
        const prev = roles.get(eid);
        if (!prev || prev.position !== role.position || prev.name !== role.name || prev.deleted !== role.deleted)
          changed = true;
        roles.set(eid, role);
        heads.set(eid, cand.source);
        break;
      }
    }

    // Grants: signer must outrank every role handed out and hold MANAGE_ROLES.
    for (const [eid, cands] of grantCandidates) {
      for (const cand of cands) {
        const s = standing(cand.author);
        let grant: Grant;
        try {
          grant = JSON.parse(cand.content) as Grant;
        } catch {
          continue;
        }
        if (!grant.member) continue;
        // AUTH-03: a Grant lives at exactly ONE derived coordinate — an
        // edition at any other eid is forged, even if signed by an authorized
        // author. Folding whichever eid group arrived first would both let a
        // forged edition shadow the real one for the same member and make
        // the fold delivery-order dependent (mirrors the banlist gate below).
        if (eid !== grantLocator(cidBytes, grant.member)) continue;
        // AUTH-04: role_ids shape must be validated unconditionally, BEFORE
        // `authorized` — an owner-signed malformed Grant short-circuits
        // `s.isOwner` and would otherwise reach `.every`/`.join` unguarded
        // and throw, taking down every member's fold with it. An empty array
        // satisfies this vacuously and is a valid revoke, not malformed (D-08).
        if (!Array.isArray(grant.role_ids) || !grant.role_ids.every((rid) => typeof rid === "string")) continue;
        // AUTH-07: a non-self Grant folds only when the signer strictly
        // outranks the TARGET's current standing (CORD-04 §3 — equal cannot
        // act on equal). Additional to (never a replacement for) the
        // roles-outrank .every() below — that check is vacuously true for an
        // empty role_ids, so it alone cannot stop a junior from stripping a
        // senior. Self-targeting (leave/self-revoke) is exempt.
        const targetStanding = standing(grant.member);
        const authorized =
          s.isOwner ||
          (hasPerm(s.permissions, PERM.MANAGE_ROLES) &&
            grant.role_ids.every((rid) => {
              const r = roles.get(rid);
              return r ? r.position > s.position : false;
            }) &&
            (grant.member === cand.author || s.position < targetStanding.position));
        if (!authorized) continue;
        const prevRoles = grants.get(grant.member) ?? [];
        if (prevRoles.join(",") !== grant.role_ids.join(",")) changed = true;
        grants.set(grant.member, grant.role_ids);
        heads.set(cand.eid, cand.source);
        break;
      }
    }

    if (!changed) break;
  }

  // ---- Metadata (MANAGE_METADATA) -----------------------------------------
  let metadata: CommunityMetadata | undefined;
  for (const cand of groupByEntity(byVsk(VSK.METADATA)).get(material.community_id) ?? []) {
    const s = standing(cand.author);
    if (!s.isOwner && !hasPerm(s.permissions, PERM.MANAGE_METADATA)) continue;
    try {
      metadata = JSON.parse(cand.content) as CommunityMetadata;
      heads.set(material.community_id, cand.source);
      break;
    } catch {
      /* skip */
    }
  }

  // ---- Channels (MANAGE_CHANNELS) -----------------------------------------
  // CHAN-04: fields are picked explicitly with type validation — never a blind
  // `JSON.parse(...) as ChannelMetadata` cast, and key material is NEVER read
  // from edition JSON (D-01: `material.channels` is the sole source of truth).
  // CHAN-07: deletion is terminal (CORD-03 §2, "the id is never reused") — if
  // ANY authorized candidate for this entity is deleted:true, the channel is
  // permanently dropped AND `heads` is pinned to that deleting edition (not
  // whatever the ordinary version-chain head would be), so a later compaction
  // republishes the terminal state, not a resurrection attempt. Both outputs
  // (`heads.set` and the `channels.push` decision) derive from ONE scan.
  const channels: ChannelMetadata[] = [];
  for (const [eid, cands] of groupByEntity(byVsk(VSK.CHANNEL))) {
    const authorized = cands.filter((c) => {
      const s = standing(c.author);
      return s.isOwner || hasPerm(s.permissions, PERM.MANAGE_CHANNELS);
    });

    // Scan ALL authorized candidates (not just the head) for a sticky deletion.
    // Multiple simultaneous deletions at different versions tiebreak on the
    // lowest rumorId (mirrors headCandidates' tiebreak at :85).
    let deletion: Edition | undefined;
    for (const cand of authorized) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cand.content);
      } catch {
        continue;
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as { deleted?: unknown }).deleted === true &&
        (!deletion || cand.rumorId < deletion.rumorId)
      ) {
        deletion = cand;
      }
    }
    if (deletion) {
      heads.set(eid, deletion.source); // pin to the terminal edition, not the ordinary head
      continue; // never push — permanently dead, id never reused
    }

    // Otherwise take the first parseable authorized candidate, picking fields
    // EXPLICITLY with type validation — never key/epoch from the edition.
    for (const cand of authorized) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cand.content);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue;
      const raw = parsed as Record<string, unknown>;
      if (typeof raw.name !== "string" || typeof raw.private !== "boolean") continue;
      const meta: ChannelMetadata = {
        channel_id: eid,
        name: raw.name,
        private: raw.private,
        ...(typeof raw.deleted === "boolean" ? { deleted: raw.deleted } : {}),
        ...(typeof raw.voice === "boolean" ? { voice: raw.voice } : {}),
        ...(raw.custom !== null && typeof raw.custom === "object" ? { custom: raw.custom as Record<string, unknown> } : {}),
      };
      heads.set(eid, cand.source);
      channels.push(meta);
      break;
    }
  }

  // ---- Banlist (BAN) ------------------------------------------------------
  // The Banlist lives at exactly ONE derived coordinate, so an edition at any other
  // eid is forged. Folding whichever eid group happened to arrive first would both
  // let a BAN-holder shadow the real list with an empty one and make the fold
  // delivery-order dependent — clients would disagree on who is banned.
  const banlist = new Set<string>();
  for (const cand of groupByEntity(byVsk(VSK.BANLIST)).get(banlistLocator(cidBytes)) ?? []) {
    const s = standing(cand.author);
    if (!s.isOwner && !hasPerm(s.permissions, PERM.BAN)) continue;
    try {
      for (const pk of JSON.parse(cand.content) as string[]) banlist.add(pk);
      heads.set(cand.eid, cand.source);
      break;
    } catch {
      /* skip */
    }
  }

  // ---- Invite Registry (CREATE_INVITE), CORD-05 §5 ------------------------
  // Every creator publishes their own registry at a coordinate bound to them, so
  // its eid must reproduce inviteLinksLocator(community_id, author) or it's a
  // forged entry into someone else's list. The aggregate live-link set is the
  // Public/Private source of truth: non-empty = Public.
  const inviteLinks = new Set<string>();
  for (const [eid, cands] of groupByEntity(byVsk(VSK.INVITE_REGISTRY))) {
    for (const cand of cands) {
      const s = standing(cand.author);
      if (!s.isOwner && !hasPerm(s.permissions, PERM.CREATE_INVITE)) continue;
      if (eid !== inviteLinksLocator(cidBytes, cand.author)) continue;
      try {
        const coords = JSON.parse(cand.content) as string[];
        for (const coord of coords) inviteLinks.add(coord);
        heads.set(eid, cand.source);
        break;
      } catch {
        /* skip */
      }
    }
  }

  return {
    material,
    metadata,
    channels,
    roles: [...roles.values()].sort((a, b) => a.position - b.position || (a.role_id < b.role_id ? -1 : 1)),
    grants,
    banlist,
    inviteLinks,
    members: new Set(),
    dissolved: false,
    heads,
  };
}
