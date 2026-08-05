# Phase 12: Document & Caps Conformance - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 13 source files + 3 package.json (D-11) + 1 new test file
**Analogs found:** 13 / 14 (all but the D-22 denylist fold have a direct in-repo analog; that one is explicitly "no analog" per the task brief, with its immediate predecessor quoted instead)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `helpers/caps.ts` (NEW) | utility | transform (validation) | `helpers/control.ts` (`MAX_ROLES`) + `helpers/invite-bundle.ts` (`INVITE_BUNDLE_MAX_CHANNELS`, throw idiom) | role-match (constant+validator convention) |
| `helpers/control.ts` (channel fold, ~296-316) | transform/fold | event-driven (fold) | itself (predecessor fold — no denylist analog exists) | self / no analog |
| `helpers/control.ts` (metadata fold, ~239-250) | transform/fold | event-driven (fold) | N/A — D-24: prove via test, no source change | no source change |
| `helpers/community.ts` (`createCommunity`) | service/model constructor | CRUD (create) | itself, extended with `assertByteCap` calls | exact (extend in place) |
| `helpers/community-list.ts` (`parseCommunityList`/`ParsedCommunityList`) | model/parser | transform (open-document parse) | `types.ts`'s `CommunityListCommunity`/`CommunityTombstone` index-signature convention | exact (structural precedent, different file) |
| `helpers/invite-list.ts` (`parseInviteList`/`ParsedInviteList`) | model/parser | transform (open-document parse) | `helpers/community-list.ts`'s `parseCommunityList` (near-identical mirror) | exact |
| `helpers/invite-bundle.ts` (constant removal + comment) | model/constant | transform | `helpers/community-list.ts:194-205` (the dependent-chain comment being rewritten) | exact (same D-10 rewrite pattern) |
| `operations/community-list.ts` (`modifyCommunityList`) | service (event operation) | CRUD (mutate+serialize) | itself, simplified per D-12 | exact (self, discretion changes shape) |
| `operations/invite-list.ts` | service (event operation) | CRUD (mutate+serialize) | `operations/community-list.ts` (mirror) | exact |
| `client/client.ts` (`saveCommunityList`, `recordJoin`) | controller/service (client engine) | request-response + CRUD | itself; `recordJoin`'s existing byte-ceiling throw is the D-06 count-cap analog | exact (extend in place) |
| `client/invite-manager.ts` (`save`, `reconcile`) | service (client engine) | CRUD | `client/client.ts`'s `saveCommunityList`/list-fingerprint pattern (near-identical mirror) | exact |
| `client/admin.ts` (`createChannel`, `editMetadata`, `deleteChannel`) | controller (admin API) | CRUD (edition publish) | itself; `deleteRole`'s `{ ...current, deleted: true }` spread (line ~245) is the closest existing "preserve+terminal-flag" idiom | exact (extend in place) |
| 6 files, 12 citation sites | doc-comment | n/a (documentation) | `__tests__/cord-wire-fixtures.ts`'s already-valid `CORD-01 §Deletions` citation and `CORD_EXAMPLES_SOURCE`/`CORD_EXAMPLES_CAVEAT` registry | exact |
| `__tests__/document-caps-conformance.test.ts` (NEW) | test | request-response (integration) | `__tests__/cord-wire-fixtures.ts` (registry/fixture style) + `client/__tests__/client.test.ts`'s existing `COMMUNITY_LIST_MAX_ENTRY_BYTES` describe block (Pitfall 5) | role-match |
| `packages/core/package.json`, `packages/common/package.json`, `packages/relay/package.json` | config | n/a (dependency bump) | each other (identical `nostr-tools` version-range edit, three files) | exact |

## Pattern Assignments

### `helpers/caps.ts` (NEW utility, transform)

**Analog 1 — exported cap constant convention:** `helpers/control.ts:24-28`
```typescript
/** Concord control-plane edition kind (CORD-04). */
export const CONTROL_KIND = 3308;

/** A Community folds only the 100 lowest `role_id`s, ignoring the rest (CORD-04 §2). */
export const MAX_ROLES = 100;
```

**Analog 2 — throw-message idiom (D-02 must match this):** `helpers/invite-bundle.ts:306-309`
```typescript
if (bytes > INVITE_BUNDLE_MAX_TOTAL_BYTES)
  throw new Error(
    `invite bundle too large to mint (${bytes} bytes > ${INVITE_BUNDLE_MAX_TOTAL_BYTES}-byte cap, ${channels.length} channel(s))`,
  );
```
Also `client/client.ts:808-811` (cited directly by D-02):
```typescript
const entryBytes = communityListEntryByteSize(prospective);
if (entryBytes > COMMUNITY_LIST_MAX_ENTRY_BYTES)
  throw new Error(
    `community list entry too large to record (${entryBytes} bytes > ${COMMUNITY_LIST_MAX_ENTRY_BYTES}-byte per-entry ceiling)`,
  );
```
Shape: `<subject> too large|exceeds <n>-byte cap (<actual> bytes > <cap>-byte cap, ...)`. Apply the same "actual op cap" ordering for `name`/`description` throws.

**Byte-length idiom (used ~8 places, e.g. `helpers/community-list.ts:171-177,187-191`, `helpers/invite-list.ts:87-89`):**
```typescript
new TextEncoder().encode(JSON.stringify(entry)).length
```
Never `.length` on the raw string — that's UTF-16 code units, not bytes.

**Reachability constraint (D-03):** `helpers/community.ts` imports nothing from `client/*`; `client/admin.ts` already imports from `helpers/*` (e.g. `import { CONTROL_KIND } from "../helpers/control.js"`, `admin.ts:30`). Placing the shared assert in `helpers/caps.ts` keeps the import direction helpers→(none), client→helpers, matching every existing cross-file import in this package.

---

### `helpers/community-list.ts` — D-12 open document (`ParsedCommunityList`)

**Structural analog for "open document root" — the codebase's existing open-entry convention.** Read from `types.ts`, entries like `CommunityListCommunity` already declare an index signature so unknown per-entry keys survive:
```bash
grep -n "k: string\]: unknown" types.ts
```
This is the precedent D-12 extends to the document root — same shape, one level up. (types.ts wasn't re-read in full since the convention is well-established and cited in RESEARCH.md Pattern 1 — confirm the exact interface text during planning if the literal excerpt is needed for a plan step.)

**Current (closed) shape to replace**, `helpers/community-list.ts:220-235`:
```typescript
export interface ParsedCommunityList {
  communities: CommunityListCommunity[];
  tombstones: CommunityTombstone[];
}

export function parseCommunityList(json: string | undefined): ParsedCommunityList {
  if (!json) return { communities: [], tombstones: [] };
  const doc = JSON.parse(json) as { entries?: CommunityListCommunity[]; tombstones?: CommunityTombstone[] };
  return { communities: doc.entries ?? [], tombstones: doc.tombstones ?? [] };
}
```
D-12 target shape (per RESEARCH.md Pattern 1 — index signature, no rename):
```typescript
export interface ParsedCommunityList {
  entries: CommunityListCommunity[];
  tombstones: CommunityTombstone[];
  [k: string]: unknown;
}

export function parseCommunityList(json: string | undefined): ParsedCommunityList {
  if (!json) return { entries: [], tombstones: [] };
  const doc = JSON.parse(json) as ParsedCommunityList;
  return { ...doc, entries: doc.entries ?? [], tombstones: doc.tombstones ?? [] };
}
```

**Memoization pattern — unchanged, quote for reference (`helpers/community-list.ts:243-247`):**
```typescript
export function getCommunityList(event: NostrEvent): ParsedCommunityList | undefined {
  const json = getHiddenContent(event);
  if (json === undefined) return undefined;
  return getOrComputeCachedValue(event, CommunityListSymbol, () => parseCommunityList(json));
}
```
`getOrComputeCachedValue(event, Symbol, () => ...)` is agnostic to the return shape — no change needed here, only to what `parseCommunityList` returns.

**Every downstream consumer that reads `.communities` must become `.entries`** — grep before editing: `getLiveCommunities` (`community-list.ts:250-253`), and any `client/*.ts` call site. `helpers/invite-list.ts` mirrors identically (`.invites` stays as the field name per the open-doc shape — but note D-12's text says drop the RENAME, i.e. the wire key `entries` stays `entries` in the parsed type too, matching community-list's `entries`/`tombstones`; invite-list's field is currently named `invites`, its own rename of the wire's `entries` — apply the same fix, drop that rename too).

**`LIST_MAX_BYTES`'s dependent-chain comment to rewrite (D-10), current text at `helpers/community-list.ts:194-205`:**
```typescript
/**
 * Per-entry serialized-size ceiling (CR-01's structural half), derived
 * arithmetically as half of {@link LIST_MAX_BYTES} rather than a copied
 * literal: an entry serializes its material TWICE (`seed` and `current`), so
 * no single membership may occupy more than half the document — otherwise two
 * ordinary joins alone could exceed the whole-document cap. This is also the
 * ceiling `INVITE_BUNDLE_MAX_TOTAL_BYTES` (`invite-bundle.ts`) is sized
 * against: twice that cap fits inside this one, with headroom left for the
 * entry's envelope (`community_id`/`added_at`) and the organic growth a later
 * Refounding adds to `current` via `held_roots`.
 */
export const COMMUNITY_LIST_MAX_ENTRY_BYTES = Math.floor(LIST_MAX_BYTES / 2);
```
D-07 removes `COMMUNITY_LIST_MAX_ENTRY_BYTES` and its throw entirely (per D-07's explicit list) — so this whole block is deleted, not merely reworded. `LIST_MAX_BYTES` itself (line 86, `export const LIST_MAX_BYTES = 65_535;`) survives per D-08 as a diagnostic-only reference (see `client/client.ts` pattern below), but its own doc comment ("The NIP-44 plaintext cap the serialized list must fit under") should be reworded since it's no longer an enforced cap.

---

### `helpers/invite-list.ts` — mirror of the above

Same open-document treatment. `INVITE_LIST_MAX_BYTES` (line 34) and its gate consumer (`inviteListWithinByteCap`, lines 86-90) are removed per D-07 — `client/invite-manager.ts`'s `save()` gate at line ~276 (`if (!inviteListWithinByteCap(...))`) is the call site to delete, mirroring `client.ts:1168`'s `LIST_MAX_BYTES` gate.

---

### `helpers/control.ts` — channel fold (D-13 item 3 / D-22 denylist)

**No existing denylist-then-spread analog in this codebase** — confirmed, this is a genuinely new shape. The task brief's fallback applies: quote the current explicit-field-pick fold this replaces so the executor sees the exact diff.

**Current (explicit-pick, to be replaced), `helpers/control.ts:294-316`:**
```typescript
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
    ...(raw.custom !== null && typeof raw.custom === "object" ? { custom: raw.custom as Record<string, unknown> } : {}),
  };
  heads.set(eid, cand.source);
  channels.push(meta);
  break;
}
```
D-22's target shape (CONTEXT.md, verbatim):
```typescript
const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = raw;
if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
```
Note the surrounding comment block (`helpers/control.ts:253-261`, the "CHAN-04: fields are picked explicitly..." header above the channel fold) must be updated too — it currently states the never-blind-spread rule this change modifies to denylist-then-spread; leaving the old comment verbatim after the code changes would misdescribe the new fold. Cite both D-13 and CHAN-04 in the new denylist comment per the D-22 instruction.

**Metadata fold — do NOT touch (D-24), current state confirmed at `helpers/control.ts:239-250`:**
```typescript
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
```
This is a blind cast (`as CommunityMetadata`), already preserving every runtime key — zero source change here per D-24. Only a regression test is needed.

---

### `client/admin.ts` — caps + `deleteChannel` (D-02/D-03/D-14)

**`createChannel`, current state, `admin.ts:181-188`:**
```typescript
async createChannel(name: string, options: CreateChannelOptions = {}): Promise<string> {
  const isPrivate = options.private ?? false;
  const channelId = bytesToHex(generateSecretKey());
  if (isPrivate) this.opts.mintChannelKey(channelId, name);
  const content: Record<string, unknown> = { name, private: isPrivate };
  await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify(content));
  return channelId;
}
```
Add `assertByteCap(name, NAME_MAX_BYTES, "channel name")` before building `content`.

**`editMetadata`, current state, `admin.ts:153-158`:**
```typescript
async editMetadata(patch: Partial<CommunityMetadata>): Promise<void> {
  const material = this.material;
  const current = this.opts.state().metadata ?? { name: material.name, relays: material.relays };
  const next: CommunityMetadata = { ...current, ...patch };
  await this.publishEdition(VSK.METADATA, material.community_id, JSON.stringify(next));
}
```
D-03 requires capping `next.name`/`next.description` (not just `patch`'s fields) since the merge can re-publish a pre-existing over-cap `name` even when the patch only touches `icon` — assert against `next`, after the merge, before `publishEdition`.

**`deleteChannel`, current state (already matches D-14's target), `admin.ts:190-198`:**
```typescript
async deleteChannel(channelId: string): Promise<void> {
  const ch = this.opts.state().channels.find((c) => c.channel_id === channelId);
  if (!ch) return;
  await this.publishEdition(
    VSK.CHANNEL,
    channelId,
    JSON.stringify({ name: ch.name, private: ch.private, deleted: true }),
  );
}
```
D-14 target — destructure out `channel_id`, spread the rest, so any unknown field the D-22 fold now preserves also survives deletion:
```typescript
const { channel_id, ...content } = ch;
await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify({ ...content, deleted: true }));
```
**Closest existing "preserve+terminal-flag" idiom in this same file** (for reviewer confidence this shape is already house style) — `deleteRole`, `admin.ts:242-246`:
```typescript
async deleteRole(roleId: string): Promise<void> {
  const current = this.opts.state().roles.find((r) => r.role_id === roleId);
  if (!current) return;
  await this.publishEdition(VSK.ROLE, roleId, JSON.stringify({ ...current, deleted: true }));
}
```

---

### `client/client.ts` — `recordJoin` (D-06), `saveCommunityList` (D-08/D-25/D-23)

**`recordJoin`'s existing asymmetric ceiling — the direct analog for the new 50-membership cap, `client/client.ts:799-815`:**
```typescript
private recordJoin(material: JoinMaterial): ConcordCommunity {
  const addedAt = Date.now();
  const prospective: CommunityListCommunity = {
    community_id: material.community_id,
    seed: material,
    current: material,
    added_at: addedAt,
  };
  const entryBytes = communityListEntryByteSize(prospective);
  if (entryBytes > COMMUNITY_LIST_MAX_ENTRY_BYTES)
    throw new Error(
      `community list entry too large to record (${entryBytes} bytes > ${COMMUNITY_LIST_MAX_ENTRY_BYTES}-byte per-entry ceiling)`,
    );
  const community = this.addCommunity(material);
  this.list = joinCommunity(prospective)(this.list, this.tombstones).communities;
  return community;
}
```
The byte-ceiling throw here is deleted per D-07; a new 50-live-membership throw is added in its place, using `liveCommunities(this.list, this.tombstones).length` (already imported, per RESEARCH.md's confirmed reachability at `client.ts:1066`) — count BEFORE adding the prospective entry, throw when it would be the 51st live membership. Keep the same throw-message shape (`community list ... (${count} ... > 50 ...)`).

**`saveCommunityList`'s diagnostic-without-gate rewrite target (D-08/D-25), current full state, `client/client.ts:1144-1201`+:**
```typescript
async saveCommunityList(): Promise<void> {
  if (!this.signer.nip44) return;
  try {
    const list = this.list;
    const tombstones = this.tombstones;
    const fingerprint = canonicalJson({ entries: list, tombstones });
    if (fingerprint === this.publishedListFingerprint) {
      this.clearCommunityListDirty();
      return;
    }
    const serializedBytes = communityListByteSize(list, tombstones);
    if (serializedBytes > LIST_MAX_BYTES) {
      let largestEntryId = "";
      let largestEntryBytes = -1;
      for (const entry of list) {
        const entryBytes = communityListEntryByteSize(entry);
        if (entryBytes > largestEntryBytes) {
          largestEntryBytes = entryBytes;
          largestEntryId = entry.community_id;
        }
      }
      const tombstoneBytes = new TextEncoder().encode(JSON.stringify(tombstones)).length;
      const largestEntryClause =
        list.length === 0 ? "" : ` — largest entry community=${largestEntryId.slice(0, 8)} (${largestEntryBytes} bytes)`;
      const message = `community list exceeds the NIP-44 byte cap (${serializedBytes}/${LIST_MAX_BYTES} bytes, ${list.length} entries, ${tombstoneBytes} tombstone bytes); not publishing${largestEntryClause}`;
      this.publishLog(message);
      console.warn(message);
      return;
    }
    // ... continues to actual encrypt/sign/publish below
```
D-08/D-25 target: remove the `if (serializedBytes > LIST_MAX_BYTES) { ...; return; }` early-return entirely (the `return` is the "refusal" being dropped), but keep computing `serializedBytes`/`largestEntryId`/`tombstoneBytes` and log them unconditionally via `this.publishLog` right before the actual publish, with the message reworded to drop "exceeds the NIP-44 byte cap" / "not publishing" framing — e.g. `` `community list size: ${serializedBytes} bytes, ${list.length} entries, ${tombstoneBytes} tombstone bytes${largestEntryClause}` `` (RESEARCH.md Pitfall 4's exact recommended wording). `LIST_MAX_BYTES` (the constant) stays as an exported symbol per D-08, consumed here only for the diagnostic, never for a gate.

**`this.publishLog` — the D-20 debug convention, already correctly applied here.** Derived once in the constructor (`client/client.ts:~313`, `this.publishLog = this.log.extend("publish")`), never `.extend()`'d at a call site. New diagnostic/log statements this phase adds must reuse `this.publishLog` (or `this.log`/`this.inviteLog` in `invite-manager.ts`, same pattern), never construct a new `.extend()` inline.

**D-23's client-tier unknown-root carrier — the actual WIRE-09 fix site.** RESEARCH.md's Pattern 3 sketch (not yet in source, this is the plan target):
```typescript
private documentExtras: Record<string, unknown> = {};

// in watchLists(), after a successful cast read:
const doc = getCommunityList(event); // now ParsedCommunityList (open doc)
if (doc) {
  const { entries, tombstones, ...extras } = doc;
  this.documentExtras = { ...this.documentExtras, ...extras };
}

// in saveCommunityList(), replacing the plain {entries, tombstones} JSON.stringify:
const plaintext = JSON.stringify({ ...this.documentExtras, entries: list, tombstones });
```
Apply identically in `client/invite-manager.ts`'s `save()`/`reconcile()` (its own `this.invites`/`this.tombstones` fields, mirroring `client.ts`'s `this.list`/`this.tombstones`).

---

### `operations/community-list.ts` — D-12 rebuild removal

**Current lossy rebuild, `operations/community-list.ts:71-90`:**
```typescript
export function modifyCommunityList(apply: CommunityListOperation, signer?: EventSigner): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required to encrypt the community list");
    let json = getHiddenContent(draft);
    if (json === undefined && draft.content) {
      const { decrypt } = getHiddenContentEncryptionMethods(draft.kind, signer);
      json = await decrypt(await signer.getPublicKey(), draft.content);
    }
    const { communities, tombstones } = parseCommunityList(json);
    const next = apply(communities, tombstones);
    // The wire document keys the array as `entries` (armada-compatible).
    const document = JSON.stringify({ entries: next.communities, tombstones: next.tombstones });
    return setHiddenContent(document, signer)(draft);
  };
}
```
D-12 target — parse the full open doc, shallow-copy-and-replace only `entries`/`tombstones`, serialize the whole doc:
```typescript
const doc = parseCommunityList(json); // now { entries, tombstones, [k: string]: unknown }
const next = apply(doc.entries, doc.tombstones);
const document = JSON.stringify({ ...doc, entries: next.communities, tombstones: next.tombstones });
```
`CommunityListOperation`'s own signature (`(communities, tombstones) => {communities, tombstones}`, lines 26-29) is unaffected — it's still array-in/array-out per D-12's note that "`mergeCommunities`... take arrays... and are unaffected." `operations/invite-list.ts:73` mirrors this identically.

---

### 6 files, 12 citation sites (D-16/D-17)

**Registry file to extend:** `packages/concord/src/__tests__/cord-wire-fixtures.ts`. Its existing structure (already read in full):
```typescript
export const CORD_EXAMPLES_SOURCE = {
  repo: "github.com/concord-protocol/concord",
  branch: "main",
  file: "examples.md",
};

export const CORD_EXAMPLES_CAVEAT =
  "Non-normative — if an example here disagrees with a CORD, the CORD wins.";
```
This registry is for `examples.md` wire fixtures (kind/content/tags), not spec-section names — D-16's guard needs a **new**, separate section registry (RESEARCH.md's "Section registries" table, verbatim CORD-01…07 section lists) added to this same file, structured similarly to `CordWireExample`'s typed-const style. Recommended shape, following the file's own convention of typed consts + a matching validator function (mirrors `substituteFixtureTags`/`missingFixtureTags`'s existing pattern at lines 125-165):
```typescript
export const CORD_SECTIONS: Record<string, readonly string[]> = {
  "CORD-01": ["Stream Event", "Encoding", "Binding", "Deletions", "Removing Participants"],
  "CORD-02": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Appendix A", "Appendix B"],
  // ... CORD-03 through CORD-07 per RESEARCH.md's table
};
```
The guard test itself (Vitest, per RESEARCH.md's discretion resolution) greps `src/` for `CORD-\d\d §\S+` and asserts each matched section is a member of `CORD_SECTIONS[doc]`.

**Direct replacement sites — quote current (invalid) text before editing, e.g. `client/private-channel.ts:233`:**
```typescript
//  root (CORD-06 §94). Called by {@link ConcordCommunity} on adopt. */
```
→ `CORD-06 §3`. Full 12-site table with old→new mapping is in RESEARCH.md's "Code Examples" section (already verified against live spec) — reuse it verbatim rather than re-deriving.

---

### `nostr-tools` bump (D-11) — `packages/core`, `packages/common`, `packages/relay` `package.json`

Config edit, identical pattern in all three files — a version-range bump `~2.19`/`^2.19` → `^2.24`. No code excerpt needed; each file's existing `"nostr-tools": "..."` line is the target.

---

### `__tests__/document-caps-conformance.test.ts` (NEW)

**Analog for structure/registry style:** `__tests__/cord-wire-fixtures.ts` (typed consts + pure validator functions, no test bodies itself — consumed by suites elsewhere).

**Analog for an existing byte-cap describe block to extend/replace (Pitfall 5), `helpers/__tests__/community-list.test.ts:116-130`** — not read in full this pass (out of the file list this phase directly modifies for source, but its test block titled `COMMUNITY_LIST_MAX_ENTRY_BYTES (12.3-13)` needs rewriting from "asserts throw" to "asserts no throw, diagnostic logged" per D-08). Locate by symbol during planning, do not trust the line number.

**D-21's multi-byte UTF-8 test-string trap** — RESEARCH.md's Wave-0-gap recommendation, use directly:
```typescript
// 4-byte UTF-8 astral char (U+1D518), 2 UTF-16 code units — .length undercounts.
const oversizedName = "𝔘".repeat(20); // 80 bytes UTF-8, 40 UTF-16 units
expect(oversizedName.length).not.toBe(new TextEncoder().encode(oversizedName).length);
```

## Shared Patterns

### Byte-length measurement
**Source:** `helpers/community-list.ts:171-177` (`communityListByteSize`), `helpers/invite-list.ts:87-89`
**Apply to:** every cap check and every diagnostic in this phase (`helpers/caps.ts`, `client/client.ts` saveCommunityList diagnostic, `admin.ts` cap checks)
```typescript
new TextEncoder().encode(JSON.stringify(x)).length
```
Never `.length` on a raw string (UTF-16 code units, not bytes) — this is the exact class of bug WIRE-06/07 close (M17).

### Throw-message idiom (D-02)
**Source:** `client/client.ts:808-811`, `helpers/invite-bundle.ts:306-309`
**Apply to:** `helpers/caps.ts`'s `assertByteCap`, and the new `recordJoin` 50-cap throw
```typescript
throw new Error(`${subject} exceeds ${maxBytes}-byte cap (${actualBytes} bytes)`);
```

### Namespaced debug logger (D-20)
**Source:** `client/client.ts:~313` (`this.publishLog = this.log.extend("publish")`, derived once in constructor)
**Apply to:** any new diagnostic logging in `saveCommunityList`, `invite-manager.ts`'s `save()` — reuse the existing `this.publishLog`/`this.log` field, never `.extend()` inline at a call site.

### Open-entry index-signature convention
**Source:** `types.ts`'s `CommunityListCommunity`/`CommunityTombstone`/`InviteListInvite`/`InviteListTombstone` (all already carry `[k: string]: unknown`, per RESEARCH.md Pattern 1, confirmed by direct read during research)
**Apply to:** `ParsedCommunityList`/`ParsedInviteList` (D-12) — same index-signature shape, applied one level up (the document root instead of each entry).

### Preserve+terminal-flag spread idiom
**Source:** `client/admin.ts:242-246` (`deleteRole`: `JSON.stringify({ ...current, deleted: true })`)
**Apply to:** `deleteChannel` (D-14) — already the exact target shape modulo the `channel_id` destructure.

## No Analog Found

| File/Change | Role | Data Flow | Reason |
|---|---|---|---|
| `helpers/control.ts` channel fold denylist-then-spread (D-22) | transform/fold | event-driven | Genuinely new shape in this codebase — no other fold combines "destructure out named sensitive fields" with "spread the rest." Quoted its direct predecessor (explicit-field-pick) above instead, per task instruction. Watch for the CHAN-04 comment block above it needing a matching rewrite. |
| `client.ts`'s `documentExtras` carrier (D-23) | model field (client engine state) | CRUD | No existing "accumulate unknown top-level keys across engine lifetime, replay on save" field exists anywhere in `client/*.ts` — this is RESEARCH.md's own recommendation (Pattern 3, its Assumption A1), not a codebase precedent. Sketch quoted above is the best available guide. |

## Metadata

**Analog search scope:** `packages/concord/src/{helpers,client,operations,types.ts,__tests__}`, plus `packages/{core,common,relay}/package.json`
**Files scanned:** 13 source files fully or by targeted range read; 3 package.json referenced by name only (trivial config edits)
**Pattern extraction date:** 2026-07-30
