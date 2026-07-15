---
phase: 05-cache-identity-memo-fix
verified: 2026-07-15T22:10:00Z
status: gaps_found
score: 4/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "Category 3's false 'single machine-readable definition' framing (cited event-store.ts:219 as defining SeenRelaysSymbol and common's Seal/Rumor/GiftWrap symbols, neither of which is in that list) — 05-06 rewrote it to 'this category has no single defining list; the propagation mechanism differs per symbol,' naming each example's real mechanism."
    - "setEncryptedContentCache's self-contradictory classification (called 'identity memo' while its own defining property said 'carry-forward') — 05-06 reclassified it as carry-forward payload; mirrored in encrypted-content.ts by 05-08."
    - "encrypted-content-cache.ts:38-40's false citation claiming EncryptedContentFromCacheSymbol propagates via the event-store.ts:219 merge list — 05-07 corrected it to state plainly it is NOT in that list."
    - "14 sweep-commented write sites across core (05-08) and common (05-09) asserting 'must not survive a spread — identity memo' over enumerable Reflect.set writes that do survive a spread — reworded per the user's authorized comment-only decision; groups.ts correctly identified as the one genuine non-enumerable outlier (final descriptor superseded by the enclosing getOrComputeCachedValue call)."
    - "cache.test.ts's false 'enforcement contract' claim (claimed 3 named sites would turn the suite red; true for 0 of 3) — 05-10 rewrote the carry-forward pipe to insert a genuinely load-bearing intervening spread (includeAltTag) and narrowed the comment to name only the one site the suite now guards."
  gaps_remaining:
    - "CACHE-02 / Success Criterion 2 still fails: cache.ts's own worked example — the taxonomy's single most load-bearing passage — states EncryptedContentSymbol 'has TWO write sites, BOTH carry-forward payload' (packages/core/src/helpers/cache.ts:44-45). Verified false: seven write sites exist in core+common (operations/encrypted-content.ts:29, operations/tags.ts:90, operations/event.ts:143/180, event-store.ts:225's merge loop, common/operations/gift-wrap.ts:141, encrypted-content.ts:125), and event-store.ts:219-224's own phase-05 comment classifies the merge-loop write as 'accumulated state' for the same symbol the worked example says has only two write sites, both carry-forward. The reclassification work that closed the previous round's gaps left this exhaustive miscount untouched."
    - "cache.ts:93-95's frozen-event throw disclosure still scopes the TypeError to 'every replaceable event' via getReplaceableIdentifier. Verified: EventStore.add (event-store.ts:248) and AsyncEventStore.add (async-event-store.ts:215) both call getExpirationTimestamp — also routed through getOrComputeCachedValue — unconditionally, before any kind/replaceable branching. No frozen event of any kind can be inserted; the comment's scoping is materially narrower than the actual blast radius. .changeset/cache-frozen-event-throws.md still declares 'patch' for what is an unconditional, escape-hatch-free runtime break on every EventStore.add call for a frozen event."
  regressions: []
overrides: []
gaps:
  - truth: "(ROADMAP Success Criterion 2 / CACHE-02) The cache helper's source carries a comment distinguishing identity memos from carry-forward payloads, so a future cleanup cannot collapse the two conventions onto one write mechanism."
    status: failed
    reason: "After a full gap-closure round (05-06..05-11) that correctly fixed the four specific defects the prior verification cited, a fresh code review run against the post-closure tree found the taxonomy's own worked example — the passage cache.ts itself calls out as 'the taxonomy's single most important example' — is still factually false, and the independently-confirmed frozen-event-throw disclosure is still materially incomplete. Both were confirmed directly against the current source, not taken from the review's narration."
    artifacts:
      - path: "packages/core/src/helpers/cache.ts"
        issue: "Lines 44-45: 'Worked example — EncryptedContentSymbol has TWO write sites, BOTH carry-forward payload but for DIFFERENT reasons.' Grep of all non-test write sites for EncryptedContentSymbol in core+common finds seven: operations/encrypted-content.ts:29, operations/tags.ts:90, operations/event.ts:143 (stamp), operations/event.ts:180 (sign), event-store.ts:225 (merge loop), common/operations/gift-wrap.ts:141, helpers/encrypted-content.ts:125. Worse, event-store.ts:222-224's own phase-05 comment classifies the merge-loop write of this same symbol as 'accumulated state,' directly contradicting the worked example's exhaustive 'TWO, BOTH carry-forward' claim for the identical symbol. A reader reconciling the two comments finds the taxonomy self-contradictory at its own headline example — precisely the failure mode Success Criterion 2 exists to prevent."
      - path: "packages/core/src/helpers/cache.ts"
        issue: "Lines 93-95: 'getReplaceableIdentifier routes through getOrComputeCachedValue, and EventStore.add calls it on every replaceable event, so this is reachable from a normal insert.' Verified against event-store.ts:248 and async-event-store.ts:215: both call getExpirationTimestamp (also getOrComputeCachedValue-routed) unconditionally on every event, before any replaceable-kind branching (event-store.ts:255). The throw is reachable on ANY frozen event via EventStore.add/AsyncEventStore.add, not only replaceable ones. The comment's own scoping claim is incomplete in exactly the direction that matters for a reader triaging a TypeError on a non-replaceable kind."
      - path: ".changeset/cache-frozen-event-throws.md"
        issue: "Declares 'applesauce-core: patch' for an unconditional, escape-hatch-free behavior change (Reflect.set's silent-false degradation becomes an Object.defineProperty TypeError) that now fires on every EventStore.add/AsyncEventStore.add call for any frozen event of any kind — not a patch-level fix, a breaking behavior change for any consumer that freezes events (e.g. Redux Toolkit/immer in development)."
      - path: "packages/common/src/helpers/groups.ts"
        issue: "Lines 93-118 (getHiddenGroups): confirmed a real, independent defect — getOrComputeCachedValue gates on Reflect.has, not on the returned value, so returning undefined at line 99 (locked-tags case) permanently memoizes undefined on the event. unlockHiddenGroups then resolves undefined against a Promise<GroupPointer[]> signature (bypassing its own 'if (!groups) throw' guard, because isHiddenGroupsUnlocked's presence check fires first), and isHiddenGroupsUnlocked's type guard lies. The phase-05 comment at lines 107-114 sits directly on this write site and is accurate about the descriptor mechanics (non-enumerable, correctly does not survive a spread) but is silent on — and by tone ratifies as fine — the undefined-poisoning bug one line above it. This is a real behavior bug, not a comment-accuracy-only issue, so it is out of this phase's declared comment-only scope to fix outright; it is listed here because the comment's confident 'correctly does not survive a spread' framing gives a false impression of soundness at a site that has an unrelated but serious defect, and no deferral-register entry accounts for it (the 05-11 Deferral Register was written against the prior review's finding-ID set, before this defect was found)."
    missing:
      - "Rewrite cache.ts's worked example to stop claiming an exhaustive 'TWO write sites': either enumerate-by-contrast (name 3+ illustrative sites spanning all relevant categories, explicitly non-exhaustive) or reconcile explicitly with event-store.ts's merge-loop classification of the same symbol as accumulated state."
      - "Reconcile cache.ts's category-3 merge-list enumeration (names FromCacheSymbol/verifiedSymbol only) with event-store.ts:219's actual three-member list (also includes EncryptedContentSymbol) so the two comments do not disagree about list membership."
      - "Rewrite cache.ts:93-95's frozen-event throw disclosure to name getExpirationTimestamp's unconditional call on every event (not just getReplaceableIdentifier on replaceable ones) as the primary reachability path, matching the actual blast radius in event-store.ts:248 and async-event-store.ts:215."
      - "Re-bump .changeset/cache-frozen-event-throws.md from patch to minor (or add explicit migration guidance) given the throw is unconditional, escape-hatch-free, and reaches every EventStore.add call for a frozen event of any kind."
      - "Either fix getHiddenGroups to not memoize a negative/undefined result (mirror the sibling helpers' shape: check the bail-out condition before the getOrComputeCachedValue call, or use a sentinel that isHiddenGroupsUnlocked correctly distinguishes) or, if kept out of this phase's comment-only scope, add an explicit deferral-register entry naming the defect, its consequence chain, and its routing destination — do not leave a confident-sounding 'correctly does not survive a spread' comment sitting on an undisclosed bug."
      - "Fix or re-verify encrypted-content-cache.ts:40-41's unparseable sentence fragment ('Consequence: isEncryptedContentFromCache gates persistEncryptedContent below — assuming provenance survives dedup goes untested.') — the 05-11 Deferral Register marks a 'WR-07' closed, but that closure refers to a different finding (gift-wrap.ts's RumorSymbol sentinel) from an earlier review's finding-ID numbering; the fragment this review's WR-07 actually names is still present verbatim."
human_verification:
  - test: "Directly edit packages/core/src/operations/tags.ts's modifyHiddenTags return to write EncryptedContentSymbol via a non-enumerable Object.defineProperty descriptor (identical shape to 05-10 SUMMARY's probe code), run `pnpm --filter applesauce-core test -- cache.test.ts`, confirm the SHIPPED 'carry-forward payloads' describe block itself (not a duplicate probe file) fails at getHiddenTags(signed)/getEncryptedContent(signed), then revert with `git checkout -- packages/core/src/operations/tags.ts`."
    expected: "cache.test.ts's real 'carry-forward payloads' suite goes RED under the migration; its 'cache identity memos' suite and the rest of the applesauce-core suite stay green (discrimination); the file is byte-identical to HEAD after revert."
    why_human: "05-10's plan specified this exact literal in-place-edit procedure as the non-vacuity proof for the D-13 enforcement contract (Truth 6). The executor's auto-mode permission classifier denied the direct edit (parallel-worktree file-ownership scoping) and 05-10 substituted a temporary duplicate test file exercising the identical production functions and pipe shape, which is strong but not identical evidence — it exercises the same mechanism through a copy, not the shipped test in place. The orchestrator's own attempted post-merge re-run of the literal procedure was denied by the same permission classifier and was not worked around, per this verification's explicit instructions not to edit production files. A human (or an agent run outside the parallel-worktree permission constraint) can complete this in under two minutes and it is the single cleanest way to close this open item."
---

# Phase 5: Cache Identity Memo Fix Verification Report

**Phase Goal:** A value memoized onto a config object by `applesauce-core`'s cache helper does not survive an object spread, so a rolled-forward copy recomputes its derivation instead of returning the source's stale memo — the single root cause behind three HIGH concord findings.
**Verified:** 2026-07-15T22:10:00Z
**Status:** gaps_found
**Re-verification:** Yes — gap-closure round (plans 05-06..05-11) against the previous VERIFICATION.md's CACHE-02 failure

## Scope Note

This is a gap-closure re-verification. Per the ROADMAP's Phase 5 "Gap closure" note and this round's explicit instructions, Success Criteria 1, 3, 4, and 5 PASSED the prior verification and are **not reopened** — the runtime fix (non-enumerable memo writes in `cache.ts`) is correct and untouched by this round's comment-only plans. The decisive question for this round is whether **Success Criterion 2 / CACHE-02** now passes. It does not: a fresh code review of the post-gap-closure tree (`05-REVIEW.md`, dated after 05-06..05-11 landed) found three new critical issues, two of which I independently confirmed by reading the current source directly (not by trusting the review's narration).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC1 / CACHE-01, not reopened) A value written by `setCachedValue`/`getOrComputeCachedValue` is non-enumerable, so a spread recomputes instead of returning the stale memo. | ✓ VERIFIED | `packages/core/src/helpers/cache.ts:101-103,111` — both writes still use `Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true })`, byte-identical to the previously-passed state. |
| 2 | (SC2 / CACHE-02) The cache helper's source carries a comment distinguishing identity memos from carry-forward payloads, so a future cleanup cannot collapse the two conventions. | ✗ FAILED | The prior round's 4 specific gaps are genuinely closed (see `gaps_closed`). But `cache.ts:44-45`'s worked example — the taxonomy's own "single most important example" — still claims `EncryptedContentSymbol` has exactly "TWO write sites, BOTH carry-forward payload." Confirmed false: 7 write sites exist, and `event-store.ts:222-224`'s own comment classifies one of them (the merge-loop write) as *accumulated state* for the same symbol — a direct contradiction at the taxonomy's own worked example. `cache.ts:93-95`'s frozen-throw disclosure is also confirmed incomplete: `EventStore.add`/`AsyncEventStore.add` throw on ANY frozen event via the unconditional `getExpirationTimestamp` call, not only replaceable ones as the comment states. |
| 3 | (SC3 / CACHE-03, not reopened) `getEncryptedContent`/`getHiddenTags` still return correct plaintext off a signed event built through the factory pipe's spread operations. | ✓ VERIFIED | Independently re-run: `pnpm --filter applesauce-core test -- cache.test.ts` → 635/635 passing, including the "carry-forward payloads" suite driving a real `eventPipe(modifyHiddenTags, includeAltTag, sign)` through real nip04 encryption and signing. |
| 4 | (SC4, not reopened) `pnpm -r test` passes across the full workspace against the 1989-test baseline. | ✓ VERIFIED | Per orchestrator's independently-confirmed facts: 1997 passed, 2 skipped, 250 files, exit 0. Spot-checked `applesauce-core`'s own suite directly (635/635, 57 files) as part of this verification. |
| 5 | (SC5 / TEST-01, anchor only, not reopened) Correctly left standing/unchecked at Phase 5. | ✓ VERIFIED | `REQUIREMENTS.md:120` — "Pending — cross-cutting; does NOT close at Phase 5." Correctly not claimed complete. |
| 6 | (05-10 PLAN must-have / D-13 enforcement contract) Migrating `operations/tags.ts`'s `EncryptedContentSymbol` write onto a non-enumerable descriptor turns the carry-forward suite RED, proven by a recorded probe rather than asserted by comment. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The mechanism is present and wired (`includeAltTag` genuinely sits between `modifyHiddenTags` and `sign()` in the shipped pipe — confirmed by re-running `cache.test.ts` green). But 05-10's own SUMMARY discloses the specified literal procedure (edit `operations/tags.ts` in place, watch the SHIPPED test go red, revert) was blocked by a permission-classifier denial and substituted with an equivalent-mechanism duplicate test file — strong evidence, not the specified proof. This verification's instructions explicitly forbid editing production files to complete the probe. See Human Verification below. |

**Score:** 4/6 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/helpers/cache.ts` | Non-enumerable writes + sound, accurate taxonomy prose | ⚠️ PARTIAL | Write mechanism (Task 1, prior round) remains correct. Taxonomy prose: the 4 defects the prior VERIFICATION.md cited are genuinely fixed. The worked example's exhaustive "TWO write sites" claim and the frozen-throw disclosure's incomplete scoping are new/residual defects confirmed against the current file — see gaps. |
| `.changeset/cache-frozen-event-throws.md` | Accurate, correctly-scoped changeset | ✗ UNDER-SCOPED | Confirmed on disk: `"applesauce-core": patch`, single-sentence body. Content is accurate as far as it goes but the bump level does not reflect the confirmed unconditional, escape-hatch-free blast radius (every `EventStore.add`/`AsyncEventStore.add` call on a frozen event of any kind). |
| 35 sweep-commented write sites (core + common) | Category comment citing corrected `cache.ts` taxonomy, no false spread-survival claims | ✓ VERIFIED | Confirmed via `05-REVIEW.md`'s "What holds up" section (13 sweep sites named individually) and direct reading of `groups.ts`: all 14 previously-false "must not survive a spread" comments are reworded; the one genuine non-enumerable outlier (`groups.ts`'s `getHiddenGroups`) is correctly distinguished from its 7 enumerable siblings. Zero `TBD`/`FIXME`/`XXX` markers found across all 8 phase-touched files checked. |
| `packages/common/src/helpers/encrypted-content-cache.ts` | No false merge-list citation for `EncryptedContentFromCacheSymbol` | ⚠️ PARTIAL | CR-04's original false citation is fixed (confirmed: states plainly it is NOT in the merge list). A separate, still-present defect: the closing sentence ("Consequence: isEncryptedContentFromCache gates persistEncryptedContent below — assuming provenance survives dedup goes untested.") remains an unparseable fragment, confirmed present verbatim. The 05-11 Deferral Register's "WR-07 closed" entry refers to a different file (`gift-wrap.ts`'s `RumorSymbol` sentinel) under an earlier review's finding-ID numbering — a genuine cross-review ID collision, not evidence this fragment was addressed. |
| `packages/core/src/helpers/__tests__/cache.test.ts` | Enforcement comment claims only what the suite guards, non-vacuity proven by recorded probe | ⚠️ PARTIAL | Comment accuracy confirmed true by independent trace (`05-REVIEW.md` IN-03, and my own re-read of the test + `operations/tags.ts`/`operations/event.ts`). Non-vacuity: proven via an equivalent-mechanism duplicate test, not the plan's literal in-place-edit procedure — see Truth 6 and Human Verification. |
| `packages/common/src/helpers/groups.ts` | Accurate descriptor comment for the one genuine non-enumerable sweep outlier | ⚠️ ADJACENT DEFECT | The descriptor claim itself ("correctly does not survive a spread") is true and confirmed. A separate, real bug at the same site (permanently memoizing `undefined` via `getOrComputeCachedValue`'s `Reflect.has`-gated cache when hidden tags are locked) is not disclosed by the comment and is not in any deferral register. Not a comment-accuracy failure in the narrow CACHE-02 sense, but the comment's confident framing creates false assurance about a site that has an undisclosed defect. |
| `packages/concord/src/helpers/keys.ts` (CONCORD-H01 comments) | Corrected reasoning, no "hand-rolled" misuse | ✓ VERIFIED | Not reopened; 05-11 corrected the `baseKeysFor` "hand-rolled" misclassification (WR-09 under the prior review's numbering). No new defect found here in this round's review. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `cache.ts`'s worked example | `event-store.ts:219-228`'s merge loop | Cross-reference / exhaustive write-site count | ✗ NOT WIRED (still false) | The worked example's "TWO write sites" claim contradicts `event-store.ts:222-224`'s own comment classifying a third write of the same symbol as accumulated state. Both comments were written by this phase and now disagree with each other. |
| `cache.ts`'s frozen-throw disclosure | `EventStore.add`/`AsyncEventStore.add` | Reachability scoping claim | ✗ NOT WIRED (understated) | `event-store.ts:248` and `async-event-store.ts:215` call `getExpirationTimestamp` unconditionally on every event, before the `isReplaceable` branch (`event-store.ts:255`) the comment cites as the sole reachability path. |
| `cache.test.ts`'s carry-forward suite | `operations/tags.ts`'s `modifyHiddenTags` write | "Enforcement contract" comment + non-vacuity probe | ⚠️ PARTIAL (mechanism proven, literal procedure not run) | Mechanism confirmed real via re-run and via an equivalent-mechanism duplicate-test probe (05-10 SUMMARY). The plan's literal in-place-edit procedure against the shipped test was not completed — permission-denied both during execution and during this verification's attempted post-merge re-run. |

### Data-Flow Trace (Level 4)

Not applicable — this phase is a shared-helper/comment-accuracy phase with no UI/dashboard data-flow surface.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Non-enumerable memo write still in place | `Read packages/core/src/helpers/cache.ts:101-103,111` | `Object.defineProperty(..., { enumerable: false, ... })` present, unchanged | ✓ PASS |
| `cache.test.ts` (memo + carry-forward suites) passes | `pnpm --filter applesauce-core test -- cache.test.ts` | 635/635 tests passed, 57 files | ✓ PASS |
| `EncryptedContentSymbol` write-site count | `grep -rn "EncryptedContentSymbol" packages/core/src packages/common/src --include="*.ts" \| grep -v __tests__` | 7 non-test write sites found | ✓ PASS (confirms CR-01 is a real, not misread, finding) |
| Frozen-event throw reachable on non-replaceable kind | `Read event-store.ts:237-260`, `async-event-store.ts:210-225` | `getExpirationTimestamp` called unconditionally before `isReplaceable` branch, in both stores | ✓ PASS (confirms CR-02 is a real, not misread, finding) |
| `getHiddenGroups` undefined-poisoning | Read `packages/common/src/helpers/groups.ts:93-119` | `getOrComputeCachedValue` wraps a callback that can `return undefined` at line 99; `Reflect.has`-gated cache confirmed in `cache.ts:107` | ✓ PASS (confirms CR-03 is a real, not misread, finding) |
| No debt markers in phase-touched files | `grep -rn "TBD\|FIXME\|XXX"` across all 8 reviewed files | 0 matches | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this repository; the phase's own non-vacuity "probe" is the test-suite-level check covered under Behavioral Spot-Checks and Human Verification above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CACHE-01 | 05-01, 05-02, 05-05 | Memo does not survive a spread | ✓ SATISFIED | Not reopened; re-confirmed unchanged. `REQUIREMENTS.md:15` correctly `[x]`. |
| CACHE-02 | 05-01, 05-03, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11 | Taxonomy documents identity-memo vs. carry-forward distinction accurately | ✗ BLOCKED | Taxonomy's worked example remains factually false about its own cited example (CR-01) and the frozen-throw disclosure remains materially incomplete (CR-02), both confirmed directly against current source. `REQUIREMENTS.md:16,118` correctly still `[ ]` / "Pending — taxonomy unsound." |
| CACHE-03 | 05-02, 05-10 | Carry-forward path intact through pipe + signing | ✓ SATISFIED | Not reopened; re-confirmed via direct test re-run (635/635). `REQUIREMENTS.md:17` correctly `[x]`. |
| TEST-01 | 05-04, 05-05 | Standing, cross-phase (Phases 5-12); anchored, not closed, at Phase 5 | ✓ CORRECTLY ANCHORED | `REQUIREMENTS.md:120` correctly leaves it Pending/standing. |

No orphaned requirements: all four IDs mapped to Phase 5 in `REQUIREMENTS.md`'s traceability table are claimed by at least one of the eleven plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/helpers/cache.ts` | 44-45 | Worked example asserts a false, exhaustive write-site count ("TWO ... BOTH carry-forward payload") that contradicts the same phase's own comment elsewhere (`event-store.ts:222-224`) | 🛑 Blocker | Directly defeats Success Criterion 2's stated purpose at the taxonomy's own headline example — the exact "future cleanup collapses the two conventions" failure mode the criterion exists to prevent. |
| `packages/core/src/helpers/cache.ts` | 93-95 | Frozen-event throw reachability scoped to "every replaceable event" when the actual reachable set is "every event of any kind" | 🛑 Blocker | Understates a real, confirmed behavior change (`Object.defineProperty` throws where `Reflect.set` degraded silently) in exactly the direction that misleads a reader triaging a `TypeError` on a non-replaceable kind. |
| `.changeset/cache-frozen-event-throws.md` | 1-3 | `patch` bump for an unconditional, escape-hatch-free runtime-breaking change | ⚠️ Warning | Consumers relying on semver-patch safety may be surprised by a new `TypeError` on every frozen-event insert. |
| `packages/common/src/helpers/groups.ts` | 93-119 | `getHiddenGroups` permanently memoizes `undefined` via `Reflect.has`-gated caching, poisoning `unlockHiddenGroups`'s return type and `isHiddenGroupsUnlocked`'s type guard | 🛑 Blocker (real defect; comment-only fix is out of this phase's declared scope, but the silence/false-assurance is in scope) | A real, reachable bug (any read before hidden tags unlock permanently breaks the site) that this phase's own comment sits on top of without disclosing, and that no deferral register currently accounts for. |
| `packages/common/src/helpers/encrypted-content-cache.ts` | 40-41 | Unparseable sentence fragment ("Consequence: X gates Y below — assuming Z goes untested") survives despite a Deferral Register entry claiming closure under a stale finding-ID | ⚠️ Warning | A reader cannot extract the intended warning; the apparent "closed" status in 05-11's SUMMARY is a cross-review finding-ID collision, not evidence of an actual fix. |

No `TBD`/`FIXME`/`XXX` debt markers found in any of the 8 phase-touched files re-checked in this round.

### Bookkeeping Issue (carried forward, still unresolved)

`.planning/ROADMAP.md:32` and `:212` still mark Phase 5 `[x]` / "Complete (2026-07-15)". `.planning/REQUIREMENTS.md` correctly shows CACHE-02 as `[ ]` / "Pending — taxonomy unsound," which is internally consistent with this verification's finding — but the ROADMAP-level Phase 5 completion marking is inconsistent with an outstanding `gaps_found` phase and should not be flipped to Complete until a subsequent re-verification actually passes.

### Human Verification Required

1. **Direct-edit re-run of the D-13 non-vacuity probe (Truth 6)**
   - **Test:** Temporarily edit `packages/core/src/operations/tags.ts`'s `modifyHiddenTags` return to write `EncryptedContentSymbol` via a non-enumerable `Object.defineProperty` descriptor (exact code in `05-10-SUMMARY.md`'s "Task 2 Probe Transcript"). Run `pnpm --filter applesauce-core test -- cache.test.ts` and confirm the SHIPPED `"carry-forward payloads"` describe block itself fails at `getHiddenTags(signed)`/`getEncryptedContent(signed)`, while `"cache identity memos"` stays green. Revert with `git checkout -- packages/core/src/operations/tags.ts` and confirm `pnpm --filter applesauce-core test` returns to 635/635.
   - **Expected:** The shipped test goes RED under the migration and green after revert, matching the equivalent-mechanism probe's already-observed outcome.
   - **Why human:** This verification's instructions explicitly prohibit editing production files to run this probe myself. 05-10's own SUMMARY discloses this exact gap: the plan's literal procedure was blocked by the harness's parallel-worktree permission classifier, both during execution and during the orchestrator's own attempted post-merge re-run.

### Gaps Summary

The prior verification's four specific CACHE-02 gaps (the false category-3 "machine-readable definition," `setEncryptedContentCache`'s self-contradictory classification, the false `encrypted-content-cache.ts` merge-list citation, and the 14 sweep sites' false spread-survival claims) are all genuinely closed by plans 05-06 through 05-09 — this is real, verified progress, not a re-litigation of already-settled ground.

However, Success Criterion 2 / CACHE-02 still fails a fresh independent check. `cache.ts`'s worked example — the specific passage the file's own opening paragraph calls "the taxonomy's single most important example" — still makes a false, exhaustive claim about the number of write sites for its subject symbol, and now (as a side effect of a `gap_closure`-round fix elsewhere) directly contradicts a different comment this same phase wrote (`event-store.ts:222-224`) about the same symbol. I confirmed this by grepping every non-test `EncryptedContentSymbol` write site in `packages/core/src` and `packages/common/src` (7, not 2) and reading `event-store.ts`'s merge-loop comment directly — not by trusting the code review's narration. I confirmed the frozen-event throw scoping gap the same way, reading `event-store.ts:237-260` and `async-event-store.ts:210-225` directly. A third finding (`groups.ts`'s `getHiddenGroups` permanently memoizing `undefined`) is a real, reachable bug that this phase's own comment sits on without disclosing; it is adjacent to, not squarely inside, CACHE-02's literal text, but it is exactly the kind of "confidently wrong/incomplete comment" this whole phase exists to eliminate, and it currently has no deferral-register entry.

This is a legitimate, narrower-scope gap than the prior round's — the specific defects previously cited are fixed, but closer scrutiny of the fixed file surfaced defects that survived the fix (or were newly exposed by it). Given the phase's own review process caught this on a second pass, a third closure round scoped narrowly to the 5 `missing` items above should be tractable and should not require reopening the sweep's already-verified 35 sites or the runtime fix.

---

_Verified: 2026-07-15T22:10:00Z_
_Verifier: Claude (gsd-verifier)_
