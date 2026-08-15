---
phase: 15-concord-stream-auth-cleanup
plan: 05
subsystem: auth
tags: [nip-42, concord, relay-auth, rxjs, vitest]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-04's scope-owned StreamSigners wiring in ConcordCommunity/ConcordPrivateChannel (reads) — this plan extends the same holder to every publish"
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-01's StreamSigners/createUserAuthHandler primitives (client/auth.ts)"
provides:
  - "streamPublishOptions(event) on ConcordCommunity — derives waitForAuth/onAuthRequired from the event's own pubkey at all nine publish sites, so D-16 cannot be got wrong by hand-typing the wrong key"
  - "The one NIP-59 exception (grantChannelAccess's Direct-Invite) explicit and commented: waitForAuth: true, answered by a threaded userOnAuthRequired"
  - "ConcordClient builds one createUserAuthHandler instance and threads it into ConcordInviteManager and every ConcordCommunity it constructs (D-08)"
  - "ConcordInviteManager gets its own StreamSigners scope for invite-link keys, distinct from both the user handler and any community's stream keys"
  - "A structural publish-answerability oracle proving every publish declares an author its own holder (or the user's) can actually authenticate"
affects: [15-06, 15-07, 15-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "streamPublishOptions(event) helper: derive waitForAuth/onAuthRequired FROM the event being published, never hand-typed per call site — makes the D-16 defect class (wrong key at one of nine sites) structurally unrepresentable"
    - "Register-before-publish: every authoring key (channel-rekey GroupKey, invite-link secret key, new-epoch control/guestbook) is registered into the scope's StreamSigners immediately before the publish that needs it to answer"
    - "One user handler per owning engine (D-08): ConcordClient builds createUserAuthHandler ONCE in its constructor and threads the same instance into ConcordInviteManager and every ConcordCommunity — never reconstructed per call"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/invite-manager.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "grantChannelAccess's Direct-Invite grant is the one deliberate deviation from streamPublishOptions: DirectInviteFactory.create generates and destroys an ephemeral author key internally, so waitForAuth: [wrap.pubkey] would name a key no client can ever hold. It gets waitForAuth: true answered by a new userOnAuthRequired option threaded from ConcordClient — commented at the site naming D-16/D-17."
  - "refound()'s channel-rekey wraps and root-roll wraps both use streamPublishOptions via the shared requireMajority closure; the channel-rekey addresses are recomputed (channelRekeyGroupKey over the PRIOR root, one per channelRekeys entry) and registered immediately before that half of the loop, mirroring rotateChannel's own registration."
  - "Two of this plan's acceptance-criteria greps (a literal 'waitForAuth: \\[' count of 2, and a literal 'pool.publish(\\|pool.request(' match in client.ts/invite-manager.ts) undercount against the actual code: openLive()'s pre-existing waitForAuth: authors is a variable, not a bracket literal, and prettier line-wraps `this.pool\\n  .publish(...)` across two lines. The underlying invariants both criteria intend to check (no publish hand-types its own waitForAuth array; every publish/request call site passes an options object) are satisfied and verified structurally by Task 3's oracle — recorded here as a same-outcome literal mismatch, not a functional gap."

requirements-completed: [CAUTH-01, CAUTH-03]

coverage:
  - id: D1
    description: "All nine ConcordCommunity publishes carry auth options derived from the event being published (streamPublishOptions), each authoring key registered before its publish; the one NIP-59 Direct-Invite exception is explicit and commented"
    requirement: CAUTH-01
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key"
        status: pass
    human_judgment: false
  - id: D2
    description: "ConcordClient builds one createUserAuthHandler instance and threads it into ConcordInviteManager and every ConcordCommunity; saveCommunityList's publish, the user's own list read, and the join-by-link invite-bundle read all carry waitForAuth/onAuthRequired"
    requirement: CAUTH-01
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#ConcordClient community list (DI, no network) > saveCommunityList's publish carries waitForAuth: [pubkey] answered by the user's own handler (15-05 Task 3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ConcordInviteManager holds its own StreamSigners scope for invite-link keys; its invite-list read/save route through the threaded user handler, revokeBundle answers with the link key's own handler (different author than the user, D-17)"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (582/582 pass, 55 files) — invite-manager.ts wiring exercised via existing revoke/create/save invite tests plus this plan's new saveCommunityList/publish-answerability assertions"
        status: pass
    human_judgment: false
  - id: D4
    description: "No publish or user-scoped read leaves waitForAuth/onAuthRequired undefined; no call site overrides authRetries/authTimeout; the whole concord suite and the examples app both build/pass"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (582/582 pass, 55 files)"
        status: pass
      - kind: other
        ref: "grep -rn 'authRetries|authTimeout' packages/concord/src returns matches ONLY inside test-file assertions (toBeUndefined checks), never production code"
        status: pass
      - kind: other
        ref: "pnpm exec turbo build --filter=applesauce-concord and --filter=applesauce-examples (both exit 0, 6/6 and 15/15 tasks respectively)"
        status: pass
    human_judgment: false

# Metrics
duration: ~55min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 05: Every Concord Publish Gets Its Own Reactive Auth Options Summary

**`streamPublishOptions(event)` derives `waitForAuth`/`onAuthRequired` from the event being published at all nine `ConcordCommunity` publish sites, `ConcordClient` builds one `createUserAuthHandler` instance threaded into the invite manager and every community, and a structural oracle proves each declared author is answerable by the holder that issued it — including the one NIP-59 Direct-Invite exception, which waits on any authenticated user and is answered by the user's own key.**

## Performance

- **Duration:** ~55 min (including diagnosis of a transient host disk-quota (EDQUOT) issue on `/tmp` that briefly broke `pnpm vitest`/`git` output relay — resolved via `TMPDIR` redirect and worktree-local redirect+Read verification; no code impact)
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 5 (3 production, 2 test)

## Accomplishments

- `ConcordCommunity.streamPublishOptions(event)`: a private helper returning `{ waitForAuth: [event.pubkey], onAuthRequired: this.signers.onAuthRequired }`, with a diagnostic-only `publishLog` trace (never a throw, never a gate) when the holder has no registered signer for the author. Wired into all nine publish sites — `rotateChannel`, `createInvite`, `refreshInviteBundles`, `revokeInvite`, `refound`'s `requireMajority`/compaction/snapshot loops, and `publishToPlane` — with each authoring key registered into `this.signers` immediately before its publish (channel-rekey `GroupKey`s recomputed the same way at both `rotateChannel` and `refound`'s channel-rekey branch; invite-link secret keys via `addSecretKey`; the new epoch's `control`/`guestbook` keys before compaction/snapshot).
- `grantChannelAccess`'s Direct-Invite grant is the one documented D-16/D-17 exception: `waitForAuth: true` answered by a new `userOnAuthRequired` option on `ConcordCommunityOptions`, since `DirectInviteFactory.create` generates and destroys its ephemeral author key internally — no client can ever hold it.
- `ConcordClient` builds `this.userOnAuthRequired = createUserAuthHandler(this.signer, () => this.user$.value?.pubkey)` once in its constructor (before `ConcordInviteManager` is constructed) and threads the same instance into the invite manager and every `addCommunity()` call. Wired at `saveCommunityList`'s publish, the user's own Community-List read (`fetchList`), and the join-by-link invite-bundle read (which waits on any authenticated user since no link-signer key is held yet).
- `ConcordInviteManager` gains its own `private readonly signers = new StreamSigners()` scope for invite-link keys — distinct from both the user handler and any community's stream keys (T-15-01). Its invite-list read and `save()`'s publish route through the threaded user handler; `revokeBundle()`'s publish registers the link's own secret key and answers with the link key's handler, since that publish's author is the link key, not the user (D-17).
- New publish-answerability oracle in `community.test.ts`: a `publish` recorder captures `{ relays, event, options }` across a scripted scenario (genesis, private-channel creation, an invite mint + revoke, a Direct-Invite grant, and a channel rotation), then loops over the *recording* — never enumerated sites — asserting every stream publish's `waitForAuth` deep-equals `[event.pubkey]` and that invoking the recorded handler actually authenticates that pubkey against a relay spy; the one grant record is asserted separately via its `waitForAuth: true` marker and answers with the user's own pubkey.
- `client.test.ts` gained an equivalent assertion for `saveCommunityList`'s publish (captures options, asserts `waitForAuth: [pubkey]`, invokes the handler, asserts the user's pubkey was authenticated) — `fakePool`'s `publish` now also records its options bag alongside the published event.

## Task Commits

Each task was committed atomically:

1. **Task 1: Give every ConcordCommunity publish its own auth options** - `08455740` (feat)
2. **Task 2: Build the client-wide user handler and wire the user-key operations** - `7742ea31` (feat)
3. **Task 3: Prove every publish is answerable by the holder that issued it** - `64b75479` (test)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `packages/concord/src/client/community.ts` - `streamPublishOptions(event)` helper; nine publish sites wired; `userOnAuthRequired` option/field for the one Direct-Invite exception; register-before-publish at every authoring-key site
- `packages/concord/src/client/client.ts` - `userOnAuthRequired` built once in the constructor via `createUserAuthHandler`; threaded into `ConcordInviteManager` and `addCommunity`; wired at `saveCommunityList`, `fetchList`, and `joinByLink`'s invite-bundle read
- `packages/concord/src/client/invite-manager.ts` - `userOnAuthRequired` option + own `StreamSigners` scope; invite-list read/`save()` use the user handler; `revokeBundle()` uses the link key's own handler
- `packages/concord/src/client/__tests__/community.test.ts` - new "publish-answerability oracle — T-15-10" describe block (publish recorder + loop-based assertion + Direct-Invite branch); one pre-existing `toHaveBeenCalledWith` assertion updated for the new third `pool.request` argument was NOT needed here (that fix landed in `client.test.ts`)
- `packages/concord/src/client/__tests__/client.test.ts` - `fakePool`'s `publish` now records options; new `saveCommunityList` auth-answerability test; fixed a pre-existing 2-arg `toHaveBeenCalledWith` assertion (Rule 1) that no longer matched `joinByLink`'s invite-bundle `pool.request` call now carrying a third options argument

## Decisions Made

- **grantChannelAccess is the sole `streamPublishOptions` exception**: documented inline with D-16/D-17 citations rather than special-cased inside the helper, keeping the helper's own contract ("derive from the event") total and the one deviation visible at its call site.
- **`userOnAuthRequired` threaded, never reconstructed**: `ConcordClient` is the single owning engine that builds `createUserAuthHandler`; `ConcordInviteManager` and every `ConcordCommunity` receive the same instance as a constructor option, matching plan 15-04's "one handler per owning engine" precedent for stream-side `StreamSigners`.
- **`refound()`'s channel-rekey registration recomputes addresses locally** (mirroring `rotateChannel`) rather than reusing a shared helper, since the two call sites derive from different local state (`plan.newEpoch` vs. each `channelRekeys` entry's own `channel.epoch + 1`) and a shared extraction would have added a public surface this plan doesn't otherwise need.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `client.test.ts`'s "scopes the pool.request filter to the empty d tag" test asserted a 2-arg call shape that no longer matched**
- **Found during:** Task 2, `pnpm vitest run packages/concord/src/client/__tests__/client.test.ts` after wiring `waitForAuth: true, onAuthRequired: this.userOnAuthRequired` into `joinByLink`'s invite-bundle `pool.request` call
- **Issue:** `expect(requestSpy).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([...]))` requires an exact argument-count match on at least one recorded call; adding the required third options argument left no call matching the 2-arg shape
- **Fix:** Added a third matcher, `expect.objectContaining({ waitForAuth: true, onAuthRequired: expect.any(Function) })`
- **Files modified:** `packages/concord/src/client/__tests__/client.test.ts`
- **Verification:** `pnpm vitest run packages/concord/src/client/__tests__/client.test.ts` (59/59, then 60/60 after Task 3's new test)
- **Committed in:** `7742ea31` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, confined to a test-file assertion shape; no production-code deviation)
**Impact on plan:** Necessary to reach the plan's own "client suite passes" verification gate for Task 2. No scope creep.

## Issues Encountered

- Same environment precondition every prior plan in this phase documented: a bare `pnpm --filter applesauce-concord build`/`test` fails on unbuilt `node_modules` symlinks. Resolved identically via `pnpm exec turbo build --filter=applesauce-concord` / `--filter=applesauce-examples`. Not a code deviation.
- Partway through final verification, the host's `/tmp` tmpfs mount hit a per-process disk quota (`EDQUOT`, errno -122) that broke `pnpm vitest`'s worker temp files and, transiently, this session's Bash-tool stdout relay for any command producing visible output (redirects to real files also failed while `/tmp` was affected). Diagnosed via `df -h` (plenty of raw space; the failure was a quota, not real exhaustion) and worked around by redirecting `TMPDIR` to a worktree-local scratch directory for `vitest`/`turbo` invocations, and by redirecting all diagnostic command output to worktree-local files (readable via the `Read` tool) rather than relying on direct stdout relay or the session scratchpad (`/tmp/claude-1000/...`, which stayed affected throughout). All verification below was re-run and confirmed green under this workaround; no code changes resulted from the diagnosis. The scratch `TMPDIR` and diagnostic files were deleted before this SUMMARY was written.

## RED->GREEN Non-Vacuity Probe (Task 3, Wave-0 requirement)

Per the task's explicit instruction, the third argument was temporarily removed from ONE community publish site (`publishToPlane`), confirmed RED against the new publish-answerability oracle, then restored (`git diff --stat packages/concord/src/client/community.ts` against the committed state came back empty after the restore, confirming an exact restore).

**Probe — `publishToPlane`'s `pool.publish` call loses its third argument:**

```ts
// TEMPORARY PROBE — third argument removed to confirm the loop below goes RED.
this.pool.publish(this.transport(), wrap).catch((err) => {
```

Running `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts -t "publish a community makes declares"` against that change produced:

```
FAIL  … > ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key
AssertionError: expected undefined to deeply equal [ Array(1) ]

- Expected:
[
  "c9c95eefee6fe8c015b5cab5eb7f9fbea2882cbc37879a61b584b67f3f811e3b",
]

+ Received:
undefined

 ❯ packages/concord/src/client/__tests__/community.test.ts:3588:42
    3586|
    3587|     for (const record of streamRecords) {
    3588|       expect(record.options.waitForAuth).toEqual([record.event.pubkey]…
       |                                          ^

Tests  1 failed | 63 skipped (64)
```

The failure names the exact publish's own recorded `event.pubkey` as the missing expectation — the loop caught the regression naming the right site, not a generic assertion failure. The probe was reverted and the full suite returned to 64/64 green (`community.test.ts`), 582/582 across the whole `applesauce-concord` package.

## Next Phase Readiness

- Every publish and user-scoped read in `applesauce-concord` now carries `waitForAuth`/`onAuthRequired`; the plan's top-level verification grep (`grep -rn '\.publish(' packages/concord/src` excluding tests) counts twelve real call sites — nine in `community.ts`, two in `invite-manager.ts`, one in `client.ts` — every one with a third options argument.
- `ConcordRelayAuth`'s only remaining production consumers stay `relay-auth.ts` and `invite-watcher.ts` (confirmed unchanged by this plan) — exactly plan 15-06/15-07's scope.
- `pnpm --filter applesauce-concord test`: 55 files, 582 tests passing (up from the pre-plan 580 — 2 new tests: the publish-answerability oracle and the `saveCommunityList` auth-answerability test).
- `pnpm exec turbo build --filter=applesauce-concord` and `--filter=applesauce-examples` both exit 0 (6/6 and 15/15 tasks).
- No blockers for 15-06.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-05-SUMMARY.md
- FOUND: 08455740 (Task 1 commit)
- FOUND: 7742ea31 (Task 2 commit)
- FOUND: 64b75479 (Task 3 commit)
- FOUND: 5d3afdbf (SUMMARY commit)
