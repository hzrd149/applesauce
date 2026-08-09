---
id: SEED-001
status: resolved
planted: 2026-07-22
planted_during: v1.1 / Phase 12.2 — concord-sync-debug-logging
resolved: 2026-08-08
resolved_in: phase-14
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
  **Audited compliant (Phase 14).** All seven sites derive at operator-application
  time (inside the `(source) => {...}` returned by an operator factory, evaluated
  once per operator application, not per emission) or at function-entry time
  (inside `createTimelineLoader`/`createOutboxTimelineLoader`, once per loader
  construction). None sits on a path a reactive pipeline can re-enter.
- `packages/loaders/src/loaders/sync-loader.ts` — **Audited, one genuine offender
  found and fixed (Phase 14).** The line numbers this entry previously cited
  predated several refactors and no longer pointed at the described code;
  replaced below with the audited current-state finding. `buildRelayStream(url)`'s per-url
  request logger was derived inline via `log.extend(url).extend("request")`
  inside the `switchMap((nips) => ...)` projector — a re-enterable reactive
  callback — instead of at `buildRelayStream`'s own top level, where every other
  per-relay value in that function is derived. Fixed by hoisting it to a
  `const requestLog` declared once per relay, alongside `authPhases` and the
  other per-relay state. `paginatedRequest`'s `logger?.extend("backward").extend(nanoid(8))`
  and the loader-level `baseLog.extend(nanoid(4))` are per-call correlation
  loggers, audited compliant under the Rule's carve-out below — untouched.
- `packages/relay/src/management.ts:123` — **Audited compliant (Phase 14, as part
  of confirming no relay-side sweep was needed, D-20).** `this.log = this.log.extend(relay.url)`
  is a constructor-time derive-and-reassign, run once per `RelayManagement`
  construction — the same shape as `relay.ts`'s own `this.log` derivation.
- `packages/concord/src/client/client.ts:260,409` — out of this phase's scope
  (`packages/concord/` is Phase 15 territory); left as recorded during 12.2,
  not re-audited here.

Resolved during Phase 12.2 (reference implementation of the fix):

- `packages/concord/src/client/sync.ts` — `SyncContext.decodeLogger`
- `packages/concord/src/client/community.ts`,
  `packages/concord/src/client/private-channel.ts` — `private readonly decodeLog`
- commit `2f43cf45` — `refactor(12.2-02): derive :sync:decode loggers once, never per-wrap .extend()`

## Notes

Captured via one-shot seed capture during Phase 12.2 execution. Trigger and
scope remain at defaults — enrich with
`/gsd-capture --seed --enrich SEED-001` at your convenience.

## Resolution

Closed by Phase 14 (auth-lifecycle-debug-logging), plan 14-02.

Phase 14's own research re-verified this seed's original criterion — a grep for an
extend-then-immediately-invoke pattern (`x.extend(...)(...)`) at a log call site —
and found it returns zero hits anywhere in this monorepo, so as written it passed
without the `packages/loaders/` sweep ever being performed (D-17). The criterion
was tightened to "derived once per relay-or-loader lifetime, never on a path a
reactive pipeline can re-enter" (D-18), and `REQUIREMENTS.md` ALOG-03 and
`ROADMAP.md`'s Phase 14 success criterion 3 were both amended to that wording.

Under the tightened rule, the sweep found exactly one genuine offender: the
per-url request logger in `packages/loaders/src/loaders/sync-loader.ts`'s
`buildRelayStream`, derived inline inside a `switchMap` projector instead of at
the function's own top level. It is now hoisted to a `const requestLog` declared
once per relay, alongside `buildRelayStream`'s other per-relay state.

`timeline-loader.ts`'s seven previously-flagged sites and both generated-suffix
correlation loggers (`paginatedRequest`'s `.extend("backward").extend(nanoid(8))`
and the loader-level `baseLog.extend(nanoid(4))`) were audited and are compliant
as-is — each derives at operator-application, function-entry, or per-call
correlation time, never inside a re-enterable reactive callback or a per-item
loop body.

`packages/relay/` needed no sweep (D-20): every logger there — including
`management.ts:123`'s `this.log = this.log.extend(relay.url)` — is already a
class field, a module const, or a constructor-time derive-and-reassign.

No enforcement mechanism was added, and this is deliberate (D-19): a lint rule
enforcing the logger convention is explicitly out of scope per `REQUIREMENTS.md`'s
Out of Scope table; a grep-based repo test is that same rule wearing different
clothes; and a written-invariant comment was declined because Phase 5.1 found 14
of Phase 5's own invariant comments had gone false, giving that mechanism a poor
track record in this codebase. Regressions are caught by review, not tooling.
