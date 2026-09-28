---
phase: 19
slug: count-becomes-the-high-level-member
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 19 — Validation Strategy

> Per-phase validation contract derived from `19-RESEARCH.md` § Validation Architecture for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10, `@hirez_io/observer-spy` 2.2.0, and `vitest-websocket-mock` 0.5.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts src/__tests__/relay.test.ts` |
| **Full suite command** | `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build` |
| **Estimated runtime** | Measure during execution; task-local targeted suites are the feedback path, while package/docs builds are phase gates |

## Sampling Rate

- **After every task commit:** Run the task's targeted Vitest/static gate and `pnpm --filter applesauce-relay build` when declarations can change.
- **After every plan wave:** Run `pnpm --filter applesauce-relay test`.
- **Before `$gsd-verify-work`:** Run `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build && pnpm --dir apps/docs build` plus the exact changeset/source audit in Plan 19-03.
- **Max feedback latency:** Target under 60 seconds for the task-local command; split the package/docs phase gate from iterative RED→GREEN runs.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | COUNT-02 | T-19-01 | Untrusted COUNT fields are strictly validated and prototype-safe before emission | WebSocket integration + unit | `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts src/__tests__/relay.test.ts -t "NIP-45\|count\|COUNT"` | ❌ W0 `nip45.test.ts`; ✅ `relay.test.ts` | ⬜ pending |
| 19-01-02 | 01 | 1 | COUNT-03 | T-19-02, T-19-03 | Fixed-size sketches reject malformed input; merge/estimate oracles are independent and non-mutating | Pure unit + declaration build | `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts && pnpm --filter applesauce-relay build` | ❌ W0 `nip45.test.ts` | ⬜ pending |
| 19-02-01 | 02 | 2 | COUNT-01 | T-19-04, T-19-05 | Transport-only retry stays inside one terminal D-01 deadline and source comments match the tested contract | WebSocket integration + compile + region audit | Plan 19-02 Task 1 `<automated>` command | ✅ extend `relay.test.ts` | ⬜ pending |
| 19-02-02 | 02 | 2 | COUNT-01, COUNT-02 | T-19-04, T-19-06 | Terminal errors never resend; auth/retry state is additive, call-scoped, fresh, and shared correctly | WebSocket integration | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t "count\|COUNT"` | ✅ extend existing | ⬜ pending |
| 19-02-03 | 02 | 2 | COUNT-01 | T-19-07 | Group/Pool forward exact options and validated records without Phase 23 isolation | Unit + compile | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts && pnpm --filter applesauce-relay build` | ✅ extend existing | ⬜ pending |
| 19-03-01 | 03 | 3 | COUNT-01, COUNT-02, COUNT-03 | T-19-08 | Public helpers/errors are root-reachable while the parser remains private and docs match declarations | Snapshot + compile + docs build | `pnpm --filter applesauce-relay exec vitest run src/__tests__/exports.test.ts && pnpm --filter applesauce-relay build && pnpm --dir apps/docs build` | ✅ extend existing | ⬜ pending |
| 19-03-02 | 03 | 3 | COUNT-01, COUNT-03 | T-19-09 | Pool guidance uses guarded HLL union estimation and never recommends summing overlaps | Docs build + static positive audit | `pnpm --dir apps/docs build && rg -q "mergeHllRegisters" apps/docs/loading/relays/pool.md && rg -q "estimateHllCardinality" apps/docs/loading/relays/pool.md` | ✅ existing page/build | ⬜ pending |
| 19-03-03 | 03 | 3 | COUNT-01, COUNT-02, COUNT-03 | T-19-05, T-19-10 | Release metadata, Group boundary, source-comment regions, full relay behavior, and docs agree | Static contract audit + full suites | Plan 19-03 Task 3 `<automated>` command | ❌ task creates changeset; ✅ suites/audit inputs | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] `packages/relay/src/__tests__/nip45.test.ts` — create the COUNT-03 independent merge, composed two-relay union-estimate, estimator, validation, normalization, and mutation fixtures before implementing `nip45.ts`.
- [ ] `packages/relay/src/__tests__/relay.test.ts` — add the COUNT-02 malformed-response/prototype-safety table before replacing the unchecked wire cast.
- [ ] `packages/relay/src/__tests__/relay.test.ts` — add the COUNT-01 elapsed deadline/retry-order RED test before changing the pipeline.
- [ ] `packages/relay/src/__tests__/group.test.ts` and `pool.test.ts` — add compile/runtime assertions for exact widened option forwarding and preserved Observable record types before relying on structural production forwarding.

Wave 0 is incomplete until the tracer and TDD tasks establish these failing oracles; no `<automated>MISSING</automated>` placeholder is used because each owning task creates its test before production changes.

## Exact Test and Non-Vacuity Patterns

- Use real `await expect(server).toReceiveMessage(...)` COUNT frames for resend, freshness, sharing, auth reentrancy, and additive budget claims.
- Malformed replies under retry-enabled options must produce zero values, preserve the expected typed error, and send exactly one COUNT frame.
- The composed two-relay HLL oracle must merge disjoint half-register sketches into an independently authored all-one sketch, then compare the production estimate with the hard-coded `367.7555677437675` union total.
- Group/Pool forwarding tests assert the exact caller id/options and keep `combineLatest`, all-or-nothing errors, and non-progressive records unchanged.
- Record RED→GREEN mutation probes for the unchecked cast, unsafe copy, max-to-min merge, removed linear correction, per-attempt deadline, broadened classifier, hoisted listener, and removed outer share.

## Manual-Only Verifications

All phase behaviors have automated verification. Documentation semantics are additionally reviewed through the built pages, but no manual-only requirement is needed.

## Validation Sign-Off

- [x] All eight tasks have an `<automated>` verify command.
- [x] Sampling continuity: every task has targeted automated feedback; no three-task gap exists.
- [x] Every Wave 0 gap is owned by the task that writes its failing test before production changes.
- [x] No watch-mode flags appear in task verification.
- [ ] Feedback latency measured and recorded during execution.
- [ ] Wave 0 fixtures created and green after implementation.
- [ ] `status: validated` and `nyquist_compliant: true` set only after `$gsd-validate-phase` reconciles executed evidence.

**Approval:** pending
