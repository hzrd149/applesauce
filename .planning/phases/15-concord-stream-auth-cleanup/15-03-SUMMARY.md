---
phase: 15-concord-stream-auth-cleanup
plan: 03
subsystem: auth
tags: [nip-42, concord, relay-auth, examples, react]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    plan: "15-01"
    provides: "StreamSigners: an instance-scoped pubkey->signer holder whose onAuthRequired handler intersects a relay's missingPubkeys with the scope's own registry"
provides:
  - "Three example apps (direct-invites, rumor-stores, crypto-history) migrated from ConcordRelayAuth's driver/reference-count pattern onto the operation-scoped StreamSigners pattern"
  - "First worked examples of the new pattern outside packages/concord's own internals, for both a publish site and a read (fetchWraps) site"
affects: [15-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Example apps hold one module-level StreamSigners per single-community scope, mirroring D-06's per-engine holder rule"
    - "Registration (streamSigners.register) is decoupled from the auth attempt — the handler fires reactively off a relay's own refusal, never off a registration or connection event"

key-files:
  created: []
  modified:
    - apps/examples/src/examples/concord/direct-invites.tsx
    - apps/examples/src/examples/concord/rumor-stores.tsx
    - apps/examples/src/examples/concord/crypto-history.tsx

key-decisions:
  - "publishCommunityList in direct-invites.tsx left untouched per the plan's explicit instruction — it is signed by the user, not a stream key, and the example has no user auth handler wired; added a one-line comment pointing at ConcordClient's community-list publish as the in-package example of that split (D-09)"

requirements-completed: [CAUTH-03]

coverage:
  - id: D1
    description: "direct-invites.tsx's guestbook Join publish uses StreamSigners with waitForAuth: [wrap.pubkey] and onAuthRequired: streamSigners.onAuthRequired, holding no driver subscription"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "grep -c 'ConcordRelayAuth|authenticateStreamKeys|authDrivers' apps/examples/src/examples/concord/direct-invites.tsx == 0; grep -n 'waitForAuth' shows [wrap.pubkey]"
        status: pass
      - kind: integration
        ref: "pnpm exec turbo build --filter=applesauce-examples"
        status: pass
    human_judgment: false
  - id: D2
    description: "rumor-stores.tsx and crypto-history.tsx's fetchWraps pass onAuthRequired alongside the existing waitForAuth: authors; loadEpoch drops the ensureAuth parameter; registration renamed to streamSigners.register at both sites in each file; driversSub/seenRelays refs and their teardown lines are gone"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "grep -c 'ConcordRelayAuth|authenticateStreamKeys|registerStreamKeys|driversSub|seenRelays|ensureAuth' returns 0 for both files; grep -n 'streamSigners.register' shows exactly two sites per file; grep -rn 'ConcordRelayAuth' apps/examples/src returns nothing"
        status: pass
      - kind: integration
        ref: "pnpm exec turbo build --filter=applesauce-examples"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (576/576, confirming no package source was touched)"
        status: pass
    human_judgment: false

# Metrics
duration: ~25min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 03: Migrate Concord Example Apps Off ConcordRelayAuth Summary

**Three example apps (direct-invites, rumor-stores, crypto-history) now demonstrate the operation-scoped `StreamSigners` pattern — one publish site and two read sites — with every driver subscription, seen-relays set, and teardown effect removed; `applesauce-examples` builds clean (15/15 turbo tasks) and the untouched `applesauce-concord` suite stays at 576/576.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-15
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- `direct-invites.tsx`'s `publishGuestbookJoin` replaced its `relayAuth.registerStreamKeys` + `authDrivers` array + `finally` teardown with a single awaited `pool.publish(relays, wrap, { waitForAuth: [wrap.pubkey], onAuthRequired: streamSigners.onAuthRequired })` call — `wrap.pubkey` is the guestbook stream pubkey since `wrapForTarget` finalizes the wrap with the stream secret key (D-16).
- `publishCommunityList` (the user-authored publish) deliberately left unchanged, with a one-line comment explaining the D-09 split and pointing at `ConcordClient`'s community-list publish as the in-package user-handler example.
- `rumor-stores.tsx` and `crypto-history.tsx` — structural twins — both replaced their module-level `ConcordRelayAuth` singleton with `const streamSigners = new StreamSigners()`, added `onAuthRequired: streamSigners.onAuthRequired` beside the existing `waitForAuth: authors` in `fetchWraps`'s `pool.request(...)` options, dropped the `ensureAuth` parameter from `loadEpoch` and both call sites, renamed `relayAuth.registerStreamKeys([...])` to `streamSigners.register([...])` at both registration sites in each file (core planes + channels), and deleted the `driversSub`/`seenRelays` refs, the `ensureAuth` closure, and the driver-teardown line from each cleanup effect. `Subscription` dropped from the `rxjs` import in both files (no longer used).
- Registration and the auth attempt are now decoupled by design in all three files — the handler fires reactively off a relay's own `auth-required:` refusal (D-01), never off registration, a connection event, or a pre-check.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate direct-invites.tsx to a reactive publish handler** - `3b3a67df` (feat)
2. **Task 2: Migrate the two manual-walk examples off drivers** - `ade7dfaa` (feat)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `apps/examples/src/examples/concord/direct-invites.tsx` - `StreamSigners` replaces `ConcordRelayAuth`; guestbook Join publish uses `waitForAuth`/`onAuthRequired`
- `apps/examples/src/examples/concord/rumor-stores.tsx` - `StreamSigners` replaces `ConcordRelayAuth`; `fetchWraps` reads reactively; `loadEpoch`/`Walker` driver bookkeeping removed
- `apps/examples/src/examples/concord/crypto-history.tsx` - identical migration to `rumor-stores.tsx`

## Decisions Made

- `publishCommunityList` in `direct-invites.tsx` intentionally untouched — signed by the user, not a stream key, and the example wires no user auth handler; a comment marks the split and points at `ConcordClient` as the in-package example, per the plan's explicit instruction.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm --filter applesauce-examples build` (the plan's literal verify command) initially failed with cascading `Cannot find module 'applesauce-core'` / `'applesauce-relay'` etc. errors across unrelated example files, because the worktree's dependency packages had no `dist/` built yet (`node_modules` symlinks point at `./dist/...` per each package's `exports` map). This is the identical environment precondition plan 15-01 documented and resolved. Ran `pnpm exec turbo build --filter=applesauce-examples` instead, which builds the full dependency graph before the examples app itself — equivalent to the plan's intent, not a code deviation. All 15 turbo tasks passed, including `applesauce-examples:build` (`tsc -b && vite build`) with the three migrated example files compiling clean.

## Next Phase Readiness

- `apps/examples/src` now has zero occurrences of `ConcordRelayAuth`, `authenticateStreamKeys`, or `registerStreamKeys` — confirmed via `grep -rn 'ConcordRelayAuth\|authenticateStreamKeys\|registerStreamKeys' apps/examples/src` returning nothing.
- Plan 15-07 (deletion of `ConcordRelayAuth` and its driver/reference-counting mechanism from `packages/concord/src/client/relay-auth.ts`) can now proceed without breaking `apps/*`'s workspace build — the three example apps that constructed the class being deleted are the last call sites outside `packages/concord/src` itself.
- `pool.request`'s `waitForAuth: authors` in `fetchWraps` was already correctly scoped before this plan; the only change was adding the handler beside it, per the plan's explicit instruction not to widen or narrow that value.
- No blockers for downstream plans.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: apps/examples/src/examples/concord/direct-invites.tsx
- FOUND: apps/examples/src/examples/concord/rumor-stores.tsx
- FOUND: apps/examples/src/examples/concord/crypto-history.tsx
- FOUND: 3b3a67df (Task 1 commit)
- FOUND: ade7dfaa (Task 2 commit)
