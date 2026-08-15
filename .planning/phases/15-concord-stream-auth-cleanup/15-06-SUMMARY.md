---
phase: 15-concord-stream-auth-cleanup
plan: 06
subsystem: auth
tags: [nip-42, concord, relay-auth, rxjs, vitest]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-05's client-wide createUserAuthHandler pattern (client/auth.ts) and ConcordClient's own userOnAuthRequired instance — this plan builds InviteWatcher's OWN separate instance of the same primitive (D-09)"
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-04's scope-owned StreamSigners/onAuthRequired wiring precedent, extended here to the invite watcher's user-scoped reads"
provides:
  - "InviteWatcher answers a gating inbox relay's refusal of one of its own reads with the user's key on demand, via its own createUserAuthHandler instance threaded as waitForAuth/onAuthRequired on both refresh()'s pool.request and openLive()'s pool.subscription"
  - "ConcordRelayAuth has zero production consumers left outside relay-auth.ts itself — the class plan 15-07 deletes is now unreachable from InviteWatcher/ConcordClient"
  - "autoAuthenticate is gone from both InviteWatcherOptions and ConcordClientOptions; needsAuth$ and authenticateUser() are gone from InviteWatcher"
affects: [15-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InviteWatcher builds its OWN createUserAuthHandler instance (never shared with ConcordClient's) — the last of three engines (community, private channel, invite watcher) to adopt the pattern, closing CAUTH-03's relay-status-driven auth readers"

key-files:
  created: []
  modified:
    - packages/concord/src/client/invite-watcher.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/__tests__/invite-watcher.test.ts
    - apps/examples/src/examples/concord/admin-management.tsx

key-decisions:
  - "authenticateUser() and needsAuth$ (and their proactive relay-status-flag reader userNeedsAuth()) are removed outright rather than kept as a deprecated manual path — both were proactive by definition (checking authRequiredForRead/authRequiredForPublish before any refusal), which D-01 rules out. The capability that 'keeps working' per CONTEXT.md is a gating inbox relay still getting the user's AUTH — now reactively, on refusal of the watcher's own read, not via the removed methods."
  - "InviteWatcher's userOnAuthRequired construction moved earlier in the constructor (right after autoDecrypt, before the extras tail) rather than at the tail's end, since it has no dependency on the extras holder and the plan's read_first explicitly noted this class's guarded tail is a shape-consistency convention, not a place to add unrelated construction"

requirements-completed: []

coverage:
  - id: D1
    description: "InviteWatcher's historical pool.request (refresh()) and live pool.subscription (openLive()) both carry waitForAuth: [userPubkey] and a callable onAuthRequired built from InviteWatcher's own createUserAuthHandler instance, never ConcordClient's"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/invite-watcher.test.ts#InviteWatcher > reactive user auth (D-01/D-09) — the watcher authenticates only when an inbox relay refuses one of its own reads > authenticates the user only when an inbox relay refuses one of its own reads"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero ambient authenticate calls after start() settles — the watcher performs no authentication until an inbox relay refuses one of its own reads"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/invite-watcher.test.ts#InviteWatcher > reactive user auth (D-01/D-09) — the watcher authenticates only when an inbox relay refuses one of its own reads > authenticates the user only when an inbox relay refuses one of its own reads (first assertion, checked before all others)"
        status: pass
    human_judgment: false
  - id: D3
    description: "autoAuthenticate, authenticateUser(), needsAuth$, and userNeedsAuth() are gone from InviteWatcher; autoAuthenticate is gone from ConcordClientOptions/ConcordClient; ConcordRelayAuth has no consumers left outside relay-auth.ts itself"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "grep -c 'autoAuthenticate|authenticateUser|userNeedsAuth|needsAuth' packages/concord/src/client/invite-watcher.ts packages/concord/src/client/client.ts (both 0); grep -c 'ConcordRelayAuth|relayAuth|authSub' packages/concord/src/client/invite-watcher.ts (0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The examples app's admin-management.tsx builds with the manual-authenticate banner and its needsAuth binding removed, no replacement banner added"
    verification:
      - kind: other
        ref: "grep -c 'needsAuth|authenticateUser' apps/examples/src/examples/concord/admin-management.tsx (0); pnpm exec turbo build --filter=applesauce-examples (15/15 tasks, exit 0)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The whole applesauce-concord suite and the examples app both build/pass with the new wiring"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (582/582 pass, 55 files)"
        status: pass
      - kind: other
        ref: "pnpm exec turbo build --filter=applesauce-concord and --filter=applesauce-examples (both exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: ~10min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 06: Migrate the Invite Watcher off the Client-Wide Auth Class Summary

**`InviteWatcher` builds its own `createUserAuthHandler` instance (D-09, never shared with `ConcordClient`'s) and answers a gating inbox relay's refusal of one of its own reads with the user's key via `waitForAuth`/`onAuthRequired` on both `refresh()`'s `pool.request` and `openLive()`'s `pool.subscription` — removing `autoAuthenticate`, `authenticateUser()`, `needsAuth$`, and the relay-wide-flag reader `userNeedsAuth()` from the last consumer of `ConcordRelayAuth`.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-08-15
- **Tasks:** 2/2
- **Files modified:** 4 (2 production, 2 test/example)

## Accomplishments

- `InviteWatcher` gained a private `userOnAuthRequired: RelayAuthHandler` field, built once in the constructor via `createUserAuthHandler(this.signer, () => this.pubkey)` — its own instance, distinct from `ConcordClient`'s, per D-09 (the two engines' latency and user-visible auth consequences differ even though they resolve the same identity).
- `refresh()`'s `pool.request(...)` and `openLive()`'s `pool.subscription(...)` both gained a third options argument: `{ waitForAuth: [this.pubkey], onAuthRequired: this.userOnAuthRequired }`. Both call sites already guarantee `this.pubkey` is defined at that point via their own leading guards.
- Deleted from `InviteWatcher`: the `ConcordRelayAuth` import and `relayAuth` field/construction, the `autoAuthenticate` option/field/assignment and its `if (this.autoAuthenticate) this.authSub = ...` line in `start()`, the `authSub` field and its two `stop()` clear-sites, the public `needsAuth$` observable and its `combineLatest`/`pool.status$` derivation in the constructor, the public `authenticateUser()` method, and the private `userNeedsAuth()` relay-wide-flag reader — the last two are exactly the mechanisms CAUTH-03 names.
- Deleted from `ConcordClient`/`ConcordClientOptions`: the `autoAuthenticate` option/field/assignment and its pass-through in `ensureInviteWatcher()`'s options object. Updated the `directInviteWatcher$` doc comment (dropped its `{@link InviteWatcher.needsAuth$}` reference) and `ensureInviteWatcher()`'s "two independent gates" comment (now describes the one remaining gate, `autoUnlock`), both replaced with a sentence stating the watcher answers a gating inbox relay's refusal with the user's key on demand.
- Re-derived `invite-watcher.test.ts`'s `autoAuthenticate:false` test as a reactive-answer proof: a pool recorder captures `{ filters, options }` for both `pool.request` and `pool.subscription`; the test asserts, in order, that the authenticate recorder is EMPTY after `start()` settles (D-01, checked first), that both recorded options carry `waitForAuth: [userPubkey]` and a callable `onAuthRequired`, that invoking either captured handler with the user's own pubkey in `missingPubkeys` authenticates exactly that pubkey, and that an unrelated pubkey in `missingPubkeys` authenticates nothing (T-15-03, one identity per handler).
- Dropped the `needsAuth$` binding, the `!needsAuth` early-return guard clause, and the whole "Inbox authentication required" `Banner` block from the examples app's `ActionBanners` — no replacement banner added, since there is nothing left for the user to do proactively.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace the invite watcher's ambient auth with a reactive user handler** - `36e6f187` (feat)
2. **Task 2: Re-derive the watcher's auth test and drop the example's manual banner** - `81309919` (test)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `packages/concord/src/client/invite-watcher.ts` - own `createUserAuthHandler` instance built in the constructor; `waitForAuth`/`onAuthRequired` threaded into `refresh()`'s `pool.request` and `openLive()`'s `pool.subscription`; `ConcordRelayAuth`/`autoAuthenticate`/`authSub`/`needsAuth$`/`authenticateUser()`/`userNeedsAuth()` all removed; unused `normalizeURL`/`combineLatest` imports dropped (kept `distinctUntilChanged`, `Subscription` — both still used elsewhere)
- `packages/concord/src/client/client.ts` - `autoAuthenticate` option/field/assignment/pass-through removed from `ConcordClientOptions`/`ConcordClient`/`ensureInviteWatcher()`; two stale doc comments updated
- `packages/concord/src/client/__tests__/invite-watcher.test.ts` - old `autoAuthenticate:false — authenticateUser satisfies needsAuth$` test replaced with a new `reactive user auth (D-01/D-09)` describe block proving the reactive-answer behavior
- `apps/examples/src/examples/concord/admin-management.tsx` - `needsAuth` binding, its early-return guard clause, and the "Inbox authentication required" banner all removed from `ActionBanners`

## Decisions Made

- **`authenticateUser()`/`needsAuth$` removed outright, not deprecated**: both are proactive by definition (checking `authRequiredForRead`/`authRequiredForPublish` ahead of any refusal), which D-01 rules out. The plan's objective text made this ruling explicit up front: what "keeps working" is the capability (a gating inbox relay gets the user's AUTH), not the specific methods, since concord is unreleased and the public-surface removal costs nothing downstream.
- **`userOnAuthRequired` construction placed right after `autoDecrypt`**, before the extras-holder try/catch tail, since it has no dependency on `this.extras` and the tail's guard is a shape-consistency convention (per the file's own comment) rather than a place for unrelated construction.

## Deviations from Plan

None - plan executed exactly as written. The `InviteWatcherOptions.autoAuthenticate` doc-comment deletion, the `pendingCount$`/`extrasSub` dependency on `distinctUntilChanged`/`Subscription` (kept, not removed, since both remain in active use elsewhere in the file), and the two client.ts doc-comment rewrites all matched the plan's `<action>` text precisely.

## Issues Encountered

- Same environment precondition every prior plan in this phase documented: a bare `pnpm --filter applesauce-concord build`/`test` fails on unbuilt `node_modules` symlinks. Resolved identically via `pnpm exec turbo build --filter=applesauce-concord` / `--filter=applesauce-examples`. Not a code deviation.
- The plan's top-level verification text for the `ConcordRelayAuth` grep ("matches ONLY `client/relay-auth.ts`, `client/index.ts`, ...") doesn't literally hold: `client/auth.ts` also matches, via a pre-existing (plan 15-01) doc comment — "Replaces `ConcordRelayAuth`'s registry half with..." — that predates this plan and is untouched by it. `client/index.ts` itself has no literal `ConcordRelayAuth` string (it wildcard-re-exports `relay-auth.js`). The underlying invariant — no production code outside `relay-auth.ts` constructs or calls `ConcordRelayAuth` — holds: `invite-watcher.ts` and `client.ts` are both confirmed at 0 matches. Recorded here as a same-outcome literal-mismatch, mirroring 15-05's identical note about its own acceptance-criteria greps.
- Similarly, `grep -rn 'pool.status\$' packages/concord/src | grep -v __tests__` matches more files than the plan's verification text anticipated (`community.ts`, `private-channel.ts`, `invite-manager.ts`, `client.ts`, `helpers/relays.ts`) — all are pre-existing doc-comment prose mentioning "`pool.status$` lookup keys" in the context of `ExtraRelays.merge`'s URL-normalization behavior, not live subscriptions. `invite-watcher.ts` itself has zero `pool.status$` references (confirmed by the Task 1 acceptance-criteria grep). No live status$-driven auth mechanism survives outside `relay-auth.ts` and `client/auth.ts`'s `connectedRelays$` (which reads only `.connected`).

## RED->GREEN Non-Vacuity Probe (Task 2, Wave-0 requirement)

Per the task's explicit instruction, a temporary ambient `authenticate` call was re-added to `start()`, confirmed RED against the new empty-recorder assertion, then reverted (`git diff --stat packages/concord/src/client/invite-watcher.ts` against the committed state came back empty after the restore, confirming an exact restore).

**Probe — an ambient `authenticate` call added right after `relays$.next(relays)` in `start()`:**

```ts
const relays = await this.resolveRelays();
this.relays$.next(relays);
// TEMPORARY PROBE — ambient authenticate call to confirm the empty-recorder assertion goes RED.
if (this.pubkey) void this.pool.relay(relays[0] ?? "").authenticate(this.signer);
await this.refresh();
this.openLive();
```

Running `pnpm vitest run packages/concord/src/client/__tests__/invite-watcher.test.ts -t "authenticates the user only when an inbox relay refuses one of its own reads"` against that change produced:

```
FAIL  … > InviteWatcher > reactive user auth (D-01/D-09) — the watcher authenticates only when an inbox relay refuses one of its own reads > authenticates the user only when an inbox relay refuses one of its own reads
AssertionError: expected [ { …(2) } ] to deeply equal []

- Expected
+ Received

- []
+ [
+   {
+     "pubkey": "cb55c9c955e1addc0b5c4ffdd8aa213dcb1001e17413bf43e632889d1fbac803",
+     "url": "wss://iw-auth-relay.test",
+   },
+ ]

 ❯ packages/concord/src/client/__tests__/invite-watcher.test.ts:209:33

Tests  1 failed | 14 skipped (15)
```

The failure was caught by the FIRST assertion in the test — the empty-recorder claim that would have caught the old ambient `pool.status$`/`autoAuthenticate` subscription — not by a later, weaker check. The probe was reverted (empty `git diff --stat`) and the full suite returned to 15/15 green.

## Next Phase Readiness

- `ConcordRelayAuth`'s only remaining production consumer is `relay-auth.ts` itself — `invite-watcher.ts` (this plan's scope) and every other engine (`community.ts`/`private-channel.ts`/`client.ts`, plans 15-04/15-05) are now migrated. Plan 15-07's deletion of `relay-auth.ts` is a pure removal, not a migration.
- `pnpm --filter applesauce-concord test`: 55 files, 582 tests passing (unchanged count from the pre-plan baseline — this plan replaced one test with another rather than adding new coverage volume).
- `pnpm exec turbo build --filter=applesauce-concord` and `--filter=applesauce-examples` both exit 0 (6/6 and 15/15 tasks).
- REQUIREMENTS.md: CAUTH-03 intentionally left **Pending** — this plan closes the invite watcher's two named relay-wide-flag readers (`authenticateUser`/`userNeedsAuth`) and its `ConcordRelayAuth` consumption, but the class itself (`authenticateStreamKeys`/`version$`/reference-counting/`ensureAuth()`) is still alive in `relay-auth.ts` pending plan 15-07's deletion. Do not mark CAUTH-03 Complete until that lands.
- No blockers for 15-07.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/invite-watcher.ts
- FOUND: packages/concord/src/client/client.ts
- FOUND: packages/concord/src/client/__tests__/invite-watcher.test.ts
- FOUND: apps/examples/src/examples/concord/admin-management.tsx
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-06-SUMMARY.md
- FOUND: 36e6f187 (Task 1 commit)
- FOUND: 81309919 (Task 2 commit)
- FOUND: a3f89df9 (SUMMARY commit)
