---
id: SEED-002
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-002: update to typescript 7

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-002` to add context._

TypeScript 7 is the native (Go) port of the compiler rather than an incremental
release of the existing JS-based one, so this is a toolchain migration and not a
routine version bump. Confirm the current migration path and the 6.x transitional
story at promotion time rather than trusting this note.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-002` to estimate effort.

One input to that estimate: the workspace does not currently pin a single TypeScript
version, so a bump touches 18 manifests across 5 distinct ranges (see Breadcrumbs).
Consolidating those onto one range is arguably a prerequisite, and may be worth doing
independently of TS 7.

## Breadcrumbs

TypeScript is pinned independently in 18 `package.json` files across five distinct
ranges — there is no single source of truth to bump:

| Range | Manifests |
|-------|-----------|
| `~5.6.3` | `apps/examples` |
| `^5.7.3` | `packages/relay` |
| `^5.8.3` | `packages/actions`, `common`, `concord`, `content`, `core`, `extra`, `loaders`, `react`, `signers`, `wallet-connect` |
| `^5.9.3` | root `package.json`, `apps/agent-skills`, `apps/llms`, `packages/accounts`, `sqlite`, `wallet` |

Note `apps/examples` is the only tilde pin and the furthest behind (`5.6.3`); the root
`package.json` is at `^5.9.3`.

Related: SEED-001 (`avoid-inline-debug-extend`) is unrelated. Backlog phase 999.8
(`update to nostr-tools ~2.24`) is a sibling dependency-bump item — the two may be
worth sequencing together since both touch the same manifests and both need a
full-suite run for fallout.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
