---
phase: 4
slug: common-package-rumor-support
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 4 — Validation Strategy

> Per-phase validation contract. Skeleton created at plan-time; finalized by `/gsd-validate-phase` after execution. This is a small signature-only genericization phase (4 common helpers); acceptance is dominated by "existing tests + snapshots pass unchanged."

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` + `vitest.workspace.ts` |
| **Quick run command** | `pnpm --filter applesauce-common test` |
| **Full suite command** | `pnpm --filter applesauce-common test` + `pnpm run build` (full workspace) |
| **Estimated runtime** | seconds (common tests) |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter applesauce-common test`
- **Before phase completion:** `pnpm --filter applesauce-common test` green (incl. unchanged export/helper snapshots) + `pnpm run build` exit 0
- **Max feedback latency:** ~seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| COMMON-01 | The 4 structural-only helpers (`getNip10References`, `getReactionEmoji`, `getHashtagTag`, `getContentWarning`) accept `E extends StoreEvent` with `NostrEvent` default; existing helper tests pass unchanged | unit + type-check | `pnpm --filter applesauce-common test` | ⬜ pending |
| COMMON-02 | Targeted common casts operate over rumors while keeping `NostrEvent` defaults — audited empty this phase (no common cast has a current rumor use case; generic cast infra from Phase 2/3 already supports rumor casts; remaining casts are COMMON-F1/future). Verified by: no cast default changed + full build green | audit + type-check | `pnpm run build` (full workspace exit 0) | ⬜ pending |
| COMMON-03 | Default signed-`NostrEvent` behavior in `applesauce-common` unchanged — existing tests AND export/helper snapshots pass unchanged (signature-only genericization) | unit + snapshot | `pnpm --filter applesauce-common test` (snapshots unchanged) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — signature-only genericization of 4 helpers; acceptance is unchanged existing tests + snapshots. No new test files required (existing helper tests exercise the 4 functions; add type-level coverage only if practical).

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] COMMON-01: 4 helpers generic, existing helper tests pass unchanged
- [ ] COMMON-02: targeted-cast set audited (empty this phase, COMMON-F1 owns the rest), no cast default changed, full build green
- [ ] COMMON-03: existing common tests + export/helper snapshots pass unchanged
- [ ] `pnpm run build` exit 0 (full workspace)
- [ ] `nyquist_compliant: true` set in frontmatter (at validate-phase)

**Approval:** pending (finalized by /gsd-validate-phase after execution)
