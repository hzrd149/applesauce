---
phase: 05-cache-identity-memo-fix
verified: 2026-07-15T19:03:21Z
status: gaps_found
score: 4/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The cache helper's source carries a comment distinguishing identity memos (must NOT survive a spread) from carry-forward payloads (MUST survive a spread), so a future cleanup cannot collapse the two conventions onto one write mechanism (ROADMAP Success Criterion 2 / CACHE-02)."
    status: failed
    reason: "The taxonomy prose landed by 05-01/05-03 is not sound: its own two 'machine-readable definitions' are false for the examples they cite, one write site is classified into a category whose defining property the same sentence says it must violate, and 14 hand-rolled write sites now carry a comment asserting a property ('must not survive a spread') that the code beneath them does not have. A false comment is what caused CONCORD-H01 in the first place; this phase has re-introduced the same failure mode at a larger scale (14 sites vs. 1) while believing it fixed it."
    artifacts:
      - path: "packages/core/src/helpers/cache.ts"
        issue: "Category 3 ('accumulated state') is defined as being defined by the event-store.ts:219 merge list `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`. Verified against the actual code: SeenRelaysSymbol (the doc's own first example) is NOT in that list — it merges separately at event-store.ts:212-217. The gift-wrap Seal/Rumor/GiftWrap symbols (the doc's second example) live in applesauce-common and have zero hits in applesauce-core — they are not merged by anything, let alone this list. And the list's third member, EncryptedContentSymbol, is the same symbol this same file classifies into categories 1 and 2 elsewhere. Filing one symbol under three categories via the document's own 'machine-readable definition' is exactly the convention-collapse Success Criterion 2 exists to prevent (CR-01)."
      - path: "packages/core/src/helpers/cache.ts"
        issue: "setEncryptedContentCache (encrypted-content.ts) is classified as an 'identity memo' and, in the same sentence, the doc says its write must stay enumerable 'so it keeps surviving the pipe's spreads' — but the doc's own opening thesis defines the write-site question as 'must THIS WRITE survive a spread?', and 'yes' means carry-forward payload by the doc's own rule, not identity memo. The classification contradicts the taxonomy's own decision rule at its single worked example (CR-02)."
      - path: "packages/common/src/helpers/encrypted-content-cache.ts"
        issue: "Lines 38-40: the comment on markEncryptedContentFromCache claims EncryptedContentFromCacheSymbol is 'propagated across duplicate events the same way FromCacheSymbol is (applesauce-core's event-store.ts:219 merge list)'. Verified false: EncryptedContentFromCacheSymbol (Symbol.for('encrypted-content-from-cache')) appears nowhere in packages/core/src — it is not in that merge list and is not propagated by anything. isEncryptedContentFromCache gates the persist pipeline, so an author trusting this false comment will assume restore-provenance survives dedup and not test the path where it doesn't (CR-04)."
      - path: "packages/core/src/casts/cast.ts"
        issue: "Line 56-57 and 13 sibling sites (filter.ts:24, event.ts:129, hidden-tags.ts:105, hidden-tags.ts:150, contacts.ts:95, app-data.ts:66, bookmark.ts:102, emoji-pack.ts:104, emoji-pack.ts:123, groups.ts:108, lists.ts:48, mute.ts:88, trusted-assertions.ts:90) each carry a comment reading 'must not survive a spread — identity memo' directly above a plain enumerable Reflect.set(event, symbol, value) call. Object spread copies enumerable own symbol properties, so these values DO survive a spread — the opposite of what the comment claims. Verified concretely at cast.ts: `{ ...event }` inherits the SAME Map by reference (aliased mutable state, not just a stale value), and at filter.ts: getIndexableTags's memo rides onto `{ ...event, tags: newTags }` so filter matching on the copy evaluates the original's tags. These sites are only masked today by eventPipe's delete loop scrubbing them on one call path — that is a coincidence of one code path, not the invariant the comments assert (CR-05)."
      - path: "packages/core/src/helpers/__tests__/cache.test.ts"
        issue: "Lines ~88-95: the comment claims migrating encrypted-content.ts:117's write, common/operations/gift-wrap.ts:121's write, or operations/tags.ts's write onto setCachedValue would turn this suite red 'immediately — that is its job'. Verified false for all three: encrypted-content.ts's unlock path is never executed by this test (the fixture's hasHiddenTags() is false so modifyHiddenTags never reaches unlock); common/operations/gift-wrap.ts lives in a different package this test file does not import and cannot affect; and migrating operations/tags.ts's write would still pass, because stamp/sign copy the symbol via Reflect.has/get/set, which are enumerability-blind, with no intervening spread between the write and sign(). The suite is a valid smoke test that the pipe preserves plaintext today; it is not the enforcement guard its own comment says it is (CR-03)."
    missing:
      - "Rewrite cache.ts's category-3 ('accumulated state') prose to stop citing event-store.ts:219 as a single machine-readable definition; either name the real propagation mechanism per example (merge list for FromCacheSymbol/verifiedSymbol; separate element-wise merge at event-store.ts:212-217 for SeenRelaysSymbol; shared-object-reference propagation, not a merge at all, for common's Seal/Rumor/GiftWrap symbols) or drop the 'machine-readable definition' framing for category 3 outright."
      - "Reclassify setEncryptedContentCache's write site as carry-forward payload (not identity memo) and state the real reason it hand-rolls an enumerable write: its purpose is memoization, but its write must still survive modifyPublicTags's `{ ...draft, tags }` spread on the unlock-then-modify path, so 'must this write survive a spread?' = yes = carry-forward, not memo."
      - "Fix or remove the encrypted-content-cache.ts:38-40 false citation to the event-store.ts:219 merge list; state plainly that EncryptedContentFromCacheSymbol is not propagated across duplicate events at all."
      - "USER DECISION (authoritative, recorded here for gap closure): for the 14 'must not survive a spread — identity memo' comments sitting above enumerable Reflect.set writes, THE COMMENTS ARE WRONG — REWORD THEM. These sites are intentionally enumerable; do NOT convert them to non-enumerable/setCachedValue — that was explicitly considered and rejected for this phase. Resolution is comment-only, staying inside 05-03's original comment-only, zero-behavior-change scope."
      - "Either delete cache.test.ts's false 'enforcement contract' claim (lines ~88-95) or rewrite the carry-forward test to actually exercise an intervening spread between the hidden-tag write and sign() (e.g. insert a public-tag operation between modifyHiddenTags and sign in the pipe) so the claim becomes true instead of asserted."
human_verification: []
---

# Phase 5: Cache Identity Memo Fix Verification Report

**Phase Goal:** A value memoized onto a config object by `applesauce-core`'s cache helper does not survive an object spread, so a rolled-forward copy recomputes its derivation instead of returning the source's stale memo — the single root cause behind three HIGH concord findings.
**Verified:** 2026-07-15T19:03:21Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (Success Criterion 1) A value written by `setCachedValue`/`getOrComputeCachedValue` is stored non-enumerable, so a spread with a changed field recomputes instead of returning the stale memo. | ✓ VERIFIED | `packages/core/src/helpers/cache.ts:52-53,62` — both writes use `Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true })`. `cache.test.ts`'s "cache identity memos" suite exercises this directly. Reintroducing the defect (flipping to `enumerable: true`) turned 2/6 `cache.test.ts` cases red; restoring the fix turned them green again (independently reproduced). |
| 2 | (Success Criterion 2 / CACHE-02) The cache helper's source carries a comment distinguishing identity memos from carry-forward payloads, so a future cleanup cannot collapse the two conventions. | ✗ FAILED | See `gaps` above (CR-01, CR-02, CR-04, CR-05) — the taxonomy's own "machine-readable definitions" are false for the examples they cite, one write site is self-contradictorily classified, a false citation exists in a downstream file, and 14 sweep-commented sites assert a property the code does not have. |
| 3 | (Success Criterion 3 / CACHE-03) `getEncryptedContent`/`getHiddenTags` still return correct plaintext off a signed event built through the factory pipe's spread operations. | ✓ VERIFIED | `packages/core/src/helpers/__tests__/cache.test.ts`'s "carry-forward payloads" suite drives a real `eventPipe(modifyHiddenTags, sign)` through real nip04 encryption and real signing; suite green. Reviewer confirmed the underlying mechanism (`operations/tags.ts:87-90`'s object-literal write, `PRESERVE_EVENT_SYMBOLS`) is untouched by the 05-01 fix. |
| 4 | (Success Criterion 4) `pnpm -r test` passes across the full workspace against the 1989-test baseline, exit 0. | ✓ VERIFIED | Independently re-run: `vitest run` → 1997 passed \| 2 skipped across 250 files, exit 0 (baseline 1989 + 8 new cases from 05-02/05-04, correctly accounted for). `turbo build --filter='./packages/*'` → 14/14. |
| 5 | (Success Criterion 5 / TEST-01, anchor only) A test derives the expected epoch-N control address from the CORD-02 §4 formula independently and asserts a rolled-forward object matches it, closing H01(a)/H01(c); non-vacuous. | ✓ VERIFIED | `keys.test.ts`/`channel-rekey.test.ts` compute expected values solely via `crypto.ts`'s `controlGroupKey`/`channelGroupKey`, never touching `rollForward`/`deriveConcordKeys`/`rollForwardChannel`. Reintroducing the cache defect was independently observed to turn exactly these two named tests red, with the other 17 concord tests unaffected — proving non-vacuity. TEST-01 itself is correctly left standing/unchecked (Phases 5-12), not closed here. |
| 6 | (05-02 PLAN must-have / "D-13 enforcement contract") A future cleanup that migrates `EncryptedContentSymbol`'s carry-forward write sites onto `setCachedValue` turns the carry-forward test half red immediately. | ✗ FAILED | `cache.test.ts:88-95`'s comment makes this claim for three named sites (`encrypted-content.ts`, `common/operations/gift-wrap.ts`, `operations/tags.ts`). Verified false for all three (CR-03): the `encrypted-content.ts` unlock path is never executed by this fixture; `common/operations/gift-wrap.ts` is a different package this test file cannot import or affect; and the `operations/tags.ts` migration would still pass, because `stamp`/`sign`'s `Reflect.has`/`get`/`set` copy is enumerability-blind and no spread intervenes before `sign()`. |

**Score:** 4/6 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/helpers/cache.ts` | Non-enumerable writes + sound taxonomy prose | ⚠️ PARTIAL | Write mechanism (Task 1) is correct and verified. Taxonomy prose (Task 2) exists but is unsound — see gaps. |
| `.changeset/cache-identity-memo-non-enumerable.md` | Patch changeset, single-sentence body | ✓ VERIFIED | Exists, single package/patch bump, single-sentence body (not independently re-derived beyond orchestrator's confirmation; low risk). |
| `packages/core/src/helpers/__tests__/cache.test.ts` | Two-sided convention test | ⚠️ PARTIAL | Both halves pass and are non-vacuous (Probe A/B independently reproduced by orchestrator). The file's own "enforcement contract" claim (lines 88-95) is false — see gap 6. |
| 35 sweep-commented write sites (core + common) | Category comment citing `cache.ts` taxonomy | ⚠️ PARTIAL | All 35 sites do carry a comment (comment-only diff confirmed, 113 insertions / 22 deletions, zero non-comment lines). 14 of those comments assert a false property of the code beneath them (CR-05). Comment *presence* is complete; comment *correctness* is not. |
| `packages/concord/src/helpers/keys.ts` (BaseKeysSymbol / ChannelPlaneKeysSymbol comments) | Corrected CONCORD-H01 reasoning | ✓ VERIFIED (with a minor, non-blocking note) | Comment-only correction confirmed; cites CONCORD-H01, non-enumerable fix, and the JSON.stringify/spread asymmetry. WR-09 (a wording nit: "hand-rolled" misapplied to `baseKeysFor`, which always called the shared helper) is a warning-level inaccuracy, not part of the user's authorized fix scope, and does not block this phase. |
| `packages/concord/src/helpers/__tests__/keys.test.ts`, `channel-rekey.test.ts` | Spec-derived H01(a)/H01(c) regression tests | ✓ VERIFIED | Confirmed non-self-referential (expected values via `crypto.ts` only) and non-vacuous (orchestrator's defect-reintroduction probe). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `cache.ts` write mechanism | `pipeline.ts`'s `Reflect.deleteProperty` | `configurable: true` flag | ✓ WIRED | Both writes carry `configurable: true`; full suite green including all `eventPipe` call sites. |
| `cache.ts` taxonomy prose | `event-store.ts:219` merge list | Cross-reference cited as "machine-readable definition" | ✗ NOT WIRED (false citation) | The cited line does not define what the prose claims it defines for any of the three named examples (CR-01). |
| `encrypted-content-cache.ts:38` | `event-store.ts:219` merge list | Comment claims propagation via that list | ✗ NOT WIRED (false citation) | `EncryptedContentFromCacheSymbol` has zero hits in `packages/core/src` (CR-04). |
| `cache.test.ts`'s carry-forward suite | `encrypted-content.ts` / `common/operations/gift-wrap.ts` / `operations/tags.ts` | "Enforcement contract" comment | ✗ NOT WIRED (false claim) | Test does not exercise 2 of 3 named sites and would not fail if the 3rd were migrated (CR-03). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CACHE-01 | 05-01, 05-02, 05-05 | Memo does not survive a spread | ✓ SATISFIED | Non-enumerable write confirmed; memo-drop test confirmed non-vacuous. |
| CACHE-02 | 05-01, 05-03, 05-05 | Taxonomy documents identity-memo vs. carry-forward distinction, preventing convention collapse | ✗ BLOCKED | Taxonomy is internally unsound (CR-01, CR-02, CR-04) and 14 sweep comments assert a false property (CR-05). REQUIREMENTS.md and ROADMAP.md both already mark this `[x]`/`Complete` — that marking is premature; see Bookkeeping note below. |
| CACHE-03 | 05-02 | Carry-forward path intact through pipe + signing | ✓ SATISFIED | Real-pipe test green; mechanism unchanged and confirmed untouched. |
| TEST-01 | 05-04, 05-05 | Standing, cross-phase (Phases 5-12); anchored, not closed, at Phase 5 | ✓ CORRECTLY ANCHORED | Two non-vacuous, non-self-referential spec-derived tests landed per this phase's slice. `REQUIREMENTS.md` correctly leaves the master TEST-01 checkbox unchecked, consistent with its own standing-criterion rule. |

No orphaned requirements: all four requirement IDs mapped to Phase 5 in `REQUIREMENTS.md`'s traceability table (CACHE-01, CACHE-02, CACHE-03, TEST-01) are claimed by at least one of the five plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/helpers/cache.ts` | 19-23 | False "machine-readable definition" (self-referential documentation bug) | 🛑 Blocker | Defeats Success Criterion 2's purpose; a future author following the doc's own instructions misclassifies. |
| `packages/core/src/helpers/cache.ts` | 31-38 | Self-contradictory classification of `setEncryptedContentCache` | 🛑 Blocker | Same document argues both "identity memo" and "must survive a spread" for one site. |
| `packages/common/src/helpers/encrypted-content-cache.ts` | 38-40 | False citation to a merge list the symbol is not in | 🛑 Blocker | Gates the `persist` pipeline; misleads about restore-provenance survival across dedup. |
| 14 files (cast.ts, filter.ts, event.ts, hidden-tags.ts x2, contacts.ts, app-data.ts, bookmark.ts, emoji-pack.ts x2, groups.ts, lists.ts, mute.ts, trusted-assertions.ts) | various | Comment asserts "must not survive a spread" over enumerable writes that do survive a spread | 🛑 Blocker (per-site; user-resolved as comment-only reword) | Same class of defect as CONCORD-H01's own root cause (a confidently wrong comment), now replicated at 14 sites. User has decided these sites are intentionally enumerable and the fix is wording-only — see gap entry. |
| `packages/core/src/helpers/__tests__/cache.test.ts` | 88-95 | Comment claims an enforcement contract the test does not implement for 2/3 named sites, and would not catch for the 3rd | ⚠️ Warning | Overstates test coverage; a future migration of a carry-forward site would not be caught despite the comment's confidence. |
| `packages/core/src/helpers/cache.ts` | 43-46 | `configurable`/`writable` rationale (WR-01/WR-02) factually inverted (claims a throw where the actual failure mode is `Reflect.deleteProperty` returning `false` silently) | ℹ️ Info | Not required by the user's authorized fix scope; noted for optional inclusion in gap closure. |
| `packages/core/src/helpers/cache.ts` | ~53, 62 | `Object.defineProperty` throws on frozen/non-extensible objects where `Reflect.set` previously degraded silently (WR-03) | ℹ️ Info | Undocumented behavior change; no test coverage; not part of the user's authorized fix scope for this verification round. |

No `TBD`/`FIXME`/`XXX` debt markers found in any file touched by this phase.

### Bookkeeping Issue (flag for gap closure)

`.planning/ROADMAP.md:32` already reads:
```
- [x] **Phase 5: Cache Identity Memo Fix** ... (completed 2026-07-15)
```
`.planning/REQUIREMENTS.md:16` and its traceability table (line 118) already mark **CACHE-02** as `[x]` / `Complete`. Both were flipped when the 5th SUMMARY landed, **before this verification ran**. Given Success Criterion 2 / CACHE-02 fails, both markings are premature and should be reverted to `[ ]` / `Pending` as part of gap closure, then re-flipped only once a re-verification passes.

### Human Verification Required

None. Every truth in this phase is resolvable by static/code inspection, grep, and the orchestrator's independently-reproduced test runs (including defect-reintroduction probes) — no visual, runtime-only, or external-service behavior is involved.

### Gaps Summary

Phase 5's runtime fix (Success Criterion 1: non-enumerable cache writes) is real, correct, and proven non-vacuous — the orchestrator independently confirmed this by reintroducing the defect and observing the predicted concord test failures. Success Criteria 3, 4, and 5 are also genuinely met.

Success Criterion 2 — the phase's *documentation* deliverable — is not met. The taxonomy in `cache.ts` was meant to stop a future cleanup from collapsing the identity-memo and carry-forward conventions by making the distinction legible and checkable. Instead:

1. Its two self-declared "machine-readable definitions" (`event-store.ts:219` for category 3, implicitly restated at `encrypted-content-cache.ts:38-40`) are false for every example they cite.
2. One write site (`setEncryptedContentCache`) is classified into "identity memo" while the same sentence gives it the defining property of "carry-forward payload" — a direct self-contradiction at the taxonomy's own worked example.
3. Fourteen sweep-commented write sites across `core` and `common` now assert "must not survive a spread — identity memo" over code that demonstrably does survive a spread (verified concretely at `cast.ts` — an aliased shared `Map` — and `filter.ts` — a memo that rides a tag-changing spread). These are unremediated CONCORD-H01 instances the phase has now annotated as though they were correct, which is strictly worse than no comment because the next author will trust them.
4. The new `cache.test.ts` file's own "enforcement contract" comment overclaims what the test actually guards (CR-03) — a smaller instance of the same class of problem, now inside the very test meant to prevent it.

The user has already ruled on the highest-volume item (the 14-site false comment class, finding 3): **the comments are wrong and should be reworded**; these sites are intentionally enumerable, and converting them to non-enumerable / migrating them onto `setCachedValue` was explicitly considered and rejected. Gap closure for that item is therefore comment-only, within 05-03's original zero-behavior-change scope. The other three items (the two false "machine-readable definition" citations and the test file's overclaimed enforcement contract) do not yet have an explicit user ruling and should be resolved per the `<missing>` items listed in this report's frontmatter `gaps` section — all are also comment/prose-only fixes with no proposed behavior change.

Separately, both `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` already record Phase 5 / CACHE-02 as complete — that bookkeeping was written before verification and should be reverted alongside gap closure.

---

_Verified: 2026-07-15T19:03:21Z_
_Verifier: Claude (gsd-verifier)_
