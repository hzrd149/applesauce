---
phase: 15-concord-stream-auth-cleanup
plan: 09
subsystem: auth
tags: [nip-42, concord, stream-signers, gift-wrap]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: per-operation waitForAuth/onAuthRequired plumbing (D-01/D-02/D-06/D-15/D-16), the scope-owned StreamSigners holder (client/auth.ts)
provides:
  - "ConcordCommunity.heldChannelKeys(): every public AND private channel key this community holds, fed into openLive()/reconcileLive()'s publish-side signer registration"
  - "wrapForTarget's widened return { wrap, rumorId, key } carrying the exact GroupKey that finalized the wrap"
  - "publishToPlane registers wrapForTarget's own returned key immediately before publishing, with the false 'already registered' comment removed"
  - "a private-channel send regression test inside the publish-answerability oracle, proven RED against the pre-fix source and GREEN against the fix"
affects: [15-10, 15-11, 15-12, 15-13, 15-14, phase-15-reverification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "publish-side registry wider than subscription/read set — the community publishes on behalf of private channels its sub-engine reads (D-06 asymmetry made explicit by two distinctly-named methods)"
    - "carry a resolved key out of an async builder instead of re-resolving it after an await, to avoid a concurrent-mutation race (mirrors WR-01's rekey-path precedent)"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "heldChannelKeys() derives from this.keys.channels intersected with non-deleted state$ channels, dropping the !c.private clause publicChannelKeys() keeps — the community's own StreamSigners already skips a keyless private channel entirely (CHAN-01), so no extra guard was needed"
  - "publishToPlane registers wrapForTarget's returned key directly rather than re-resolving via planeKeyFor(this.keys, target) after the await, closing the same class of race WR-01 documents on the rekey path"
  - "streamPublishOptions's doc comment reworded to avoid the literal string 'planeKeyFor' — pre-existing unrelated doc comments at community.ts:186-190/1017-1018 already reference that name in prose, so the plan's literal 'grep -c planeKeyFor is 0' acceptance criterion could not be met verbatim without editing unrelated code; the semantic property (no second key resolution call in publishToPlane) holds and was verified by inspection (no import, no `planeKeyFor(` call site in the file)"

requirements-completed: [CAUTH-01]

coverage:
  - id: D1
    description: "A private-channel send's waitForAuth pubkey is registered in the community's own StreamSigners, so the recorded onAuthRequired handler authenticates it when the relay names it as missing"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key"
        status: pass
    human_judgment: false
  - id: D2
    description: "wrapForTarget returns the exact GroupKey that finalized the wrap (wrap.pubkey === key.pk), for control, private-channel, and ephemeralSk-supplied targets"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#ConcordKeys > wrapForTarget returns the GroupKey that finalized the wrap (CR-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The community's live subscription author set is unchanged (currentAuthors() still resolves through publicChannelKeys() only) — the widening is publish-side only, proven by the existing two-communities-share-one-relay isolation test staying green"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts (two communities sharing one relay each authenticate only their own authors...)"
        status: pass
    human_judgment: false

duration: ~11min
completed: 2026-08-18
status: complete
---

# Phase 15 Plan 09: Register private-channel keys into the publish-side signer registry Summary

**Closed CR-01/GAP 1: `ConcordCommunity.heldChannelKeys()` widens the publish-side `StreamSigners` registry to cover private channels, and `wrapForTarget`'s returned `GroupKey` — not a second `planeKeyFor` resolution — is what `publishToPlane` registers, so every private-channel send's `waitForAuth` pubkey is now answerable by the community's own holder.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-08-18T09:46:53Z (base commit)
- **Completed:** 2026-08-18T09:57:08Z (last task commit, UTC-equivalent of the +01:00 timestamps above)
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added `ConcordCommunity.heldChannelKeys()` (public AND private channel keys this community holds) and wired it into both `openLive()`'s and `reconcileLive()`'s `this.signers.register(...)` calls, while `currentAuthors()` keeps resolving through the unchanged, public-only `publicChannelKeys()`
- Widened `wrapForTarget`'s return type to `{ wrap, rumorId, key }` (additive) so the exact `GroupKey` that finalized a wrap travels out of the builder instead of being re-derived after an `await`
- `publishToPlane` now registers that exact key immediately before publishing and the false "already registered by the walk and openLive()" comment at the call site is gone, replaced by the true invariant
- Added a regression test: a private-channel `sendMessage` inside the existing publish-answerability oracle, with a named (non-circular) assertion pinning that the send's `waitForAuth` pubkey is answerable by its own recorded handler — proven RED against the pre-fix `community.ts` and GREEN against the fix

## Task Commits

Each task was committed atomically:

1. **Task 1: Register every channel key the community HOLDS, without widening what it READS** - `25b4a3c7` (fix)
2. **Task 2: Carry the finalizing GroupKey out of wrapForTarget so the publish's declared key and its registration cannot drift** - `69cd5daa` (fix)
3. **Task 3: Regression test — a private-channel send is answerable by the community's own holder** - `4d8ddfd7` (test)

_No TDD-cycle splitting was used — each task's implementation and any directly-associated test additions landed in one commit per the plan's task boundaries._

## Files Created/Modified
- `packages/concord/src/client/community.ts` - Added `heldChannelKeys()`; repointed `openLive()`/`reconcileLive()` registration to it; narrowed `publicChannelKeys()`'s doc comment; `publishToPlane` now registers `wrapForTarget`'s returned key and the false "no registration needed" comment is replaced
- `packages/concord/src/helpers/keys.ts` - `wrapForTarget` returns `{ wrap, rumorId, key }` (additive), doc comment states the contract
- `packages/concord/src/helpers/__tests__/keys.test.ts` - New test pinning `wrap.pubkey === key.pk` for control, private-channel, and ephemeralSk-supplied targets
- `packages/concord/src/client/__tests__/community.test.ts` - Extended the publish-answerability scenario with a private-channel send, a named answerability assertion, and a raised anti-vacuity floor

## Decisions Made
- `heldChannelKeys()`'s filter is `!c.deleted` only (drops `publicChannelKeys()`'s `!c.private` clause) — `this.keys.channels` is already the exact held set (CHAN-01 skips keyless private channels), so no extra guard was added
- The private-channel's message-plane pubkey for Task 3's named assertion is derived from the pool's own recorded-publish list (`recorded[beforeSendCount]`), not read back from `community`'s `StreamSigners` — keeps the assertion non-circular per the plan's explicit instruction
- `streamPublishOptions`'s comment avoids the literal string `planeKeyFor` (see Deviations) — the semantic "no second resolution" property is satisfied (no `planeKeyFor` import or call site exists in `community.ts`; only pre-existing, unrelated doc-comment prose at lines 186-190/1017-1018 mentions the name)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - acceptance-criterion mismatch, not a code bug] Task 2's literal `grep -c 'planeKeyFor'` acceptance criterion could not be met at 0**
- **Found during:** Task 2 verification
- **Issue:** The plan's acceptance criterion `grep -c 'planeKeyFor' packages/concord/src/client/community.ts is 0` assumes no other reference to the name exists in the file. Pre-existing, unrelated doc comments at `community.ts:186-190` (the composer-guard doc comment) and `:1017-1018` (the `requireChannelKey` doc comment) already mention `planeKeyFor` in prose, and predate this plan (verified via `git show HEAD~1:...` before Task 1's commit).
- **Fix:** Reworded my own new comment in `publishToPlane` to avoid the literal string `planeKeyFor`, so the count stays at the pre-existing 5 rather than growing to 6. Verified the underlying semantic property directly: `publishToPlane` never imports or calls `planeKeyFor` — the only remaining mentions are prose in comments unrelated to this task's files.
- **Files modified:** `packages/concord/src/client/community.ts`
- **Verification:** `grep -n "^import\|planeKeyFor(" packages/concord/src/client/community.ts` shows zero actual call sites; `grep -c 'planeKeyFor'` is 5 (pre-existing, unchanged by this plan)
- **Committed in:** `69cd5daa` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (acceptance-criterion mismatch against pre-existing unrelated code, Rule 1 disposition)
**Impact on plan:** No scope creep. The literal grep count could not reach 0 without editing files outside this plan's declared `files_modified`; the load-bearing property ("publishToPlane uses wrapForTarget's returned key, never a second resolution") is verified true by direct inspection and is what the criterion was actually protecting.

## Non-Vacuity Probe (Task 3, recorded verbatim per plan instruction)

**Method:** Copied the fixed `community.ts` aside, replaced it with `git show 9b2b3028:packages/concord/src/client/community.ts` (the commit immediately before Task 1), rebuilt (`pnpm turbo build --filter=applesauce-concord...`, exit 0), then ran `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts`.

**RED result:** 1 failed / 63 passed. The new scenario failed inside the existing structural assertion loop (not yet reaching the new named assertion, since the loop iterates every stream record including the private-channel send first):

```
FAIL  packages/concord/src/client/__tests__/community.test.ts > ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key
AssertionError: expected [] to deeply equal [ Array(1) ]

- Expected
+ Received

- [
-   "6e22b6a8be597996f10b01f3dd8fe83aeba3dbee46def90d18f56f142fa04caa",
- ]
+ []

 ❯ community.test.ts:3673:46
    expect(authCalls.map((c) => c.pubkey)).toEqual([record.event.pubkey]);
```

The private channel's message-plane pubkey (`6e22b6a8be597996f10b01f3dd8fe83aeba3dbee46def90d18f56f142fa04caa` in this run) was named in the failure — its recorded `onAuthRequired` handler found no registered signer for it and authenticated nothing, confirming the pre-fix registry gap CR-01 describes.

**Restore + GREEN:** Restored the fixed `community.ts` from the saved copy (`git diff --stat` showed zero diff, confirming an exact restore), rebuilt, and reran: `Test Files 1 passed (1)`, `Tests 64 passed (64)`.

## Issues Encountered
None beyond the acceptance-criterion mismatch documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CAUTH-01's truth now holds for the day-to-day private-channel write path: `heldChannelKeys()` feeds the publish-side registry, and `publishToPlane` registers exactly the key `wrapForTarget` finalized the wrap with
- Plans 15-10 (WR-03/WR-04 auth failure reporting), 15-11 (WR-05/WR-08 example holders + guard roots) are unblocked wave-1 siblings with no dependency on this plan's changes
- `packages/concord` remains unreleased — no changeset created, per 15-CONTEXT.md § Phase Boundary
- REQUIREMENTS.md's CAUTH-01 checkbox is intentionally left untouched by this plan (per STATE.md's note: deliberately left for the re-verification pass, not edited during gap closure)

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/helpers/keys.ts
- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-09-SUMMARY.md
- FOUND commit: 25b4a3c7 (Task 1)
- FOUND commit: 69cd5daa (Task 2)
- FOUND commit: 4d8ddfd7 (Task 3)
- FOUND commit: acfa3cf6 (SUMMARY commit)
