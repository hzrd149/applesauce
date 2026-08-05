---
id: SEED-004
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-004: update to snort/worker-relay v2

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-004` to add context._

Capture-time finding that sets the risk here: the two consuming examples do not use
the package through its public entry alone — **they import worker internals by deep
subpath, including a `src/` path**:

```ts
import WorkerVite from "@snort/worker-relay/src/worker?worker";   // DEV — source tree
new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url) // PROD — build output
```

Those two paths are the likeliest thing a major bump breaks, and they are the least
likely to be covered by the package's stated API contract or its migration notes. A
v2 that only reorganises its build output — without touching `WorkerRelayInterface`
at all — would still break both examples. Treat the worker-script resolution, not the
API surface, as the load-bearing part of this migration.

Offsetting that: the blast radius is contained. `@snort/worker-relay` is a dependency
of `apps/examples` **only** — no published `packages/*` depends on it, so no consumer
of the applesauce libraries is affected and no changeset is required for the bump
itself.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-004` to estimate effort.

Both examples are runtime-verified by loading them in the browser, not by the test
suite — the suite passing proves nothing about this bump. Budget for manual
verification of both examples in DEV **and** a production build, since the DEV and
PROD worker paths differ and only one of them is exercised at a time.

## Breadcrumbs

**Pinned in one place:** `apps/examples/package.json` → `"@snort/worker-relay": "^1.5.0"`
Lockfile resolves to `1.5.0`. No other manifest references it.

**Two consumers, both in `apps/examples`:**

- `apps/examples/src/examples/cache/worker-relay.tsx` — cache-in-front-of-store usage
- `apps/examples/src/examples/database/worker-relay.tsx` — full `WorkerRelayEventDatabase`
  wrapper class

**`WorkerRelayInterface` API surface actually used** (the migration checklist):

| Method | Used in |
|--------|---------|
| `new WorkerRelayInterface(workerScript)` | both |
| `.init({...})` | both |
| `.query(["REQ", id, ...filters])` | both |
| `.event(event)` | both |
| `.count(["REQ", ...])` | database only |
| `.delete(["REQ", ...])` | database only |

Note the wire-shaped argument convention (`["REQ", id, ...filters]`) — if v2 changes
that to a plain filter object, every call site above moves.

**Docs that hardcode the version and will drift silently:**

- `.planning/codebase/INTEGRATIONS.md:195` — "`@snort/worker-relay` 1.5.0"
- `.planning/codebase/STACK.md:124` — "@snort/worker-relay 1.5.0"

**Docs that describe it narratively (check for staleness, no version pinned):**

- `apps/agent-skills/src/skill/references/persistence.md` (lines 8, 35, 44)
- `apps/agent-skills/src/skill/references/overview.md:102`
- `apps/llms/src/template.md`

Related: sibling dependency items are SEED-002 (TypeScript 7), SEED-003 (React 19),
and backlog 999.8 (nostr-tools ~2.24). This one is the most isolated of the four —
single consumer app, no published-package impact — so it can ship independently of
all of them.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
