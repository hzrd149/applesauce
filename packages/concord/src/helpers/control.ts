// CORD-04 Control Plane — folding versioned editions into community state.
//
// Every authority action is a kind 3308 edition sealed by the actor's real
// npub. Clients fold the highest-version edition per entity, refuse downgrades,
// and drop editions whose signer isn't authorised. Authority is rooted at the
// owner (proven by community_id) and resolved outward, so the roster is folded
// owner-first to break the apparent circularity (CORD-04 §1).

import { PERM, VSK } from "../types.js";
import type {
  ChannelKey,
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

// ---- Channel-edition fold: type-derived rule tables (CR-01/WR-01/WR-09) ----
//
// Two hand-maintained field lists produced two review findings in this same
// phase: CR-01 (this refactor's own predecessor deleted the `deleted`/`custom`
// type guards when it introduced the denylist-then-spread shape) and WR-01
// (the denylist named `key`/`epoch` but not `held`, even though the comment
// beside it claimed exhaustiveness over `ChannelKey`). Both tables below are
// TOTAL maps over the real declared types instead: adding a field to either
// governed type fails `pnpm --filter applesauce-concord build` naming the
// table that is now missing an entry, rather than shipping silently. Mirrors
// 12.3-14's `HELD_KEY_FIELD_RULES` precedent (`ExhaustiveBundleRules<T>`).

/**
 * A key-remapping mapped type that keeps only `T`'s explicitly DECLARED
 * members, dropping any key admitted solely through an index signature
 * (`string`/`number`/`symbol`). `ChannelMetadata` carries `[k: string]:
 * unknown` (added by plan 12-08 for D-13's round-trip requirement), so
 * `keyof Required<ChannelMetadata>` is `string | number` — a mapped rule
 * table keyed directly over that union degenerates into an unenforcing index
 * signature that compiles and checks nothing. Stripping the index-signature
 * keys is what makes {@link ChannelMetadataFoldRules} total over the five
 * declared members instead.
 */
export type DeclaredKeysOf<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K];
};

/**
 * `ChannelMetadata`'s five declared fields, with optionality removed. The
 * `Required<...>` wrapper is load-bearing, not cosmetic: without it the
 * optional members `deleted` and `custom` would produce OPTIONAL rule slots
 * in {@link ChannelMetadataFoldRules}, and a missing rule for either would
 * not be a type error — which is exactly CR-01 (the fold's `deleted`/`custom`
 * type guards were silently dropped when 12-08 introduced the denylist).
 */
export type ChannelMetadataDeclared = Required<DeclaredKeysOf<ChannelMetadata>>;

/** A runtime type predicate bound to a fold rule's declared field type. */
export type ChannelFieldGuard<V> = (value: unknown) => value is V;

/**
 * One field's fold rule. `guard` is typed {@link ChannelFieldGuard}`<V>`
 * rather than a loose `(v: unknown) => boolean` so a guard asserting the
 * WRONG type for its slot is a compile error — deliberately closing the
 * class Phase 12.3 backlogged as CR5-01 (a rule's `kind` not type-bound to
 * the field it names, found latent-only there) rather than reproducing it
 * here.
 * - `"derived"`: the value never comes from edition JSON (only `channel_id`,
 *   sourced from the fold's own coordinate).
 * - `"required"`: a guard miss rejects the WHOLE edition (`continue` to the
 *   next candidate) — matches the fold's pre-existing `name`/`private`
 *   behavior.
 * - `"optional"`: a guard miss OMITS just this field and keeps the channel —
 *   converting a type-validation miss into a channel-availability miss would
 *   trade CR-01 for a worse bug (D-04's read-side precedent).
 */
export type ChannelFieldRule<V> =
  | { disposition: "derived" }
  | { disposition: "required"; guard: ChannelFieldGuard<V> }
  | { disposition: "optional"; guard: ChannelFieldGuard<V> };

/** A rule table total over {@link ChannelMetadataDeclared}'s five members. */
export type ChannelMetadataFoldRules = {
  [K in keyof ChannelMetadataDeclared]: ChannelFieldRule<ChannelMetadataDeclared[K]>;
};

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function isBooleanValue(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * `custom` is declared `Record<string, unknown>` — excluding arrays here is a
 * DELIBERATE strengthening beyond the pre-12-08 check (which only tested
 * `typeof === "object"`): an array passes that bare typeof test while
 * producing numeric indices under `Object.keys`/enumeration, the identical
 * type-lie CR-01 names for a string `custom`.
 */
function isCustomRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The per-field validation table (CR-01). */
export const CHANNEL_METADATA_FOLD_RULES: ChannelMetadataFoldRules = {
  channel_id: { disposition: "derived" },
  name: { disposition: "required", guard: isStringValue },
  private: { disposition: "required", guard: isBooleanValue },
  deleted: { disposition: "optional", guard: isBooleanValue },
  custom: { disposition: "optional", guard: isCustomRecord },
};

/**
 * A total classification over every `ChannelKey` field (WR-01). The
 * conditional is the point of the whole type: a `ChannelKey` field that
 * `ChannelMetadata` does not itself declare is not merely EXPECTED to be
 * stripped, it CANNOT be classified any other way — the non-strip escape
 * hatch (`"metadata-field"`) is only reachable for names present in
 * {@link ChannelMetadataDeclared}'s key set.
 */
export type ChannelKeyFoldDisposition = {
  [K in keyof Required<ChannelKey>]: K extends keyof ChannelMetadataDeclared ? "strip" | "metadata-field" : "strip";
};

/**
 * `name` is the one field `ChannelKey` and `ChannelMetadata` share — the
 * metadata rules above validate it, so it must not be stripped. Every other
 * `ChannelKey` field (`id`, `key`, `epoch`, `held`) is key material or a
 * key-material identifier and is stripped, closing WR-01's `held` omission
 * alongside the pre-existing `key`/`epoch` denylist.
 */
export const CHANNEL_KEY_FOLD_DISPOSITION: ChannelKeyFoldDisposition = {
  id: "strip",
  key: "strip",
  epoch: "strip",
  name: "metadata-field",
  held: "strip",
};

/**
 * The strip set, DERIVED at module load from {@link CHANNEL_KEY_FOLD_DISPOSITION}
 * rather than written out as a literal array — a literal would not grow when
 * the table grows, which is the entire defect being closed.
 */
export const CHANNEL_KEY_STRIPPED_FIELDS: readonly string[] = Object.entries(CHANNEL_KEY_FOLD_DISPOSITION)
  .filter(([, disposition]) => disposition === "strip")
  .map(([field]) => field);

/**
 * Rule-driven channel-edition builder (CR-01/WR-01). Returns `undefined`
 * meaning "reject this candidate, try the next" — preserving the fold's
 * pre-existing `continue` semantics exactly.
 *
 * Builds ONE object from two ordered entry lists via `Object.fromEntries`,
 * never a rest-spread and never per-key bracket assignment:
 *  - pass-through entries (every own key neither stripped nor declared) FIRST;
 *  - declared-field entries (from {@link CHANNEL_METADATA_FOLD_RULES}) LAST.
 * Two properties depend on exactly that ordering and construction method:
 * later entries win, so a hostile edition's own `channel_id` can never
 * shadow the coordinate-derived one (D-22, pinned by Test C); and
 * `Object.fromEntries` uses data-property creation (never a bracket-
 * assignment loop, which WOULD set the prototype), so an edition carrying a
 * prototype-setter key cannot alter the result's prototype — a hazard the
 * previous rest-spread never had and this refactor must not introduce.
 */
function foldChannelEdition(parsed: Record<string, unknown>, eid: string): ChannelMetadata | undefined {
  const declaredKeys = Object.keys(CHANNEL_METADATA_FOLD_RULES);
  const passThrough = Object.entries(parsed).filter(
    ([key]) => !CHANNEL_KEY_STRIPPED_FIELDS.includes(key) && !declaredKeys.includes(key),
  );

  const declared: [string, unknown][] = [];
  for (const [key, entry] of Object.entries(CHANNEL_METADATA_FOLD_RULES)) {
    // The only erasure in this function, deliberately contained here:
    // reading a heterogeneous table generically requires one widening step,
    // with the real enforcement living in `ChannelMetadataFoldRules`'s
    // declared type.
    const rule: ChannelFieldRule<unknown> = entry;
    if (rule.disposition === "derived") {
      declared.push([key, eid]);
      continue;
    }
    const raw = parsed[key];
    if (rule.guard(raw)) {
      declared.push([key, raw]);
    } else if (rule.disposition === "required") {
      return undefined;
    }
    // "optional" + guard miss: contribute nothing, keep the channel (D-04's
    // read-side precedent — a validation miss must not become an
    // availability miss).
  }

  return Object.fromEntries([...passThrough, ...declared]) as ChannelMetadata;
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
        // AUTH-03 (hardening): grant.member is untrusted JSON content, so it
        // must be a well-formed xonly hex BEFORE grantLocator is called below —
        // grantLocator → hexToBytes throws (RangeError) on any non-hex or
        // odd-length string, and that throw propagates uncaught out of
        // foldControl, taking down every member's fold. This is the same
        // "fold must be total" defect AUTH-04 guards one clause below, and
        // isHexKey mirrors the eid validation already used above.
        if (!grant.member || !isHexKey(grant.member)) continue;
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
  // What round-trips and why: unrecognized top-level keys on a channel
  // edition survive the fold untouched (WIRE-09/WIRE-10) — D-13 requires
  // folds and editors to preserve fields they do not understand, and CORD-02
  // §6 makes it a MUST, since a future protocol field must not be wiped by a
  // client that predates it.
  //
  // How key material is excluded now: the strip set is DERIVED from
  // `CHANNEL_KEY_FOLD_DISPOSITION` (above), a total classification over every
  // `ChannelKey` field (CHAN-04, D-01, D-22). Adding a field to `ChannelKey`
  // fails the build naming that table, and the non-strip classification is
  // reachable only for names `ChannelMetadata` itself declares — so unlike
  // the denylist this replaces, no future-contributor instruction is needed
  // here: the compiler carries it. `material.channels` remains the sole
  // source of channel key material (D-01), unchanged.
  //
  // How `deleted`/`custom` are validated now, and why: an authorized-but-
  // hostile `MANAGE_CHANNELS` holder publishing a truthy non-`true` `deleted`
  // (e.g. the string `"false"`) used to produce a channel that rendered while
  // three loose-truthiness gates in client/community.ts silently excluded it
  // from sync, live reconciliation and sub-engine spawn (CR-01). Both fields
  // are now guarded by predicates bound to their declared field type
  // (`ChannelFieldGuard<V>`) — a guard asserting the wrong type is a compile
  // error.
  //
  // Deliberate BOUNDARY: `JoinMaterial` is NOT covered by the strip set. Its
  // member names are generic enough that blanket-stripping them from a
  // channel edition would destroy the round-trip property D-13 requires, and
  // no code path in this package ever assigns a `JoinMaterial` member onto a
  // `ChannelMetadata` — that would be whole-object confusion, not field
  // drift. Stating this boundary honestly (rather than claiming coverage
  // that does not exist) is the WR-01 correction.
  //
  // D-15 still holds: `custom` gets no special-casing beyond the type guard
  // every declared field now carries.
  //
  // CHAN-07: deletion is terminal (CORD-03 §2, "the id is never reused") — if
  // ANY authorized candidate for this entity is deleted:true, the channel is
  // permanently dropped AND `heads` is pinned to that deleting edition (not
  // whatever the ordinary version-chain head would be), so a later compaction
  // republishes the terminal state, not a resurrection attempt. Both outputs
  // (`heads.set` and the `channels.push` decision) derive from ONE scan. This
  // scan and its `=== true` test are untouched by the CR-01 fix above: the
  // bug was never here, it was that a non-`true` truthy value survived into
  // the folded object where this scan had already declined to treat it as a
  // deletion.
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

    // Otherwise take the first parseable authorized candidate and fold it
    // through the rule tables above (CR-01/WR-01) — see the CHAN-04/D-01/D-22
    // comment above `channels`.
    for (const cand of authorized) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cand.content);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue;
      const meta = foldChannelEdition(parsed as Record<string, unknown>, eid);
      if (!meta) continue;
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
      // D-14: honor an entry only when the signer strictly outranks the
      // BANNED TARGET's current standing (CORD-04 §3 — equal cannot act on
      // equal; mirrors AUTH-07's Grant target-rank gate above, applied to a
      // different entity). This is additive to the author-BAN-bit check
      // above, not a replacement. The owner (position 0) is unbannable for
      // free since no signer's position can ever be strictly below 0.
      for (const pk of JSON.parse(cand.content) as string[]) {
        if (s.isOwner || s.position < standing(pk).position) banlist.add(pk);
      }
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
