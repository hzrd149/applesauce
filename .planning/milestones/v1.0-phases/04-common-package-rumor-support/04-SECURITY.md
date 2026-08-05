---
phase: 4
slug: common-package-rumor-support
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-09
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| (no new boundaries) | Signature-only genericization of 4 `applesauce-common` structural helpers. No new network, storage, auth, or user-input surface; every helper keeps its `= NostrEvent` default. `KnownEvent`-guarded (signature-dependent) helpers were deliberately NOT genericized. | — |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Tampering | genericized helper signatures (threading/emoji/hashtag/content) | low | mitigate | Each helper bound to a structural shape only with `= NostrEvent` default (preserving signed inference at every call site); no `isValidXxx`/`KnownEvent<K>`-guarded helper genericized, so no signature/verification assumption is weakened; full `pnpm run build` gate (exit 0) confirms no downstream inference drift. Verifier ran a runtime spot-check over rumor shapes. | closed |
| T-04-02 | Tampering | published export surface (4 `exports.test.ts` snapshots + `casts/*`) | low | mitigate | Signature-only edits add zero export names; the 4 inline export snapshots pass unchanged (no `vitest -u`), and no `casts/*` file was edited — verified byte-identical via `git diff`/`git log`. | closed |
| T-04-03 | Repudiation | COMMON-02 scope decision | low | mitigate | The empty targeted-cast set is documented in `04-COMMON-02-AUDIT.md` with a re-runnable grep — auditable, not a silent omission (verifier re-ran the grep). | closed |
| T-04-SC | Tampering | supply chain (npm/pip/cargo installs) | low | accept | No new packages installed — a pure internal TypeScript generics change; no supply-chain surface to gate. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-SC | No dependency changes this phase — no supply-chain surface. | autonomous (plan-authored disposition) | 2026-07-09 |

*Note: the pre-existing `getHashtagTag` unsafe-`undefined` cast (code-review WR-01) is a correctness/robustness issue documented in `deferred-items.md`, not a STRIDE security threat introduced by this phase.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-09 | 4 | 4 | 0 | autonomous orchestrator (ASVS L1 short-circuit — register authored at plan time, threats_open 0; mitigations independently confirmed by the phase verifier's full builds/tests + runtime rumor-shape spot-check and the code review) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-09
