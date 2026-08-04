---
phase: 05-cache-identity-memo-fix
plan: 02
subsystem: testing
tags: [cache, event-store, spread-safety, applesauce-core, vitest, encrypted-content, hidden-tags]

# Dependency graph
requires:
  - phase: 05-01
    provides: "cache.ts write mechanism fixed (Object.defineProperty, non-enumerable memos) and the identity-memo/carry-forward/accumulated-state taxonomy prose"
provides:
  - "packages/core/src/helpers/__tests__/cache.test.ts — the D-13 two-sided convention test, enforcing the taxonomy as a binding regression guard instead of advisory prose"
  - "A binding automated assertion for ROADMAP Success Criterion 1 (memo dropped by spread, copy recomputes from new fields)"
  - "A binding automated assertion for ROADMAP Success Criterion 3 (plaintext correct off a signed event that passed real pipe spreads)"
affects: [05-03, 05-04, 05-05, concord-rotation-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-sided convention test co-located in one file: opposite outcomes (memo ABSENT vs. payload PRESENT) on the same underlying spread/pipe mechanism, so the contrast enforces the taxonomy"
    - "Real eventPipe + real signing (not stubbed) as the only trustworthy proof that PRESERVE_EVENT_SYMBOLS actually preserves a carry-forward payload through the factory pipe"
    - "Core package's own package-level FakeUser fixture (packages/core/src/__tests__/fixtures.ts) reused for a core-native test signer — avoids adding an applesauce-common dependency to a core test"

key-files:
  created:
    - packages/core/src/helpers/__tests__/cache.test.ts
  modified: []

key-decisions:
  - "Used the already-existing core-native FakeUser fixture (packages/core/src/__tests__/fixtures.ts) instead of hand-rolling a signer from nostr-tools primitives as the plan's read_first suggested — it already implements EventSigner + EncryptedContentSigner with no applesauce-common dependency, and is the established convention across ~20 other core test files"
  - "Modeled the memo-drop fixture on concord's real material shape ({ community_root, root_epoch }) per the plan's guidance, using a locally-declared Symbol(\"test-memo\") rather than a production symbol"
  - "Used kinds.Mutelist for the carry-forward half (nip04-routed hidden tags), matching the plan's recommendation and the sibling hidden-tags.test.ts convention"

requirements-completed: [CACHE-01, CACHE-03]

coverage:
  - id: D1
    description: "Memo-drop half: a cache memo written via setCachedValue/getOrComputeCachedValue is absent from a spread copy with a changed field, and the copy recomputes from its own new field rather than returning a stale value; memoization on the original object still works; the memo is non-enumerable (invisible to Object.keys/JSON.stringify, present via getOwnPropertySymbols)"
    requirement: "CACHE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/cache.test.ts#cache identity memos (5 tests, pnpm --filter applesauce-core test cache)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Carry-forward half: EncryptedContentSymbol plaintext survives a real eventPipe(modifyHiddenTags, sign) built with a real nip04-encrypting signer, and getHiddenTags/getEncryptedContent read correct plaintext back off the signed, genuinely-encrypted, genuinely-signed event"
    requirement: "CACHE-03"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/cache.test.ts#carry-forward payloads (1 test, pnpm --filter applesauce-core test cache)"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-15
status: complete
---

# Phase 5 Plan 2: Cache Identity Memo Test Coverage Summary

**Created `packages/core/src/helpers/__tests__/cache.test.ts`, the D-13 two-sided convention test enforcing the memo-vs-carry-forward taxonomy: one suite proves an identity memo is dropped by a spread and forces recomputation, the other proves `EncryptedContentSymbol` plaintext survives a real factory pipe and real signing.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-15
- **Tasks:** 2 completed
- **Files modified:** 1 (new file)

## Accomplishments
- `describe("cache identity memos", ...)` — 5 tests proving: a memo written via `setCachedValue` is readable via `getCachedValue`; the memo is ABSENT (`Reflect.has === false`) on a spread copy with a changed field; `getOrComputeCachedValue` on that spread copy recomputes and returns a value derived from the copy's OWN new field (not the stale source value), with a compute-invocation counter proving it actually ran; `getOrComputeCachedValue` on the original object still memoizes without a second invocation; the memo is non-enumerable (`Object.keys`/`JSON.stringify` unaffected, `Object.getOwnPropertySymbols` confirms it exists).
- `describe("carry-forward payloads", ...)` — 1 test driving a real `eventPipe(modifyHiddenTags(user, ...), sign(user))` through real nip04 encryption and real signing (via the core package's own `FakeUser` fixture), then asserting `getHiddenTags(signed)` and `getEncryptedContent(signed)` both return the correct plaintext, `signed.content` is non-empty and NOT the plaintext (real encryption occurred), and `signed.id`/`signed.sig`/`signed.pubkey` prove genuine signing.
- Both halves live in the ONE file per D-14 — the contrast between "memo dropped" and "payload survives" on the same spread/pipe mechanism IS the enforcement mechanism for the taxonomy documented in `cache.ts`.
- `pnpm --filter applesauce-core test` — 635/635 tests pass (full package suite, no regressions). `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Memo-drop half — prove an identity memo does NOT survive a spread (D-13, CACHE-01)** - `0790ff4c` (test)
2. **Task 2: Carry-forward half — prove plaintext survives the real pipe and real signing (D-15, CACHE-03)** - `8864e940` (test)

_Note: this is a worktree-mode execution — STATE.md/ROADMAP.md updates are deferred to the orchestrator after all wave agents complete._

## Files Created/Modified
- `packages/core/src/helpers/__tests__/cache.test.ts` - New file: `cache identity memos` suite (5 tests, memo-drop half) + `carry-forward payloads` suite (1 test, carry-forward half), both asserting opposite outcomes on the spread/pipe mechanism

## Decisions Made
- Reused the core package's own `FakeUser` fixture (`packages/core/src/__tests__/fixtures.ts`) rather than hand-rolling a signer from raw `nostr-tools` primitives as the plan's `read_first` section suggested. The plan's research had missed this file (it assumed "core has no FakeUser"), but it exists at the package level (not `helpers/__tests__/`), already implements both `EventSigner` and `EncryptedContentSigner` using core-native `generateSecretKey`/`getPublicKey`/`finalizeEvent`, has zero dependency on `applesauce-common`, and is already the established convention across ~20 other core test files (`operations/__tests__/tags.test.ts`, `operations/__tests__/encrypted-content.test.ts`, etc.). Using it satisfies the plan's actual constraint (no `applesauce-common` import) more idiomatically than a hand-rolled inline signer would.
- Modeled the memo-drop test fixture on concord's real `material` shape (`{ community_root, root_epoch }`) per the plan's explicit guidance, to keep the test legible as the regression guard for the real-world CONCORD-H01 bug rather than an abstract example.
- Used `kinds.Mutelist` for the carry-forward half, matching both the plan's recommendation and the sibling `hidden-tags.test.ts`'s convention for a nip04-routed hidden-tags kind.

## Deviations from Plan

None - plan executed exactly as written. The FakeUser fixture substitution (see Decisions) is a same-outcome adaptation within the plan's own constraint ("no `applesauce-common` import"), not a deviation from any acceptance criterion — all acceptance criteria were verified via grep and pass.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP Success Criteria 1 and 3 now have binding automated assertions instead of relying on the 05-01 taxonomy prose alone.
- The D-13 enforcement contract is live: a future cleanup migrating `EncryptedContentSymbol`'s carry-forward write sites (`operations/tags.ts:87`, `helpers/encrypted-content.ts:117`, `common/operations/gift-wrap.ts:121`) onto `setCachedValue` will turn the carry-forward suite red immediately.
- Sibling plans in this phase (05-03 comment sweep, 05-04 concord spec-derived tests, 05-05 non-vacuity probes) can build on this test file and cite it rather than re-deriving the same proof.
- No production code was modified in this plan — only a new test file was added.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: `packages/core/src/helpers/__tests__/cache.test.ts`
- FOUND: this SUMMARY.md
- FOUND commit: `0790ff4c` (Task 1)
- FOUND commit: `8864e940` (Task 2)
