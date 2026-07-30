---
phase: 12-document-caps-conformance
verified: 2026-07-30T17:00:00Z
status: gaps_found
score: 6/7 must-haves verified
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "A channel name is capped at 64 bytes on write and defensively on read (ROADMAP success criterion 1)."
    reason: "D-04 (12-CONTEXT.md, locked 2026-07-29): the read path deliberately accepts an over-cap name/description verbatim. helpers/control.ts's channel fold has exactly one rejection idiom (`continue`), and applying it to an over-cap name would convert a caps bug into a channel-availability bug, since the fold is the sole source of channel state. Truncating on read was also rejected — it makes two clients disagree about a channel's name. Same override precedent as Phase 11's D-09. Verified: `helpers/caps.ts`'s header comment states this override in the source itself, and no read-side guard exists in `helpers/control.ts` — matching the locked decision exactly."
    accepted_by: "user (12-discuss-phase, recorded as D-04 in 12-CONTEXT.md)"
    accepted_at: "2026-07-29T00:00:00Z"
  - must_have: "A deleteChannel edition preserves custom via an explicit destructure while still excluding client-only key material — never a naive spread, which would leak ch.key (ROADMAP success criterion 4, original rationale)."
    reason: "D-14 (12-CONTEXT.md, locked 2026-07-29): ChannelMetadata no longer carries key/epoch (removed earlier in the milestone as accepted breaking changes), so `ch.key` cannot exist and `tsc` rejects any code that reads it — the leak criterion 4 warns about is structurally impossible via this client's own code today. The implemented destructure (`const { channel_id, ...rest } = ch`) still satisfies the criterion's letter (an explicit destructure of the coordinate) and the spread is safe because the type carries no key material. Verified: `packages/concord/src/types.ts`'s ChannelMetadata has no key/epoch fields; `deleteChannel` in `client/admin.ts:228-233` performs exactly this destructure-and-spread."
    accepted_by: "user (12-discuss-phase, recorded as D-14 in 12-CONTEXT.md)"
    accepted_at: "2026-07-29T00:00:00Z"
gaps:
  - truth: "The channel-edition fold (helpers/control.ts) must not regress the type-validation guarantees it had before this phase — specifically, that only a genuinely boolean deleted and a genuinely object-typed custom are permitted to enter ChannelMetadata."
    status: failed
    reason: "CR-01 (12-REVIEW.md, independently confirmed): plan 12-08's denylist-then-spread refactor of the channel fold dropped the type checks the prior explicit-pick fold applied to `deleted` and `custom` (`typeof raw.deleted === \"boolean\"` / `raw.custom !== null && typeof raw.custom === \"object\"`). Both fields now flow through `...rest` unvalidated. Executing the fold against `{\"name\":\"general\",\"private\":false,\"deleted\":\"false\",\"custom\":\"not-an-object\"}` produces a folded channel with `deleted === \"false\"` (a truthy string) and `custom === \"not-an-object\"`. The terminal-deletion scan tests `=== true`, so this is NOT recognized as a deletion and the channel is pushed into state.channels; three downstream call sites in client/community.ts (`:757`, `:807`, `:830`) gate on loose truthiness of `deleted` and therefore silently exclude the channel from stream-key registration, live reconciliation, and private sub-engine spawn, while `channels$` applies no `deleted` filter and still renders it. Net effect: any authorized MANAGE_CHANNELS holder — the exact threat actor the adjacent CHAN-04 comment names — can make a channel permanently visible-but-silently-dead on every client, with no deletion edition, no UI signal, and no test catching it (control.test.ts Test D only exercises name/private, per WR-09). This is a regression this phase's own refactor introduced on the exact mechanism (D-13/D-22's round-trip fold) the phase exists to harden, and it directly undermines the phase goal's promise that shared state 'cannot silently destroy each other's data' — here an authorized-but-hostile client silently disables a channel with no observable signal to any user."
    artifacts:
      - path: "packages/concord/src/helpers/control.ts"
        issue: "Lines ~318-323: `const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed`; `deleted` and `custom` ride through `...rest` at any runtime type — the prior `typeof` guards on both were deleted and not re-applied."
    missing:
      - "Re-apply the two dropped validations after the destructure (destructure `deleted`/`custom` out too, validate each, and conditionally re-attach only when well-typed), preserving the round-trip property for genuinely unrecognized keys. See 12-REVIEW.md CR-01's suggested fix."
      - "Add regression tests for a non-boolean `deleted` (asserting the channel remains reachable via `publicChannelKeys()`/is not silently dead) and a non-object `custom` (asserting it is absent from the folded object) — WR-09 confirms neither is covered today."
      - "While in this code: WR-01 notes the denylist also omits `held` (a `ChannelKey` field carrying key-hex entries) despite the same comment block claiming the denylist is exhaustive over sensitive fields — fold that fix in alongside CR-01's since both touch the same denylist."
deferred: []
human_verification: []
---

# Phase 12: Document & Caps Conformance Verification Report

**Phase Goal:** Community and channel documents respect the protocol's byte and membership caps, and round-trip fields the current client doesn't understand — so two clients sharing one npub, or a future protocol revision, cannot silently destroy each other's data.

**Verified:** 2026-07-30T17:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Channel `name` capped at 64 UTF-8 bytes on write, defensively on read | PASSED (override) | `createChannel` (`client/admin.ts:191-192`) calls `assertByteCap(name, NAME_MAX_BYTES, "channel name")` before any side effect. Read-side guard deliberately absent per locked D-04 override (see frontmatter). `helpers/caps.ts` uses `TextEncoder().encode(value).length`, never `.length` — confirmed by code read and by `cord-wire-fixtures.test.ts:155-186`'s astral-string / 64-byte / 10000-byte fixtures exercising the UTF-16-vs-UTF-8 distinction. |
| 2 | Community `name` (64B) / `description` (10000B) caps enforced, alongside the 50-membership constant | ✓ VERIFIED | `helpers/community.ts:125-126` (`createCommunity`) and `client/admin.ts:163-164` (`editMetadata`, asserted against the **merged** `next`, satisfying D-03) both call `assertByteCap`. `client/client.ts:835-838` (`recordJoin`) enforces `COMMUNITY_LIST_MAX_MEMBERSHIPS = 50` (`community-list.ts:94`) counting `liveCommunities(...)` only — tombstones excluded, merge paths (`loadMirror`/`watchLists`) unguarded, confirmed by grep and by plan 12-05's tests. Every cap test asserts against `CORD_METADATA_CAPS`/`CORD_COMMUNITY_LIST_MEMBERSHIP_CAP` (vendored fixture), never `helpers/caps.ts`'s own constants — confirmed in `helpers/__tests__/community.test.ts` and `client/__tests__/community.test.ts`. |
| 3 | Community List and Invite List round-trip unknown top-level document fields | ✓ VERIFIED | `parseCommunityList`/`parseInviteList` (`community-list.ts:251-255`, `invite-list.ts`) spread the parsed document (`ParsedCommunityList`/`ParsedInviteList` both carry `[k: string]: unknown`) rather than destructuring to a closed struct; the lossy `JSON.stringify({entries, tombstones})` rebuilds in `operations/*.ts` are gone. `ConcordClient`/`ConcordInviteManager` each hold a `documentExtras` carrier populated from the parsed document and spread first (entries/tombstones assigned last) at every publish site (`client.ts:1036,1268`; `invite-manager.ts:290`) — confirmed by `document-caps-conformance.test.ts` Tests A-F driven end-to-end through `ConcordClient`/`ConcordInviteManager`, not just the factory layer (satisfying D-23). **Caveats (not blocking the core truth, see Anti-Patterns):** WR-03 — the extras merge is existing-first/monotonic, so a field a peer deliberately removes cannot be retired and can ping-pong back; WR-04 — `ConcordClient.stop()` never clears `documentExtras`, retaining left memberships' key material for the process lifetime; WR-06 — a corrupted/array-rooted document is spread without a root-shape guard, so numeric keys could round-trip as "preserved fields." |
| 4 | `deleteChannel` preserves `custom` via explicit destructure, excludes client-only key material | PASSED (override) | `client/admin.ts:228-233`: `const { channel_id, ...rest } = ch; JSON.stringify({ ...rest, deleted: true })`. `ChannelMetadata` (`types.ts`) no longer declares `key`/`epoch` (removed earlier in the milestone), so `tsc` prevents a value-level read of `ch.key` via this client's own code and the destructure satisfies criterion 4's letter per the locked D-14 override (see frontmatter). **Not fully independent of Gap 1 below:** the fold that produces `ch` in the first place (CR-01) can admit unvalidated `deleted`/`custom` values that this destructure will then faithfully re-publish — the destructure itself is correct, but its input is not always well-typed. |
| 5 | Code comments cite real, existing spec sections | ✓ VERIFIED | `grep -rhoE "CORD-[0-9]{2} §[A-Za-z0-9-]+"` across `packages/concord/src` shows zero occurrences of `CORD-06 §94` or `CORD-03 §44` outside test-fixture string literals in `cord-citations.test.ts`/`cord-wire-fixtures.test.ts` (which exist specifically to exercise the scanner against deliberately-invalid strings, not as real citations). `cord-citations.test.ts` recursively scans every `.ts` file under `src/` (two explicit, documented exclusions) against `CORD_SECTIONS` in `cord-wire-fixtures.ts`, which accepts CORD-01's named unnumbered sections and hyphenated ranges. Full suite green, confirming the guard currently passes. |
| 6 | (TEST-01, standing) Every cap/document rule is asserted against spec-transcribed or fixture values, never the implementation's own constant, with UTF-16/UTF-8-divergent multi-byte fixtures | ✓ VERIFIED | Confirmed the substantive pattern: `helpers/__tests__/community.test.ts`, `client/__tests__/community.test.ts` import `CORD_METADATA_CAPS`/`multiByteStringOverBytes` from `cord-wire-fixtures.ts` (never `helpers/caps.ts`'s `NAME_MAX_BYTES`/`DESCRIPTION_MAX_BYTES`) and comment explicitly that this is deliberate (D-21/TEST-01). `cord-wire-fixtures.test.ts:140,148-149` proves the registry's cap numbers equal values parsed back out of the verbatim CORD-02 sentence. **Caveat (not blocking, see Anti-Patterns):** WR-08 found three vacuous, self-referential `it()` blocks (`expect(SOME_FIXTURE_SENTENCE).toContain("round-trip")`) padding the suite with tests that touch no implementation symbol — the exact anti-pattern this phase exists to eliminate, though the substantive spec-anchored assertions coexist and are unaffected by their presence. |
| 7 (derived) | The channel-fold refactor performed to satisfy WIRE-09/WIRE-10 does not itself introduce a new way for an authorized-but-hostile actor to silently corrupt shared channel state | ✗ FAILED | See Gap in frontmatter (CR-01). A `MANAGE_CHANNELS` holder can publish `{"deleted":"false","custom":"not-an-object"}` and produce a channel that is permanently visible-but-silently-dead on every client — no deletion edition, no test coverage (WR-09), no UI signal. This is a regression relative to pre-phase behavior, introduced by this phase's own D-22 implementation, directly touching the phase goal's "cannot silently destroy each other's data" promise. |

**Score:** 6/7 truths verified (2 by locked override, 0 present-but-behavior-unverified), 1 failed (BLOCKER)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/helpers/caps.ts` | Shared UTF-8 byte-cap check | ✓ VERIFIED | Exists, substantive, wired into `helpers/community.ts` and `client/admin.ts` (3 call sites) |
| `packages/concord/src/helpers/community-list.ts` | 50-membership constant, opened `ParsedCommunityList` | ✓ VERIFIED | `COMMUNITY_LIST_MAX_MEMBERSHIPS` exported, `[k: string]: unknown` on `ParsedCommunityList` |
| `packages/concord/src/helpers/invite-list.ts` | Opened `ParsedInviteList`, no byte cap | ✓ VERIFIED | Index signature present, `INVITE_LIST_MAX_BYTES`/`inviteListWithinByteCap` removed |
| `packages/concord/src/helpers/invite-bundle.ts` | Byte-cap removal, count bounds unchanged | ✓ VERIFIED (with accepted risk) | `INVITE_BUNDLE_MAX_TOTAL_BYTES` fully removed, structurally guarded against reintroduction. CR-02 (aggregate bound loss on untrusted invite-bundle input) is a real residual risk per the review, but is **not scored as a phase gap** here per explicit instruction — D-07/D-25 (12-CONTEXT.md) is a locked user decision covering this removal. |
| `packages/concord/src/helpers/control.ts` | Denylist-then-spread channel fold | ⚠️ SUBSTANTIVE, REGRESSED | Exists, wired, round-trip works — but see Gap (CR-01): the denylist strips only `key`/`epoch`, not `held`, and no longer validates `deleted`/`custom` types. |
| `packages/concord/src/client/admin.ts` | `deleteChannel` destructure-and-spread | ✓ VERIFIED | Confirmed at `:228-233` |
| `packages/concord/src/__tests__/cord-wire-fixtures.ts` / `cord-citations.test.ts` | Spec-anchored fixture registry + citation guard | ✓ VERIFIED | Both exist, both pass, guard proven non-vacuous against the historically-invalid citations |
| `packages/core/package.json`, `packages/common/package.json`, `packages/relay/package.json` | `nostr-tools` bumped to `^2.24` | ✓ VERIFIED | All three resolve `^2.24`; `apps/examples/package.json` still pins `~2.19` (WR-13, warning, not a phase gap — examples app is not in this phase's file scope) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `helpers/community.ts::createCommunity` | `helpers/caps.ts::assertByteCap` | direct call, reachable with no client | WIRED | Confirmed — public API path has no bypass |
| `client/admin.ts::editMetadata` | `helpers/caps.ts::assertByteCap` | asserted against merged `next`, not raw `patch` | WIRED | Confirmed at `:163-164` — closes the "icon-only patch republishes stale over-cap name" bypass |
| `client/client.ts::recordJoin` | `helpers/community-list.ts::COMMUNITY_LIST_MAX_MEMBERSHIPS` + `liveCommunities` | count check | WIRED | Confirmed at `:835-838`; merge paths (`loadMirror`, `watchLists`) confirmed refusal-free |
| `helpers/community-list.ts::parseCommunityList` | `operations/community-list.ts::modifyCommunityList` | open-document spread, no `{entries,tombstones}` literal rebuild | WIRED | Confirmed — reconstruction lines D-12 targeted are gone |
| `client/client.ts::documentExtras` | publish sites (`saveCommunityList`, mirror save) | spread-first, entries/tombstones-last | WIRED | Confirmed at all four sites reviewed in 12-REVIEW.md |
| `helpers/control.ts` fold | `client/admin.ts::deleteChannel` | folded `ChannelMetadata` flows into the spread `ch` | WIRED, BUT UPSTREAM DEFECT | The link itself works; the defect (CR-01) is in what the fold allows through, not in this link |
| `__tests__/cord-citations.test.ts` | `__tests__/cord-wire-fixtures.ts::CORD_SECTIONS`/`citationsOutsideRegistry` | import + recursive file scan | WIRED | Confirmed, suite passes |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| WIRE-06 | 12-01, 12-04 | Channel `name` 64-byte cap, write (+read, overridden) | ✓ SATISFIED | `createChannel` byte-cap enforced; D-04 override accepted for read side |
| WIRE-07 | 12-01, 12-04 | Community `name`/`description` byte caps | ✓ SATISFIED | `createCommunity`/`editMetadata` byte-caps enforced against merged value |
| WIRE-08 | 12-01, 12-02, 12-03, 12-05 | 50-membership cap, byte-cap removal, nostr-tools bump | ✓ SATISFIED | Confirmed live-only counting at `recordJoin`; byte caps removed and structurally guarded; `nostr-tools ^2.24` resolved in core/common/relay |
| WIRE-09 | 12-07, 12-08, 12-09 | Round-trip unknown top-level fields (Lists + channel fold) | ⚠️ SATISFIED, WITH A CO-LOCATED REGRESSION | Round-trip mechanism works end-to-end (Lists via `documentExtras`, channel fold via denylist-then-spread) — but see CR-01: the same fold refactor that implements this requirement dropped type validation on two fields, a defect that must be fixed before this requirement's implementation is safe to rely on |
| WIRE-10 | 12-08 | `deleteChannel` preserves `custom`, excludes key material | ✓ SATISFIED | Destructure-and-spread confirmed; type-level key-material exclusion confirmed via `tsc` |
| WIRE-12 | 12-01, 12-06 | Real spec-section citations everywhere | ✓ SATISFIED | Sweep complete, structural guard passes, confirmed by direct grep of the compiled source tree |
| TEST-01 (standing) | all plans | Spec-anchored, non-self-referential assertions | ✓ SATISFIED (substantively), with 3 vacuous tests noted (WR-08, non-blocking) | Confirmed cap literals sourced from `cord-wire-fixtures.ts`, never from implementation constants |

No orphaned requirements found — all six phase requirement IDs (WIRE-06, WIRE-07, WIRE-08, WIRE-09, WIRE-10, WIRE-12) plus the standing TEST-01 are claimed by at least one plan's frontmatter and REQUIREMENTS.md's Phase 12 traceability rows match exactly.

### Anti-Patterns Found

| File | Line(s) | Pattern | Severity | Impact |
|------|---------|---------|----------|--------|
| `packages/concord/src/helpers/control.ts` | ~318-323 | Type-validation regression on `deleted`/`custom` in denylist-then-spread | 🛑 BLOCKER (CR-01) | Authorized-but-hostile actor can make a channel silently visible-but-dead; no test catches it |
| `packages/concord/src/helpers/control.ts` | 263-267, 318 | Denylist omits `held` (a `ChannelKey` field carrying key hex), contradicting its own "exhaustive over sensitive fields" comment | ⚠️ Warning (WR-01) | Latent guardrail gap — no current code path exploits it, but the documented contract is already unmet |
| `packages/concord/src/client/client.ts` | 1001, 1085; `invite-manager.ts:316` | `documentExtras` merge is existing-first/monotonic (never drops a key) | ⚠️ Warning (WR-03) | A field a peer deliberately removes cannot be retired; can resurrect via cross-device ping-pong |
| `packages/concord/src/client/client.ts` | 293, 488-505 | `documentExtras` never cleared in `stop()`, unlike `ConcordInviteManager.stop()` | ⚠️ Warning (WR-04) | Retains left memberships' key material in memory for the process lifetime (retention, not disclosure — confirmed not to reach the wire) |
| `packages/concord/src/helpers/caps.ts` | 37-53 | `assertByteCap` coerces non-string input via `TextEncoder`, silently accepting `undefined` as 0 bytes | ⚠️ Warning (WR-05) | `editMetadata({ name: undefined })` could publish a `CommunityMetadata` missing its required `name` |
| `packages/concord/src/helpers/community-list.ts` / `invite-list.ts` | 251-255 / ~122-126 | Opened root spreads any parsed JSON with no shape guard (array/null root) | ⚠️ Warning (WR-06) | A corrupted/malformed document could round-trip numeric junk keys as "preserved fields" |
| `packages/concord/src/client/admin.ts` | 228-233 | `deleteChannel` republishes the fold's `name` verbatim, bypassing the write-side byte cap | ⚠️ Warning (WR-07) | Same client both refuses an over-cap `createChannel` and emits an over-cap deletion edition |
| Three test files (see 12-REVIEW.md WR-08) | — | Vacuous self-referential `it()` assertions (`expect(X).toContain(...)` on a fixture constant against itself) | ⚠️ Warning (WR-08) | Exactly the anti-pattern TEST-01/this phase exists to eliminate; padding, not coverage |
| `packages/concord/src/helpers/__tests__/control.test.ts` | ~869-895 | No test exercises non-boolean `deleted` / non-object `custom` through the fold | ⚠️ Warning (WR-09) | Directly explains why CR-01 shipped green |
| `packages/concord/src/helpers/__tests__/invite-list.test.ts` | absent | No structural export guard for the removed `inviteListWithinByteCap`, unlike its Community List twin | ⚠️ Warning (WR-10) | Removal is not locked against silent reintroduction |
| `packages/concord/src/client/client.ts` | 829-849 | Membership cap counts a live-but-engineless entry, refusing a corrective re-join at exactly 50 | ⚠️ Warning (WR-11) | Edge-case liveness bug, not a data-loss bug |
| `packages/concord/src/helpers/community-list.ts` | 98-110 | `LIST_MAX_BYTES` dead in `src/`, doc comment describes a nonexistent use | ⚠️ Warning (WR-12) | Documentation drift |
| `packages/core/package.json` etc. | — | `nostr-tools` widened `~` → `^`; `apps/examples` left at `~2.19` | ⚠️ Warning (WR-13) | Two divergent crypto implementations resolve in the workspace tree |
| `packages/concord/src/__tests__/cord-wire-fixtures.ts` | 337-338, 366-385 | Citation-guard regex has undisclosed blind spots (`CORD-06 § 3`, `CORD-06 §§3`, etc. are unmatched) | ⚠️ Warning (WR-14) | Guard's stated limitation doesn't cover this class |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in the reviewed file set.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full concord suite passes | `pnpm exec vitest run` (packages/concord) | 546 tests / 54 files passed | ✓ PASS |
| Package typechecks | `pnpm exec tsc --noEmit -p packages/concord/tsconfig.json` | exit 0, no output | ✓ PASS |
| No invalid `CORD-NN §X` citations remain in real source | `grep -rhoE "CORD-[0-9]{2} §[A-Za-z0-9-]+" packages/concord/src` | 0 occurrences of `CORD-06 §94`/`CORD-03 §44` outside test-fixture string literals | ✓ PASS |
| `nostr-tools` resolves `^2.24` in core/common/relay | `grep -n "nostr-tools" packages/{core,common,relay}/package.json` | all three `^2.24` | ✓ PASS |
| `INVITE_BUNDLE_MAX_TOTAL_BYTES` fully removed and guarded | `grep -rn INVITE_BUNDLE_MAX_TOTAL_BYTES packages/concord/src` | only the structural non-reintroduction test references the string | ✓ PASS (D-07/D-25 accepted risk re: CR-02, not scored as a gap) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or phase-declared probes found for this phase. Skipped.

### Human Verification Required

None. All must-haves were resolvable programmatically; the one failing item (CR-01) is independently confirmed by execution (per the code review) and requires a code fix, not human judgment.

### Gaps Summary

Five of six ROADMAP success criteria are cleanly achieved, and the two criteria whose original wording was overtaken by locked mid-phase decisions (criterion 1's "defensively on read," criterion 4's spread-vs-destructure framing) are honored via the explicit D-04/D-14 overrides recorded in 12-CONTEXT.md — both verified directly against the code, not just asserted.

The blocking issue is CR-01: the same channel-fold refactor built to satisfy WIRE-09/WIRE-10's round-trip requirement dropped type validation that the pre-phase fold applied to `deleted` and `custom`. This is not a hypothetical — it was proven by execution (independently confirmed) that an authorized `MANAGE_CHANNELS` holder can publish an edition that becomes permanently visible-but-silently-dead on every client, with no deletion event, no test coverage, and no user-facing signal. This is precisely the failure mode the phase goal is written to prevent ("cannot silently destroy each other's data") — it just arrives from a different direction (an authorized-but-hostile in-fold actor) than the two the goal statement names (multi-device same-npub races, future protocol revisions). Given the fix is well-scoped (re-apply two `typeof` guards after the destructure, add the two missing regression tests, and fold in WR-01's `held` omission while touching the same denylist), this should be a fast, targeted closure — not a re-plan.

CR-02 (loss of the invite-bundle aggregate byte bound) is a real residual risk documented in 12-REVIEW.md, but per explicit governing instruction it is **not** scored as a phase gap here: it traces to a locked user decision (D-07/D-25 in 12-CONTEXT.md) about scope, not to an implementation defect. It is noted here for visibility only.

The fourteen warnings (WR-01 through WR-14) are real, mostly small, findings that do not on their own block the phase goal — several (WR-03, WR-04, WR-06) are legitimate hardening opportunities for the round-trip mechanism's edge cases, and one (WR-08) is a minor recurrence of the exact anti-pattern TEST-01 exists to eliminate. None of them independently justifies withholding the phase, but WR-01 and WR-09 are directly coupled to CR-01's fix and should be closed in the same pass.

---

_Verified: 2026-07-30T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
