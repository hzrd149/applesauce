# Phase 12: Document & Caps Conformance - Research

**Researched:** 2026-07-29
**Domain:** Nostr wire-document conformance (Concord protocol) — byte/membership caps, unknown-field round-tripping, spec-citation correctness
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md is unusually complete (21 locked decisions, D-01…D-21, plus 5 Claude's-Discretion
items and 3 Deferred Ideas). This research does not re-litigate any of them. Full text lives at
`.planning/phases/12-document-caps-conformance/12-CONTEXT.md`; the load-bearing points are
excerpted below. **Read the full CONTEXT.md before planning — this excerpt omits rationale
paragraphs.**

### Locked Decisions (D-01…D-21)

- **D-01 (governing principle):** Preserve, don't reconstruct — the tiebreaker for every
  otherwise-close call this phase.
- **D-02:** Throw on write for an over-cap `name`/`description` (Error naming actual vs allowed
  bytes), matching `client/client.ts:808-811`'s existing style. No truncation.
- **D-03:** Enforce in the helpers, not at client methods — one shared byte-length check reachable
  from every write path, including `helpers/community.ts:114`'s `createCommunity` (bypasses the
  client) and `client/admin.ts:153-158`'s `editMetadata` merge. *(Discretion: concrete shape.)*
- **D-04:** Read path accepts an over-cap value verbatim — write-side contract only. **Overrides**
  ROADMAP criterion 1's "and defensively on read" clause; `verify-phase` must not re-block on it.
- **D-05:** Caps are **64 bytes** (`name`) / **10000 bytes** (`description`), UTF-8 via
  `TextEncoder`, transcribed from CORD-02 §6.
- **D-06:** 50 counts **live** memberships only (tombstones don't consume budget), enforced at
  `recordJoin` only — refuse local join at 50, tolerate merged overflow from another device
  (mirrors the existing asymmetric byte-cap pattern at `client.ts:795-798`).
- **D-07:** Remove all serialized-byte caps in `packages/concord`: `LIST_MAX_BYTES` (gate at
  `client.ts:1168`), `INVITE_LIST_MAX_BYTES` (gate at `invite-manager.ts:276`),
  `COMMUNITY_LIST_MAX_ENTRY_BYTES` (throw at `client.ts:808`), and
  `INVITE_BUNDLE_MAX_TOTAL_BYTES` at both sites (mint throw `invite-bundle.ts:306`, validator gate
  `invite-bundle.ts:706`). **Overrides** CORD-02 Appendix B's "MUST enforce the cap at every
  layer" — the premise (NIP-44's 65,535 ceiling) no longer exists upstream.
- **D-08:** Keep the diagnostic, drop the refusal — `saveCommunityList` still measures and logs,
  but always publishes.
- **D-09:** Count bounds (`INVITE_BUNDLE_MAX_CHANNELS`=256, `INVITE_BUNDLE_MAX_HELD_ROOTS`=64) stay
  unchanged — independent of the byte caps, and the real fail-closed boundary.
- **D-10:** `INVITE_BUNDLE_MAX_TOTAL_BYTES`'s dependent comments (the `LIST_MAX_BYTES` →
  `COMMUNITY_LIST_MAX_ENTRY_BYTES` → `INVITE_BUNDLE_MAX_TOTAL_BYTES` prose chain) must be
  deleted/rewritten, never left citing a deleted constant.
- **D-11:** Bump `nostr-tools` to `^2.24` in `packages/core`, `packages/common`, `packages/relay`
  (concord has no direct dep, inherits transitively). 2.19.4 (installed) throws below 65535;
  2.24.x lifts the ceiling to 4294967295.
- **D-12:** Model the document root as an **open document** — `parseCommunityList`/
  `parseInviteList` stop returning a closed two-field struct and stop renaming `entries`→
  `communities`/`invites`; mutations become shallow-copy-and-replace; serialization becomes
  `JSON.stringify(doc)`. **Breaking:** `ParsedCommunityList`/`ParsedInviteList` change shape.
  Rejected: a bolted-on `unknown: Record<string,unknown>` carrier field (enumerated patch, not
  structural fix).
- **D-13:** The round-trip rule applies to **three** lossy surfaces, not just the two Lists:
  (1) Community List / Invite List documents, (2) community metadata's `editMetadata`
  `{...current, ...patch}`, (3) the channel-edition fold at `helpers/control.ts:305-312` (keeps
  only `name`/`private`/`deleted`/`custom`, discards other top-level keys). One rule: folds and
  editors preserve what they don't understand. CORD-02 §6 nuance: unknown **top-level** keys are
  reserved-for-protocol forward-compat fields; `custom` is where another client's extension data
  belongs — both must survive, for different reasons.
- **D-14:** `deleteChannel` destructures out `channel_id` and spreads the rest:
  `const { channel_id, ...content } = ch; JSON.stringify({ ...content, deleted: true })`.
  ROADMAP criterion 4's `ch.key`-leak rationale is **obsolete** — `key`/`epoch` no longer exist on
  `ChannelMetadata` (removed as breaking changes earlier in the milestone), so `tsc` is the
  structural guard now, not the destructure shape. `verify-phase` scores on preserved fields +
  absence of key material, not on spread-vs-destructure syntax.
- **D-15:** `custom` is not special-cased once the root is open — it survives as any other
  unrecognized key would.
- **D-16:** Sweep every invalid citation + add a structural guard (accepts named AND numeric
  sections; proves existence, not correctness — stated as a limitation in the guard's comment).
  Full validated inventory (2026-07-29): `CORD-06 §94` (10 sites, invalid — CORD-06 has 3
  sections), `CORD-03 §44` (2 sites, invalid — CORD-03 has 3 sections, not named by the original
  audit), `CORD-01 §Deletions` (3 sites, **valid** — CORD-01 uses named unnumbered sections).
- **D-17:** Registry lives in `packages/concord/src/__tests__/cord-wire-fixtures.ts`. Each of the
  12 replacements is chosen by **reading the actual CORD text at that call site** — never an
  in-range guess or title match. File already records branch `main` (correct, despite D-17's own
  text flagging a possible mismatch with Phase 11's context — verified, no change needed).
- **D-18:** `validateInviteBundle`/`rebuildByRules` is **exempt** from D-01 — untrusted-input
  boundary, the allowlist rebuild is the fail-closed mechanism, not a defect.
- **D-19:** No changeset (concord unreleased) — covers D-12's breaking types and D-07's removed
  exports.
- **D-20:** Namespaced `debug` convention — derive the `Debugger` once, never `.extend()` at a
  call site.
- **D-21 (standing):** TEST-01 anchoring — every cap/document assertion cites transcribed spec
  text or the vendored fixture, never the implementation's own constant. **Trap:** an assertion
  anchoring 65,535 to "the NIP-44 spec value" fails today — NIP-44's value is now 4294967295;
  cite CORD-02, not NIP-44, for any byte-related assertion.

### Claude's Discretion

- D-03's shared byte-length check: standalone helper vs. small module vs. folded into existing
  validation.
- D-12's open-document type shape: index signature vs. `unknown` record with typed accessors vs.
  generic.
- D-16's structural guard: Vitest case vs. lint rule vs. CI script.
- Test-file organization: extend existing suites vs. new document-conformance suite.
- Which specific section each of the 12 citations becomes (governed by D-17's method, not
  pre-assigned).

**This research answers all five discretion items with concrete, codebase-verified
recommendations — see Architecture Patterns and Code Examples below.**

### Deferred Ideas (OUT OF SCOPE)

- The 64-byte cap on Role `name` (CORD-02 §6 confirms it's the same protocol-wide cap; `createRole`
  at `admin.ts:210-219` enforces nothing). D-03's shared helper makes this a near-free follow-up
  but is explicitly not this phase's work.
- A CORD-02-vs-NIP-44 divergence report upstream to concord-protocol/concord.
- A time-windowed `voicePresence$` (unrelated, inherited from Phase 11).
- `05.1-review-followups.md` and `11-verify-followups.md` — reviewed, not folded (unrelated
  defect classes).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-06 | Channel `name` capped at 64 UTF-8 bytes on write (D-04 overrides "and defensively on read") | D-05's cap verified verbatim against CORD-02 §6 live text; exact site `client/admin.ts:181-188` (`createChannel`) confirmed by direct read; D-03 helper location recommended below |
| WIRE-07 | Community `name` (64B) / `description` (10000B) byte caps enforced | Same CORD-02 §6 verbatim text; sites `helpers/community.ts:114-146` (`createCommunity`) and `client/admin.ts:153-158` (`editMetadata`) confirmed; metadata-fold correction below (see Pitfall 2) |
| WIRE-08 | Community List enforces the 50-membership cap alongside the byte cap | CORD-02 §8 verbatim text confirmed ("The List caps at 50 memberships... the cap is a protocol constant, not client taste"); `recordJoin` site and existing `liveCommunities` import confirmed reachable at `client.ts:1066` |
| WIRE-09 | Community List / Invite List round-trip unknown top-level fields | **Critical finding**: the actual lossy write paths are `client.ts`'s `saveCommunityList()` (line 1207) and `invite-manager.ts`'s `save()` (line ~281) — NOT the `operations/*.ts` files CONTEXT.md's D-12 names as illustrative. Full call-site map below (Pitfall 1) |
| WIRE-10 | `deleteChannel` preserves `custom` via explicit destructure, no key-material leak | D-14's pattern verified against current `ChannelMetadata` type (confirmed `key`/`epoch` absent); tension with D-13 item 3's fold-preservation flagged (Pitfall 3) |
| WIRE-12 | Every `CORD-NN §N` citation names a real section | All 12 sites read in context and matched against live CORD-06/CORD-03 text — full replacement table below (Code Examples) |

</phase_requirements>

## Summary

This phase closes six wire-conformance requirements in `applesauce-concord`, all downstream of
one governing principle (D-01: preserve, don't reconstruct). CONTEXT.md already locked 21
decisions with unusual precision; this research fetched the live CORD spec text the repo has no
local copy of, traced every citation site to its actual code context, and — most importantly —
traced WIRE-09's actual runtime write path, which diverges from what CONTEXT.md's D-12 discussion
names.

**The single most important finding:** `operations/community-list.ts:87` and
`operations/invite-list.ts:73` (the two reconstruction sites D-12 names) are **not on
`ConcordClient`'s actual publish path**. `CommunityListFactory`/`modifyCommunityList`/
`InviteListFactory`/`modifyInviteList` have zero call sites anywhere under `client/*.ts` — grep
confirms it. The real, exercised WIRE-09 defect lives in `client/client.ts`'s
`saveCommunityList()` (`JSON.stringify({ entries: list, tombstones })` at line 1207) and
`client/invite-manager.ts`'s `save()` (`JSON.stringify({ entries: this.invites, tombstones })` at
line ~281) — both hand-roll the two-field document directly from the client's own reduced
in-memory arrays, which structurally have no field to carry an unknown top-level key through.
Fixing only `parseCommunityList`/`parseInviteList` (D-12) and the two `operations/*.ts` files,
without also touching `client.ts`/`invite-manager.ts`, would leave WIRE-09 unfixed for every real
`ConcordClient` user. The concord-audit.md source finding (L07) already names `client.ts:762` and
`invite-manager.ts:220` (today's `~1207`/`~281`) as lossy sites — this is not new scope, just
scope CONTEXT.md's decision prose didn't enumerate.

**Primary recommendation:** Fix the open-document shape at the parse layer (D-12, as decided),
then thread a `documentExtras: Record<string, unknown>` (or equivalent) carrier through
`ConcordClient`'s and `ConcordInviteManager`'s own persisted state so `saveCommunityList()`/
`invite-manager.save()` can spread it back in at publish time — the same "preserve, don't
reconstruct" discipline D-12 applies to the helper layer, extended to the two places that
actually publish.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Byte/count cap enforcement (WIRE-06/07/08) | SDK helpers (`packages/concord/src/helpers`) | SDK client (`client/admin.ts`, `client/client.ts`) call sites | D-03 locks "enforce in helpers, not client methods" — the shared check must be reachable from `helpers/community.ts`'s public `createCommunity`, which the client tier cannot gate alone |
| Document round-trip / unknown-field preservation (WIRE-09) | SDK client (`client/client.ts`, `client/invite-manager.ts`) | SDK helpers (`helpers/community-list.ts`, `helpers/invite-list.ts`) parse layer | The parse layer fixes the *type*; the client tier owns the actual publish reconstruction and is where the live defect sits (see Summary) |
| Channel/metadata edition fold (WIRE-09 item 2/3, WIRE-10) | SDK helpers (`helpers/control.ts` fold, `client/admin.ts` publish) | — | Both the read-side fold and the write-side edit/delete live in `packages/concord`; no browser/API split — this SDK has no server tier of its own |
| Spec-citation correctness (WIRE-12) | Source comments (all tiers) | Test infra (`__tests__/cord-wire-fixtures.ts`) | Citations are documentation, not runtime behavior; the guard belongs in test/lint tooling |

*(This SDK has no browser/server/CDN split — `packages/concord` is a protocol library consumed by
host apps. "Tier" above maps to the SDK's own internal layering: helpers vs. client.)*

## Package Legitimacy Audit

Only one dependency changes this phase: `nostr-tools`'s pinned version bump (D-11), already a
direct dependency of `packages/core`/`packages/common`/`packages/relay` — not a new package.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `nostr-tools` | npm | Multi-year (pre-existing dep in this monorepo since before this milestone) | 952,864/wk `[VERIFIED: npm registry]` | `github.com/nbd-wtf/nostr-tools` `[VERIFIED: npm registry]` | `SUS` (automated: "too-new", `[VERIFIED: gsd-tools package-legitimacy]`) | **Approved, verdict overridden** — see note |

**Note on the `SUS` verdict:** The automated check flagged `nostr-tools` as "too-new" based on the
latest version's registry-reported publish timestamp. This is a false positive for this specific
change: `nostr-tools` is not a new dependency being introduced — it is already pinned at
`~2.19`/`^2.19` in three of this monorepo's own packages (`core`, `common`, `relay`) and has been
throughout this milestone. D-11 only bumps the version range. Direct verification (below) confirms
952k weekly downloads and an authoritative GitHub repo (`nbd-wtf/nostr-tools`, the canonical Nostr
protocol reference library). No `checkpoint:human-verify` is warranted for the *package identity*;
however, the planner should still gate the **version bump itself** behind a task that runs the
existing test suite (`pnpm --filter applesauce-concord test`, plus `core`/`common`/`relay`) after
the bump, since D-11 is also an unreviewed dependency-range change in packages other than concord.

**Version verification (direct source inspection, not just registry metadata):**

```
npm view nostr-tools versions --json   # confirms 2.24.1 is latest (2.24.0, 2.24.1 both exist)
```

`[VERIFIED: npm registry]` — 2.24.1 is the latest published version as of this research.

Cross-checked the actual shipped `nip44.js` source across versions via the locally-installed
package (`node_modules/.pnpm/nostr-tools@2.19.4.../lib/cjs/nostr.bundle.js`) and via unpkg's CDN
mirror of the published npm tarball (`unpkg.com/nostr-tools@<version>/lib/esm/nip44.js`) —
`[VERIFIED: npm registry via unpkg CDN + locally-installed package source]`:

| Version | `maxPlaintextSize` | `extendedPrefixThreshold` present? |
|---|---|---|
| 2.19.4 (currently installed) | `65535` | No |
| 2.22.0 | `65535` | No |
| 2.22.1 | `65535` | No |
| 2.23.0 – 2.23.2 | `65535` | No |
| **2.23.4** | `4294967295` | **Yes (`65536`)** |
| 2.23.12 | `4294967295` | Yes (`65536`) |
| 2.24.0 | `4294967295` | Yes (`65536`) |
| 2.24.1 (latest) | `4294967295` | Yes (`65536`) |

**Correction to CONTEXT.md D-11's supporting claim:** D-11's text states "2.24.0 is the first
release with `maxPlaintextSize = 4294967295`." Direct source inspection shows the change actually
landed in **2.23.4** (2.23.3 exists in the registry's version list but was skipped in this
comparison; 2.23.2 still has the old value, 2.23.4 has the new one). This does **not** change the
locked decision — D-11's target (`^2.24`) is still correct and still contains the fix — it only
corrects the historical claim about exactly which release introduced it. No planner action
required beyond not repeating the "2.24.0 is first" claim in any new comment.

**Confirmed causal chain (why the bump must land in `packages/core`, not `packages/concord`):**
`packages/concord` never imports `nostr-tools` directly (`grep` confirms zero matches). A
concord-consuming app's `signer.nip44.encrypt/decrypt` calls resolve through
`packages/signers/src/signers/private-key-signer.ts`, which imports `nip44` from
`applesauce-core/helpers/encryption`, which is `packages/core/src/helpers/encryption.ts:2`'s
`export { nip04, nip44 } from "nostr-tools"` — a direct re-export. So `packages/core`'s
`nostr-tools` pin is the actual runtime-determining version for any `PrivateKeySigner`-based app.
Bumping `common`/`relay` too (as D-11 specifies) keeps the monorepo's pnpm-deduplicated
`node_modules` on one `nostr-tools` instance rather than risking two co-installed majors.
`[VERIFIED: source trace across packages/core, packages/signers, packages/concord]`

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │  CORD-02/05 wire documents (relay-stored)    │
                    │  13302 Community List / 13303 Invite List /  │
                    │  3308 Control editions (metadata, channel)   │
                    └───────────────────┬───────────────────────────┘
                                         │ fetch + decrypt/decode
                                         ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  PARSE LAYER (packages/concord/src/helpers/*.ts)                 │
   │  parseCommunityList / parseInviteList  — D-12: open document,    │
   │  no key rename, [k: string]: unknown carries every top-level key │
   │  foldControl (control.ts) — D-13 item 3: channel/metadata folds  │
   │  preserve unknown top-level keys too, not just custom            │
   └───────────────────────────────┬────────────────────────────────┘
                                    │ getCommunityList()/getInviteList()
                                    │ (memoized via getOrComputeCachedValue)
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  CAST LAYER (packages/concord/src/casts/*.ts)                    │
   │  ConcordCommunityList.communities / ConcordInviteList.invites    │
   │  (public getter NAMES unchanged — only internal .entries access) │
   └───────────────────────────────┬────────────────────────────────┘
                                    │ watchLists() merges into client state
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  CLIENT ENGINE STATE (client/client.ts, client/invite-manager.ts)│
   │  this.list: CommunityListCommunity[]                             │
   │  this.tombstones: CommunityTombstone[]                           │
   │  ⚠ MISSING: no field carries unknown top-level doc keys today —  │
   │  the actual WIRE-09 defect is HERE, not just at the parse layer  │
   │  RECOMMENDED: add this.documentExtras: Record<string, unknown>   │
   └───────────────────────────────┬────────────────────────────────┘
                                    │ saveCommunityList() / save()
                                    │ JSON.stringify({ entries, tombstones })
                                    ▼  ← must become
                                    │  JSON.stringify({ ...extras, entries, tombstones })
                                    ▼
                    ┌───────────────────────────────┐
                    │  publish back to relay (13302/13303)  │
                    └───────────────────────────────┘

   PARALLEL, LOWER-LEVEL PATH (not on ConcordClient's call graph today):
   operations/community-list.ts + factories/community-list.ts
   — D-12 also fixes these (they exist as a standalone factory API,
     used only by their own tests today, grep-confirmed zero call
     sites under client/*.ts)
```

### Recommended file-level changes

```
packages/concord/src/
├── types.ts                    # ChannelMetadata, CommunityMetadata gain [k: string]: unknown
│                                #   (matches CommunityListCommunity's existing convention)
├── helpers/
│   ├── caps.ts                 # NEW — D-03's shared byte-cap helper (see Code Examples)
│   ├── community-list.ts       # D-12 open-doc parse; D-06 50-cap uses liveCommunities (already
│   │                           #   imported in client.ts); D-07 removes LIST_MAX_BYTES gate-only
│   │                           #   (constant itself: see Pitfall 4 — recommend KEEP for diagnostic)
│   ├── invite-list.ts          # D-12 open-doc parse; D-07 removes INVITE_LIST_MAX_BYTES
│   ├── invite-bundle.ts        # D-07 removes INVITE_BUNDLE_MAX_TOTAL_BYTES at both sites;
│   │                           #   D-10 rewrites the dependent-chain comment (lines ~232-243)
│   ├── control.ts               # D-13 item 3: channel + metadata folds preserve unknown
│   │                           #   top-level keys — WITH a denylist for key-material fields
│   │                           #   (see Pitfall 3 — do not blind-spread raw JSON)
│   └── community.ts            # D-03 cap check call site (createCommunity)
├── operations/
│   ├── community-list.ts       # D-12: modifyCommunityList shallow-copies the FULL parsed doc,
│   │                           #   not just {communities, tombstones}
│   └── invite-list.ts          # mirror
├── client/
│   ├── admin.ts                # D-02/D-03 cap checks (createChannel, editMetadata);
│   │                           #   D-14 deleteChannel destructure
│   ├── client.ts               # ⚠ saveCommunityList() (~1207), parseMirror/loadMirror/saveMirror
│   │                           #   (~962-991), recordJoin (~799-815, add 50-cap) — the REAL
│   │                           #   WIRE-09 write-path fix belongs here (see Pitfall 1)
│   └── invite-manager.ts       # ⚠ save() (~281), reconcile() (~294) — same class of fix
└── __tests__/
    └── cord-wire-fixtures.ts   # D-17 registry: 12 citation replacements (see Code Examples)
```

### Pattern 1: The codebase's established "open entry, index signature" convention

**What:** Every per-entry type in the two encrypted lists already declares
`[k: string]: unknown` — `CommunityListCommunity`, `CommunityTombstone`, `InviteListInvite`,
`InviteListTombstone` (all in `types.ts`, confirmed by direct read). This is the established,
working pattern for "preserve what you don't understand" at the entry level; D-12/D-13 extend the
same convention to the **document root** (`ParsedCommunityList`/`ParsedInviteList`) and to
`ChannelMetadata`/`CommunityMetadata` (which currently lack it).

**Recommendation for D-12's discretion item (open-document type shape):** Use an index signature,
matching the established convention exactly — not a `Record<string,unknown>` intersection type or
a generic. This is the codebase's own precedent, not an external pattern:

```typescript
// helpers/community-list.ts — replaces the current closed ParsedCommunityList
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

`getOrComputeCachedValue(event, CommunityListSymbol, () => parseCommunityList(json))` needs no
change — it memoizes whatever `parseCommunityList` returns, and an index-signature object works
identically to the closed struct for this purpose (confirmed: `getOrComputeCachedValue` reads
`WeakMap`/symbol storage, agnostic to the value's shape).

### Pattern 2: The shared byte-cap helper (D-03)

**What:** No existing shared byte-length utility exists in `packages/concord` — `grep` finds eight
independent `new TextEncoder().encode(x).length` call sites, no common helper. `MAX_ROLES` (100,
`helpers/control.ts:28`) is the closest precedent for "an exported cap constant consumed by
multiple call sites," and `invite-bundle.ts:307-309`'s throw message
(`` `invite bundle too large to mint (${bytes} bytes > ${CAP}-byte cap...)` ``) is the closest
precedent for D-02's required message format.

**Recommendation:** A new small module, `helpers/caps.ts`, exporting the two spec-transcribed
constants plus one assert function — reachable from both `helpers/community.ts` (createCommunity)
and `client/admin.ts` (editMetadata, createChannel) without an inverted helpers→client import:

```typescript
// helpers/caps.ts (NEW)
// CORD-02 §6: "The `name` caps at 64 bytes and the `description` at 10000 bytes, counted as
// UTF-8. The 64-byte name cap is uniform across the protocol (Channels and Roles carry the
// same one)." Transcribed literal, not derived — see D-21/D-05.
export const NAME_MAX_BYTES = 64;
export const DESCRIPTION_MAX_BYTES = 10000;

export function assertByteCap(value: string, maxBytes: number, field: string): void {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > maxBytes) throw new Error(`${field} exceeds ${maxBytes}-byte cap (${bytes} bytes)`);
}
```

### Pattern 3: The client-tier "extras" carrier (the finding this research surfaces)

**What:** `ConcordClient` and `ConcordInviteManager` each maintain a *reduced* in-memory
representation (`this.list`/`this.tombstones`, `this.invites`/`this.tombstones`) that has never
had a field for "everything else in the document." D-12 fixes the *parse* layer; it does not by
itself give the client tier anywhere to put a preserved top-level key between read and re-publish.

**Recommendation:**

```typescript
// client/client.ts — sketch, not literal
private documentExtras: Record<string, unknown> = {};

// in watchLists(), after a successful cast read:
const doc = getCommunityList(event); // now ParsedCommunityList (open doc)
if (doc) {
  const { entries, tombstones, ...extras } = doc;
  this.documentExtras = { ...this.documentExtras, ...extras };
  // ... existing merge of entries/tombstones into this.list/this.tombstones
}

// in saveCommunityList():
const plaintext = JSON.stringify({ ...this.documentExtras, entries: list, tombstones });
```

Mirror in `invite-manager.ts`'s `save()`/`reconcile()`. See Pitfall 1 for the full site list this
touches, and Open Questions for the local-mirror (`saveMirror`/`loadMirror`) sub-case.

### Pattern 4: The channel/metadata fold denylist (resolving the D-13/D-14 tension)

See Pitfall 3 below — this is a genuine design tension between two of this phase's own decisions,
not an established pattern. Recommendation included there.

### Anti-Patterns to Avoid

- **Reintroducing a closed root struct** ("the user challenged the premise of the parsed types
  themselves" — CONTEXT.md Specifics). Any plan step that adds a new named field to carry "the
  rest" (e.g., `unknown: Record<string, unknown>`) rather than opening the root itself regresses
  D-12; this was explicitly rejected in CONTEXT.md.
- **Truncating on read or write** for the byte caps (D-02, D-04) — rejected twice in CONTEXT.md
  because a truncated value is indistinguishable from an intentional one and two clients would
  disagree on the truth.
- **Fixing only `operations/*.ts`** for WIRE-09 and calling it done — see Summary/Pitfall 1. The
  factory/operations layer is real, tested code, but it is not what `ConcordClient` calls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTF-8 byte length | A `.length`-based check or a manual byte-counting loop | `new TextEncoder().encode(x).length` | Already the established idiom (8 sites); `.length` is UTF-16 code units and undercounts multi-byte characters — exactly the M17 audit finding this phase closes |
| Section-citation validation | A hand-maintained list of "known good" citations checked ad hoc | A structural guard reading the vendored `cord-wire-fixtures.ts` registry (or a small parsed section-list per CORD doc) against every `CORD-NN §X` grep hit in `src/` | D-16 requires this to be systematic (a test/lint/CI check), not a one-time sweep that immediately rots |
| Open-document typing | A bespoke `Record<string, unknown>` wrapper type per document | The codebase's own `[k: string]: unknown` index-signature convention (already used 4×) | Consistency; a new pattern here would be the third distinct way "open object" is expressed in this package |

**Key insight:** Every "don't hand-roll" item above already has a working precedent inside
`packages/concord` itself — this phase is about applying an existing convention consistently, not
importing a new one.

## Common Pitfalls

### Pitfall 1: Fixing the parse layer without fixing the client publish layer (WIRE-09's real scope)

**What goes wrong:** A plan that implements D-12 exactly as CONTEXT.md's decision text names it
(`parseCommunityList`/`parseInviteList` + `operations/community-list.ts:87` +
`operations/invite-list.ts:73`) passes every test written against those files but leaves the
actual `ConcordClient`/`ConcordInviteManager` publish path — which never calls
`CommunityListFactory`/`InviteListFactory`/`modifyCommunityList`/`modifyInviteList` at all
(zero call sites under `client/*.ts`, grep-confirmed) — exactly as lossy as before.

**Why it happens:** CONTEXT.md's D-12 text cites the operations files as "the reconstruction
lines that cause L07," which is true of those files, but the concord-audit.md source finding L07
itself lists **five** site groups, including `client.ts:762` and `invite-manager.ts:220`
(current: `client.ts:1207`, `invite-manager.ts:~281`) — sites CONTEXT.md's decision prose doesn't
individually enumerate.

**How to avoid:** Treat the client-tier hand-rolled `JSON.stringify({entries, tombstones})` calls
at `client.ts:1207` (`saveCommunityList`) and `invite-manager.ts:~281` (`save()`) as in-scope
WIRE-09 sites, not optional follow-up. Apply Pattern 3's `documentExtras` carrier (or equivalent).

**Warning signs:** A round-trip test that unlocks/mutates/re-publishes via the `EventFactory`
chain (`CommunityListFactory.modify(event).join(...)`) will pass even if `ConcordClient` itself
is still lossy — because it never exercises `ConcordClient` at all. A genuine regression test for
this requirement must drive `ConcordClient.recordJoin`/`.leave`/`saveCommunityList` (or the
equivalent invite-manager methods) end-to-end, not just the factory layer.

### Pitfall 2: The community-metadata fold is already correct — don't "fix" what isn't broken

**What goes wrong:** CONTEXT.md's D-13 item 2 describes `editMetadata`'s `current` as "com[ing]
from a narrow fold," implying the metadata fold (unlike the channel fold) discards unknown
top-level keys the same way. Direct read of `helpers/control.ts:239-250` shows this is **not**
narrow: `metadata = JSON.parse(cand.content) as CommunityMetadata` is a **blind cast**, not an
explicit-field-pick like the channel fold at lines 296-316. A TypeScript `as` cast never strips
runtime properties — so `metadata` (and therefore `editMetadata`'s `current`, and therefore
`next = {...current, ...patch}`) already carries every key present in the edition JSON, known or
not, at the value level today.

**Why it happens:** The channel fold (lines 296-316, CHAN-04's explicit-field-picking pattern)
and the metadata fold (lines 239-250, a blind cast) look similar in the surrounding comments but
are structurally different — one narrows, one doesn't. CONTEXT.md's D-13 text applies one
characterization to both.

**How to avoid:** Verify with a regression test (satisfies TEST-01/D-21) that `editMetadata`
already round-trips an unknown top-level key — expect it to pass with **zero source changes** to
the fold or to `editMetadata` itself. The only genuine metadata-path work this phase needs is the
byte-cap enforcement (WIRE-07, D-02/D-03/D-05), which is orthogonal to the round-trip question.
Do not spend a task "fixing" the metadata fold's preservation — spend it proving preservation
already holds, and add the missing validation (no type/shape guard exists on `metadata` at all
today, unlike the channel fold's `typeof raw.name !== "string"` guard — a lower-priority,
out-of-decision-scope quality gap worth flagging but not fixing here).

**Warning signs:** If a plan step touches `control.ts`'s metadata fold (lines 239-250) for
anything other than adding cap enforcement, confirm it's not solving an already-solved problem.

### Pitfall 3: The D-13/D-14 tension — spreading raw JSON into the channel fold can reopen the key-material leak D-14 says is closed

**What goes wrong:** D-13 item 3 requires the channel-edition fold (`control.ts:296-316`) to
preserve unknown top-level keys, not just `name`/`private`/`deleted`/`custom`. D-14's own
rationale for accepting a plain `{...content}` spread in `deleteChannel` rests on "`ChannelMetadata`
no longer carries key material... `tsc` is the structural guard." But `tsc` only prevents *our
own code* from reading a `.key` property the type doesn't declare — it does nothing to stop a
hostile or stale edition's raw JSON from *containing* a `key` field. If the channel fold is
changed to blind-spread `raw` (the parsed JSON) into `ChannelMetadata` to satisfy D-13 item 3, a
malicious `MANAGE_CHANNELS` holder's edition with a `key: "..."` field would now survive the fold
at the **value** level (invisible to `tsc`, present in the object), and would then round-trip back
out through `deleteChannel`'s D-14 spread — silently reintroducing exactly the class of leak
CHAN-04/D-14 close today via explicit field-picking.

**Why it happens:** D-13 (preserve unknown top-level keys) and CHAN-04's established pattern
(never blind-cast edition JSON, pick fields explicitly with type validation) point in opposite
implementation directions for the *same* fold, and neither CONTEXT.md decision anticipated the
collision.

**How to avoid:** Preserve unknown keys via a **denylist-then-spread**, not a blind spread —
explicitly exclude any field name the type deliberately removed as key material (`key`, `epoch`)
even while spreading everything else through:

```typescript
// helpers/control.ts — sketch of the corrected channel fold
const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = raw;
if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
```

This keeps CHAN-04's guarantee (key material never survives the fold as a live, spreadable
property) while satisfying D-13 item 3 (any *other* unknown top-level key survives). Flag this
denylist explicitly in a code comment citing both requirements, since a future reader adding a
new sensitive field to `ChannelKey`/`JoinMaterial` needs to know to extend the denylist.

**Warning signs:** A test that publishes a hostile edition with an extra `key` field and asserts
it does NOT survive into `ChannelMetadata` (this is the correct behavior) failing after a D-13
item-3 change — this is the exact regression to write a test for.

### Pitfall 4: `LIST_MAX_BYTES`'s diagnostic message can't say "X/LIST_MAX_BYTES bytes" if the constant is deleted

**What goes wrong:** D-07 says "Remove... `LIST_MAX_BYTES` and its gate at `client.ts:1168`." D-08
says `saveCommunityList` "still emits its existing rich message (bytes, entry count, tombstone
bytes, largest entry)... but publishes regardless." The **current** message text is:
`` `community list exceeds the NIP-44 byte cap (${serializedBytes}/${LIST_MAX_BYTES} bytes, ...)` ``
— if `LIST_MAX_BYTES` the constant is fully deleted, this exact message can no longer be
constructed (there's no cap to divide by, and "exceeds the cap" is false once there's no cap).

**How to avoid:** Read D-07 and D-08 together as: the **gate** (the `if` that returns early
without publishing) is removed; whether the **constant** `LIST_MAX_BYTES` itself survives as a
diagnostic reference value is an implementation detail D-08 leaves open. Recommend: reword the
message to drop the "exceeds cap" framing entirely (`` `community list size: ${serializedBytes}
bytes, ${list.length} entries, ${tombstoneBytes} tombstone bytes${largestEntryClause}` ``, always
logged at the debug level, no "not publishing" clause since it always publishes) — this makes the
message correct regardless of whether `LIST_MAX_BYTES` the symbol still exists. If the planner
wants to keep a size *reference point* in the message for operator context, keep the literal
`65_535` inline with a comment explaining it's informational only (the historical NIP-44 ceiling,
now lifted), not an enforced cap — do not silently leave `LIST_MAX_BYTES` as a live exported
symbol that a future reader might mistake for still-enforced.

**Same issue applies** to `INVITE_BUNDLE_MAX_TOTAL_BYTES` — D-07 removes it "at both its sites"
(mint throw + validator gate), which most likely means the constant declaration itself
(`invite-bundle.ts:244`) goes too, unlike `LIST_MAX_BYTES` (which D-08 explicitly keeps a
diagnostic role for). **This is an open point for the planner to resolve explicitly per
constant** — see Open Questions.

### Pitfall 5: Tests that assert the cap-chain relationship will fail after D-07/D-10, not just tests that assert the cap value

**What goes wrong:** `helpers/__tests__/invite-bundle-schema.test.ts` has a dedicated test (lines
280-289) titled "the cap chain is arithmetically closed: 2x the bundle total-bytes cap fits the
per-entry ceiling, and 2x that ceiling fits `LIST_MAX_BYTES`" that imports and asserts against all
three soon-to-be-removed constants. `helpers/__tests__/community-list.test.ts` (lines 116-130) has
a `describe` block titled with `COMMUNITY_LIST_MAX_ENTRY_BYTES (12.3-13)` asserting "at cap" /
"over cap" behavior. `client/__tests__/client.test.ts` (line 2212, 2281) computes padding to hit
`COMMUNITY_LIST_MAX_ENTRY_BYTES`/`LIST_MAX_BYTES` exactly. `helpers/__tests__/invite-bundle.test.ts`
(line 586) does the same for `INVITE_BUNDLE_MAX_TOTAL_BYTES`.

**How to avoid:** These aren't simple deletions — several (`client.test.ts`'s over-cap-throw test,
`invite-bundle.test.ts`'s mint-throw test) currently assert a **throw**, and per D-08 the new
correct behavior is "measures and logs but does not throw." These need rewriting into
"does-not-throw, logs diagnostic" tests, not removal, to keep coverage of D-08's behavior.

## Code Examples

### The 12 citation replacements (D-17), verified against live CORD text

Every row below was independently confirmed by (1) reading the actual code at that file:line and
(2) matching its stated subject against the live CORD-06/CORD-03 text fetched from
`github.com/concord-protocol/concord@main`. All 10 `CORD-06 §94` sites resolve to the same real
section — every one is about a Refounding bundling a channel-scoped rekey, sealed under the prior
root (CORD-06 §3's exact subject). Both `CORD-03 §44` sites resolve to CORD-03 §3 (Messages) —
both are the `checkChatBinding` anti-replay drop, which is CORD-03 §3's binding-check MUST
("Concord Channels make CORD-01's binding a requirement... a receiver MUST check both
strict-equal... dropping a mismatch").

| File:Line | Current (invalid) | Actual subject (verified in code) | Correct citation |
|---|---|---|---|
| `client/channel-sync.ts:88` | `CORD-06 §94` | "rekey blobs sealed under the current root and each held root" — Refounding-bundled channel rekey read | **CORD-06 §3** |
| `client/private-channel.ts:233` | `CORD-06 §94` | "a Refounding may bundle a channel Rekey sealed under the prior root" | **CORD-06 §3** |
| `client/community.ts:985` | `CORD-06 §94` | `adoptRefounding` — "a Refounding may bundle a channel Rekey sealed under the prior root" | **CORD-06 §3** |
| `client/community.ts:1448` | `CORD-06 §94` | `refound()`'s `channelRekeys` option — per-channel keep lists for bundled rekeys | **CORD-06 §3** |
| `client/community.ts:1483` | `CORD-06 §94` | `refound()` — "Bundle a channel Rekey ONLY for the explicitly-named private channels" | **CORD-06 §3** |
| `helpers/keys.ts:308` | `CORD-06 §94` | `RefoundingPlan.channelRekeyWraps` — "sealed under the PRIOR root" | **CORD-06 §3** |
| `helpers/keys.ts:341` | `CORD-06 §94` | `buildRefounding`'s `channelRekeys` option (two lines below an already-correct `CORD-06 §3` citation on the function's own doc comment) | **CORD-06 §3** |
| `helpers/keys.ts:379` | `CORD-06 §94` | `buildRefounding` step "1b. Channel rekeys" | **CORD-06 §3** |
| `helpers/keys.ts:643` | `CORD-06 §94` | `ChannelKeys.nextRekey` — "a Refounding-bundled channel rekey is sealed under the PRIOR root" | **CORD-06 §3** |
| `helpers/keys.ts:697` | `CORD-06 §94` | `buildChannelRekey`'s `priorRoot` param — "so the blob is openable on either base fork" | **CORD-06 §3** |
| `client/private-channel.ts:312` | `CORD-03 §44` | `route()` — `checkChatBinding` drop on channel/epoch mismatch | **CORD-03 §3** |
| `client/community.ts:680` | `CORD-03 §44` | `route()` — `checkChatBinding` drop, "anti-replay" | **CORD-03 §3** |

`CORD-01 §Deletions` (3 sites: `operations/gift-wrap.ts:45`, `__tests__/cord-wire-fixtures.ts:68`,
`helpers/__tests__/keys.test.ts:89`) — **valid, no change**. Confirmed: CORD-01's "Deletions"
section (verbatim) reads "Users delete their content in a stream by sending giftwrapped kind 5
deletion events to it. They can also delete their own giftwraps by `p` tag (on NIP-59-supporting
relays) if the client saved the ephemeral key" — exactly matches the comment's subject
(`ephemeralSk` for self-deleting a giftwrap by `p` tag).

**Section registries** (for the D-16 structural guard), verified against the live repo's actual
`##`/`###` headers:

```
CORD-01: named, unnumbered — Stream Event, Encrypted vs plaintext seals, Encoding, Binding,
         Deletions, Removing Participants
CORD-02: §1 Identity, §2 Access, §3 Epochs, §4 Addressing, §5 Planes, §6 Metadata, §7 Invites,
         §8 The Community List, §9 Dissolution, Appendix A (A.1–A.6), Appendix B
CORD-03: §1 Keying, §2 Metadata, §3 Messages
CORD-04: §1 Editions, §2 The Roster, §3 Permissions and Position, §4 The Banlist,
         §5 Authorizing an Action, §6 The Three Removals
CORD-05: §1 The Bundle, §2 The Link, §3 The Relay Dictionary, §4 The Invite List, §5 The Registry,
         §6 Direct Invites
CORD-06: §1 Rekey Blobs - The 3303 event, §2 Receiving & Processing Rekeys, §3 Refounding
CORD-07: §1 Voice Keys, §2 The Broker, §3 Media Encryption, §4 Presence, §5 Rendezvous,
         §6 Video and Screenshare, §7 Moderation
```

`[VERIFIED: github.com/concord-protocol/concord@main, direct raw-file fetch]` — this exactly
matches D-17's own transcribed table in CONTEXT.md; independently re-derived here from the live
repo, not copied from CONTEXT.md.

### Verbatim CORD-02 §6 / §8 text (for spec-anchored test literals, D-21)

```
§6 Metadata:
"The `name` caps at 64 bytes and the `description` at 10000 bytes, counted as UTF-8. The 64-byte
name cap is uniform across the protocol (Channels and Roles carry the same one)."

"An editor MUST round-trip fields it doesn't understand (editing the name never wipes another
client's rules)... Top-level fields outside `custom` are reserved for the protocol. The same
object is permitted on ChannelMetadata (CORD-03)."

§8 The Community List:
"The List caps at 50 memberships: it is one NIP-44 event, and NIP-44 plaintext hard-caps at
65,535 bytes, so the cap is a protocol constant, not client taste. The count is not the whole
budget — join material carrying private-channel keys can overflow the event well below 50 — so a
client MUST verify the serialized List fits before publishing. The round-trip discipline applies
here too (§6): preserve what you don't understand."

Appendix B:
"Every layer of the nesting is a NIP-44 plaintext, and NIP-44 hard-caps plaintext at 65,535 bytes:
implementations MUST enforce the cap at every layer themselves (libraries are lenient, and a
lenient publisher mints events a strict reader cannot decrypt)."
```

`[VERIFIED: github.com/concord-protocol/concord@main/02.md, direct raw-file fetch]` — matches
CONTEXT.md D-05/D-06/D-07's citations verbatim; independently confirmed against the live file, not
merely trusted from CONTEXT.md.

```
CORD-03 §2 Metadata:
"A Channel is defined by a ChannelMetadata entity in the Control Plane (CORD-04), holding its
channel_id, name, and private flag... A Channel is deleted by an edition setting "deleted": true.
Deletion is terminal: the id is never reused, clients drop the Channel from display and may
discard its keys."

CORD-05 §4 The Invite List:
"Two copies merge without coordination: the token is the merge key, an entry is immutable once
minted, tombstones union, and a tombstone always beats an entry — terminally... Because two
clients can share this one document, the round-trip discipline applies (CORD-02 §6): preserve
what you don't understand."
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| NIP-44 `max_plaintext_size = 65535` | NIP-44 `max_plaintext_size = 4294967295`, `extended_prefix_threshold = 65536` (u16→u32 length-prefix switch) | Landed in `nostr-tools` 2.23.4 (not 2.24.0 as CONTEXT.md's D-11 states — see Package Legitimacy Audit correction) | CORD-02 Appendix B's "MUST enforce the cap at every layer" and §8's 50-membership derivation both reason from the old 65,535 ceiling, which no longer exists upstream — the entire rationale for this phase's cap-removal decisions (D-07/D-08/D-09) |
| `packages/core`/`common`/`relay` pinned `~2.19`/`^2.19` | Bump to `^2.24` (D-11) | This phase | Any code relying on the OLD 65535 throw behavior (e.g., a test asserting `nip44.encrypt` throws at 65536 bytes) will need updating |

**Deprecated/outdated:** The prose chain `LIST_MAX_BYTES` → `COMMUNITY_LIST_MAX_ENTRY_BYTES` →
`INVITE_BUNDLE_MAX_TOTAL_BYTES` documented at `community-list.ts:196-205` and
`invite-bundle.ts:236-243` becomes false once D-07 lands (D-10).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `documentExtras`-style client-tier carrier is the right shape for closing the client.ts/invite-manager.ts gap (vs. e.g. restructuring `this.list`/`this.tombstones` into a single open-document field) | Pattern 3 | Low — this is a design recommendation, not a locked decision; the planner/discuss-phase should confirm the shape before implementation, but the underlying requirement (client tier must preserve unknown top-level keys through save) is verified, not assumed |
| A2 | The metadata fold's blind-cast preservation (Pitfall 2) has no other narrowing step between fold and publish that I haven't traced | Pitfall 2 | Medium — verified the fold→`CommunityState.metadata`→`editMetadata`'s `current` chain directly, but did not exhaustively trace every consumer of `CommunityState.metadata` across the whole client tier; a plan step should still include a regression test proving this, not just skip the fix on faith |
| A3 | The denylist-then-spread pattern (Pitfall 3) is the correct resolution to the D-13/D-14 tension, rather than e.g. leaving the channel fold's explicit-pick-only behavior unchanged and accepting WIRE-09 item 3 as only partially closed for channels | Pitfall 3 | Medium — this is a genuine open design question CONTEXT.md didn't anticipate; flagged explicitly in Open Questions for discuss-phase/planner judgment, not silently resolved |

## Open Questions

1. **Does `INVITE_BUNDLE_MAX_TOTAL_BYTES` the constant get deleted, or only its two enforcement
   sites?**
   - What we know: D-07 lists it among constants to "remove," at "both its sites" (mint throw,
     validator gate). D-08's "keep the diagnostic" treatment is stated only for
     `LIST_MAX_BYTES`/`saveCommunityList`, not extended to invite bundles.
   - What's unclear: whether the invite-bundle mint path should also gain a diagnostic-without-
     refusal treatment (mirroring D-08), or whether it goes fully silent (measurement removed
     entirely, not just the throw).
   - Recommendation: Treat `INVITE_BUNDLE_MAX_TOTAL_BYTES` as fully removed (constant + both call
     sites), consistent with D-09's framing that only the two count-bound constants
     (`INVITE_BUNDLE_MAX_CHANNELS`/`INVITE_BUNDLE_MAX_HELD_ROOTS`) "stay unchanged" — implying
     everything else byte-oriented in that file is going away. If the planner wants a diagnostic
     parity with `LIST_MAX_BYTES`, that should be an explicit, separately-justified addition, not
     assumed.

2. **Should the local community-list mirror (`saveMirror`/`loadMirror`/`parseMirror`,
   `client.ts:~962-991`) also carry `documentExtras`, or is the relay-fetched copy sufficient?**
   - What we know: The mirror is client-local disk persistence, re-synced against the relay copy
     on every `watchLists()` emission. `parseMirror`'s legacy-format branch already constructs a
     closed `{communities, tombstones}` shape independent of `parseCommunityList`'s return type.
   - What's unclear: whether an entirely-offline client (never having fetched the relay copy this
     session) that publishes from mirror-only state would silently drop unknown top-level fields
     it never saw, and whether that scenario is realistic enough to justify carrying extras
     through mirror storage too.
   - Recommendation: Lower priority than the relay-copy fix (Pitfall 1); note it in the plan as a
     smaller follow-up task rather than blocking the phase, since the primary WIRE-09 guarantee is
     about the published wire document, and any client publishing must have unlocked/read *some*
     copy of the list at least once in its lifetime to have a signer capable of publishing at all.

3. **Does the CORD-03 §2 comment "name ≤ 64 bytes, the protocol-wide cap (CORD-04)" (in the spec's
   own example JSON comment) indicate the cap should also be cited as CORD-04 somewhere in
   concord's code, or is this a spec-authoring inconsistency to ignore?**
   - What we know: CORD-02 §6 is unambiguous that IT defines the 64-byte cap ("uniform across the
     protocol"). CORD-03 §2's inline comment cites CORD-04 instead, which is about Roles/
     Permissions, not the cap itself.
   - What's unclear: whether this is deliberate (CORD-04 also documents the cap somewhere this
     research didn't check) or a spec typo.
   - Recommendation: Cite CORD-02 §6 for all cap-related code comments in this phase (matching
     D-05's locked citation) and ignore CORD-03 §2's CORD-04 cross-reference — it does not affect
     any of this phase's 12 citation-replacement sites (none of them are about the byte cap
     itself).

## Environment Availability

Not applicable — this phase is entirely internal code changes to an already-installed monorepo
package plus a version-range bump of an already-present dependency (`nostr-tools`). No new
external services, CLIs, or runtimes are introduced. `npm view`/registry access was available and
used during this research session; the actual `pnpm install` + bump should be verified to succeed
in the execution environment, but no fallback is needed since the dependency already resolves
today at a lower version.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.15 (`packages/concord/package.json`) |
| Config file | none dedicated — root/package defaults (`vitest run --passWithNoTests`) |
| Quick run command | `pnpm --filter applesauce-concord test -- <pattern>` |
| Full suite command | `pnpm --filter applesauce-concord test` (also run `core`/`common`/`relay` after the D-11 bump) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-06 | Channel name >64 UTF-8 bytes throws on write, multi-byte string exercised | unit | `vitest run helpers/__tests__/community.test.ts` or new admin test | ✅ extend `client/__tests__/*.test.ts` (admin methods have no dedicated test file today — confirm during planning) |
| WIRE-07 | Community name/description cap enforcement + metadata round-trip proof (Pitfall 2) | unit | `vitest run helpers/__tests__/community.test.ts` | ✅ extend |
| WIRE-08 | 50-membership cap, live-only counting, asymmetric local-refuse/merge-tolerate | unit | `vitest run client/__tests__/client.test.ts` | ✅ extend (mirrors existing `COMMUNITY_LIST_MAX_ENTRY_BYTES` test block) |
| WIRE-09 | Open-document round-trip through `ConcordClient`'s ACTUAL publish path (Pitfall 1) — not just the factory layer | integration | `vitest run client/__tests__/client.test.ts` + `client/__tests__/invite-watcher.test.ts` or a new suite | ❌ Wave 0 — no existing test drives `saveCommunityList`/`invite-manager.save()` with an unknown top-level field present |
| WIRE-10 | `deleteChannel` preserves unknown fields, never leaks key material (Pitfall 3's denylist test) | unit | `vitest run client/__tests__/community.test.ts` (admin tests likely live here or a sibling) | ❌ Wave 0 — the hostile-`key`-field regression test does not exist |
| WIRE-12 | Structural citation guard (D-16) | unit/lint | `vitest run __tests__/` (new file) or a script in `package.json`'s `test` chain | ❌ Wave 0 — no citation-validation mechanism exists at all today |

### Sampling Rate

- **Per task commit:** targeted `vitest run <changed-file's test>`
- **Per wave merge:** `pnpm --filter applesauce-concord test` (full suite; also re-run `core`/
  `common`/`relay` suites after D-11's bump lands)
- **Phase gate:** Full suite green before `/gsd-verify-work`, including the D-11-bumped packages

### Wave 0 Gaps

- [ ] A cross-cutting document-conformance test file (recommended: new
      `packages/concord/src/__tests__/document-caps-conformance.test.ts`, sibling to
      `cord-wire-fixtures.ts`) for the two client-tier round-trip proofs (WIRE-09 via
      `ConcordClient`, not the factory layer) and the D-16 structural guard — these don't have a
      natural home in any existing per-file suite (resolves the "test file organization"
      discretion item: **hybrid** — narrow unit assertions extend existing suites per-file, the
      two cross-cutting proofs get one new suite)
- [ ] `admin.ts`'s methods (`createChannel`, `editMetadata`, `deleteChannel`) currently have no
      dedicated test file — confirm during planning which existing file (`client.test.ts`,
      `community.test.ts`, or a new `admin.test.ts`) is the intended home before adding cap tests
- [ ] The hostile-edition-with-`key`-field regression test (Pitfall 3) — proves the channel fold's
      denylist actually excludes key material even while preserving other unknowns
- [ ] Multi-byte UTF-8 test string construction (D-21): use a string where `.length` (UTF-16 code
      units) diverges from UTF-8 byte length — e.g. a string built from a 4-byte UTF-8 astral
      character (`"𝔘"`, U+1D518, 4 bytes UTF-8 but 2 UTF-16 code units) repeated enough times to
      land exactly at/over the 64 or 10000 byte boundary; assert `.length !== byteLength(str)` as
      a guard within the test itself so the test would fail loudly if the fixture string were ever
      accidentally simplified to ASCII

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched this phase |
| V3 Session Management | No | Not touched this phase |
| V4 Access Control | No | Fold authority (BAN/MANAGE_CHANNELS/MANAGE_METADATA gates) unchanged this phase — resolved in Phase 9 |
| V5 Input Validation | **Yes** | Byte-length checks (`TextEncoder`-based, D-05); the channel-fold denylist (Pitfall 3) is itself an input-validation control against a hostile edition's JSON |
| V6 Cryptography | No | No crypto derivation changes this phase (byte caps/round-tripping only) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `MANAGE_CHANNELS`/`MANAGE_METADATA` holder embeds an oversized `name`/`description` to grief storage/UI | Denial of Service | D-02's throw-on-write cap (write-side only per D-04 — a malicious peer's over-cap value is still accepted verbatim on read, by design, to avoid the channel-availability regression D-04's rationale describes) |
| Malicious edition JSON reintroduces a `key`/`epoch` field the type no longer declares, hoping it round-trips through an unknown-field-preserving fold | Information Disclosure / Tampering | Pitfall 3's denylist-then-spread pattern — explicit exclusion of key-material field names even while preserving genuine unknowns |
| A second client sharing one npub silently wipes fields the first client wrote, causing state loss (not directly an attacker, but a data-integrity failure with the same shape as tampering) | Tampering (self-inflicted) | D-01/D-12/D-13's whole preserve-don't-reconstruct discipline — this phase's core purpose |

## Sources

### Primary (HIGH confidence)

- `github.com/concord-protocol/concord@main` — `02.md`, `03.md`, `05.md`, `06.md`, `01.md`
  fetched via direct `curl` to `raw.githubusercontent.com` and read verbatim with the Read tool
  (not summarized) — §6/§8/Appendix B of CORD-02, §2/§3 of CORD-03, §4 of CORD-05, all three
  sections of CORD-06, and CORD-01's "Deletions" section. `[VERIFIED: github raw file fetch]`
- `npm view nostr-tools versions --json` and direct source inspection of
  `unpkg.com/nostr-tools@<version>/lib/esm/nip44.js` across 8 versions (2.19.4, 2.22.0, 2.22.1,
  2.23.0–2.23.2, 2.23.4, 2.23.12, 2.24.0, 2.24.1), cross-checked against the locally-installed
  `node_modules/.pnpm/nostr-tools@2.19.4.../nip44.js`. `[VERIFIED: npm registry + unpkg CDN + local install]`
- `packages/concord/src/**/*.ts` — every cited file:line was read directly (Read tool), not
  grepped-and-assumed: `helpers/community-list.ts`, `helpers/invite-list.ts`,
  `operations/community-list.ts`, `operations/invite-list.ts`, `factories/community-list.ts`,
  `factories/invite-list.ts`, `casts/community-list.ts`, `casts/invite-list.ts`,
  `client/client.ts`, `client/invite-manager.ts`, `client/admin.ts`, `helpers/control.ts`,
  `helpers/community.ts`, `helpers/keys.ts`, `helpers/invite-bundle.ts`,
  `client/private-channel.ts`, `client/community.ts`, `client/channel-sync.ts`,
  `operations/gift-wrap.ts`, `types.ts`, `__tests__/cord-wire-fixtures.ts`, plus all
  `package.json` files for `core`/`common`/`relay`/`concord`/`signers`. `[VERIFIED: direct file read]`
- `.planning/concord-audit.md` — M12, M17, L02, L07, L09, L11 findings read directly, confirming
  and extending CONTEXT.md's site enumeration (notably: L07's own site list already names
  `client.ts:762`/`invite-manager.ts:220`, validating Pitfall 1's finding as pre-existing audit
  scope, not new scope this research invented). `[VERIFIED: direct file read]`

### Secondary (MEDIUM confidence)

- WebFetch summarization of `02.md`/`03.md` was used as a first pass, then independently
  cross-checked against the raw curl'd files read directly — all WebFetch summaries matched the
  verbatim source on cross-check, no discrepancies found.

### Tertiary (LOW confidence)

- None — every load-bearing claim in this document was either read directly from source (code or
  spec) or explicitly marked `[ASSUMED]`/flagged in the Assumptions Log / Open Questions.

## Metadata

**Confidence breakdown:**
- Standard stack (nostr-tools version behavior): HIGH — direct source-code diff across 8 published
  versions, cross-checked against the locally-installed package
- Architecture (open-document pattern, client-tier gap): HIGH — the codebase's own established
  `[k: string]: unknown` convention plus a verified call-graph trace (grep for zero factory/
  operations call sites under `client/*.ts`) supports the Pattern 3 recommendation directly
- Citation replacements (D-17's 12 sites): HIGH — every site read in code context and matched
  against live-fetched CORD-06/CORD-03 text, not inferred
- Pitfalls 2/3 (metadata fold correctness, key-material denylist tension): MEDIUM — verified by
  direct code trace but not exhaustively tested at runtime during this research session; flagged
  in Assumptions Log for planner/discuss-phase confirmation

**Research date:** 2026-07-29
**Valid until:** 30 days (stable internal SDK code + a spec repo with low churn; re-verify the
CORD spec fetch and nostr-tools version table if this research is reused after that window)
