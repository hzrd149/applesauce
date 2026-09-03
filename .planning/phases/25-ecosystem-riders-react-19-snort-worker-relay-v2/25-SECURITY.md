---
phase: 25
slug: ecosystem-riders-react-19-snort-worker-relay-v2
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-03
---

# Phase 25 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Package registry → workspace | Audited React test packages and worker-relay v2 enter the dependency graph. | Executable third-party code and lockfile metadata |
| Observable → React commit | Values and errors cross lifecycle and active-source boundaries. | Application state and errors |
| Browser UI → worker → OPFS | User actions and relay events cross RPC into persistent browser storage. | Persisted Nostr events and query results |
| Encrypted wallet cache → locked wallet | Decrypted metadata must become unreachable when wallet trust state changes. | Private wallet relay metadata |
| Event content → parsed application data | Untrusted JSON becomes cached downstream data. | Event-provided JSON values |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-25-01 | Tampering | React package resolution | high | mitigate | Human package-identity approval, audited ranges, lockfile review, frozen install, and builds | closed |
| T-25-02 | Denial of Service | Initial observable rendering | medium | mitigate | Synchronous/asynchronous renderer tests and act-wrapped emissions | closed |
| T-25-03 | Denial of Service | Stale observable errors | medium | mitigate | Active-source identity gates and early/late error-boundary tests | closed |
| T-25-04 | Elevation of Privilege | Nested provider selection | medium | mitigate | Nearest-provider and outer-provider restoration tests through public hooks | closed |
| T-25-05 | Tampering | React compatibility CI | medium | mitigate | Matching runtime/type majors, isolated React 18/19 installs, and identical suites | closed |
| T-25-06A | Tampering | worker-relay package resolution | high | mitigate | Human registry/source approval, audited v2 range, lockfile review, and Vite build | closed |
| T-25-07A | Information Disclosure | OPFS migration | medium | mitigate | Stable database names, no clear-as-migration path, and approved seeded-data browser smoke | closed |
| T-25-08A | Denial of Service | Worker initialization and operations | medium | mitigate | Settled initialization, operation-scoped errors, retries, and approved browser smoke | closed |
| T-25-09 | Information Disclosure | Wallet lock boundary | high | mitigate | All decrypted caches are deleted and regression-tested on lock | closed |
| T-25-10 | Tampering | Application-data parsing | medium | mitigate | Undefined-only failure sentinel with falsy and malformed-input regressions | closed |
| T-25-11 | Repudiation | Changeset scope | low | mitigate | One-change, one-sentence changesets verified mechanically | closed |
| T-25-06B | Tampering | Active observable identity | medium | mitigate | Observable identity gates reject stale values and errors after replacement | closed |
| T-25-07B | Denial of Service | Hot replacement subscription | medium | mitigate | Retained subscription established in isomorphic layout effect with ordered-sibling regression | closed |
| T-25-08B | Denial of Service | Strict Mode cleanup | medium | mitigate | Self-closing render probe and exact teardown assertions | closed |
| T-25-SC1 | Tampering | React test dependency install | high | mitigate | Explicit legitimacy approval before installation | closed |
| T-25-SC2 | Tampering | CI dependency resolution | high | mitigate | CI installs only committed audited ranges | closed |
| T-25-SC3 | Tampering | worker-relay dependency install | high | mitigate | Explicit registry/source approval before installation | closed |
| T-25-SC4 | Tampering | Plan 25-04 dependency surface | low | accept | No package-manager installation occurred in the plan | closed |
| T-25-SC5 | Tampering | Temporary React selection | low | accept | Only audited majors were selected without lockfile writes, then frozen baseline and clean diff were verified | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-25-01 | T-25-SC4 | No dependency installation or new supply-chain surface occurred. | Phase plan | 2026-09-03 |
| AR-25-02 | T-25-SC5 | Temporary selection used already-audited majors, prohibited lockfile writes, and ended with frozen restoration plus a clean metadata diff. | Phase plan | 2026-09-03 |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-03 | 19 | 19 | 0 | Codex verify-work security enforcement |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-03
