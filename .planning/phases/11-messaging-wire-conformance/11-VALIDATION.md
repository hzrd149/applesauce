---
phase: 11
slug: messaging-wire-conformance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace config at `vitest.workspace.ts`) |
| **Config file** | `vitest.workspace.ts` (root); `packages/concord/package.json` test script |
| **Quick run command** | `pnpm --filter applesauce-concord test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~{N} seconds (planner/executor to measure) |

> **Coverage gap to close in this phase (WIRE-01).** Root `pnpm test` is
> `turbo build --filter='./packages/*' && vitest run` — it **excludes `apps/*`
> from the build**. Removing `ChannelMetadata.voice` / `CreateChannelOptions.voice`
> breaks `apps/examples/src/examples/concord/admin-management.tsx` and
> `apps/docs/concord/channels.md`, and `pnpm test` will stay green while the
> workspace no longer builds. WIRE-01's verification MUST therefore include an
> unfiltered `pnpm build` (or `tsc -b` inside `apps/examples`) — a green
> `pnpm test` is not sufficient evidence for success criterion 1.

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter applesauce-concord test`
- **After every plan wave:** Run `pnpm test`
- **WIRE-01 removal task specifically:** Run `pnpm build` (unfiltered — see gap note above)
- **Before `/gsd-verify-work`:** Full suite must be green AND `pnpm build` must succeed
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner: populate one row per task. Every WIRE-0x row's automated command must
exercise a **fixture-anchored** assertion per TEST-01 (D-10) — asserting against
the vendored `examples.md` tag set, never a snapshot of our own output.*

---

## Wave 0 Requirements

- [ ] Vendored CORD fixture file under `packages/concord/src/__tests__/` — the
      transcribed `examples.md` tag sets with per-entry CORD section citations
      (D-10). Every WIRE-03/04/05 assertion depends on this existing first.

*Otherwise: existing vitest infrastructure covers all phase requirements — no
framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| {behavior} | REQ-{XX} | {reason} | {steps} |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`watch:test` / `vitest` without `run` are forbidden)
- [ ] WIRE-01 verified by unfiltered `pnpm build`, not `pnpm test` alone
- [ ] Every WIRE-0x wire-shape assertion is fixture-anchored (TEST-01 / D-10)
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
