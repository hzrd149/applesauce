---
phase: 1
slug: generic-store-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` + `vitest.workspace.ts` |
| **Quick run command** | `pnpm --filter applesauce-core test` |
| **Full suite command** | `pnpm --filter applesauce-core test` (592 tests, ~2.5s) |
| **Estimated runtime** | ~3 seconds (core); full workspace build ~exit 0 |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter applesauce-core test`
- **After every plan wave:** Run core build + test; full `pnpm build` before phase close
- **Before phase completion:** Full core suite green + full workspace build exit 0
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File | Status |
|-------------|----------|-----------|-------------------|------|--------|
| CORE-01 | `EventStore<E extends StoreEvent = NostrEvent>` generic; zero behavior change at default | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/event-store.test.ts`, `event-store-dispose.test.ts` | ✅ green |
| CORE-02 | `AsyncEventStore<E>` generic; zero behavior change at default | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/async-event-store.test.ts` | ✅ green |
| CORE-03 | Explicit `verifyEvent: undefined` disables verification (`"verifyEvent" in options`); setter `console.warn` preserved | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/verify-event-option.test.ts` (3 cases) | ✅ green |
| CORE-04 | 11 structural helpers generic over `E`; identical results for `NostrEvent` | unit | `pnpm --filter applesauce-core test` | `helpers/__tests__/{filter,expiration,pointers,relays,events}.test.ts` | ✅ green |
| CORE-05 | 18 interfaces + 4 managers (`DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`) generic | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/{delete-manager,event-memory,expiration-manager}.test.ts` | ✅ green |
| RUMOR-01 | `StoreEvent` / `Rumor` types exported and consumed | unit | `pnpm --filter applesauce-core test` | `helpers/__tests__/rumor.test.ts`, `exports.test.ts` | ✅ green |
| RUMOR-02 | `verifyRumor` accepts correct-id rumor, rejects tampered-id | unit | `pnpm --filter applesauce-core test` | `helpers/__tests__/rumor.test.ts` (2 cases) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. The genericization requirements (CORE-01/02/04/05) are structural/type-level; their acceptance criterion is "zero behavior change for default signed stores," which is validated by the pre-existing 592-test suite passing unchanged. The two new behaviors (CORE-03, RUMOR-02) ship with dedicated tests (`verify-event-option.test.ts`, `rumor.test.ts`).

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All requirements have automated verification (unit tests, all green)
- [x] Sampling continuity: full suite run at every wave boundary + phase close
- [x] Wave 0 covers all MISSING references (none — existing infra sufficient)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-08 (autonomous — no coverage gaps; all 7 requirements COVERED)
