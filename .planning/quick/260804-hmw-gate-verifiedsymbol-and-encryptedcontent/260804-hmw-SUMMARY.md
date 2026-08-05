---
phase: quick/260804-hmw-gate-verifiedsymbol-and-encryptedcontent
plan: 260804-hmw
subsystem: core
tags: [event-store, symbols, replaceable-events, verifyEvent, encrypted-content, nostr-tools]

# Dependency graph
requires:
  - phase: 05.1 (symbol-propagation-redesign)
    provides: non-enumerable setCachedValue writes, EncryptedContentSymbol, FromCacheSymbol conventions
provides:
  - copySymbolsToDuplicateEvent gates verifiedSymbol/EncryptedContentSymbol on source.id === dest.id
  - DuplicateSymbolDisposition tuple-list shape forcing every future symbol to declare a disposition
affects: [applesauce-core event-store, applesauce-common/applesauce-wallet consumers of EventStore.add]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disposition-tagged tuple list ([symbol, disposition][]) instead of a bare symbol array, so a future entry without a disposition is a compile error rather than a silent 'copy always'"

key-files:
  created: []
  modified:
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/__tests__/event-store.test.ts
    - .changeset/copy-symbols-version-gate.md

key-decisions:
  - "verifiedSymbol and EncryptedContentSymbol are same-id-only; FromCacheSymbol stays any-duplicate (delivery provenance, not payload)"
  - "Fix lives inside copySymbolsToDuplicateEvent (not at the one currently-reachable call site) since async-event-store.ts's three call sites and a custom IEventDatabase's call site all route through the same static method"
  - "Pinned created_at on two pre-existing tests (event-store.test.ts:438/448) that only produced matching ids by unixNow() second-boundary coincidence — a latent flake once the id gate exists"

patterns-established:
  - "DuplicateSymbolDisposition: 'any-duplicate' | 'same-id-only' — a tuple-list element shape that makes omitting a disposition a TS2322 compile error"

requirements-completed: []

coverage:
  - id: D1
    description: "copySymbolsToDuplicateEvent gates verifiedSymbol and EncryptedContentSymbol on source.id === dest.id; FromCacheSymbol unchanged; tuple-list shape forces future symbols to declare a disposition"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/event-store.test.ts#copySymbolsToDuplicateEvent (CR-04 regression)"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-core build (tsc) — hand-check: appending a bare symbol to the disposition list produces TS2322"
        status: pass
    human_judgment: false
  - id: D2
    description: "Regression tests drive the real EventStore.add() path: decrypted plaintext (Test A) and a signature verdict (Test B) no longer cross replaceable-event versions"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/event-store.test.ts#copySymbolsToDuplicateEvent gates payload symbols on source.id === dest.id (WR-01 regression) > Test A"
        status: pass
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/event-store.test.ts#copySymbolsToDuplicateEvent gates payload symbols on source.id === dest.id (WR-01 regression) > Test B"
        status: pass
    human_judgment: false
  - id: D3
    description: "Positive controls: a same-id duplicate still merges (Test C) and FromCacheSymbol still crosses versions (Test D) — both proven RED-then-GREEN via the mandatory disposition-flip non-vacuity probe"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/event-store.test.ts#... > Test C"
        status: pass
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/event-store.test.ts#... > Test D"
        status: pass
    human_judgment: false
  - id: D4
    description: "One single-sentence patch changeset for applesauce-core; full workspace build (14/14 packages) and vitest suite green"
    verification:
      - kind: other
        ref: "pnpm test (turbo build --filter='./packages/*' && vitest run) — 271 test files passed, 1 skipped; 2466 tests passed, 2 skipped, 0 failed"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-04
status: complete
---

# Quick Task 260804-hmw: gate payload symbols on source.id === dest.id Summary

**`copySymbolsToDuplicateEvent`'s symbol list is now a `[symbol, disposition]` tuple list (`"any-duplicate" | "same-id-only"`), closing WR-01: a losing version of a replaceable event can no longer leak its decrypted plaintext or forge a false signature verdict onto the stored NIP-01 winner through `EventStore.add()`.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files modified:** 3 (`event-store.ts`, `event-store.test.ts`, one new changeset)

## Accomplishments

- `copySymbolsToDuplicateEvent`'s bare `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` array replaced with a `readonly (readonly [symbol, DuplicateSymbolDisposition])[]` — a bare symbol with no disposition is now a `TS2322` compile error, confirmed by hand (see below).
- `verifiedSymbol`/`EncryptedContentSymbol` gated `"same-id-only"`; `FromCacheSymbol` stays `"any-duplicate"` with its reasoning recorded in the doc comment. `async-event-store.ts`'s three mirrored call sites are covered by construction (they call the same static `EventStore.copySymbolsToDuplicateEvent`).
- Four new regression tests drive `eventStore.add()` end-to-end (never calling `copySymbolsToDuplicateEvent` directly): Test A (plaintext), Test B (signature verdict, proven downstream via nostr-tools' own `verifyEvent`), Test C (same-id positive control), Test D (`FromCacheSymbol` still crosses versions — pinning the deliberate decision).
- Two pre-existing tests (`event-store.test.ts:438`/`:448`) had their `created_at` pinned to remove a latent flake the id gate would otherwise introduce (they previously only matched ids by `unixNow()` second-boundary coincidence).
- One single-sentence `patch` changeset for `applesauce-core`. Full workspace build (14/14 packages) and `vitest run` green (2466 passed, 2 skipped, 0 failed).

## Task Commits

1. **Task 1: structural fix in `copySymbolsToDuplicateEvent`** — `200d9a85` (fix)
2. **Task 2: regression tests through the real `EventStore.add()` path** — `4efd074f` (test)
3. **Task 3: changeset and full verification** — `55546e6b` (docs)

_Plan (`0f8d43bc`) and lockfile update (`cee7a361`) predate this SUMMARY and were already committed._

## Files Created/Modified

- `packages/core/src/event-store/event-store.ts` — `DuplicateSymbolDisposition` type; `copySymbolsToDuplicateEvent`'s symbol list rewritten as a disposition-tagged tuple list; `sameVersion` gate added to the copy loop; doc comments rewritten (function-level, per-symbol, and the seen-relays out-of-scope note).
- `packages/core/src/event-store/__tests__/event-store.test.ts` — new `describe` block with Tests A–D; `created_at` pinned in two pre-existing CR-04 tests.
- `.changeset/copy-symbols-version-gate.md` — new patch changeset for `applesauce-core`.

## Decisions Made

- The fix goes inside `copySymbolsToDuplicateEvent` rather than patching the one call site (`event-store.ts:269`) known reachable today — `async-event-store.ts:237/252/272` call the identical static method, and a custom `IEventDatabase` could reach `event-store.ts:304` too. Patching the single known-reachable site would have been the enumerated-denylist shape this project has already paid for twice (12-10's `CHANNEL_KEY_FOLD_DISPOSITION` rework, and the CR-01/WR-01 drift that preceded it).
- Kept the tuple-list local to the function body (matching the plan's literal shape) rather than hoisting it to a `private static readonly` class field — no behavioral difference, just closer adherence to the plan's stated construction and a smaller diff.
- Test fixtures for A/B/D give `v1` a strictly older `created_at` than `v2` (rather than relying on a tie-break by id) so `v1` deterministically loses regardless of id ordering, avoiding a second source of flakiness beyond the one already being fixed.

## Deviations from Plan

None — plan executed exactly as written. Both fixture/latent-flake items called out in the plan (Task 1's `created_at` pin, Task 2's mandatory non-vacuity probe) were followed as directed, not treated as out-of-scope discoveries.

## Non-Vacuity Probe Transcript (Task 2, mandatory)

**Reverted state** (in `event-store.ts`, `verifiedSymbol` and `EncryptedContentSymbol` flipped from `"same-id-only"` back to `"any-duplicate"`, two-token edit, no git surgery):

```
FAIL  ... > WR-01 regression > Test A: decrypted plaintext does not cross versions
AssertionError: expected true to be false
  expect(Reflect.has(v2, EncryptedContentSymbol)).toBe(false);
  Leaked value observed on v2 (console.log probe, removed before commit):
  "wr-01 test A unique plaintext"   <- v1's exact plaintext string, as predicted

FAIL  ... > WR-01 regression > Test B: a signature verdict does not cross versions, proven downstream
AssertionError: expected true to be false
  expect(Reflect.has(v2, verifiedSymbol)).toBe(false);
  <- first of the two ordered assertions failed; the copied verdict landed on v2

Test Files  1 failed (1)
Tests  2 failed | 2 passed | 52 skipped (56)
```

Test C and Test D both stayed GREEN under the reverted (defective) code, confirming the gate is not over-broad.

**Restored state** (dispositions reverted to `"same-id-only"` / `"any-duplicate"` as committed):

```
Test Files  9 passed (9)
     Tests  172 passed (172)
```

`git diff packages/core/src/event-store/event-store.ts` showed zero residual diff against the Task 1 commit before Task 2 was committed — the probe left no trace.

## Hand-Check Transcript (Task 1, mandatory)

Appended a bare `EventStoreSymbol` (no disposition tuple) to the `symbols` array and ran `pnpm --filter applesauce-core build`:

```
src/event-store/event-store.ts:257:7 - error TS2322: Type 'symbol' is not
assignable to type 'readonly [symbol, DuplicateSymbolDisposition]'.

      EventStoreSymbol, // PROBE: bare symbol, no disposition — must fail tsc

Found 1 error in src/event-store/event-store.ts:257
```

Probe entry removed; `pnpm --filter applesauce-core build` re-confirmed exit 0.

## Full Workspace Verification (Task 3)

```
pnpm test
 Tasks:    14 successful, 14 total   (turbo build --filter='./packages/*')
 Test Files  271 passed | 1 skipped (272)
      Tests  2466 passed | 2 skipped (2468)
```

No `pnpm-lock.yaml` drift observed after this run (checked via `git status --porcelain` immediately after — clean apart from the new changeset file).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- WR-01 closed. WR-04 (`EventFactory.kind()`) remains explicitly out of scope for this task, as does the `IEventDatabase.add` same-id-return contract gap and the cross-version seen-relays merge (both documented as deliberately out of scope in the plan and preserved as doc-comment notes in `event-store.ts`).
- No blockers for downstream work; `applesauce-core`'s full test suite and the whole-workspace suite are both green.

---
*Quick Task: 260804-hmw*
*Completed: 2026-08-04*

## Self-Check: PASSED

- FOUND: packages/core/src/event-store/event-store.ts
- FOUND: packages/core/src/event-store/__tests__/event-store.test.ts
- FOUND: .changeset/copy-symbols-version-gate.md
- FOUND: .planning/quick/260804-hmw-gate-verifiedsymbol-and-encryptedcontent/260804-hmw-SUMMARY.md
- FOUND commit: 200d9a85 (Task 1)
- FOUND commit: 4efd074f (Task 2)
- FOUND commit: 55546e6b (Task 3)
