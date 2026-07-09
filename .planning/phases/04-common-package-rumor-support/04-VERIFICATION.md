---
phase: 04-common-package-rumor-support
verified: 2026-07-09T05:54:24Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 4: Common Package Rumor Support Verification Report

**Phase Goal:** Carry the genericization into `applesauce-common` — helpers and casts (plus their models/factories where needed) — so they operate over rumors while default signed-`NostrEvent` behavior is untouched.
**Verified:** 2026-07-09T05:54:24Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `getNip10References`, `getReactionEmoji`, `getHashtagTag`, `getContentWarning` each accept a generic `E` while defaulting to `NostrEvent` (COMMON-01) | ✓ VERIFIED | Read all four source files: `threading.ts` → `getNip10References<E extends { tags: string[][] } = NostrEvent>(event: E)`; `emoji.ts` → `getReactionEmoji<E extends StoreEvent = NostrEvent>(event: E)`; `hashtag.ts` → `getHashtagTag<E extends { tags: string[][] } = NostrEvent>(event: E, hashtag: string)`; `content.ts` → `getContentWarning<E extends { tags: string[][] } = NostrEvent>(event: E)`. Runtime spot-check (below) confirms all four operate correctly on unsigned rumor-shaped objects, not just at the type level. |
| 2 | `getNip10References` and `getHashtagTag` still accept an `EventTemplate`-shaped argument (narrow tag-only bound preserves the pre-existing union callers) | ✓ VERIFIED | Both use the narrow `{ tags: string[][] }` inline bound (not `StoreEvent`), which is structurally satisfied by any `EventTemplate`-shaped object. `grep -c "EventTemplate"` on both files returns 0 (import correctly removed since the union collapsed into a generic param), and `pnpm --filter applesauce-common build` type-checks clean, confirming no caller regression. |
| 3 | COMMON-02 targeted-cast set is audited empty this phase and documented in `04-COMMON-02-AUDIT.md` — no `applesauce-common` cast references or requires a rumor | ✓ VERIFIED | `04-COMMON-02-AUDIT.md` exists with the empty-set finding, supporting evidence (concord's `ConcordDirectInvite` bypasses common casts via core's `EventCast` directly; actions' `wrapped-messages.ts` uses `castUser` on a pubkey string, not an event; wallet has zero `Rumor` references), and the COMMON-F1/F2 deferral rationale. `grep -rln "Rumor" packages/common/src/casts` returns empty (confirmed independently). `git diff` across the full phase commit range touches zero files under `packages/common/src/casts/`, `models/`, or `factories/` — confirms no cast/model/factory was changed, which is the correct outcome per the task instructions (empty targeted-cast set is not a phase failure). |
| 4 | Existing `applesauce-common` tests pass and all four export snapshots are byte-for-byte unchanged (COMMON-03) | ✓ VERIFIED | `pnpm --filter applesauce-common test` run independently: 62 test files, 500 tests, all passed. `git log` on the four `exports.test.ts` files shows no commits since long before this phase (last touch predates phase-04 entirely) — snapshots are untouched, not merely "passing." |
| 5 | Full-workspace `pnpm run build` exits 0 — the downstream-inference gate from Phases 1-3 | ✓ VERIFIED | `pnpm run build` run independently from repo root: exit code 0, turbo reports "18 successful, 18 total" across all packages including `applesauce-common`, `applesauce-content`, `applesauce-concord`, `applesauce-actions`, `applesauce-wallet`, `applesauce-react`. No errors/failures in build log. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/common/src/helpers/threading.ts` | `getNip10References` genericized, `EventTemplate` import removed | ✓ VERIFIED | Signature matches exactly; body untouched (confirmed via `git diff` — only the signature line and one import line changed) |
| `packages/common/src/helpers/emoji.ts` | `getReactionEmoji` genericized over `StoreEvent`, `StoreEvent` import added | ✓ VERIFIED | Signature matches exactly; `import { NostrEvent, StoreEvent } from "applesauce-core/helpers/event"` present |
| `packages/common/src/helpers/hashtag.ts` | `getHashtagTag` genericized, `EventTemplate` import removed | ✓ VERIFIED | Signature matches exactly |
| `packages/common/src/helpers/content.ts` | `getContentWarning` genericized | ✓ VERIFIED | Signature matches exactly |
| `.changeset/genericize-common-helpers.md` | Minor bump, single-sentence body | ✓ VERIFIED | `"applesauce-common": minor` frontmatter, single-sentence markdown body, no bullets/code |
| `.planning/phases/04-common-package-rumor-support/04-COMMON-02-AUDIT.md` | Empty targeted-cast audit note | ✓ VERIFIED | Present, states finding + evidence + conclusion + re-runnable grep command |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Each genericized helper | Existing `NostrEvent` callers | `= NostrEvent` default | ✓ WIRED | Default preserves inference at every existing call site; `pnpm run build` full-workspace exit 0 proves no downstream inference drift in `applesauce-content`/`applesauce-concord`/etc. |
| `applesauce-common` build | Full workspace build | `pnpm run build` (turbo) | ✓ WIRED | 18/18 tasks successful, full turbo, exit 0 |
| Genericized helpers | Rumor-shaped (unsigned) objects | Structural typing at runtime | ✓ WIRED | Runtime spot-check (below) — all four helpers correctly process a plain `{tags, content}` object with no `id`/`pubkey`/`sig` |
| Four `exports.test.ts` files | Published API surface | Inline snapshot assertions | ✓ WIRED | `git log` confirms zero commits to any of the four export-test files during this phase; test run confirms all pass |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `getContentWarning` operates on unsigned rumor-shaped object | `getContentWarning({tags:[['content-warning','nsfw']], content:'...'})` (via built `dist/helpers/content.js`) | `'nsfw'` | ✓ PASS |
| `getHashtagTag` operates on unsigned rumor-shaped object | `getHashtagTag({tags:[['t','nostr']], ...}, 'nostr')` | `['t','nostr']` | ✓ PASS |
| `getNip10References` operates on unsigned rumor-shaped object | `getNip10References({tags:[...], ...})` | `{}` (no thread tags present, no throw) | ✓ PASS |
| `getReactionEmoji` operates on unsigned rumor-shaped object | `getReactionEmoji({tags:[...], content:':shortcode:'})` | `undefined` (no matching emoji tag, no throw) | ✓ PASS |
| Package-level test suite | `pnpm --filter applesauce-common test` | 62 files / 500 tests passed | ✓ PASS |
| Package-level build | `pnpm --filter applesauce-common build` | tsc exits 0 | ✓ PASS |
| Full-workspace build | `pnpm run build` | 18/18 tasks successful, exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| COMMON-01 | 04-01-PLAN.md | `applesauce-common` helpers that use only structural fields accept `E extends StoreEvent` | ✓ SATISFIED | Four helper signatures genericized; runtime spot-check confirms structural typing works, not just type erasure |
| COMMON-02 | 04-01-PLAN.md | `applesauce-common` casts (plus models/factories where needed) operate over rumors while keeping `NostrEvent` defaults | ✓ SATISFIED | Audited and documented as an empty targeted-cast set — no current consumer applies a common cast to a rumor (concord and actions both bypass common casts for their rumor use cases). Per explicit task framing, this is the correct outcome, not a gap: zero cast files changed means `NostrEvent` defaults on existing casts (already generic via core's Phase 2/3 `EventCast<E extends StoreEvent = NostrEvent>`) are trivially preserved. |
| COMMON-03 | 04-01-PLAN.md | Default signed-`NostrEvent` behavior in `applesauce-common` is unchanged | ✓ SATISFIED | 500/500 tests pass; all four export/helper snapshot test files untouched since before the phase; full workspace build green |

**Orphaned requirements check:** `REQUIREMENTS.md` traceability table maps 16/16 v1 requirements to phases with 0 unmapped. All three phase-4 requirement IDs (COMMON-01, COMMON-02, COMMON-03) appear in both the PLAN frontmatter `requirements:` field and REQUIREMENTS.md — no orphans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found in the 4 modified files (`grep` for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` returns no matches) | — | — |

**Pre-existing issue (not a Phase 4 gap):** `packages/common/src/helpers/hashtag.ts:9` casts `event.tags.find(...)` as `["t", string]`, hiding a possible `undefined` (code-review WR-01). Confirmed via `git diff` that this cast line is untouched by this phase — only the function signature (the `<E>` genericization) was modified. Documented in `deferred-items.md` with correct rationale (fixing the public return type is a breaking API change out of this phase's zero-behavior-change scope). Two informational findings (IN-01, IN-02) are also pre-existing and require no action, per `04-REVIEW.md`.

### Human Verification Required

None. All must-haves resolved programmatically via source inspection, independent test/build execution, and runtime spot-checks.

### Gaps Summary

None. All 5 derived must-have truths verified, all 6 required artifacts present/substantive/wired, all 4 key links verified, all 3 phase-4 requirement IDs satisfied with zero orphans against REQUIREMENTS.md, zero anti-pattern blockers introduced by this phase, and both the package-level and full-workspace builds/tests pass when run independently (not merely trusted from SUMMARY.md). The one pre-existing code-review warning (WR-01) is correctly out of scope for this phase's zero-behavior-change charter and is tracked in `deferred-items.md` for future remediation.

This is the final phase of milestone v1.0 (event-store-supports-rumors). REQUIREMENTS.md shows all 16 v1 requirements (CORE-01..07, RUMOR-01..06, COMMON-01..03) marked complete with 0 unmapped.

---

_Verified: 2026-07-09T05:54:24Z_
_Verifier: Claude (gsd-verifier)_
