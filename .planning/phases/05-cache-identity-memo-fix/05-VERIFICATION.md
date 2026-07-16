---
phase: 05-cache-identity-memo-fix
verified: 2026-07-16T05:30:00Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
overrides: []
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "cache.ts's worked example no longer claims an exhaustive 'TWO write sites, BOTH carry-forward payload' count for EncryptedContentSymbol. It now reads 'has multiple write sites (this list is non-exhaustive)' and correctly names three illustrative sites spanning both remaining categories: operations/tags.ts's modifyHiddenTags (carry-forward), helpers/encrypted-content.ts's setEncryptedContentCache (carry-forward), and EventStore.copySymbolsToDuplicateEvent's merge loop (accumulated state) — verified against all three sites' actual source."
    - "The worked example is now reconciled with event-store.ts's own merge-loop comment instead of contradicting it: both comments agree EncryptedContentSymbol's merge-loop write is accumulated state, and cache.ts explicitly uses this as proof that one symbol can be category-mixed across write sites."
    - "packages/common/src/helpers/groups.ts's getHiddenGroups comment no longer reads as a soundness endorsement. It retains the true descriptor mechanics and now discloses, by name, the undefined-memoization defect, its consequence chain through isHiddenGroupsUnlocked/unlockHiddenGroups, and routes the reader to STATE.md's Deferred Items table (05-13) — confirmed present and legible on read."
    - "packages/common/src/helpers/encrypted-content-cache.ts's unparseable 'goes untested' fragment is gone. markEncryptedContentFromCache's comment is now a complete, legible warning about persistEncryptedContent's filter, and honestly marks the fail-open reachability as unverified rather than fabricating certainty (05-13)."
    - ".changeset/cache-frozen-event-throws.md re-bumped patch -> minor, matching the confirmed unconditional, escape-hatch-free blast radius; the sibling cache-identity-memo-non-enumerable.md changeset correctly stayed at patch (05-12)."
    - "STATE.md's Deferred Items table now carries durable, greppable rows for the getHiddenGroups defect, the WR-07 cross-review finding-ID collision, and the two round-3 supersessions (full taxonomy reconciliation; Truth 6/D-13 probe) — all four confirmed present with the required specificity (05-14)."
    - "ROADMAP.md's Phase 5 checklist line and status-table row no longer claim Complete; both correctly read an open, in-gap-closure phase with no completion date (05-14)."
  gaps_remaining:
    - "cache.ts's frozen-event throw disclosure (the part of the file the plan itself designates as surviving the redesign, not superseded) still ships a false, self-contradictory reachability claim: it asserts both stores call getExpirationTimestamp 'unconditionally before any kind or replaceable branching' and, three lines later, names 'the ONE carve-out' as kinds.EventDeletion — which is itself a kind branch, directly contradicting the 'before any kind... branching' framing. Worse, the disclosure omits a second, distinct early return (this.deletes.check(event) in both EventStore.add and AsyncEventStore.add) that also bypasses getExpirationTimestamp regardless of kind. 05-12's own SUMMARY confirms the executor traced BOTH early returns before writing the comment, yet only one made it into the shipped text — the SUMMARY's claim that 'the deletion carve-out is stated explicitly, matching what was actually traced' overclaims fidelity to what was actually shipped."
  regressions: []
gaps:
  - truth: "(ROADMAP Success Criterion 2 / CACHE-02) The cache helper's source carries a comment distinguishing identity memos from carry-forward payloads, so a future cleanup cannot collapse the two conventions onto one write mechanism."
    status: failed
    reason: "Round 3 (05-12/05-13/05-14) genuinely fixed the worked example's exhaustive-count falsehood that failed the prior round — this is real, verified progress. But a fresh, independent read of the same file's frozen-event throw disclosure (also touched by round 3, in the part of the file explicitly designed to survive the eventual redesign) finds a new falsehood of the identical defect class: an exhaustive-sounding claim ('the ONE carve-out') that is false because a second, distinct carve-out exists and is omitted. This is the third round in which cache.ts's prose has shipped a confirmed-false claim; the specific defect changed shape but the failure mode (overclaiming exhaustiveness without full verification) recurred inside the very passage a prior round dedicated to fixing."
    artifacts:
      - path: "packages/core/src/helpers/cache.ts"
        issue: "Lines 106-114: 'both EventStore.add and AsyncEventStore.add call it unconditionally before any kind or replaceable branching ... The one carve-out: both stores return early for kinds.EventDeletion before reaching that call.' Self-contradictory on its face (a kind check IS a kind branch, so the call is not 'before any kind... branching'), and additionally incomplete: event-store.ts:242 and async-event-store.ts:209 both contain a SECOND early return (this.deletes.check(event) / await this.deletes.check(event)) that also precedes getExpirationTimestamp and is not named anywhere in the comment. A reader relying on 'the one carve-out' to reason about which events reach the throw would wrongly conclude a previously-tombstoned kind-1 note reaches getExpirationTimestamp, when it actually returns early via the deletes-check path and never does."
    missing:
      - "Rewrite cache.ts:106-114 to name BOTH early returns that precede getExpirationTimestamp in event-store.ts's and async-event-store.ts's add(): the kinds.EventDeletion kind check AND the separate this.deletes.check(event) tombstone check. Either drop 'the ONE carve-out' framing (since there are two) or enumerate both explicitly. Reconcile 'unconditionally before any kind or replaceable branching' with the fact that a kind branch (EventDeletion) already precedes the call — the accurate claim is that the call is unconditional with respect to the isReplaceable classification, not that no kind-based branch precedes it at all."
      - "Revert .planning/REQUIREMENTS.md:16 ('- [x] **CACHE-02**') and :118 ('| CACHE-02 | Phase 5 | Complete (05-12) |') to their pre-05-12 state ('- [ ] **CACHE-02**' and 'Pending — taxonomy unsound (see 05-VERIFICATION.md)') until this gap closes. The [x] was set by an automated requirements.mark-complete bookkeeping step triggered by 05-12's requirements-completed: [CACHE-02] frontmatter (commit b52dea73), not by a verifier's considered judgment — 05-12's plan text never claimed CACHE-02 would fully close, and 05-14's own SUMMARY explicitly flags this exact tension as unresolved and hands it to verify-phase."
    human_verification: []
human_verification: []
---

# Phase 5: Cache Identity Memo Fix Verification Report

**Phase Goal:** A value memoized onto a config object by `applesauce-core`'s cache helper does not survive an object spread, so a rolled-forward copy recomputes its derivation instead of returning the source's stale memo — the single root cause behind three HIGH concord findings.
**Verified:** 2026-07-16T05:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — round-3 gap-closure (plans 05-12..05-14) against the prior VERIFICATION.md's CACHE-02 failure

## Scope Note

Per the orchestrator's explicit instructions, Success Criteria 1, 3, 4, and 5 PASSED a prior verification round and are **not reopened** — the runtime fix (non-enumerable memo writes in `cache.ts`) is correct and untouched by any round-3 plan. They are cheaply reconfirmed below. This re-verification's entire substance is **Success Criterion 2 / CACHE-02** — the cache helper's taxonomy comment — scored on what `cache.ts` actually asserts today, not on round 3's stated intent or on any SUMMARY's self-reported pass status.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC1 / CACHE-01, not reopened) A value written by `setCachedValue`/`getOrComputeCachedValue` is non-enumerable, so a spread recomputes instead of returning the stale memo. | ✓ VERIFIED | `packages/core/src/helpers/cache.ts:120-122,130` — both writes still use `Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true })`, byte-identical to the previously-passed state (round 3's plans explicitly forbid touching function bodies and every task carries a hard empty-non-comment-diff gate). |
| 2 | (SC2 / CACHE-02) The cache helper's source carries a comment distinguishing identity memos from carry-forward payloads, so a future cleanup cannot collapse the two conventions. | ✗ FAILED | The prior round's headline defect — the worked example's false, exhaustive "TWO write sites, BOTH carry-forward" claim — is genuinely fixed and independently re-verified against source (see Requirements Coverage / gaps_closed). But `cache.ts:106-114`'s frozen-event throw disclosure — the specific passage round 3's Task 1 (05-12) was dedicated to correcting — now contains a new, confirmed falsehood: it claims the call is "before any kind... branching" and then names "the ONE carve-out," when a second, distinct carve-out (`this.deletes.check(event)`) exists in both `EventStore.add` and `AsyncEventStore.add` and is not disclosed. Confirmed directly by reading `event-store.ts:236-245` and `async-event-store.ts:203-212`, not by trusting `05-12-SUMMARY.md`'s narration (which itself proves the omission — see Anti-Patterns). |
| 3 | (SC3 / CACHE-03, not reopened) `getEncryptedContent`/`getHiddenTags` still return correct plaintext off a signed event built through the factory pipe's spread operations. | ✓ VERIFIED | Independently re-run: `pnpm --filter applesauce-core test -- cache.test.ts` → 635/635 passing (57 files), including the "carry-forward payloads" suite driving a real `eventPipe(modifyHiddenTags, includeAltTag, sign)` through nip04 encryption and signing. |
| 4 | (SC4, not reopened) `pnpm -r test` passes across the full workspace against the 1989-test baseline. | ✓ VERIFIED | Per orchestrator's independently-confirmed facts at this HEAD: 1997 passed, 2 skipped, 250 test files, exit 0. Post-merge build 14/14 packages, exit 0. Working tree confirmed clean; `packages/core/src/operations/tags.ts` confirmed free of any probe edit. |
| 5 | (SC5 / TEST-01, anchor only, not reopened) Correctly left standing/unchecked at Phase 5. | ✓ VERIFIED | `.planning/REQUIREMENTS.md:120` — "Pending — cross-cutting; does NOT close at Phase 5." Correctly not claimed complete. `.planning/ROADMAP.md:240` restates the standing-criterion closure rule. |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/helpers/cache.ts` | Non-enumerable writes + sound, accurate taxonomy prose | ⚠️ PARTIAL | Write mechanism (Task 1 of round 1) remains byte-identical and correct. Taxonomy prose: the worked example is now fixed and accurate (verified against `operations/tags.ts:90`, `helpers/encrypted-content.ts:125`, `event-store.ts:216-224`). The frozen-throw disclosure at lines 106-114 is not — see gaps. |
| `.changeset/cache-frozen-event-throws.md` | Accurate, correctly-scoped changeset | ✓ VERIFIED | Confirmed on disk: `"applesauce-core": minor`, single-sentence body unchanged. Matches the confirmed unconditional, escape-hatch-free blast radius. |
| `.changeset/cache-identity-memo-non-enumerable.md` | Untouched sibling changeset | ✓ VERIFIED | Still `patch`, byte-identical per 05-12's own scope fence. |
| `packages/common/src/helpers/groups.ts` | Discloses the `getHiddenGroups` defect instead of ratifying the site | ✓ VERIFIED | Read in full: retains the true descriptor mechanics, then explicitly labels "KNOWN, DELIBERATELY-DEFERRED DEFECT" with the full consequence chain (`getOrComputeCachedValue`'s `Reflect.has` gate → poisoned `undefined` memo → `isHiddenGroupsUnlocked`'s presence check satisfied → `unlockHiddenGroups` returns `undefined` against its `Promise<GroupPointer[]>` signature) and points at `.planning/STATE.md`'s Deferred Items table. No soundness-endorsement language (`redundant, not load-bearing` / `correctly does not survive`) remains. |
| `packages/common/src/helpers/encrypted-content-cache.ts` | Legible provenance warning, no unparseable fragment | ✓ VERIFIED | Read in full: the "goes untested" fragment is gone. `markEncryptedContentFromCache`'s comment is a complete sentence naming the mechanism, the merge-list non-membership (still correctly NOT in `copySymbolsToDuplicateEvent`'s list), and honestly states the fail-open reachability is "unverified here" rather than asserting it — matches 05-13's mandate to prefer an honest "unverified" over a fabricated claim. |
| `.planning/STATE.md` | Durable Deferred Items rows for the `groups.ts` defect, the finding-ID collision, and the two supersessions | ✓ VERIFIED | All four rows present (`getHiddenGroups`; `WR-07`/`05-REVIEW` collision; CACHE-02 taxonomy supersession; Truth 6/D-13 probe supersession), matching the existing table's column shape, agreeing with `groups.ts`'s landed comment. |
| `.planning/ROADMAP.md` | Phase 5 not marked Complete in either location | ✓ VERIFIED | Checklist line unchecked with `(in gap closure — CACHE-02 open, reduced round-3 scope)`; status-table row reads `In gap closure`, no completion date. Consistent with this verification's own finding. |
| `.planning/REQUIREMENTS.md` | CACHE-02 status consistent with actual code state | ✗ INCONSISTENT | Line 16 (`[x]`) and line 118 (`Complete (05-12)`) claim CACHE-02 is done. This directly contradicts ROADMAP.md's "CACHE-02 open" and STATE.md's "Superseded ... reduced scope" framing, and contradicts this verification's own finding that a confirmed falsehood remains in `cache.ts`. Root cause identified precisely: commit `b52dea73` ("docs(05-12): mark CACHE-02 complete in requirements traceability"), a standalone automated `requirements.mark-complete` step driven by 05-12's `requirements-completed: [CACHE-02]` frontmatter — not a verifier's judgment. `05-14-SUMMARY.md` itself flags this exact tension as unresolved and explicitly routes it to verify-phase. This verification resolves it: the `[x]` is NOT justified by the code and should be reverted. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `cache.ts`'s worked example | `event-store.ts:216-224`'s merge loop | Cross-reference / category-mixing claim | ✓ WIRED | The worked example's claim that `EncryptedContentSymbol`'s merge-loop write is accumulated state now matches `event-store.ts:222-224`'s own comment word-for-word in substance. No contradiction. |
| `cache.ts`'s worked example | `operations/tags.ts:90`, `helpers/encrypted-content.ts:125` | Carry-forward site citations | ✓ WIRED | Both cited sites read and confirmed to match the prose exactly (object-literal write at `tags.ts:90`; `Reflect.set` write at `encrypted-content.ts:125`, function name `setEncryptedContentCache` confirmed). |
| `cache.ts`'s frozen-throw disclosure | `EventStore.add` / `AsyncEventStore.add` | Reachability scoping claim | ✗ NOT WIRED (still false) | `event-store.ts:236` (`kinds.EventDeletion`) and `event-store.ts:242` (`this.deletes.check(event)`) are BOTH early returns preceding `event-store.ts:245`'s `getExpirationTimestamp(event)` call; `async-event-store.ts:203` and `:209` mirror this exactly. The comment names only the first as "the one carve-out." |
| `groups.ts`'s comment | `.planning/STATE.md`'s Deferred Items table | Forward reference to deferral record | ✓ WIRED | The comment's routing pointer resolves to an actual row; confirmed both sides agree on the defect and its consequence chain. |
| `.planning/REQUIREMENTS.md`'s CACHE-02 status | `packages/core/src/helpers/cache.ts`'s actual content | Traceability accuracy | ✗ NOT WIRED | `[x]` / "Complete (05-12)" does not match the code's actual state (a confirmed falsehood remains). See Bookkeeping Issue below. |

### Data-Flow Trace (Level 4)

Not applicable — this phase is a shared-helper/comment-accuracy phase with no UI/dashboard data-flow surface.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Non-enumerable memo write still in place | `Read packages/core/src/helpers/cache.ts:120-122,130` | `Object.defineProperty(..., { enumerable: false, ... })` present, unchanged | ✓ PASS |
| `cache.test.ts` (memo + carry-forward suites) passes | `pnpm --filter applesauce-core test -- cache.test.ts` | 635/635 tests passed, 57 files | ✓ PASS |
| Worked example's cited write sites match source | `Read operations/tags.ts:90`, `helpers/encrypted-content.ts:117-131`, `event-store.ts:216-224` | All three sites match the prose's claims about mechanism and category | ✓ PASS |
| `EventStore.add` / `AsyncEventStore.add` carve-out count | `Read event-store.ts:236-245`, `async-event-store.ts:203-212` | TWO early returns precede `getExpirationTimestamp` in both stores (`kinds.EventDeletion` and `this.deletes.check`), not one | ✓ PASS (confirms the residual WR-02 defect is real, not misread) |
| No debt markers in round-3-touched files | `grep -rn "TBD\|FIXME\|XXX"` across `cache.ts`, `groups.ts`, `encrypted-content-cache.ts`, `.changeset/cache-frozen-event-throws.md` | 0 matches | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention in this repository. Round 3 shipped no runtime-affecting change (all comment/prose-only, per the empty-non-comment-diff gate on every task); the Truth 6/D-13 non-vacuity probe was explicitly dropped as superseded by the symbol-propagation redesign decision (`.planning/STATE.md`'s Deferred Items, row 4) and is correctly not re-litigated here.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CACHE-01 | 05-01, 05-02, 05-05 | Memo does not survive a spread | ✓ SATISFIED | Not reopened; re-confirmed unchanged. |
| CACHE-02 | 05-01, 05-03, 05-06..05-14 | Taxonomy documents identity-memo vs. carry-forward distinction accurately | ✗ BLOCKED | Worked example now accurate (round 3's genuine fix). Frozen-throw disclosure — in the part of the file the plan itself designates as outliving the eventual redesign — still ships a confirmed false/self-contradictory reachability claim. `.planning/REQUIREMENTS.md`'s `[x]`/"Complete (05-12)" is **not justified by the code** and traces to an automated bookkeeping commit (`b52dea73`), not a verifier's judgment — see Bookkeeping Issue. |
| CACHE-03 | 05-02, 05-10 | Carry-forward path intact through pipe + signing | ✓ SATISFIED | Not reopened; re-confirmed via direct test re-run (635/635). |
| TEST-01 | 05-04, 05-05 | Standing, cross-phase (Phases 5-12); anchored, not closed, at Phase 5 | ✓ CORRECTLY ANCHORED | `REQUIREMENTS.md:120` correctly leaves it Pending/standing. |

No orphaned requirements: all four IDs mapped to Phase 5 in `REQUIREMENTS.md`'s traceability table are claimed by at least one of the fourteen plans (05-12/13/14 each declare `requirements: [CACHE-02]` or, for 05-14, all four as anchor/bookkeeping references).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/helpers/cache.ts` | 106-114 | Frozen-event throw disclosure is self-contradictory ("unconditionally before any kind... branching" vs "the ONE carve-out") and omits a second, confirmed carve-out (`this.deletes.check`) that its own author's SUMMARY says was traced but not written | 🛑 Blocker | Directly defeats CACHE-02's purpose in the one passage explicitly designated to outlive the eventual taxonomy deletion — this is the third round in which `cache.ts` has shipped a confirmed-false exhaustiveness claim. |
| `.planning/REQUIREMENTS.md` | 16, 118 | CACHE-02 marked `[x]` / "Complete (05-12)" via an automated `requirements.mark-complete` bookkeeping step, not a verifier's judgment, and contradicted by ROADMAP.md/STATE.md/this verification's own finding | 🛑 Blocker (bookkeeping) | A future reader trusting REQUIREMENTS.md alone would incorrectly believe CACHE-02 is closed; `05-14-SUMMARY.md` itself flags this as an open tension routed to verify-phase, which this report resolves by recommending revert. |
| `05-12-SUMMARY.md` | "Decisions Made" | SUMMARY claims "the deletion carve-out is stated explicitly, matching what was actually traced" when the trace found TWO carve-outs and only one was written into the shipped comment | ⚠️ Warning | Not a code defect, but an executor self-report that overclaims fidelity between what was traced and what shipped — exactly the kind of SUMMARY claim this verification exists to check against the actual file rather than trust. |
| `.planning/ROADMAP.md` | ~62-64 | "Plans: 13/14 plans executed" and 05-14's checklist entry still unchecked, despite `05-14-SUMMARY.md` existing with `status: complete` | ℹ️ Info | Self-referential ordering artifact (05-14 could not mark itself complete while still executing) rather than a defect; orchestrator-level bookkeeping, not scored against CACHE-02. |

No `TBD`/`FIXME`/`XXX` debt markers found in any of the round-3-touched files.

### Bookkeeping Issue (root-caused this round)

`.planning/REQUIREMENTS.md:16` and `:118` mark CACHE-02 `[x]` / "Complete (05-12)". This is traced to a single, isolated commit — `b52dea73` ("docs(05-12): mark CACHE-02 complete in requirements traceability") — produced by an automated `requirements.mark-complete` step because plan 05-12's frontmatter declared `requirements: [CACHE-02]` / `requirements-completed: [CACHE-02]`. It is **not** evidence that CACHE-02 is satisfied; 05-12's own plan text never claims full closure ("cache.ts ships no known-false claim" was the stated bar, and that bar is not met — see gaps). `.planning/ROADMAP.md` (correctly) and `.planning/STATE.md` (correctly, via its Superseded/reduced-scope framing) both disagree with REQUIREMENTS.md, and `05-14-SUMMARY.md` explicitly documents the discrepancy and declines to resolve it, routing the decision to verify-phase.

**Resolution:** REQUIREMENTS.md's `[x]` is NOT justified by the code as it exists at this HEAD. Recommend reverting `.planning/REQUIREMENTS.md:16` to `- [ ] **CACHE-02**: ...` and `:118` to `| CACHE-02 | Phase 5 | Pending — taxonomy unsound (see 05-VERIFICATION.md) |` until the frozen-throw disclosure gap closes and a subsequent re-verification passes.

### Human Verification Required

None. All findings in this round were confirmed directly against source (`cache.ts`, `event-store.ts`, `async-event-store.ts`, `groups.ts`, `encrypted-content-cache.ts`, `.changeset/*`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`) and by running `pnpm --filter applesauce-core test -- cache.test.ts` directly. No claim in this report rests on SUMMARY narration alone.

### Gaps Summary

Round 3 made real, verifiable progress: the worked example's exhaustive "TWO write sites, BOTH carry-forward" falsehood — the specific defect that failed the prior verification round — is fixed and now reconciled with `event-store.ts`'s own comment about the same symbol. `groups.ts` and `encrypted-content-cache.ts`'s comments are both fixed to disclose rather than obscure. The changeset bump is corrected. STATE.md and ROADMAP.md now tell an internally consistent, honest story about the phase's open status.

However, **Success Criterion 2 / CACHE-02 still fails.** The frozen-event throw disclosure — the one part of `cache.ts` that round 3's own plan explicitly designated as surviving the eventual symbol-propagation redesign, i.e. squarely in scope and not excused by supersession — ships a new, confirmed falsehood: it claims the reachability call happens "before any kind... branching" and then names "the ONE carve-out," when a second carve-out (`this.deletes.check`) also precedes the call in both `EventStore.add` and `AsyncEventStore.add`. This was traced by 05-12's own executor (per its SUMMARY's "Decisions Made" section) but not written into the shipped comment — the SUMMARY's claim of fidelity to the trace does not match what was actually shipped. This is the third round in which this file has shipped a confirmed-false, exhaustive-sounding claim; the shape of the defect changed, but the pattern (overclaiming completeness without full verification) recurred inside the exact passage a prior round was dedicated to correcting.

Separately, `.planning/REQUIREMENTS.md`'s CACHE-02 `[x]`/"Complete" marking is not justified by the code and traces to automated bookkeeping rather than a verifier's judgment; this report resolves that open tension (flagged unresolved by `05-14-SUMMARY.md`) by recommending it be reverted to `[ ]`/Pending.

Given the narrow, single-paragraph scope of the remaining defect and the demonstrated pattern of round-3 plans successfully fixing everything else they targeted, a fourth closure round scoped narrowly to `cache.ts:106-114` (name both carve-outs explicitly) plus the `REQUIREMENTS.md` revert should be tractable without reopening any of the sweep's already-verified work or the runtime fix.

---

_Verified: 2026-07-16T05:30:00Z_
_Verifier: Claude (gsd-verifier)_
