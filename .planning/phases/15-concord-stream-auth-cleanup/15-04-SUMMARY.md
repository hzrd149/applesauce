---
phase: 15-concord-stream-auth-cleanup
plan: 04
subsystem: auth
tags: [nip-42, concord, relay-auth, rxjs, vitest]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-01's StreamSigners (client/auth.ts) — the scope-owned pubkey->signer holder every engine here constructs its own instance of"
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-02's connected$ re-homing onto connectedRelays$, freeing community.ts/private-channel.ts's status$ composites from ConcordRelayAuth"
provides:
  - "Both sync walks (sync.ts/channel-sync.ts) and both engines (community.ts/private-channel.ts) carry a scope-owned StreamSigners and pass onAuthRequired beside waitForAuth at every read site, with no per-relay driver, reference count, or challenge$ subscription"
  - "ConcordClient holds no client-wide relayAuth registry any more"
  - "A failed NIP-42 auth during a walk surfaces through error$ via a new authFailure field (D-13)"
  - "The CAUTH-02 scoped-AUTH oracle and CAUTH-04 no-suppression assertions in community.test.ts, DESIGN-DERIVED per 15-VALIDATION.md since no prior-behavior recording exists"
affects: [15-05, 15-06, 15-07, 15-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope-owned StreamSigners: ConcordCommunity and ConcordPrivateChannel each construct their OWN holder in the constructor, never passed down or shared (T-15-01)"
    - "Registration is inert: signers.register(...) makes keys resolvable but never triggers an AUTH; only a relay's actual auth-required refusal invokes onAuthRequired (D-01)"
    - "A cross-package handler-type boundary (RelayAuthHandler vs the sync loader's structurally-narrower SyncAuthHandler) is bridged with a single documented `as unknown as` cast at the one call site that crosses it, rather than widening either package's own handler type"

key-files:
  created: []
  modified:
    - packages/concord/src/client/sync.ts
    - packages/concord/src/client/channel-sync.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/__tests__/sync.test.ts
    - packages/concord/src/client/__tests__/channel-sync.test.ts
    - packages/concord/src/client/__tests__/sync-logging.test.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/private-channel.test.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "SyncLoadRequest.onAuthRequired is typed SyncAuthHandler (packages/loaders), a structurally NARROWER context (no `request` field) than applesauce-relay's RelayAuthHandler that SyncContext.onAuthRequired carries — TypeScript's contravariant function-parameter check makes a RelayAuthHandler-typed value NOT directly assignable there. Bridged with a single documented `ctx.onAuthRequired as unknown as SyncAuthHandler` cast at syncAuthors' one loader-request construction site (sync.ts), since the handler body never reads `request` — confined to that one boundary, not widened into either package's own type"
  - "The CAUTH-02 isolation test's synthesized RelayAuthContext.missingPubkeys is the UNION of both communities' authors, not each operation's own narrow set — with an exact-match `missingPubkeys`, StreamSigners.onAuthRequired's own intersect-with-missingPubkeys logic makes registry sharing mathematically unable to leak (intersect(A, A∪B) = A regardless of registry size), so the isolation claim is only genuinely exercised by a relay-controlled input naming BOTH scopes' pubkeys (T-15-09) — confirmed by RED probe 1 below"

requirements-completed: [CAUTH-01, CAUTH-02, CAUTH-04]

coverage:
  - id: D1
    description: "Both sync walks and both engines pass a scope-owned onAuthRequired beside a correctly-scoped waitForAuth at every read site; signers.register() never itself triggers an AUTH"
    requirement: CAUTH-01
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > waitForAuth matches the filter's own authors, and invoking the captured handler authenticates exactly that scoped set (CAUTH-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A relay shared by two communities is asked to authenticate only each scope's own requested pubkeys — proven even when the relay-supplied missingPubkeys is deliberately widened to the union of both scopes' authors — and a second (reconnect) auth-required cycle re-authenticates that same scoped set, never a union"
    requirement: CAUTH-02
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > two communities sharing one relay each authenticate only their own authors, and a reconnect cycle re-authenticates that same scoped set (CAUTH-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No concord call site overrides authRetries/authTimeout — the recorded live-subscription options leave both undefined, so the documented upstream defaults (1, 30_000) govern — and a second auth-required cycle is never suppressed or deduped"
    requirement: CAUTH-04
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > the recorded live-subscription options leave authRetries/authTimeout undefined (D-05/CAUTH-04), and a second auth-required cycle is never suppressed"
        status: pass
    human_judgment: false
  - id: D4
    description: "The two engines and two walks no longer construct or reference ConcordRelayAuth, ensureAuth, authDrivers, or challenge$; ConcordClient holds no relayAuth field; the full concord suite and the examples app both build/pass"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (580/580 pass, 55 files)"
        status: pass
      - kind: other
        ref: "grep -rn 'relayAuth|ensureAuth|authDrivers' packages/concord/src returns matches ONLY in client/relay-auth.ts, client/invite-watcher.ts, client/__tests__/relay-auth.test.ts"
        status: pass
      - kind: other
        ref: "pnpm exec turbo build --filter=applesauce-concord and --filter=applesauce-examples (both exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 04: Rewire Both Engines and Walks Onto Scope-Owned Auth Handlers Summary

**Both `ConcordCommunity` and `ConcordPrivateChannel` construct their own `StreamSigners` and pass `onAuthRequired` beside `waitForAuth` at every sync-walk and live-subscription call site, with no per-relay driver, reference count, or `challenge$` subscription left in either engine or `ConcordClient` -- proven by a CAUTH-02 oracle whose cross-scope isolation claim survives a relay-supplied `missingPubkeys` deliberately widened to both scopes' union.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 11 (5 production, 6 test)

## Accomplishments

- `SyncContext`/`ChannelSyncContext` replaced `relayAuth`/`ensureAuth` with `signers: StreamSigners` and `onAuthRequired: RelayAuthHandler`; `syncAuthors` threads `onAuthRequired` into the loader request beside `waitForAuth`; both `syncEpoch` (sync.ts) and both mirrored sites in `channel-sync.ts` now call `ctx.signers.register(...)` with the `ctx.ensureAuth(...)` lines deleted outright — registration no longer triggers an AUTH.
- `ConcordCommunity` and `ConcordPrivateChannel` each construct their own `StreamSigners` in the constructor (`onAuthFailure` wired to a new private `authFailure` field), delete the `authDrivers` map and private `ensureAuth()` method, swap `syncContext()`'s two members, and add `onAuthRequired: this.signers.onAuthRequired` beside `waitForAuth` in `openLive()`'s subscription options. `spawnPrivateChannel()` no longer passes `relayAuth` down — each channel owns its own holder (T-15-01).
- D-13 wired in both engines: `authFailure` resets to `null` at the top of the walk (`start()`/`walk()`) and the success-path `error$.next(null)` becomes `error$.next(this.authFailure)`, so a walk that returned nothing because a relay refused the scope's keys is now visible in `error$` instead of a silent blank.
- `ConcordClient` no longer constructs or holds a `ConcordRelayAuth`; `addCommunity`'s options object drops the `relayAuth` pass-through entirely.
- The whole test suite (sync/channel-sync/sync-logging/community/private-channel) mechanically migrated onto `signers`/`onAuthRequired`; the WR-04 auth-driver-lifecycle describe blocks in `community.test.ts` and `private-channel.test.ts` were re-derived as live-subscription transport-narrowing suites (a de-configured relay stops being targeted and records zero `authenticate` calls; a no-op extras re-emission doesn't reopen the live subscription; `dispose()` closes it) — the underlying WR-04 question is answered by the new design rather than dropped.
- New CAUTH-02/CAUTH-04 oracle in `community.test.ts`: derives the expected pubkey set from the recorded live-subscription filter's own `authors` array (never from `community.currentAuthors()`), invokes the captured `onAuthRequired` handler directly with a synthesized `RelayAuthContext`, and proves cross-scope isolation even when the relay-supplied `missingPubkeys` is widened to the union of two communities' authors sharing one relay object — plus a reconnect cycle re-authenticating the same scoped set, `authRetries`/`authTimeout` staying undefined, and the sync path's per-relay request options carrying a matching `waitForAuth` and `onAuthRequired`.
- Fixed two tests broken by removing the client-wide registry's registration/`challenge$`-triggered proactive AUTH (`client.test.ts`'s "authenticates stream keys" test and `community.test.ts`'s extras-auth-coverage test), both of which now capture and invoke the scope's own `onAuthRequired` handler directly rather than relying on the now-removed ambient mechanism.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire both walks and both engines onto scope-owned handlers** - `4f8f7883` (feat)
2. **Task 2: Migrate the existing suite and re-derive the driver-lifecycle tests** - `eed5aefb` (test)
3. **Task 3: CAUTH-02 scoped-AUTH oracle and CAUTH-04 no-suppression assertions** - `c34fdbcc` (test)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `packages/concord/src/client/sync.ts` - `SyncContext.signers`/`onAuthRequired`; `syncAuthors` threads `onAuthRequired`; `syncEpoch`'s two register-then-authenticate pairs collapse to bare `register()` calls
- `packages/concord/src/client/channel-sync.ts` - mirrored two-site edit for `syncMessagePlanes`/`syncRekeyAndAdvance`
- `packages/concord/src/client/community.ts` - own `StreamSigners`, `authFailure` field wired to `error$` (D-13), deleted `authDrivers`/`ensureAuth()`, `openLive()`/`reconcileLive()` register-only, `spawnPrivateChannel()` no longer passes `relayAuth`
- `packages/concord/src/client/private-channel.ts` - mirrored community.ts changes for the sub-engine
- `packages/concord/src/client/client.ts` - deleted `ConcordRelayAuth` import/field/construction/pass-through
- `packages/concord/src/client/__tests__/sync.test.ts`, `channel-sync.test.ts`, `sync-logging.test.ts` - `SyncContext`/`ChannelSyncContext` fixtures migrated to `signers: new StreamSigners()` / `onAuthRequired: () => {}`
- `packages/concord/src/client/__tests__/community.test.ts` - 47 `relayAuth` option-literal deletions, WR-04 describe block re-derived, extras-auth-coverage test comment/title corrected, new CAUTH-02/CAUTH-04 oracle describe block appended
- `packages/concord/src/client/__tests__/private-channel.test.ts` - 9 `relayAuth` option-literal deletions, WR-04 describe block re-derived, extras test's stale `relayCalls`/"auth registrations" assertion removed
- `packages/concord/src/client/__tests__/client.test.ts` - `fakePool` gained `subscriptionOptions` capture; the "authenticates stream keys" test rewritten to capture and invoke the community's own `onAuthRequired` handler

## Decisions Made

- **Cross-package handler-type boundary cast**: `applesauce-loaders`' `SyncLoadRequest.onAuthRequired: SyncAuthHandler` is typed against a package-local `SyncAuthContext` deliberately narrower than `applesauce-relay`'s `RelayAuthContext` (no `request` field) — its own doc comment states a `RelayAuthContext`-typed handler is NOT assignable there. `SyncContext.onAuthRequired: RelayAuthHandler` (needed so the same field also satisfies `pool.subscription()`'s `RelayAuthHandler` slot in `openLive()`) is bridged into the loader's narrower slot with one documented `as unknown as SyncAuthHandler` cast at `syncAuthors`' single loader-request construction site — the handler body never reads `request`, so the cast is safe; confined to that one boundary rather than widening either package's public type.
- **CAUTH-02 isolation test uses a UNION `missingPubkeys`, not each operation's own narrow set**: with an exact-match `missingPubkeys`, `StreamSigners.onAuthRequired`'s intersect-with-`missingPubkeys` logic makes a shared registry mathematically unable to leak regardless of registry contents (`intersect(authorsA, authorsA ∪ authorsB) = authorsA`), so an isolation test built that way could never go RED under a shared-registry regression. Widening the synthesized `missingPubkeys` to the union of both communities' authors (simulating a relay-controlled input naming pubkeys from both scopes, per T-15-09) makes the test genuinely sensitive to registry sharing — confirmed empirically by RED probe 1 below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cross-package handler-type mismatch between `applesauce-relay`'s `RelayAuthHandler` and `applesauce-loaders`' `SyncAuthHandler`**
- **Found during:** Task 1, first `pnpm exec turbo build --filter=applesauce-concord` after wiring `onAuthRequired: ctx.onAuthRequired` into `syncAuthors`' loader request
- **Issue:** `SyncContext.onAuthRequired` is typed `RelayAuthHandler` (needed so the same field satisfies `pool.subscription()`'s options in `openLive()`), but `SyncLoadRequest.onAuthRequired` expects the structurally narrower `SyncAuthHandler` (no `request` field) — TypeScript's contravariant function-parameter check rejects the wider-context handler where the narrower one is expected; `tsc` failed with `Type 'RelayAuthHandler' is not assignable to type 'SyncAuthHandler'`
- **Fix:** Imported `type { SyncAuthHandler }` from `applesauce-loaders/loaders` in `sync.ts` and cast at the single call site: `onAuthRequired: ctx.onAuthRequired as unknown as SyncAuthHandler`, with a comment explaining the boundary and why it's safe (the handler never reads `request`)
- **Files modified:** `packages/concord/src/client/sync.ts`
- **Verification:** `pnpm exec turbo build --filter=applesauce-concord` exits 0
- **Committed in:** `4f8f7883` (Task 1 commit)

**2. [Rule 1 - Bug] `community.test.ts`'s "auth driver registration covers the extras endpoint" test relied on the removed mechanism**
- **Found during:** Task 2, full-suite run after the mechanical migration
- **Issue:** The test's own comment stated `ensureAuth` was "the only observable signal for per-relay auth-driver registration" — that mechanism no longer exists (Task 1 removed it). The test still passed, but only because the sync loader's own backfill `pool.relay(url).request(...)` calls incidentally cover the same relay set — a vacuous pass against a stale premise, not a genuine assertion of anything Task 1 built
- **Fix:** Renamed the test and rewrote its comment to describe what it actually now proves (the epoch walk's own backfill requests cover the extras endpoint, not a driver-registration side effect)
- **Files modified:** `packages/concord/src/client/__tests__/community.test.ts`
- **Verification:** `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` (63/63 pass)
- **Committed in:** `eed5aefb` (Task 2 commit)

**3. [Rule 1 - Bug] `private-channel.test.ts`'s extras test asserted on the removed `pool.relay(url)` driver-registration side effect**
- **Found during:** Task 2, full-suite run — this test genuinely FAILED (not vacuously passed)
- **Issue:** `relayCalls.some((u) => u.includes("extras-extra-two"))` expected `true` after a second extras emission, relying on the removed `ensureAuth` calling `pool.relay(url)` for every transport URL on each `openLive()`. With that mechanism gone, only the live subscription retargets (via `pool.subscription()`); no fresh sync walk (and thus no `pool.relay()` call) is triggered by an extras-only change
- **Fix:** Removed `relayCalls` tracking from `extrasPrivateChannelPool()` (it no longer means anything coherent under the new design) and the test's "and auth registrations" title clause; kept the `subscriptionTargets`-based assertions, which already proved the live-subscription retargeting correctly
- **Files modified:** `packages/concord/src/client/__tests__/private-channel.test.ts`
- **Verification:** `pnpm vitest run packages/concord/src/client/__tests__/private-channel.test.ts` (11/11 pass)
- **Committed in:** `eed5aefb` (Task 2 commit)

**4. [Rule 1 - Bug] `client.test.ts`'s "community startup authenticates stream keys, not the user key" test asserted on the removed registration/`challenge$`-triggered proactive AUTH**
- **Found during:** Task 2, full `pnpm --filter applesauce-concord test` run — this test genuinely FAILED
- **Issue:** The test's `fakePool({ challenge: "challenge-abc" })` relied on `ConcordRelayAuth`'s old driver subscribing directly to `relay.challenge$` and proactively authenticating once stream keys were registered, entirely independent of any actual operation. That mechanism is exactly what D-01 removes; the fake pool's `request`/`subscription` never manufacture a genuine `auth-required:` refusal, so nothing invoked the new reactive handler and `authenticatedPubkeys` stayed empty
- **Fix:** Added `subscriptionOptions` capture to `fakePool`, then rewrote the test to capture the community's live-subscription `onAuthRequired` handler and invoke it directly with a synthesized context naming the community's own core stream-plane pubkeys (derived independently via `deriveConcordKeys`, mirroring the CAUTH-02 oracle's derivation discipline)
- **Files modified:** `packages/concord/src/client/__tests__/client.test.ts`
- **Verification:** `pnpm --filter applesauce-concord test` (580/580 pass, 55 files)
- **Committed in:** `eed5aefb` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 Rule 3 blocking, 3 Rule 1 bugs — all three test fixes were direct, in-scope consequences of Task 1's production changes removing the ambient/proactive auth mechanisms these tests depended on)
**Impact on plan:** No scope creep — every fix was required to reach the plan's own "whole concord suite is green" verification gate; `client.test.ts` was not in the plan's declared `<files>` list but its failure was a direct fallout of Task 1's wiring.

## Issues Encountered

- Same environment precondition plans 15-01/15-02/15-03 documented: a bare `pnpm --filter applesauce-concord build`/`test` fails on `Cannot find package 'applesauce-core/helpers'` since `node_modules` symlinks to unbuilt source. Resolved identically via `pnpm exec turbo build --filter=applesauce-concord` (and `--filter=applesauce-examples` for the examples check), which builds the whole dependency graph first. Not a code deviation.

## RED->GREEN Non-Vacuity Probes (Task 3, Wave-0 requirement)

Per the task's explicit instruction, two temporary regressions were injected into `community.ts`, confirmed RED against the new CAUTH-02 oracle, then reverted (`git diff --stat packages/concord/src/client/community.ts` against the committed state came back empty after each restore, confirming an exact restore).

**Probe 1 — shared `StreamSigners` instance (the pre-phase client-wide shape):**

```ts
// TEMPORARY — module-level singleton, given to every ConcordCommunity instance
const __PROBE_SHARED_SIGNERS__ = new StreamSigners();
// ...
this.signers = __PROBE_SHARED_SIGNERS__; // was: new StreamSigners({ onAuthFailure: ... })
```

Running `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts -t "two communities sharing one relay"` produced:

```
FAIL  … > ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > two communities sharing one relay each authenticate only their own authors, and a reconnect cycle re-authenticates that same scoped set (CAUTH-02)
AssertionError: expected [ …(10) ] to deeply equal [ …(5) ]

- Expected
+ Received

  [
+   "15a146f0af8580744dd49f1a7899373d86efedf9c14af528be27f0ac01891593",
+   "161354dc99c24334db8fd6020973aa0532c1db8b1f3232c73cead089d9625d1c",
+   "25bcab105c295bfaab9d07d61d173d1bf785a5df47e24a02b848288b58bccdbd",
    "66cd2f565f98d7a1b21199eca0a3d33b9902073b87d75a23dfb17392d3153363",
+   "750e5a16b5efcb5f92aa0b56b245f2a7e695e91204ccb910865fd311d8c02cf0",
    "cb36d2fc6f9b88c2b39ceddb2d6f18e8c56a917738993682167d3c93444ef125",
+   "cd75a8977b6938a15413a3393c3040d69b23e5f01f0b7ff4ce64add13226b702",
    "d95492d73567ada3b42608d484d04e22b6815a29796e79428267f3fc1e360517",
    "e21327ed99218f12fb2db10ced2104e1f3e3d54331a98a8ec3671f72e109d90e",
    "f30131a98acce393ae17a61c2b64dba08a9c8edee08c39943f73029365cbf7e6",
  ]

Tests  1 failed | 62 skipped (63)
```

Community A's captured handler recorded 10 authentications (the union of A's 5 and B's 5 keys) instead of A's own 5, since both communities registered into the SAME `StreamSigners` map. This confirms the isolation assertion is genuinely sensitive to registry sharing — and confirms the earlier design decision to widen the synthesized `missingPubkeys` to the union was necessary: an initial version of this probe using each operation's own exact `missingPubkeys` stayed GREEN even under a shared registry (`intersect(authorsA, authorsA ∪ authorsB) = authorsA` regardless of what else the registry holds), which would have made the isolation test vacuous against exactly this regression.

**Probe 2 — `onAuthRequired` removed from `openLive()`'s options bag:**

```ts
.subscription(targets, [{ kinds: [...], authors }], {
  waitForAuth: authors,
  // TEMPORARY — onAuthRequired: this.signers.onAuthRequired, removed
})
```

Running `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts -t "waitForAuth matches the filter's own authors"` produced:

```
FAIL  … > ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04 > waitForAuth matches the filter's own authors, and invoking the captured handler authenticates exactly that scoped set (CAUTH-01)
AssertionError: expected 'undefined' to be 'function' // Object.is equality

Expected: "function"
Received: "undefined"

Tests  1 failed | 62 skipped (63)
```

Both probes restored cleanly (empty `git diff --stat` against the committed `community.ts`), and the full CAUTH-02 describe block returned to 63/63 green.

## Next Phase Readiness

- Every read a community or private channel issues now carries both a correctly-scoped `waitForAuth` and that scope's own `onAuthRequired`; no driver, reference count, `challenge$` subscription, or registration-triggered AUTH survives in `sync.ts`, `channel-sync.ts`, `community.ts`, or `private-channel.ts`.
- `ConcordClient` holds no `relayAuth` field of any kind — `ConcordRelayAuth`'s only remaining production consumers are `relay-auth.ts` itself and `invite-watcher.ts`, exactly the two plan 15-06/15-07 own (confirmed by the plan-level verification grep).
- `pnpm --filter applesauce-concord test`: 55 files, 580 tests passing (up from the pre-plan 576 baseline — 4 new CAUTH-02/CAUTH-04 oracle tests).
- `pnpm exec turbo build --filter=applesauce-concord` and `--filter=applesauce-examples` both exit 0.
- REQUIREMENTS.md: CAUTH-01, CAUTH-02, CAUTH-04 marked Complete. CAUTH-03 intentionally left Pending — this plan removed four of its five named mechanisms from the two engines and the two walks, but `ConcordRelayAuth` itself (and its `authenticateStreamKeys`/`version$`/reference-counting/`ensureAuth()` machinery) is still alive for `relay-auth.ts`'s and `invite-watcher.ts`'s own use; CAUTH-03 closes only once those two consumers migrate and the class is deleted (plan 15-07, per this plan's own objective text).
- No blockers for 15-05/15-06.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/sync.ts
- FOUND: packages/concord/src/client/channel-sync.ts
- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/private-channel.ts
- FOUND: packages/concord/src/client/client.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-04-SUMMARY.md
- FOUND: 4f8f7883 (Task 1 commit)
- FOUND: eed5aefb (Task 2 commit)
- FOUND: c34fdbcc (Task 3 commit)
- FOUND: 1b922248 (SUMMARY/REQUIREMENTS.md docs commit)
