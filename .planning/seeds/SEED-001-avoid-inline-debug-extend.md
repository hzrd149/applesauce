---
id: SEED-001
status: dormant
planted: 2026-07-22
planted_during: v1.1 / Phase 12.2 — concord-sync-debug-logging
trigger_when: when relevant
scope: unknown
---

# SEED-001: Avoid using `debug.extend()` inline — create logger instances at class or module level instead of repeatedly allocating them

## Why This Matters

`debug`'s `extend()` allocates a new `Debugger` and re-runs namespace
enable-matching on every invocation. Calling it inline at a log call site —
especially inside a per-item loop — pays that cost on every single log call, and
it scatters namespace strings as duplicated string literals rather than naming
them once.

This surfaced concretely during Phase 12.2: the concord sync instrumentation
initially called `ctx.logger.extend("decode")(...)` inside per-wrap drop loops,
and `this.log.extend("sync").extend("decode")(...)` at the two live `onWrap`
sites. It was fixed mid-phase by deriving once and storing —
`SyncContext.decodeLogger` (built once in `syncContext()`) and a
`private readonly decodeLog` field assigned in the constructor.

The idea is captured as a seed because the same pattern exists elsewhere in the
monorepo and warrants a deliberate sweep rather than an opportunistic fix.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope
matches. Natural fits: any logging/observability milestone, a performance pass
over the loaders, or a lint-rule/convention hardening effort.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-001` to estimate effort.

Rough shape: the concord occurrences are already resolved. The remaining work is
a sweep of `packages/loaders/` plus, optionally, a lint rule to prevent
regressions.

## The Rule

Derive the `Debugger` once and store it:

- **class** — a field assigned in the constructor, one per sub-namespace used
  more than once
- **free function / module scope** — a module-level `const`
- **context object** — a field on the context, derived where the context is built

Acceptable and not to be changed: `.extend()` used once at construction time to
derive-and-store, e.g. `this.log = options.logger ?? logger.extend("invite")`,
and `logger: this.log.extend("sync")` passed into a child's options object.

## Breadcrumbs

Already following the convention (module-level `const` or class field — no change needed):

- `packages/common/src/helpers/encrypted-content-cache.ts:63`
- `packages/core/src/helpers/event-cache.ts:7`
- `packages/core/src/event-store/event-memory.ts:16`
- `packages/relay/src/negentropy.ts:28`
- `packages/relay/src/liveness.ts:53`
- `packages/signers/src/signers/nostr-connect-provider.ts:87`
- `packages/signers/src/signers/serial-port-signer.ts:47`

Candidate offenders — per-call or inline-at-call-site derivation:

- `packages/loaders/src/loaders/timeline-loader.ts:58,136,221,241,262,446,474` —
  several `opts?.logger?.extend(...)` derived per call
- `packages/loaders/src/loaders/sync-loader.ts:171,266,351` — notably `:351`
  does `log.extend(url).extend("request")` inline in a request path
- `packages/relay/src/management.ts:123` — `this.log = this.log.extend(relay.url)`
  (re-assigns the field; worth a look, likely fine)
- `packages/concord/src/client/client.ts:260,409` — `this.log.extend("invite")`
  built inside methods that can run more than once; not a hot loop, left as-is
  during 12.2

Resolved during Phase 12.2 (reference implementation of the fix):

- `packages/concord/src/client/sync.ts` — `SyncContext.decodeLogger`
- `packages/concord/src/client/community.ts`,
  `packages/concord/src/client/private-channel.ts` — `private readonly decodeLog`
- commit `2f43cf45` — `refactor(12.2-02): derive :sync:decode loggers once, never per-wrap .extend()`

## Notes

Captured via one-shot seed capture during Phase 12.2 execution. Trigger and
scope remain at defaults — enrich with
`/gsd-capture --seed --enrich SEED-001` at your convenience.
