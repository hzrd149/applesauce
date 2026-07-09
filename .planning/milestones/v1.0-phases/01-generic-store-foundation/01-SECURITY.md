---
phase: 1
slug: generic-store-foundation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-08
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| caller → `EventStore.add` (event ingestion) | Events entering the store are verified by `verifyEvent` before insertion. Unchanged this phase except the new opt-in to disable verification via `verifyEvent: undefined`. | Nostr events (untrusted, from network/caller) |
| (no other new boundaries) | The rest of the phase is compile-time type genericization — no new network, storage, auth, or user-input surface. `verifyRumor` is introduced but not wired into any store until Phase 3. | — |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering | `verifyRumor` (helpers/event.ts) | medium | mitigate | Recomputes `getEventHash(rumor)` and strict-equals `rumor.id`; `rumor.test.ts` proves accept-correct / reject-tampered. Not yet reachable from any store (Phase 3 wiring). | closed |
| T-01-02 | Tampering | genericized structural helpers | low | accept | Compile-time-only type params; `NostrEvent` runtime path byte-for-byte identical. | closed |
| T-01-03 | Tampering | genericized store/manager interfaces | low | accept | Interface-shape-only genericization; no runtime code. | closed |
| T-01-04 | Tampering | `DeleteManager` bridge casts | low | mitigate | `as unknown as NostrEvent` casts confined to helpers that read only structural `StoreEvent` fields (never `sig`); reviewer-confirmed; delete/expiration tests unchanged. | closed |
| T-01-05 | Tampering | genericized managers | low | accept | Compile-time-only type params; `NostrEvent` default preserved. | closed |
| T-01-06 | Spoofing/Tampering | `verifyEvent: undefined` (CORE-03) | medium | accept | Disabling verification is explicit opt-in; default stores unaffected; D-01 `console.warn` surfaces an accidentally-disabled verifier; `verify-event-option.test.ts` covers it. Below `high` block threshold. | closed |
| T-01-07 | Tampering | `coreVerifyEvent as unknown as (event: E) => boolean` bridge | low | mitigate | Re-types the existing default verifier; for `E = NostrEvent` it is exactly `nostr-tools` `verifyEvent`; default rejection confirmed by test. | closed |
| T-01-08 | Tampering | generic threading of stores | low | accept | Compile-time-only; `new EventStore()` byte-for-byte identical; full suite passes unchanged. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-06 | Disabling event verification via explicit `verifyEvent: undefined` is a deliberate, documented opt-in for advanced callers; default behavior is verification-on, and a `console.warn` surfaces the disabled state. Medium severity, below the `high` block threshold. | autonomous (plan-authored disposition) | 2026-07-08 |
| AR-02 | T-01-02, T-01-03, T-01-05, T-01-08 | Type-parameter genericization is compile-time-only with `NostrEvent` defaults; zero runtime/attack-surface change, proven by the unchanged 592-test suite. | autonomous (plan-authored disposition) | 2026-07-08 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-08 | 8 | 8 | 0 | autonomous orchestrator (ASVS L1 short-circuit — register authored at plan time, threats_open 0, mitigations independently confirmed by phase verifier + code reviewer) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-08
