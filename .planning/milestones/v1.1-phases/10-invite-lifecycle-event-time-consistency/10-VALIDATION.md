---
phase: 10
slug: invite-lifecycle-event-time-consistency
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `10-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace-standard) |
| **Config file** | none per-package (inherits workspace root config) |
| **Quick run command** | `pnpm --filter applesauce-concord vitest run <path>` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~single-digit seconds per file; full concord suite < ~60s |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter applesauce-concord vitest run <touched-test-file>`
- **After every plan wave:** Run `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** Full concord suite must be green
- **Max feedback latency:** ~10 seconds (single test file)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. This map lifts the requirement→test rows from `10-RESEARCH.md` §Validation Architecture; the planner/executor fills Task ID + Plan + Wave.

| Requirement | Behavior (spec-derived, D-13) | Test Type | Automated Command | File Exists | Status |
|-------------|-------------------------------|-----------|-------------------|-------------|--------|
| INVITE-01 | Lagging relay serving stale live bundle + fresher tombstone at coord `(33301, link_signer, "")` → join refuses (collapse-then-tombstone) | unit | `vitest run src/client/__tests__/client.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-01 (D-02) | `pool.request` filter includes `"#d": [""]`; decoy non-empty-`d` event ignored | unit | `vitest run src/client/__tests__/client.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-02 | `validateInviteBundle({channels:{a:1}, relays:"wss://evil"})` → `undefined` | unit | `vitest run src/helpers/__tests__/invite-bundle.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-03 | One link's `buildInviteBundle` throws (unheld channel) → other links still refresh | unit | `vitest run src/client/__tests__/community.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-04 | `expires_at` round-trips as SECONDS at every write/read site; join-time check compares seconds↔seconds (D-05 locked; §1/§4 contradiction documented in UPSTREAM-NOTES.md) | unit | `vitest run src/client/__tests__/client.test.ts` + `src/helpers/__tests__/invite-bundle.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-05 | `decodeFragment` with `version = FRAGMENT_VERSION + 1` throws (higher rejected, not just lower) | unit | `vitest run src/helpers/__tests__/invite-bundle.test.ts` | ❌ W0 | ⬜ pending |
| INVITE-01/D-04 | `vsk:"junk"` → refuse; `vsk` absent → live; `vsk:"7"` clean-numeric → stays joinable | unit | `vitest run src/helpers/__tests__/invite-bundle.test.ts` | ❌ W0 | ⬜ pending |
| TIME-01 | `1700000000700 → {created_at:1700000000, ms:700}` (no +1000ms skew at ≥500 remainder); `…000700` sorts before `…001400` | unit | `vitest run src/helpers/__tests__/stream.test.ts` | ❌ W0 | ⬜ pending |
| TIME-01 | `sendMessage`/`react`/`KickFactory`/`JoinLeaveFactory` rumor: `created_at*1000+ms` == one injected clock value | unit | `vitest run src/client/__tests__/community.test.ts` | ❌ W0 | ⬜ pending |
| TIME-02 | All N chunks of one Guestbook snapshot share identical `created_at` AND identical `ms` tag | unit | `vitest run src/factories/__tests__/guestbook.test.ts` | ❌ W0 | ⬜ pending |
| TIME-03 | Canonical-`ms` table (`"42abc"`,`"0x10"`,`"007"`,`" 5"`→malformed; `"999"`→999) agrees between `rumorMs` ordering and `hasMalformedMs` | unit | `vitest run src/helpers/__tests__/stream.test.ts` | ❌ W0 | ⬜ pending |
| TEST-01 (standing) | Every derivation above has a non-vacuity check (fails without the guard) | unit | same files | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/helpers/__tests__/stream.test.ts` — **new file**; TIME-01 decomposition/reorder (incl. ≥500ms remainder) + TIME-03 canonical-`ms` table (D-09, D-13)
- [ ] `src/helpers/__tests__/invite-bundle.test.ts` — **new file**; INVITE-02 (D-10 shape guard), INVITE-05 (D-12 version rejection), D-04 malformed/absent/clean-numeric `vsk` boundary, hand-derived `(33301, link_signer, "")` coordinate
- [ ] New `describe` blocks in `src/client/__tests__/client.test.ts` — INVITE-01 lagging-relay repro (extend existing `asyncServingPool` helper), INVITE-04 join-time seconds check
- [ ] New `describe`/`it` in `src/client/__tests__/community.test.ts` — INVITE-03 per-link skip-and-continue, TIME-01 single-clock-read across `bindToChannel` call sites
- [ ] TIME-02 shared-timestamp-across-chunks coverage in `src/factories/__tests__/guestbook.test.ts` (verify which file owns snapshot-build tests)
- Framework install: none — Vitest already configured workspace-wide

---

## Manual-Only Verifications

All phase behaviors have automated verification — every fix is a pure-TypeScript correctness change exercised by Vitest with hand-derived spec values (D-13).

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 net-new/extended test files above)
- [ ] No watch-mode flags (`vitest run`, never `vitest` watch)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
