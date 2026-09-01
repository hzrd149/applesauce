---
id: SEED-010
status: dormant
planted: 2026-09-01
planted_during: v7.0.0 Phase 21
trigger_when: when relevant
scope: unknown
---

# SEED-010: Review NIP-67 `auth` hint impact on relay subscription authentication

## Why This Matters

NIP-67 now allows an `EOSE` message to carry an `auth` hint after the relay has sent an AUTH challenge, indicating that more matching events may be available after authentication. Applesauce should determine whether `req()`/`request()`/`subscription()` must recognize the hint, authenticate, and re-establish the query without creating duplicate events, unbounded retries, privacy surprises, or a second operation timeout.

## When to Surface

**Trigger:** when relevant

This seed will surface during `$gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `$gsd-capture --seed --enrich SEED-010` to estimate effort.

## Breadcrumbs

- NIP PR: https://github.com/nostr-protocol/nips/pull/2371#event-30345349889
- Specification change: NIP-42 permits `EOSE` `auth` hints defined by NIP-67, with the AUTH challenge sent before EOSE.
- `.planning/ROADMAP.md` — Phase 22 re-layers `req()`/`request()`/`subscription()` auth and resubscription policy.
- `packages/relay/src/relay.ts` — relay request/subscription framing and auth-retry behavior.
- `packages/relay/src/__tests__/relay.test.ts` — request/subscription authentication regressions.
- `packages/relay/src/__tests__/auth-retry.test.ts` — shared authentication retry operator behavior.

## Notes

Investigate whether an `EOSE` `auth` hint is informational or should trigger policy automatically, how client consent/privacy should be represented, and whether authenticated replay belongs in `request()`/`subscription()` rather than raw `req()`.
