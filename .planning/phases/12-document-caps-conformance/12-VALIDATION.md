---
phase: 12
slug: document-caps-conformance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `12-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.15 (`packages/concord/package.json`) |
| **Config file** | none dedicated — root/package defaults (`vitest run --passWithNoTests`) |
| **Quick run command** | `pnpm --filter applesauce-concord test -- <pattern>` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~30 seconds (189 existing concord tests) |

**Post-bump scope (D-11):** after the `nostr-tools` `^2.24` bump lands, the `core`, `common`, and
`relay` suites must also be run — they carry the `~2.19`/`^2.19` pins being changed.

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter applesauce-concord test -- <changed file's test>`
- **After every plan wave:** Run `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** Full suite green, including `core` / `common` / `relay` after D-11
- **Max feedback latency:** ~30 seconds

---

## Anchoring Contract (TEST-01 / D-21 — standing, blocking)

Every cap and document assertion in this phase MUST be anchored to a value transcribed from spec
text or the `examples.md` fixture — **never** to the implementation's own constant.

- Cap literals to assert independently of source constants: **64** bytes (`name`), **10000** bytes
  (`description`), **50** memberships.
- **D-21's trap:** an assertion anchoring `65535` to "the NIP-44 spec value" **fails today** —
  NIP-44 now specifies `max_plaintext_size = 4294967295` and demotes `65536` to
  `extended_prefix_threshold`. Every byte-related assertion in this phase cites **CORD-02**, not
  NIP-44.
- **Multi-byte requirement:** byte-cap tests are exercised with a string whose UTF-16 `.length`
  differs from its UTF-8 byte length — e.g. `"𝔘"` (U+1D518: 4 UTF-8 bytes, 2 UTF-16 code units)
  repeated to land at/over the boundary. Each such test asserts `str.length !== byteLength(str)`
  inline as a self-guard, so the fixture failing back to ASCII fails loudly.

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| WIRE-06 | Channel `name` > 64 UTF-8 bytes throws on write; multi-byte string exercised; no read-side guard (D-04 override) | unit | `pnpm --filter applesauce-concord test -- admin` | ⚠️ `admin.ts` methods have no dedicated test file — home to be confirmed in planning |
| WIRE-07 | Community `name` (64B) / `description` (10000B) caps enforced in helpers (D-03 reachability); `editMetadata` round-trip proven already-passing (Pitfall 2) | unit | `pnpm --filter applesauce-concord test -- community` | ✅ extend `helpers/__tests__/community.test.ts` |
| WIRE-08 | 50-membership cap counts **live** memberships only; refuses local `recordJoin` at 50 but tolerates merged overflow | unit | `pnpm --filter applesauce-concord test -- client` | ✅ extend `client/__tests__/client.test.ts` |
| WIRE-09 | Unknown top-level fields survive parse → mutate → serialize through `ConcordClient`'s **actual** publish path, not just the factory layer (Pitfall 1) | integration | `pnpm --filter applesauce-concord test -- document-caps-conformance` | ❌ **Wave 0** — no test drives `saveCommunityList` / `invite-manager.save()` with an unknown root field |
| WIRE-10 | `deleteChannel` preserves unknown roots and `custom`; hostile `key` field does **not** survive the fold (Pitfall 3 denylist) | unit | `pnpm --filter applesauce-concord test -- admin` | ❌ **Wave 0** — hostile-`key`-field regression test does not exist |
| WIRE-12 | Structural guard fails any `CORD-NN §N` naming a non-existent section; accepts CORD-01's named sections | unit | `pnpm --filter applesauce-concord test -- citations` | ❌ **Wave 0** — no citation-validation mechanism exists today |
| D-07/D-08 | Serialized-byte caps removed: over-size list **does not throw** and **does** publish, while still emitting the debug diagnostic | unit | `pnpm --filter applesauce-concord test -- client` | ⚠️ **rewrite** — existing tests assert a throw (Pitfall 5) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New cross-cutting suite — recommended `packages/concord/src/__tests__/document-caps-conformance.test.ts`,
      sibling to `cord-wire-fixtures.ts` — homes the two client-tier round-trip proofs and the D-16
      structural guard. (Resolves the test-organization discretion item as **hybrid**: narrow
      per-file assertions extend existing suites; cross-cutting proofs get one new suite.)
- [ ] Confirm the test home for `admin.ts`'s `createChannel` / `editMetadata` / `deleteChannel`
      (`client.test.ts`, `community.test.ts`, or a new `admin.test.ts`) before adding cap tests.
- [ ] Hostile-edition-with-`key`-field regression test (Pitfall 3).
- [ ] Multi-byte UTF-8 fixture string helper per the Anchoring Contract above.
- [ ] **Rewrite, do not delete**, the tests asserting removed constants (Pitfall 5):
      `helpers/__tests__/invite-bundle-schema.test.ts:280-289` (cap-chain arithmetic),
      `helpers/__tests__/community-list.test.ts:116-130`, `client/__tests__/client.test.ts:2212,2281`,
      `helpers/__tests__/invite-bundle.test.ts:586`. Several currently assert a **throw**; the
      D-07/D-08 behavior is "measures and logs, does not throw."

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The 12 citation replacements name the *correct* section, not merely an existing one | WIRE-12 | D-16 records this limitation explicitly: the structural guard proves a section **exists**, not that the citation is **right**. `CORD-06 §94` → `CORD-06 §1` would pass while remaining wrong. | Reviewer diffs the replacements in `12-RESEARCH.md` § "The 12 citation replacements" against the live spec at `github.com/concord-protocol/concord@main`. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all ❌ MISSING references above
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] Every cap assertion is spec-anchored, not constant-anchored (TEST-01 / D-21)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
