---
phase: 3
slug: rumorstore-verification
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-09
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| caller → `RumorStore.add` (rumor ingestion) | Non-deletion rumors are verified by recomputing the event hash and checking `id` match (`verifyRumor`). This is an **integrity** check (contents match the claimed id), NOT an **authorization** check. | Unsigned NIP-59 rumors (untrusted structurally; authorization asserted by an upstream protocol layer) |
| caller → `castEvent(event, Cast)` | The public `castEvent` now compile-time-rejects an unsigned rumor for a cast whose `T` requires `sig`, preventing a runtime `.sig` `TypeError`. | Store events (signed or rumor) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Tampering | `RumorStore` accepting a rumor whose `id` ≠ serialized contents | medium | mitigate | `verifyRumor` wired as the default verifier via `super({ ...options, verifyEvent: verifyRumor })`; RUMOR-03 reject test proves `add` returns null for a mismatched id. | closed |
| T-03-02 | Tampering | disabling verification via `new RumorStore({ verifyEvent: undefined })` | low | mitigate | Constructor type is `Omit<EventStoreOptions<Rumor>, "verifyEvent">` — cannot be passed at construction (compile error). NOTE: the inherited public `verifyEvent` setter can still reassign at runtime (documented in the corrected JSDoc); the constructor path — the one this threat scopes — is closed. | closed |
| T-03-03 | Spoofing / Info Disclosure | `RumorStore` treated as an authorization boundary (it is not) | low | accept | Documented accepted design (migration doc): the local verifier checks hash integrity only; authorization is verified upstream. Recorded so downstream consumers don't over-trust store membership. | closed |
| T-03-04 | Tampering / DoS (crash) | signed-only cast reading `.sig` on an unsigned rumor (`TypeError`) | medium | mitigate | `CastEventInput<T>` pins the input to `NostrEvent` for any cast whose `T` requires `sig`, so `castEvent(rumor, SignedOnlyCast)` fails to compile; `@ts-expect-error` probe proves it. | closed |
| T-03-05 | Tampering | sig-gate over-tightening real narrowed-kind rumor casts, forcing callers to `as any` and re-open the gap | medium | mitigate | Sig-gated form leaves `kind`/other fields loose; `applesauce-concord test` (124/124 green) proves `ConcordDirectInvite extends EventCast<DirectInviteRumor>` compiles without weakening. | closed |
| T-03-06 | Info Disclosure | `performCast` leaking into public API surface | low | accept | Accepted convention (matches existing `CAST_REF_SYMBOL`/`CASTS_SYMBOL` leakage); `@internal` JSDoc marks it. Narrowing `casts/index.ts` re-exports is out of scope. | closed |
| T-03-07 | Tampering | RUMOR-06 test masking the invariance gap by using bare `EventStore` instead of a real `RumorStore` | low | mitigate | The new case constructs a genuine `RumorStore` + documented bridge cast; acceptance grep asserts both present (verifier confirmed). | closed |
| T-03-08 | Tampering | sig-gate silently regressing with no test catching it | low | mitigate | `@ts-expect-error` probe fails the build the moment the guard stops rejecting a rumor for a signed-only cast. | closed |
| T-03-09 | Tampering | hand-edited export snapshot hiding an unintended public-API change | low | mitigate | Snapshot regenerated via `vitest -u` (never hand-edited); full `pnpm -r build` gate confirms no unintended downstream surface change. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-03 | `RumorStore` is an integrity boundary (id==hash), not an authorization boundary — by explicit migration-doc design; rumor authorization is the upstream protocol layer's responsibility. | autonomous (plan-authored disposition) | 2026-07-09 |
| AR-03-02 | T-03-06 | `performCast` is intentionally reachable (matching the pre-existing symbol/export convention) and marked `@internal`; narrowing the barrel export is a larger out-of-scope refactor. | autonomous (plan-authored disposition) | 2026-07-09 |
| AR-03-03 | (code-review WR-01) | The inherited public `verifyEvent` setter can reassign a `RumorStore`'s verifier post-construction. Low risk (a caller mutating their own store), now documented accurately in the class JSDoc; not worth breaking the shared `EventStore` setter API. Kind-5 deletes bypassing per-event verification is inherited base behavior, accepted per the Deletion Policy. | autonomous | 2026-07-09 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-09 | 9 | 9 | 0 | autonomous orchestrator (ASVS L1 short-circuit — register authored at plan time, threats_open 0; mitigations independently confirmed by the phase verifier's full builds/tests + concord's 124 tests + the `@ts-expect-error` probe, and by the code review) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-09
