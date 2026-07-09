---
phase: 2
slug: generic-models-casts
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-08
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| (no new boundaries) | Pure type-genericization of the reactive model framework and cast infrastructure. No new network, storage, auth, or user-input surface; every generic parameter defaults to `NostrEvent` so the default runtime path is unchanged. | — |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering | `insertEventIntoDescendingList` bridge cast (TimelineModel) | low | mitigate | Cast scoped to one call site; helper reads only `created_at`/comparison fields on every `StoreEvent`; timeline ordering tests unchanged. | closed |
| T-02-02 | Tampering | generic threading of `claimEvents`/`claimLatest`/base models | low | accept | Compile-time-only; `NostrEvent` default; full suite passes unchanged. | closed |
| T-02-03 | Tampering | `EventModels` 2nd type param vs. 6 `declare module` augmentations | low | mitigate | Full `pnpm -r build` gate exercised all 6 augmentation files; they compiled **unmodified** (verifier-confirmed). | closed |
| T-02-04 | Tampering | bare generic instantiation inferring `StoreEvent` constraint vs `NostrEvent` default | low | mitigate | Full-workspace build is the gate; any regression surfaces as a `tsc` error and is fixed with an explicit type arg (Phase 1 precedent). Build green. | closed |
| T-02-05 | Tampering | `E` inserted at wrong position in `Model`/`ModelConstructor` | low | accept | `E` inserted as 2nd param with `NostrEvent` default; all downstream call sites are under-arity (grep-verified); wrong position fails `tsc`. Build green. | closed |
| T-02-06 | Tampering | `CastConstructor` contravariance (constructor `event` stays `NostrEvent`) | low | mitigate | Constructor param deliberately not widened (only `store` widens); code review confirmed the trick is preserved verbatim. | closed |
| T-02-07 | Tampering | `getParentEventStore(...) as unknown as CastRefEventStore<E>` bridge | low | mitigate | Re-types an already-generic helper; `rumor-cast.test.ts` (unmodified) confirms correct store resolution for signed and rumor events. | closed |
| T-02-08 | Tampering | downstream bare `CastRefEventStore` consumers inferring `StoreEvent` constraint | low | mitigate | Final `pnpm -r build` gate green; `castUser`/`castPubkey` resolved to `NostrEvent` default with zero edits. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-02, T-02-05 | Type-parameter genericization is compile-time-only with `NostrEvent` defaults; zero runtime/attack-surface change, proven by the unchanged 592-test suite and a clean full-workspace build. | autonomous (plan-authored disposition) | 2026-07-08 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-08 | 8 | 8 | 0 | autonomous orchestrator (ASVS L1 short-circuit — register authored at plan time, threats_open 0; mitigations independently confirmed by the phase verifier's own full builds/tests/type-probe and the code review) |

**Related non-security follow-up (not a threat):** code-review WR-01 — `castEvent`'s input type does not exclude an unsigned rumor from a signed-only cast (would throw a runtime `TypeError`, not create a signature-bypass). Documented in `deferred-items.md` as owned by Phase 3/4, where rumor casting is exercised. It is a robustness/API-typing item, not a STRIDE security threat, and does not open a threat at or above the block threshold.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-08
