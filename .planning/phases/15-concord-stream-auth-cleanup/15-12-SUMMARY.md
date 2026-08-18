---
phase: 15-concord-stream-auth-cleanup
plan: 12
subsystem: auth
tags: [nip-42, concord, rekey, refounding, status-observable, stream-signers]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "the one-source-key principle plan 15-09 established for wrapForTarget on the plane-publish path; the StreamSigners holder and its onAuthFailure sink shape (D-06/D-13) community.ts/private-channel.ts already used; plan 15-10's failNoSigner zero-answer report, reused here as the WR-02 test's trigger"
provides:
  - "buildChannelRekey returns rekeyKey: GroupKey — the exact address that finalized its wraps"
  - "RefoundingPlan gains rekeyKey (root-roll) and channelRekeyKeys (bundled channel rekeys), one source per address, no caller-side recomputation possible"
  - "rotateChannel()/refound() register from the plan's own returned key(s); no channel-rekey address is derived from this.material.community_root anywhere in community.ts"
  - "an auth failure at any point in either engine's lifetime — not just at walk-end — reaches error$ (and status$.error) immediately, with no second walk required"
affects: [phase-15-reverification, concord-stream-auth-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "carry the finalizing key out of the async builder that sealed the wraps, rather than re-deriving it from mutable engine state after an await — the structural variant of the one-source principle 15-09 applied to wrapForTarget, now applied to the rekey builders themselves"
    - "sink a per-operation failure callback directly into an existing granular $ status field (error$) instead of adding a new status leg — reuse over extension, matching D-10/D-13"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/helpers/__tests__/channel-rekey.test.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/private-channel.test.ts

key-decisions:
  - "Deliberate deviation from the verifier's literal WR-01 remedy: instead of a pre-await priorRoot snapshot local in community.ts, the builders (buildChannelRekey/buildRefounding) return the GroupKey they actually finalized the wraps with, and both call sites register that value. A snapshot local still leaves two independent derivations of the same address that a future edit can desync again; carrying the key out of the builder makes the desync unrepresentable rather than merely less likely."
  - "The WR-01 regression test injects the mid-flight root mutation via a spy on signer.nip44.encrypt (buildChannelRekey's own internal await), not via admin.vacFor as the plan's action text suggested — vacFor is awaited BEFORE buildChannelRekey is called, so a single mutation there is read by both the builder's argument and the later recomputation, producing no divergence. The nip44.encrypt injection point lands strictly between the wraps being sealed and the post-build registration re-reading this.material, which is the actual race checkRekey()'s 200ms timer creates. This choice is confirmed correct by the required RED->GREEN non-vacuity probe below."
  - "WR-02's post-walk regression test in both engines reuses plan 15-10's failNoSigner zero-answer path (a relay naming a pubkey the scope's StreamSigners holds no signer for at all) as the trigger, rather than fabricating a rejected relay.authenticate response — it exercises the exact onAuthFailure sink this plan wires into error$, with no new pool-fixture machinery needed."

requirements-completed: [CAUTH-01]

coverage:
  - id: D1
    description: "buildChannelRekey and buildRefounding return the GroupKey(s) that actually finalized their wraps (rekeyKey, channelRekeyKeys), additive to their existing return shapes, including the priorRoot case a caller-side recomputation from material would get wrong"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/channel-rekey.test.ts — pk-equals-wraps-pubkey assertions on both builders plus 'buildChannelRekey's rekeyKey matches the wraps even when priorRoot differs from material.community_root'"
        status: pass
    human_judgment: false
  - id: D2
    description: "rotateChannel() and refound() register the exact key their own plan finalized the wraps with; no channel-rekey address is derived from this.material.community_root anywhere in community.ts; a mid-flight community-root change leaves every rekey publish answerable"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > rotateChannel registers the key that actually finalized the wraps, even if the community's root changes mid-flight (WR-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An auth failure at any point in either engine's lifetime (not just walk-end) reaches error$ immediately, with no second walk, and the message reaches status$'s error leg; a fresh walk still clears stale error state; no new status surface was added"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > a post-walk zero-answer auth rejection reaches error$ immediately with no second start() call, and status$'s error leg reflects it (WR-02)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/private-channel.test.ts#ConcordPrivateChannel post-walk auth failure -> error$ (WR-02) > a post-walk zero-answer auth rejection reaches error$ immediately with no second walk, and status$'s error leg reflects it"
        status: pass
    human_judgment: false

# Metrics
duration: ~25min
completed: 2026-08-18
status: complete
---

# Phase 15 Plan 12: Rekey registration one-source fix + live auth-failure surface (WR-01/WR-02) Summary

**`buildChannelRekey`/`buildRefounding` now return the `GroupKey` that actually finalized their wraps, so `rotateChannel()`/`refound()` register from the plan instead of recomputing a channel-rekey address that a concurrent `adoptRefounding()` can desync; and a NIP-42 rejection at any point in either engine's lifetime — not just at walk-end — now surfaces on the existing `error$` observable immediately.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-18T11:01:15+01:00 (base commit)
- **Completed:** 2026-08-18T11:26:11+01:00 (last task commit)
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- `buildChannelRekey` widened to return `rekeyKey: GroupKey` (additive); `RefoundingPlan` widened with `rekeyKey`/`channelRekeyKeys` — the exact address(es) that finalized the wraps, carried out of the builder rather than left for a caller to re-derive
- `rotateChannel()` and `refound()` both register from the plan's own returned key(s); `channelRekeyGroupKey` has zero remaining call sites in `community.ts`, and `this.material.community_root` is never read to derive a rekey address anywhere in the file
- A regression test forces the community's key state to change strictly between `buildChannelRekey`'s wrap-sealing and `rotateChannel`'s post-build registration (via a spy on the builder's own internal `nip44.encrypt` await) and asserts every recorded rekey publish stays answerable — proven RED against the restored pre-fix registration, GREEN against the fix, with an exact-restore diff check
- The latched `authFailure` field is deleted from both `ConcordCommunity` and `ConcordPrivateChannel`; `StreamSigners`'s `onAuthFailure` callback now sinks directly into `error$.next(message)`, so a rejection during the live subscription, any publish, `reconcileLive`'s catch-up sync, or `checkRekey` surfaces without waiting for a second walk
- `start()`/`walk()` still reset `error$` to `null` at the top (same position) so a fresh walk clears stale state; the walk-end re-read of the latched field is deleted since the sink already pushed any failure as it happened
- New post-walk coverage in both engines proves a zero-answer auth rejection (plan 15-10's `failNoSigner` path) reaches `error$` and `status$.error` immediately with no second `start()`/`walk()` call

## Task Commits

Each task was committed atomically:

1. **Task 1: Return the finalizing rekey keys from the builders that produce the wraps** - `c701ef07` (feat)
2. **Task 2: Register rekey keys from the plan, deleting both post-await recomputations** - `2b18ce64` (fix)
3. **Task 3: Make an auth failure a live value on error$ instead of a latched field** - `b1a3a8e6` (feat)

_No plan-metadata commit issued in worktree mode — the orchestrator handles shared-file writes after merge._

## Files Created/Modified

- `packages/concord/src/helpers/keys.ts` - `buildChannelRekey` returns `rekeyKey`; `RefoundingPlan` gains `rekeyKey`/`channelRekeyKeys`, populated inside the existing bundled-channel-rekey loop; both changes are purely additive
- `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` - Added `pk`-equals-wraps-pubkey assertions to the existing `buildChannelRekey`/`buildRefounding` cases, plus a new `priorRoot`-divergence case proving the returned key is correct even when a caller-side recomputation from `material` would get it wrong
- `packages/concord/src/client/community.ts` - `rotateChannel()`/`refound()` register `plan.rekeyKey`/`plan.channelRekeyKeys` instead of recomputing `channelRekeyGroupKey(hexToBytes(this.material.community_root), ...)`; removed the now-dead `channelRekeyGroupKey` import; deleted the `authFailure` field; constructor's `StreamSigners` sink now writes `error$` directly; `start()` resets `error$` at the top and no longer re-reads a latched field at walk-end
- `packages/concord/src/client/__tests__/community.test.ts` - Added the WR-01 mid-flight-root regression test (with its RED/GREEN non-vacuity probe) and the WR-02 post-walk zero-answer `error$`/`status$` test
- `packages/concord/src/client/private-channel.ts` - Identical `authFailure` deletion and `error$` sink wiring on the sub-engine's `walk()`
- `packages/concord/src/client/__tests__/private-channel.test.ts` - Added the mirrored WR-02 post-walk zero-answer `error$`/`status$` test, with a local `authOraclePool`/`authRequiredCtx` fixture pair (this file had no pre-existing scoped-AUTH oracle describe block to extend)

## Decisions Made

- See `key-decisions` in the frontmatter for the three load-bearing decisions (WR-01's structural deviation, the `nip44.encrypt` injection point for the regression test, and reusing plan 15-10's `failNoSigner` path as the WR-02 test trigger).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - test-mechanism correction] The plan's suggested `admin.vacFor` spy injection point for Task 2's regression test does not reproduce the WR-01 race**

- **Found during:** Task 2, while implementing the regression test
- **Issue:** The plan's action text says: *"A spy on `admin.vacFor` that mutates the engine before resolving is the cleanest injection point, since it is the first await in the method."* Tracing `rotateChannel()`'s control flow: `vacFor` is awaited and fully resolves BEFORE `buildChannelRekey(this.material, ...)` is even called — `this.material` is read fresh, synchronously, at that call site. A single mutation performed inside `vacFor`'s mock (however it schedules the mutation relative to its own promise settling) necessarily completes before `this.material` is read for `buildChannelRekey`'s argument. That means both `buildChannelRekey`'s captured material AND the later post-build recomputation (`this.material.community_root`, read after `await buildChannelRekey(...)` resolves, with no further await in between in the pre-fix code) would observe the *same*, already-mutated value — producing no divergence, and therefore no reproducible RED against the pre-fix registration.
- **Fix:** Injected the mutation via a spy on `signer.nip44.encrypt` — the actual internal `await` inside `buildChannelRekey`'s own blobs-building loop, which runs strictly AFTER `buildChannelRekey` has captured its `material` parameter (protecting the wraps' actual seal address, computed from that captured reference) but BEFORE `rotateChannel`'s post-build code re-reads `this.material` a second time. This deterministically lands the mutation in the exact window the WR-01 defect described, with no microtask-timing guesswork required.
- **Files modified:** `packages/concord/src/client/__tests__/community.test.ts`
- **Verification (mandatory non-vacuity probe, recorded verbatim below):** confirmed RED against the restored pre-fix registration, GREEN against the fix, with an exact-restore diff check (`diff` exit 0) proving the fixed source was byte-identical after the probe.
- **Committed in:** `2b18ce64` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (test-mechanism correction, Rule 1 disposition — the plan's literal suggested injection point did not achieve its own stated goal; the goal itself, and every acceptance criterion built on it, is achieved by the corrected mechanism).
**Impact on plan:** No scope creep. The production-code fix (Task 2's registration change) is exactly as the plan specified. Only the TEST's internal mutation-injection mechanism differs from the plan's literal suggestion; the test's assertions, its target method (`rotateChannel`), its use of `publishCoveragePool`, and its RED/GREEN non-vacuity requirement are all unchanged from the plan's instructions.

## Non-Vacuity Probe (Task 2, recorded verbatim per plan instruction)

**Method:** Extracted `community.ts` as committed at the wave's base commit (`b03f4d76`, before Task 1/2's edits) via `git show b03f4d76:packages/concord/src/client/community.ts`, saved the current fixed file aside, restored the pre-fix version, and ran the new regression test in isolation.

**RED result** (against the restored pre-fix registration — the recomputation from `this.material.community_root` after the awaits):

```
FAIL  packages/concord/src/client/__tests__/community.test.ts > ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > rotateChannel registers the key that actually finalized the wraps, even if the community's root changes mid-flight (WR-01)
AssertionError: expected [] to deeply equal [ Array(1) ]

- Expected
+ Received

- [
-   "8755fd24866a7c6b37ca2cca10d809120ac063763d95ba37522c4bfc38c2bef9",
- ]
+ []

 ❯ packages/concord/src/client/__tests__/community.test.ts:3773:46
    expect(authCalls.map((c) => c.pubkey)).toEqual([record.event.pubkey]);
```

The recorded rekey publish's `waitForAuth` author was NOT authenticated by the recomputed-and-registered key — the pre-fix registration desynced from what the wraps were actually sealed under, exactly the WR-01 defect.

**Restore + GREEN:** Restored the fixed `community.ts` from the saved copy; `diff` against the saved copy exited 0 (byte-identical restore, no accidental drift). Reran the full `community.test.ts` suite: `Test Files 1 passed (1)`, `Tests 65 passed (65)`.

## Issues Encountered

- Same pre-existing, unrelated fresh-worktree issue plan 15-10 documented: several workspace packages' `dist/` outputs were stale/absent when this worktree was created (`applesauce-core`, `applesauce-signers`, `applesauce-common`, `applesauce-relay`, `applesauce-loaders` for the concord suite; additionally `applesauce-actions`, `applesauce-content`, `applesauce-accounts`, and the rest of the dependency chain for the `applesauce-examples` build). Not a code defect — resolved by running `pnpm turbo build --filter='./packages/*'` (which handles dependency ordering) before running the concord test suite and the examples build. `pnpm --filter applesauce-examples build` then exited 0 with only pre-existing, unrelated bundling warnings (chunk-size, sourcemap, CJS-in-ESM from third-party deps). Grepped the concord example files (`apps/examples/src/examples/concord/`) for `authFailure`/`.authenticated`/`authenticated$` before this rebuild confirmed none reference the symbols this plan removed — the D-19/plan-15-11 migration already made them operation-scoped, so this plan's changes touch none of their code paths.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-01 and WR-02 both closed: `community.ts` has zero remaining channel-rekey address derivations, and an auth failure at any point in either engine's lifetime reaches `error$`/`status$.error` immediately
- `pnpm --filter applesauce-concord build` exits 0; `pnpm --filter applesauce-concord test` is green at 593 passed / 0 skipped across 55 files (up from 591/55 after plan 15-09's wave); `pnpm --filter applesauce-examples build` exits 0
- `packages/concord` remains unreleased — no changeset created, per 15-CONTEXT.md § Phase Boundary
- REQUIREMENTS.md's CAUTH-01 checkbox is intentionally left untouched by this plan (per STATE.md's note: deliberately left for the re-verification pass, not edited during gap closure)
- Remaining phase-15 gap-closure plans (15-13, 15-14) are unaffected by this plan's scope and can proceed independently

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: packages/concord/src/helpers/keys.ts
- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/private-channel.ts
- FOUND: packages/concord/src/helpers/__tests__/channel-rekey.test.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: packages/concord/src/client/__tests__/private-channel.test.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-12-SUMMARY.md
- FOUND commit: c701ef07 (Task 1)
- FOUND commit: 2b18ce64 (Task 2)
- FOUND commit: b1a3a8e6 (Task 3)
- FOUND commit: 9c50872a (SUMMARY commit)
