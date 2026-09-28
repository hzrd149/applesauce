# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 25-ecosystem-riders-react-19-snort-worker-relay-v2
**Areas discussed:** Folded todo, React version matrix, hook behavior coverage, provider coverage

---

## Folded Todo

The matched Phase 05.1 follow-up contained three remaining cosmetic issues: stale `stamp` commentary, `lockWallet` retaining `WalletRelaysSymbol`, and truthy checks in `getAppDataContent`. The user chose to fold all three into Phase 25 because they appeared simple to fix.

## React Version Matrix

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Enforcement location | CI matrix; repository fixtures; split local/CI coverage | CI matrix |
| Versions | Latest releases per major; exact pins; minimum React 18 plus latest 19 | Latest per major |
| Local reproduction | Dedicated matrix command; CI only; documented manual commands | CI only |
| Workspace baseline | React 18; React 19 | React 19 |

## Hook Behavior Coverage

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Initial emissions | Sync and async; sync only; updates only | Sync and async |
| Source replacement | Full lifecycle; basic switch; skip | Full lifecycle |
| Error propagation | Pre/post-effect plus stale isolation; post-mount only; skip | Full coverage |
| Cleanup | Unmount/replacement/Strict Mode; no Strict Mode; unmount only | Full coverage |

## Provider Coverage

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Direct suites | All three providers; EventStore direct with others through hooks; one nested integration | EventStore direct, others through hooks |
| Missing providers | Exact contracts; throw-only; optional-only | Exact contracts |
| Value changes | All providers; initial-only; EventStore only | All providers |
| Nesting | Nearest plus removal transition; skip; nearest only | Nearest plus removal transition |

## the agent's Discretion

- CI implementation, rendering library, test organization, worker-relay verification depth, and focused regression-test details for the folded fixes.

## Deferred Ideas

None.
