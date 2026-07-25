---
id: SEED-003
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-003: update to react 19 while maintain support for react 18

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-003` to add context._

Capture-time finding that changes the shape of this work: **the dual-support half is
already declared, but it is never exercised.** `packages/react` ships
`peerDependencies: { react: "^18.0.0 || ^19.0.0" }`, yet `pnpm-lock.yaml` resolves
that range to `18.3.1` and contains **no React 19 entry at all**. Every test run and
every type-check to date has happened against 18 only.

So the real work is not "widen the range" — that is done. It is:

1. Make the React 19 half of the existing claim actually verified, and
2. Keep it verified, so the range does not silently drift back to being an assertion.

That points at a dual-install / CI matrix strategy rather than a version bump.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-003` to estimate effort.

The two halves have very different costs and are worth splitting at promotion:

- **Verifying 19 (the load-bearing half)** — needs a way to run `packages/react`'s
  suite against both majors. Test-matrix plumbing, not product code.
- **Moving `apps/examples` to 19** — a contained bump of one app (4 pins, below).
  Independent of the library's dual support and could ship on its own.

## Breadcrumbs

**`packages/react` — already dual-ranged, only 18 resolved:**

| Field | Declared | Lockfile resolution |
|-------|----------|---------------------|
| `peerDependencies.react` | `^18.0.0 \|\| ^19.0.0` | — |
| `devDependencies.react` | `^18.0.0 \|\| ^19.0.0` | **18.3.1** |
| `devDependencies.@types/react` | `^18.0.0 \|\| ^19.0.0` | — |

Whole-lockfile check: the only React present is `react@18.3.1` / `react-dom@18.3.1`.
No 19.x anywhere.

**`apps/examples` — pinned hard to 18, the only place with concrete 18 pins:**

- `react: ^18.3.1`
- `react-dom: ^18.3.1`
- `@types/react: ^18.3.27`
- `@types/react-dom: ^18.3.7`

Note `packages/react` has no `react-dom` dependency of any kind — only `react` — so
the DOM-side surface is `apps/examples`' concern alone.

Related: SEED-002 (TypeScript 7) and backlog 999.8 (nostr-tools ~2.24) are sibling
dependency items. Relevant overlap here is `@types/react` — a React 19 types bump and
a TypeScript major are both type-layer changes and will confound each other's fallout
if run together. Prefer sequencing them apart.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
