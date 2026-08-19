# Phase 14: Auth Lifecycle Debug Logging - Research

**Researched:** 2026-08-08
**Domain:** RxJS-based NIP-42 relay auth instrumentation (`applesauce-relay`) + `debug`-package logger hygiene sweep (`applesauce-loaders`)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Retiring the read/publish/sync bucket**
- **D-01:** Phase 13's entire auth surface is unreleased. `applesauce-relay` is published at 6.2.1; `RelayAuthOperation`, `RelayAuthContext`, `onAuthRequired`, `authTimeout`, `authRetries`, and `PublishResponse.error` exist only on master, described by fourteen pending changesets in `.changeset/`. They have zero downstream consumers today. Every API widening in this phase is therefore an edit to a pending changeset body rather than a major bump — and that window closes at the next release. This fact is what justifies D-02 and D-11 living in a logging phase; it must be re-verified before planning, because a release in between invalidates the reasoning.
- **D-02:** `operation: "read" | "publish" | "sync"` is removed from `RelayAuthContext` and replaced by a wire-verb discriminated union carrying the request the relay actually refused — shape roughly `{ verb: "REQ"; id; filters } | { verb: "COUNT"; id; filters } | { verb: "EVENT"; event } | { verb: "NEG-OPEN"; id; filter }`. Relays gate auth on request shape, not category; the discriminant is the NIP-01/NIP-77 verb, exhaustive so a new verb is a compile error.
- **D-03:** The read/publish distinction survives in exactly one place — a compatibility adapter at the `receivedAuthRequiredForReq` / `receivedAuthRequiredForEvent` write, mapping verb to legacy flag.
- **D-04:** `authRequiredForRead$` / `authRequiredForPublish$` stay as public API (RAUTH-09 unchanged) but nothing internal reads them. Delete the two `take(1)` log subscriptions at `relay.ts:546` and `:554` — the last internal readers *and* the bucketed lines this phase retires. Keep every write (`:931`, `:1056`, `:1147`→**see Research correction, actual write is `:1149`**, `:1262`), `resetState()`'s clears (`:413-414`), and the `status$` composition (`:571-572`). Concord's four readers consume `status$` and are CAUTH-03's, not this phase's.

**Operation attribution (ALOG-02)**
- **D-05:** An operation is identified in its log lines by its wire key plus a phase counter — the id already carried on the union (REQ/COUNT subscription id, `event.id`, NEG-OPEN id), truncated for display only, with `phase n/N`. `negentropy()` must own its subscription id instead of `negentropySync` minting it at `negentropy.ts:71` per negotiation, so the id stays stable across auth retries.
- **D-06:** The line carries a summary of the triggering request: kinds spelled out, every other filter field reduced to a count — e.g. `REQ nX7f2a kinds=[1059] authors=3 #e=1 limit=50`.
- **D-07:** D-08's consecutive-counter reset gets no line of its own — observable via the per-line phase counter restarting at 1.

**The connection track (AUTH send/result)**
- **D-08:** Pubkey is the join key between the connection track and each operation track. The connection track prints the pubkey it authenticated; each operation track prints which pubkeys satisfied its wait.
- **D-09:** The connection track logs challenge → signing → sent → result, with the relay's own `OK` message carried verbatim as the "why". The signing line is load-bearing: it separates "the signer never answered" from "the relay never replied" (D-12's hung-signer scenario).
- **D-10:** Line placement: the signing line in `authenticate()` (`:1303`); sent and result in `auth()` (`:1201`). *(Claude's discretion, stated and unchallenged.)*
- **D-11:** `event()`'s locally-manufactured timeout marks itself. `:1156` (context cited `:1153`) produces `{ ok: false, from, message: "Timeout" }` and `:1121` (context cited `:1120`) builds a relay rejection with the identical shape; `auth()` writes whichever it received as if both were equally authoritative. Fix structurally using `PublishResponse.error` (`types.ts:128`, D-18 of Phase 13) — set on the timeout branch, absent on a relay rejection. Do not sniff the `"Timeout"` string.
- **D-12:** `resetState()` logs auth-state invalidation when there was something to invalidate, naming how many authenticated pubkeys were dropped and whether a challenge was held. Reuse the guards already at `:407-408` so a never-authenticated connection stays silent.

**Namespace and line set (ALOG-01)**
- **D-13:** Auth lines go to a dedicated `:auth` sub-namespace, derived once per relay in the constructor alongside `this.log` — the SEED-001 pattern applied to this phase's own output. `debug` matches anchored globs, so `DEBUG=applesauce:Relay:*` still shows the auth lines and `DEBUG=applesauce:Relay:*:auth` narrows to only them. **Empirically verified true against the installed `debug@4.4.3`, see Pitfall/Finding below.**
- **D-14:** Log every state the operation actually blocks in — handler invoked (or absent), waiting on auth state — plus every outcome: RAUTH-06's `waitForAuth: false` short-circuit, handler resolved/threw/rejected, wait satisfied, per-phase timeout, retries exhausted, and D-19's silently-dropped relay in `RelayGroup.sync`. **Research correction: this log line already exists as of Phase 13 — see Pitfall 1 below, do not plan to "add" it.** Not internal bookkeeping (see D-07). Roughly five lines per phase.
- **D-15:** Lines are human prose with the key facts inline, matching the package's existing voice (`Relay connection has become unresponsive, triggering reconnect`) rather than structured `key=value`.
- **D-16:** Oracle: capture real `debug` output. Enable the `:auth` namespace, collect emitted lines via `debug`'s output hook, and assert the expected sequence for a scripted auth scenario, with the sequence derived from the NIP-42 exchange rather than from what the code prints. `debug`'s enable state is global — tests need setup/teardown discipline. Per the standing Verification Standard, record a RED→GREEN non-vacuity probe per requirement. **A working harness for exactly this already exists in this repo — see Code Examples.**

**ALOG-03 sweep**
- **D-17:** ALOG-03's stated criterion already passes and must be restated. Its test — "a grep for inline `.extend(` at a log call site returns zero hits" — finds nothing, because no extend-then-immediately-invoke pattern (`x.extend(…)(…)`) exists in `packages/loaders/` or anywhere in the monorepo. **Confirmed by direct grep in this research.**
- **D-18:** The criterion is tightened to "derived once per relay-or-loader lifetime, not on a repeating path", and the sweep is what that catches — principally `sync-loader.ts:611`, hoisting the per-url logger out of the `switchMap`. The `.extend(nanoid(n))` correlation loggers stay: they are per-call on purpose. `REQUIREMENTS.md` ALOG-03 and `ROADMAP.md` Phase 14 success criterion 3 both need amending to the new wording.
- **D-19:** No enforcement mechanism. One-time sweep, mark SEED-001 resolved, rely on review for regressions.
- **D-20:** `packages/relay/` is already compliant under the tightened rule — every logger is a class field or module const. **Confirmed.** The new `:auth` logger (D-13) must follow suit. No relay-side sweep needed.

### Claude's Discretion
- Exact naming and field shape of the wire-verb union (D-02), and whether it replaces `operation` in place or lands under a new key.
- How the request summary is rendered (D-06) beyond "kinds spelled out, rest counted".
- The exact prose of every line (D-15), and truncation width for ids (D-05).
- Where the `:auth` logger field lives on `Relay` and how `RelayGroup`/`RelayPool` route theirs.
- How `negentropy()` takes ownership of its subscription id (D-05).
- Test file placement and the capture harness's shape (D-16).

### Deferred Ideas (OUT OF SCOPE)
- Concord's four remaining reads of the auth-required flags (`relay-auth.ts:110`, `:206`, `invite-watcher.ts:258`, `:435`, all consuming `status$`) — Phase 15, not here.
- A lint rule enforcing the logger convention — scoped out by REQUIREMENTS.md at milestone start and declined again by D-19.
- Value-signalling the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — carried forward from Phase 13's deferred list; D-11 closes one instance, not the class.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ALOG-01 | An operator can tell from debug output where a NIP-42 auth attempt sits in its lifecycle — challenge received, AUTH sent, result — and why it succeeded or failed | Namespace/glob behavior empirically verified (D-13); exact line placement for every log point verified against current `relay.ts`/`negentropy.ts`/`group.ts`; D-16 capture-harness precedent identified and ready to reuse |
| ALOG-02 | Auth retry, timeout, and rejection outcomes are attributable to the specific operation that triggered them | `RelayAuthContext`/`RelayAuthOperation` construction and consumption sites fully mapped; `reqs$` recoverability of the triggering filter confirmed; D-02's wire-verb union call sites identified in `req()`/`count()`/`event()`/`negentropy()` |
| ALOG-03 | Every `Debugger` in `packages/loaders/` is derived once at class, module, or context construction — never `.extend()`-ed at a log call site | Full sweep performed: `sync-loader.ts` (4 sites) and `timeline-loader.ts` (7 sites) individually verified against the tightened D-18 rule; single genuine target confirmed (`sync-loader.ts:611`) |
</phase_requirements>
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **Changesets:** one change per `.changeset/*.md` file; body is a single sentence of markdown, no bullets/code blocks/multiple paragraphs. D-01 requires editing `.changeset/relay-operation-scoped-auth-callbacks.md` in place (confirmed below its body still names `operation`) — this is an edit to an unreleased changeset, not a new entry, since `applesauce-relay` has not shipped it yet.
- No standalone "best practices" files; this phase produces no new documentation pages (it's a source + test change), so this constraint does not apply to Phase 14's deliverables directly.
- Nothing in CLAUDE.md constrains logging style or test structure beyond the changeset rule above.

## Summary

Phase 14 is two independent pieces of work bundled by the same seed (SEED-001) and the same domain (NIP-42 auth). The first — `applesauce-relay` instrumentation — is genuinely relay-API-touching, not observability-only: D-02 retires the `RelayAuthOperation` three-value bucket in favor of a wire-verb discriminated union, and D-11 makes `event()`'s locally-manufactured timeout distinguishable from a relay-issued rejection via the already-existing-but-unused `PublishResponse.error` field. Both changes are safe to make as pending-changeset edits rather than breaking-change bumps: this research re-verified D-01's premise directly against the registry and the changeset directory — **confirmed true**. `applesauce-relay` is published at `6.2.1`; exactly 14 pending changesets target `applesauce-relay`; a repo-wide grep for `RelayAuthOperation` / `RelayAuthContext` / `onAuthRequired` found zero references outside `packages/relay/` and `packages/loaders/` (which keeps only a structural, import-free mirror). The premise holds.

The second piece — the `packages/loaders/` `Debugger`-hygiene sweep — turns out to be almost entirely already-compliant. This research re-verified every line CONTEXT.md cites in `sync-loader.ts` and `timeline-loader.ts` against current source: **all line numbers are exact**, and the tightened D-18 rule ("derived once per relay-or-loader lifetime, not on a repeating path") isolates a single real target: `sync-loader.ts:611`, where `log.extend(url).extend("request")` sits inside a `switchMap` callback in `buildRelayStream()`, rather than being hoisted to a `const` at the top of the per-relay stream builder (which runs once per relay, same as everywhere else in the file). Every other cited site in both loader files derives its logger once, at operator-application or function-entry time, and is already compliant.

One correction this research surfaces that the planner must act on: **D-14's claim that "D-19's silently-dropped relay in `RelayGroup.sync`" needs a log line added by Phase 14 is stale.** That line already exists — it landed in Phase 13 (plan 13-07) at `group.ts:359`: `this.log(\`dropping relay from group sync (D-19): ${relay.url}\`, err)`. The surrounding source comment (`group.ts:356-357`) explicitly defers only a *status channel* to "Phase 14 (ALOG-02) territory" — not this log line. The planner should not create a task to "add" this line; instead, decide whether it needs D-15 prose cleanup (it currently embeds a literal `(D-19)` plan-citation in production log text) and whether it should route through an `:auth`-flavored channel given D-13's namespace design lives on `Relay`, not `RelayGroup`.

D-13's namespace-glob claim was verified empirically against the installed `debug@4.4.3` in this repo (see Code Examples): `DEBUG=applesauce:Relay:*` matches both the base relay namespace and its `:auth` child; `DEBUG=applesauce:Relay:*:auth` narrows to only the child. D-16's capture-harness — enable a concrete namespace, override `debug.log`, collect calls, restore in a `finally` — is not a new pattern to invent: it already exists verbatim in `packages/concord/src/helpers/__tests__/relays.test.ts` (`captureDebugOutput()`), built for exactly this "module-level logger, never injected" situation `Relay` is in (no `logger` option exists on `RelayOptions` today). The planner should lift this helper into `packages/relay/src/__tests__/`, reusing `relay.test.ts`'s existing `WS` mock server + real-`Relay` + real-clock setup (matching 13-CONTEXT.md D-20's precedent of real timers, not fake ones).

**Primary recommendation:** Treat this as two sequenced workstreams — (1) `applesauce-relay`: wire-verb union (D-02) → two-track logging (D-08/D-09/D-12) → `:auth` namespace + capture-harness tests (D-13/D-16) → changeset edit (D-01); (2) `applesauce-loaders`: single-site hoist at `sync-loader.ts:611`, mark SEED-001 resolved, no changeset needed (zero observable behavior change). Do not re-derive the D-19 dropped-relay line — it exists; only its routing/prose is open.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| NIP-42 auth-required detection, retry/timeout state machine | API/Backend library (`applesauce-relay`) | — | `authRetry` operator owns handler invocation, per-phase timeout, and retry counting entirely inside the relay package; no UI/server tier involved |
| Auth lifecycle debug logging (`:auth` namespace) | API/Backend library (`applesauce-relay`) | — | `this.log`/`this.authLog` are instance fields on `Relay`; logging is emitted from the exact call sites that drive the state machine, not a separate observability layer |
| Group-level fan-out log/status (`RelayGroup.sync` dropped-relay) | API/Backend library (`applesauce-relay`, `group.ts`) | — | `RelayGroup` owns its own `logger.extend("RelayGroup")`; no dependency on `Relay`'s per-connection `:auth` sub-namespace today |
| Sync-loader/timeline-loader logger hygiene | API/Backend library (`applesauce-loaders`) | — | Pure derivation-timing refactor inside existing RxJS pipeline construction functions; no new capability, no tier crossing |
| Test oracle (debug-output capture) | Test/Dev tooling | — | Lives entirely in `packages/relay/src/__tests__/` (and optionally `packages/loaders/src/**/__tests__/`); no production code |

This phase has no browser/client, SSR, CDN, or database tier — it is entirely internal to two library packages plus their test suites.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `debug` | `^4.4.0` (installed: `4.4.3`) [VERIFIED: `pnpm list debug`, `node_modules/.pnpm/debug@4.4.3/node_modules/debug/package.json`] | Namespaced, glob-filterable debug logging | Already the sole logging primitive across every package in this monorepo (`applesauce-core`'s `logger = debug("applesauce")`); no reason to introduce a second logging library for one phase |
| `vitest` | `^4.0.15` (relay), `^4.0.15` (loaders) [VERIFIED: package.json] | Test runner | Already the project's only test runner; `pnpm vitest run <path>` from repo root is the established per-file invocation (documented in `REQUIREMENTS.md`'s Verification Standard) |
| `vitest-websocket-mock` | `^0.5.0` [VERIFIED: `packages/relay/package.json`] | Mock WebSocket server for `Relay` integration tests | Already used throughout `relay.test.ts` and `group.test.ts` for every existing auth-flow test; D-16's harness should reuse this setup, not build a new one |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@hirez_io/observer-spy` | `^2.2.0` [VERIFIED: package.json] | Observable subscription spying (`subscribeSpyTo`) | Already used for operator-level tests (`auth-retry.test.ts`) and relay-level status assertions; not needed for the debug-capture oracle itself, only for correlating log output with observable emissions if a test needs both |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real `debug` output capture (enable namespace + override `debug.log`) | Dependency-injected spy `Debugger` (the pattern `packages/concord/src/client/__tests__/sync-logging.test.ts` uses) | Not viable for `Relay`: `RelayOptions` has no `logger` field, so there is no DI seam. The loaders package *does* support DI (`SyncLoaderOptions.logger?: debug.Debugger`), so either pattern is viable there, but the relay-side oracle (which is what ALOG-01 actually needs to prove) must use real capture |

**Installation:** None required — `debug` is already a direct dependency of `applesauce-core` (`^4.4.0`) and transitively available to `applesauce-relay`/`applesauce-loaders`. No new packages are introduced by this phase.

**Version verification:** `debug@4.4.3` confirmed installed via `pnpm list debug` (deduped across the workspace) and directly inspected at `node_modules/.pnpm/debug@4.4.3/node_modules/debug/package.json`. `applesauce-relay` confirmed at `6.2.1` via `packages/relay/package.json`. `applesauce-loaders`/`applesauce-core` confirmed at `6.2.0`.

## Package Legitimacy Audit

**Not applicable — this phase installs no new packages.** `debug`, `vitest`, `vitest-websocket-mock`, and `@hirez_io/observer-spy` are all pre-existing direct or transitive dependencies already in use for the identical purpose (logging, testing, WebSocket mocking) elsewhere in this monorepo. No `package.json` changes are anticipated for either `packages/relay/` or `packages/loaders/`.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                    NIP-42 auth-required lifecycle (per Relay connection)
                    ══════════════════════════════════════════════════════

  Operation call site                     Connection track (Relay instance)
  (req/count/event/negentropy)                 (this.log / this.authLog)
  ───────────────────────────                  ───────────────────────────
        │                                             │
        │  1. send REQ/COUNT/EVENT/NEG-OPEN           │
        ├────────────────────────────────────────────►│  (socket.next)
        │                                              │
        │                                       2. relay sends AUTH challenge
        │                                              │◄──── "AUTH" message
        │                                       [connection track] "Received AUTH challenge"
        │                                              │
        │  3. relay CLOSED "auth-required: ..."        │
        │◄─────────────────────────────────────────────┤
        │  [operation track, D-13 :auth ns]             │
        │  "REQ nX7f2a kinds=[1059] ... auth required"  │
        │                                                │
        ▼                                                │
  authRetry() operator (operators/auth-retry.ts)          │
        │  D-14: log state entered                       │
        │  - handler invoked / absent                     │
        │  - waiting on auth state                        │
        ▼                                                 │
  onAuthRequired(context)  ──user code──►  signer.signEvent()
        │                                                 │
        │  4. authenticate()/auth() called                │
        ├────────────────────────────────────────────────►│
        │                              [connection track] "Signing AUTH event"
        │                                                  │
        │                              5. AUTH event sent  │
        │                              [connection track] "AUTH sent"
        │                                                  │◄── socket.next(["AUTH", event])
        │                              6. relay OK response│
        │                              [connection track] "AUTH result: <OK message verbatim>"
        │                                                  │
        ◄──── authSatisfied$ (pubkey now in authentications$) ────┤
        │  [operation track] "wait satisfied by pubkey <pk>"      │
        ▼                                                         │
  7. resend original REQ/COUNT/EVENT/NEG-OPEN ──────────────────►│
        │  [operation track] "phase 2/N"                          │
        ▼
  Success (event/data flows) OR retries exhausted / timeout / handler rejected
  [operation track] terminal outcome line, attributable to THIS operation's wire key
```

D-08's join key: the connection track never knows *which* operation's wait it satisfies (many-to-many by protocol — RAUTH-05 forbids relay-scoped bookkeeping of in-flight phases). Each operation track independently observes `authenticatedPubkeys$`/`authentications$` and logs which pubkey satisfied *its own* wait.

### Recommended Project Structure

No new files/directories required for `applesauce-relay` production code — all edits land in existing files (`relay.ts`, `types.ts`, `operators/auth-retry.ts`, `negentropy.ts`, `group.ts`). One new field on `Relay` (the `:auth` sub-logger, discretion: name it `authLog` or similar, placed next to `this.log` in the class body and derived in the constructor immediately after `this.log = this.log.extend(url)`).

```
packages/relay/src/
├── relay.ts                    # this.authLog = this.log.extend("auth") (new field); D-02/D-08/D-09/D-11/D-12 lines
├── types.ts                    # RelayAuthOperation retired; wire-verb union added to RelayAuthContext
├── operators/auth-retry.ts     # D-14 phase-state logging (handler invoked/absent, waiting, outcome)
├── negentropy.ts               # D-05: id ownership moves to Relay.negentropy() caller
├── group.ts                    # D-14/D-19 dropped-relay line: prose/namespace review only, NOT new
└── __tests__/
    └── (new or extended file)  # D-16 capture-harness tests, reusing relay.test.ts's WS+Relay setup

packages/loaders/src/loaders/
└── sync-loader.ts               # single hoist: log.extend(url).extend("request") out of the switchMap (line 611)
```

### Pattern 1: Derive-once logger as an instance field (D-13/D-20's established convention)
**What:** A `Debugger` is created exactly once, either as a class field initializer, a constructor assignment, or a module-level `const`, and reused for every subsequent log call.
**When to use:** Any logger that will be called more than once over the lifetime of the owning object.
**Example:**
```typescript
// Source: packages/relay/src/relay.ts:234,436 (existing, verified pattern)
export class Relay {
  protected log: typeof logger = logger.extend("Relay");
  // D-13: follow the identical pattern for the new :auth sub-namespace
  protected authLog: typeof logger = this.log.extend("auth");

  constructor(public url: string, opts?: RelayOptions) {
    this.log = this.log.extend(url);
    this.authLog = this.log.extend("auth"); // re-derive AFTER url is folded in
  }
}
```

### Pattern 2: Per-call correlation logger (acceptable `.extend()` — SEED-001's carve-out, confirmed still valid)
**What:** `.extend(nanoid(n))` called once per function/operator invocation to disambiguate concurrent calls in a shared log stream, never re-derived inside the invocation's own hot path.
**When to use:** Any function that may run concurrently (multiple relays, multiple loader calls) and needs distinguishable output.
**Example:**
```typescript
// Source: packages/loaders/src/loaders/timeline-loader.ts:58 (existing, verified compliant)
export function loadBackwardBlocks(request, opts) {
  return (source) => {
    const log = opts?.logger?.extend("backward").extend(nanoid(8)); // once per operator application
    // ... mergeMap/tap callbacks below reuse `log`, never re-extend
  };
}
```

### Anti-Patterns to Avoid
- **Extending inside a reactive callback that could re-fire:** `packages/loaders/src/loaders/sync-loader.ts:611` — `log.extend(url).extend("request")` sits inside `switchMap((nips) => {...})`. Even though `supported$` currently emits once, the derivation is structurally inside a repeatable projector rather than hoisted to `buildRelayStream(url)`'s own top level (where every other per-relay derivation in this file lives). This is D-18's one real target.
- **Sniffing a string to distinguish local bookkeeping from real state (13-D-01's established anti-pattern, D-11 continues it):** do not check `message === "Timeout"` to tell a manufactured timeout from a relay rejection — use `PublishResponse.error`'s presence/absence structurally.
- **Embedding plan-citation IDs in production log text:** `group.ts:359`'s existing `"dropping relay from group sync (D-19): ..."` line leaks an internal planning artifact (`(D-19)`) into output an operator reads. D-15 requires human prose without this kind of citation; flag for cleanup even though the line itself is not new.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Capturing real `debug`-package output in a test | A custom `console.log` monkey-patch or a fresh DI seam added to `Relay` | The existing `captureDebugOutput()` pattern in `packages/concord/src/helpers/__tests__/relays.test.ts:243-258` | It already solves the exact problem (module-level, non-injected logger; global enable state; safe restore) and is proven working in this codebase today |
| Rendering `debug`'s `%s`/`%d` printf-style substitutions in assertions | A hand-rolled string-interpolation checker | `node:util`'s `format(...)`, exactly as the existing harness and `sync-logging.test.ts`'s `spyLogger()`/`render()` pair already do | `debug` delegates its own formatting to the same substitution rules `util.format` implements; using anything else risks assertions that pass against a differently-formatted string than what a real terminal would show |
| Namespace-glob matching logic (verifying `DEBUG=applesauce:Relay:*` reaches `:auth` children) | A custom glob matcher or hand-reasoned assumption | `debug`'s own `enabled()`/`enable()` API, called directly in tests | This research empirically confirmed (see Pitfall/Finding below) that `debug@4.4.3`'s wildcard matching crosses `:`-delimited segments; do not assume RFC-glob semantics (`*` stopping at the next `:`) — it does not behave that way in this version |

**Key insight:** every mechanism this phase needs (derive-once logger fields, per-call correlation loggers, real-output test capture) already has a working, in-repo precedent. This phase is an application of existing conventions to two more files/one more subsystem, not new infrastructure.

## Runtime State Inventory

*Included because D-02 retires a public-but-unshipped type (`RelayAuthOperation`) and renames a context field — evaluated against the 5 categories even though this is fundamentally a greenfield logging phase, since a "retirement" merits the same check a rename would get.*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `RelayAuthOperation`/`operation` is a TypeScript type/field, never persisted to any datastore, ChromaDB collection, or `user_id`-shaped key. | None |
| Live service config | None — no external service (n8n, Datadog, Tailscale, Cloudflare) references `operation`/`RelayAuthOperation` by name. | None |
| OS-registered state | None — no OS-level task/service registration involved. | None |
| Secrets/env vars | None — no env var or secret key named after `operation`/`RelayAuthOperation`. | None |
| Build artifacts / installed packages | The word `operation` appears in one **unreleased changeset body** (`.changeset/relay-operation-scoped-auth-callbacks.md`) that will become the published changelog entry the next time `applesauce-relay` is released. This is the one artifact that must be edited (D-01) — not a runtime state item, but the single place the retired name would otherwise leak into a shipped changelog. | Edit the changeset body per D-01/D-02 before this phase's commits land |

**Confirmed via direct grep:** `grep -rn "RelayAuthOperation" . --include="*.ts" --include="*.md"` (excluding `node_modules`/`.planning`) returns only the type's own declaration/import/consumption sites inside `packages/relay/src/` — zero hits in `apps/`, `packages/concord/`, or documentation.

## Common Pitfalls

### Pitfall 1: Planning to "add" the D-19 dropped-relay log line that already exists
**What goes wrong:** A plan task that says "add a debug log line for `RelayGroup.sync`'s dropped relay" either duplicates the existing line (producing two log lines for one event) or wastes a task discovering it already exists mid-execution.
**Why it happens:** 14-CONTEXT.md's D-14 lists this as something the phase must log, carried forward from Phase 13's own `group.ts:356-357` comment ("visible in debug output only — a status channel for it is Phase 14 territory"), but the comment is about a *status channel*, and the log line itself already shipped in the same Phase-13 plan (13-07) that wrote the comment.
**How to avoid:** Plan this as a *review/adjust* task, not a *create* task: (1) confirm the line still reads `this.log(\`dropping relay from group sync (D-19): ${relay.url}\`, err)` at `group.ts:359`, (2) decide whether to strip the `(D-19)` citation per D-15's human-prose rule, (3) decide whether `RelayGroup` needs its own `:auth`-flavored sub-logger for this line to satisfy D-13's namespace design, or whether group-level fan-out diagnostics are exempt (they are not per-connection auth state).
**Warning signs:** A plan action with `read_first` pointing only at `group.ts:356-360` and an `action` describing net-new code — verify the diff is a one-line prose/namespace edit, not an insertion.

### Pitfall 2: Line-reference drift in `event()`'s three inline citations
**What goes wrong:** A plan `read_first`/`action` field hard-codes `relay.ts:1120`, `:1147`, or `:1153` expecting to land exactly on the cited statement, and instead lands one-to-three lines off, in a `filter()`/`if`-guard/`timeout({` line instead of the intended `map()`/`.next(true)`/`with:` callback.
**Why it happens:** CONTEXT.md's line citations for these three spots are close but not exact — likely counted from a slightly different revision or miscounted by 1-3 lines during the discussion session.
**How to avoid:** Use the corrected map below when writing `read_first`/`action` fields:

| CONTEXT.md cited line | Actual content at that line | Corrected line for the described content |
|---|---|---|
| `relay.ts:1120` ("event()'s relay-rejection build") | `filter((m) => m[0] === "OK" && m[1] === event.id),` | **`:1121`** — `map((m) => ({ ok: m[2] as boolean, message: m[3] as string, from: this.url })),` |
| `relay.ts:1147` (D-04's "write" for publish flag) | `if (ok === false && message?.startsWith(AUTH_REQUIRED_PREFIX) && !this.receivedAuthRequiredForEvent.value) {` | **`:1149`** — `this.receivedAuthRequiredForEvent.next(true);` (the log call itself, `this.log("Auth required for publish")`, is at `:1148`, matching the source-under-change section's own citation) |
| `relay.ts:1153` ("event()'s manufactured timeout") | `),` (closing the `tap` block) | **`:1156`** — `with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),` (the `timeout({` operator itself starts at `:1154`) |

Every other line reference in CONTEXT.md's canonical_refs and decisions sections was individually re-verified against current `master` and found **exact** — including `types.ts:50,52,60,66,128,199`; `relay.ts:234,236(via :436),405-415,436,541-560,546,554,588-598,748,759,766,801,930,931,946-976,1055,1056,1148,1201,1230,1261,1262,1303`; `operators/auth-retry.ts:232,265`; `negentropy.ts:71`; `group.ts:84`; `sync-loader.ts:248,333,346,611`; `timeline-loader.ts:58,136,221,241,262,446,474`.

### Pitfall 3: Assuming `debug`'s wildcard stops at the next namespace segment
**What goes wrong:** Assuming (as some glob systems do) that `applesauce:Relay:*` would NOT match `applesauce:Relay:wss://foo:auth` because `*` "shouldn't cross a `:`" — leading to an incorrect belief that D-13's namespace design requires users to opt in to `:auth` lines explicitly even when browsing all `Relay` output.
**Why it happens:** `debug`'s matching is regex-based (`*` compiles to `.*?`, matching greedily across any character including `:`), which is looser than typical CLI glob conventions.
**How to avoid:** This research empirically confirmed (against the installed `debug@4.4.3`) that:
```
DEBUG=applesauce:Relay:*        → matches "applesauce:Relay:wss://foo" AND "applesauce:Relay:wss://foo:auth"
DEBUG=applesauce:Relay:*:auth   → matches ONLY "applesauce:Relay:wss://foo:auth"
```
D-13's claim is correct; no additional namespace design work is needed to make `:auth` lines "opt-in-only-when-desired" — they are additive to the broader glob and narrowable via the more specific one, exactly as claimed.
**Warning signs:** A test asserting the *opposite* (that enabling `applesauce:Relay:*` should NOT show `:auth` lines) would be asserting an incorrect premise and should fail — if it passes, the harness itself is broken (likely not actually calling `debug.enable()` with the live namespace).

### Pitfall 4: Vitest's shared debug-module state leaking across tests in the same file
**What goes wrong:** `debug`'s `enabled`/`enable`/`disable`/`log` state is a module-level singleton. A test that calls `debugFactory.enable(NAMESPACE)` without restoring the prior state in a `finally` block leaves that namespace enabled (or the log sink overridden) for every subsequent test in the same file — and, if the harness accidentally captures unrelated log output, produces flaky false-positive/false-negative assertions.
**Why it happens:** Vitest's default `isolate: true` (no override present in this repo's root `vitest.config.ts`) gives each **test file** a fresh module registry, so state does not leak *across files* — but within one file, all tests share the same imported `debug` module instance, so state *does* leak across tests unless each test restores it.
**How to avoid:** Reuse the exact `captureDebugOutput()` pattern already proven in `packages/concord/src/helpers/__tests__/relays.test.ts:243-258` — record `wasEnabled` before, always restore `debug.log` and conditionally `disable()` in a `finally`/`restore()` called from every test (including failure paths).
**Warning signs:** A test that passes in isolation (`pnpm vitest run <path>`) but fails or behaves differently when run as part of the full `relay.test.ts` suite is a symptom of leaked enable-state.

### Pitfall 5: `negentropySync`'s subscription id has no caller-supplied override today
**What goes wrong:** D-05 requires the id to "stay stable across auth retries", but `negentropySync` currently mints `let id = nanoid();` internally at `negentropy.ts:71` with no parameter to accept a caller-supplied value — a naive implementation might try to thread the id through `NegentropySyncOptions` (which is spread into every relay-auth-option-bearing call site, including the public `sync()` method's forwarded `authOptions`), accidentally exposing an internal correlation id as public API surface.
**How to avoid:** Add `id` as its own explicit parameter to `negentropySync` (not folded into `NegentropySyncOptions`), generated once by `Relay.negentropy()` (`relay.ts:1230`, before the `runSync` defer that `authRetryOperator` resubscribes on retry) and threaded through the existing `negentropySync(storage, this.socket, filter, reconcile, opts)` call as a new positional or keyword argument, defaulting to `nanoid()` inside `negentropySync` itself for any direct caller that does not supply one (keeps the function usable standalone, matching its current exported-function contract).
**Warning signs:** If the id ends up on `NegentropySyncOptions`, `RelaySyncOptions` (which extends it) would gain a new public field with no clear caller-facing purpose — a strong signal the wrong layer received the change.

### Pitfall 6: `applesauce-loaders`'s `SyncAuthContext` needs NO change for D-02
**What goes wrong:** Assuming D-02's `RelayAuthContext.operation` retirement requires a parallel edit to `packages/loaders/src/loaders/sync-loader.ts`'s `SyncAuthContext` type, since 13-CONTEXT.md's D-06 established it as a "structural mirror" of `RelayAuthContext`.
**Why this is wrong:** Direct inspection of `SyncAuthContext` (sync-loader.ts:62-75) shows it was deliberately narrowed to `relay`, `url`, `challenge`, `requirement`, `missingPubkeys`, `reason` — it **never included an `operation` field in the first place** (13-D-06 narrowed the mirror to "the fields a sync-loader-level handler actually needs", and the sync loader's handler was never operation-discriminated). D-02 removes a field that `SyncAuthContext` never had.
**How to avoid:** Do not add a task to update `SyncAuthContext`'s shape for D-02. The loaders package needs zero type changes for D-02; only the `sync-loader.ts:611` hoist (D-18) touches this file.

## Code Examples

Verified patterns from this codebase's own source:

### D-16's capture harness (lift this into `packages/relay/src/__tests__/`)
```typescript
// Source: packages/concord/src/helpers/__tests__/relays.test.ts:243-258 (verified working precedent)
import debugFactory from "debug";
import { format } from "node:util";

const NAMESPACE = "applesauce:Relay:*:auth"; // or the concrete relay-url namespace for a single test

function captureDebugOutput(): { calls: unknown[][]; restore: () => void } {
  const wasEnabled = debugFactory.enabled(NAMESPACE);
  debugFactory.enable(NAMESPACE);
  const originalLog = debugFactory.log;
  const calls: unknown[][] = [];
  debugFactory.log = (...args: unknown[]) => { calls.push(args); };
  return {
    calls,
    restore: () => {
      debugFactory.log = originalLog;
      if (!wasEnabled) debugFactory.disable();
    },
  };
}

function messagesOf(calls: unknown[][]): string[] {
  return calls.map((c) => format(...(c as [unknown, ...unknown[]])));
}
```
Usage inside a test, combined with `relay.test.ts`'s existing `WS`/`Relay` `beforeEach` setup:
```typescript
it("logs challenge -> signing -> sent -> result for a successful AUTH", async () => {
  const { calls, restore } = captureDebugOutput();
  try {
    // ... drive relay through a scripted NIP-42 exchange via the mock WS server ...
    const lines = messagesOf(calls);
    expect(lines.some((l) => l.includes("challenge"))).toBe(true);
    // sequence derived from the NIP-42 exchange itself (D-16), not from source output
  } finally {
    restore();
  }
});
```

### Derive-once `:auth` sub-logger (D-13, mirrors the existing `this.log` pattern exactly)
```typescript
// Source: packages/relay/src/relay.ts:234,436 (existing pattern this phase extends)
protected log: typeof logger = logger.extend("Relay");
protected authLog: typeof logger = this.log.extend("auth"); // D-13

constructor(public url: string, opts?: RelayOptions) {
  this.log = this.log.extend(url);
  this.authLog = this.log.extend("auth"); // re-derive after url folds in, once, in the constructor
  // ...
}
```

### D-18's single fix target
```typescript
// Source: packages/loaders/src/loaders/sync-loader.ts:606-614 (current, non-compliant under tightened rule)
const request$ = () =>
  toMessages(
    withTimeout(
      paginatedRequest(request, url, filter, limit, log.extend(url).extend("request"), relayMethodOptions),
      //                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ inside switchMap, hoist this
    ),
  );

// Fix shape: derive once at the top of buildRelayStream(url), alongside every other per-relay const in that function
const requestLog = log.extend(url).extend("request");
// ... then reference `requestLog` in place of the inline `.extend()` chain wherever request$() is defined
```

## State of the Art

Not applicable in the traditional sense — this phase does not adopt a newer external library or supersede a deprecated API. The one relevant "old → new" shift is internal to this milestone:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `operation: "read" \| "publish" \| "sync"` bucket on `RelayAuthContext` | Wire-verb discriminated union (`REQ`/`COUNT`/`EVENT`/`NEG-OPEN`) | This phase (D-02) | Handlers can branch on the actual protocol verb instead of a lossy three-value category; a new verb added later is a compile error at every `switch`/discriminated match |
| `event()`'s manufactured timeout indistinguishable from a relay rejection | `PublishResponse.error` presence/absence as the discriminator | This phase (D-11), field itself added in Phase 13 (13-D-18) | Callers (including `RelayGroup`'s `errorToPublishResponse`, `types.ts:127`) can now branch structurally instead of string-sniffing `"Timeout"` |

**Deprecated/outdated:** `RelayAuthOperation` type and the `operation` field are removed outright (not deprecated-and-kept) since they have zero shipped consumers (D-01, re-verified true).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `:auth` sub-logger field name (`authLog` suggested) and its exact placement on `Relay` is Claude's Discretion per CONTEXT.md — this research suggests `authLog` and constructor placement immediately after `this.log = this.log.extend(url)`, but this is a naming choice, not a verified requirement. | Architecture Patterns, Code Examples | Low — cosmetic; any consistent name works as long as it's a derive-once instance field |
| A2 | `RelayGroup`'s dropped-relay line (`group.ts:359`) should either gain its own `:auth`-flavored routing or stay on `RelayGroup`'s existing `logger.extend("RelayGroup")` channel — this research identifies the open question but does not resolve it, since `RelayGroup` has no per-relay `:auth` sub-logger and D-13's namespace design is specified only for `Relay`. | Pitfall 1, Summary | Low-Medium — affects only where an operator finds this one line under a `DEBUG=` filter, not correctness |
| A3 | `negentropySync`'s new `id` parameter should be a new explicit function parameter rather than folded into `NegentropySyncOptions` — this is a design recommendation from this research (Pitfall 5), not a decision CONTEXT.md locked. | Pitfall 5 | Medium — if implemented as an options field instead, it becomes accidental public API surface requiring its own changeset language |
| A4 | Whether `.changeset/relay-publish-response-error-field.md` needs editing alongside `relay-operation-scoped-auth-callbacks.md` — its current body ("PublishResponse gains an optional error field carrying the original error object alongside the existing message string") remains technically accurate after D-11 gives the field a new populated case, so this research judges no edit is strictly required, but the planner should have the executor re-read it once D-11 lands to confirm the wording still reads correctly. | Summary, Project Constraints | Low — worst case is a slightly incomplete changelog entry, not a build break |

**If this table is empty:** N/A — see entries above. All four are low-to-medium risk design/wording judgment calls, not load-bearing facts; every load-bearing fact in this document (line numbers, package versions, namespace-glob behavior, zero-downstream-consumer claim, D-19 line already existing) was independently verified via direct source reads, grep, or an empirical Node.js test against the installed `debug` package.

## Open Questions

1. **Should `group.ts:359`'s dropped-relay line route through a `:auth`-labeled channel?**
   - What we know: D-13 specifies the `:auth` sub-namespace design for `Relay` (per-connection auth state). `RelayGroup` is a fan-out wrapper with its own `logger.extend("RelayGroup")` and no per-relay auth-connection concept of its own — it delegates entirely to the `Relay` instances it wraps.
   - What's unclear: whether ALOG-01's "an operator can tell ... where a NIP-42 auth attempt sits in its lifecycle" extends to group-level fan-out diagnostics, or whether this line is a different kind of thing (operational health of a `sync()` fan-out, not an auth-lifecycle event per se — the relay was dropped because ITS sync failed, and the underlying cause may or may not be auth-related).
   - Recommendation: keep this line on `RelayGroup`'s existing logger (it is not per-connection auth state), but strip the `(D-19)` citation per D-15, and consider whether the error's `.name` (if it's `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError`, per D-11's `RELAY_AUTH_ERROR_NAMES`-equivalent pattern already used in `sync-loader.ts:90`) should be surfaced explicitly in the prose so an operator can tell an auth failure from a network failure without cross-referencing the underlying `Relay`'s own `:auth` output.

2. **Does the D-11 fix change `RelayGroup.event()`'s `errorToPublishResponse` behavior?**
   - What we know: `errorToPublishResponse` (`group.ts:70-81`) already sets `.error` on any caught error (13-D-18). It runs on `RelayGroup.event()`'s per-relay `catchError`, which sits downstream of `Relay.event()`'s own internal handling — by the time an error reaches this function, `Relay.event()` has typically already converted `AuthRequiredError` back into a value-shaped `{ ok: false, message }` response (per `relay.ts:1191-1195`), so `errorToPublishResponse` mostly sees non-auth errors (connection failures, thrown `AuthHandlerError`/`AuthTimeoutError`).
   - What's unclear: whether D-11's discriminator on the manufactured-timeout path also needs a `.error` value threaded through `RelayGroup`'s aggregate `publish()` (`group.ts:252-256`, which returns `PublishResponse[]`), or whether that's already covered since `Relay.event()` itself now sets `.error` at the source.
   - Recommendation: verify during planning that `Relay.event()`'s manufactured-timeout branch (the `with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" })` at `relay.ts:1156`) is the ONLY site that needs the new `.error` value — `RelayGroup`'s aggregation should inherit it automatically since it just collects each relay's already-shaped `PublishResponse`.

3. **A connection-drop-mid-auth-wait scenario at very low `keepAlive` was flagged in Phase 13's deferred-items.md as "worth a backlog entry once Phase 14's auth lifecycle logging work gives it a place to land."**
   - What we know: this is a pre-existing (not regressed) behavior noted during Phase 13, explicitly deferred pending this phase's logging landing.
   - What's unclear: whether Phase 14 should file that backlog entry as part of its own closeout, now that the logging exists to observe it, or whether that's a separate follow-up task outside this phase's requirement scope (ALOG-01/02/03 don't mention `keepAlive` interactions).
   - Recommendation: out of scope for the plan itself (no ALOG requirement covers it), but flag it for the phase's closing summary/backlog capture step, since STATE.md explicitly ties it to this phase's completion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `debug` (npm) | All logging in this phase | Yes | `4.4.3` installed (dep range `^4.4.0` in `applesauce-core`) | — |
| `@types/debug` | TypeScript typing for `Debugger` in `packages/loaders/` (used without an explicit direct dependency — resolved transitively) | Yes (verified: `packages/loaders` builds clean via `tsc --noEmit` today) | Not pinned directly in `packages/loaders/package.json` | If a future toolchain change breaks this transitive resolution, mirror Phase 12.2's precedent (`12.2-01: debug/@types/debug added as concord's own direct dependencies`) and add both as direct deps of `applesauce-loaders` |
| `vitest-websocket-mock` | D-16's relay-level capture harness (reuses `relay.test.ts`'s existing `WS` server) | Yes | `^0.5.0` | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `@types/debug` transitive resolution in `packages/loaders` — currently working, documented fallback above if it ever breaks.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.0.15` (both `packages/relay` and `packages/loaders`) |
| Config file | `./vitest.config.ts` (root; no per-package override in either `packages/relay/` or `packages/loaders/`) |
| Quick run command | `pnpm vitest run packages/relay/src/__tests__/<file>.test.ts` (per-file, per REQUIREMENTS.md's documented convention — the `--filter … -- <path>` form silently ignores the path) |
| Full suite command | `pnpm --filter applesauce-relay test` and `pnpm --filter applesauce-loaders test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ALOG-01 | Full auth lifecycle sequence (challenge → AUTH sent → result, why succeeded/failed) is observable in captured `:auth` debug output for a scripted successful and a scripted failed exchange | integration | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` (new `describe` block, or new file `auth-lifecycle-logging.test.ts` alongside it) | ❌ Wave 0 — new test file/block needed |
| ALOG-02 | Two concurrent operations' auth retry/timeout/rejection lines are individually attributable (distinct wire keys visible in captured output) | integration | Same file as ALOG-01, additional `it()` block driving two concurrent `req()`/`event()` calls against the mock server | ❌ Wave 0 |
| ALOG-03 | `sync-loader.ts:611`'s hoist produces identical log content/timing to before, and a repo-wide grep for `.extend(` at any call-site position (not construction-time) in `packages/loaders/` returns only the already-approved correlation-id sites | unit + static check | `pnpm vitest run packages/loaders/src/loaders/__tests__/<existing-or-new>.test.ts` + `grep -rn "\.extend(" packages/loaders/src --include="*.ts" \| grep -v __tests__` (manual/CI-adjacent, matches D-19's "rely on review" decision — no automated gate required per D-19) | Existing sync-loader tests may already cover log-content parity; verify during Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <changed-test-file-path>`
- **Per wave merge:** `pnpm --filter applesauce-relay test` and, if `packages/loaders/` was touched, `pnpm --filter applesauce-loaders test`
- **Phase gate:** Both full suites green before `/gsd-verify-work`; per REQUIREMENTS.md, `pnpm --filter applesauce-concord test` is NOT required for this phase (concord is Phase 15's scope) but should stay green as a non-regression check since `applesauce-relay`'s `PublishResponse`/`RelayAuthContext` shape changes are consumed nowhere in concord today (re-verified, zero hits).

### Wave 0 Gaps
- [ ] `packages/relay/src/__tests__/<new-or-existing>.test.ts` — houses D-16's `captureDebugOutput()` harness (lifted from `packages/concord/src/helpers/__tests__/relays.test.ts:243-258`) plus the RED→GREEN non-vacuity probes for ALOG-01/02
- [ ] Confirm whether `sync-loader.ts`'s existing test suite (`packages/loaders/src/loaders/__tests__/sync-loader.test.ts`, not read in depth during this research — locate and inspect during planning) already asserts on `log`/`request` line content that would catch a regression from the D-18 hoist, or whether a new assertion is needed
- Framework install: none — `vitest`, `vitest-websocket-mock`, `debug` are all already present

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | Yes | Relay-supplied strings (the NIP-01 `CLOSED` `reason`, the NIP-42 challenge, `OK` message text) are logged verbatim in several places (D-09's "relay's own `OK` message carried verbatim as the why"). D-06 already builds in the relevant mitigation for filter summaries (kinds spelled out, everything else counted, "so a 500-author filter cannot produce a multi-kilobyte line") — the same discipline should extend to the `reason`/`OK message` strings: `debug` itself does not sanitize or truncate arguments, so an adversarial relay returning a multi-megabyte `reason` string would be logged in full. This is unlikely to be a genuine attack surface (debug output, not a UI/log-aggregation ingestion pipeline) but is worth a truncation guard consistent with D-06's spirit. |
| V7 Error Handling and Logging | Yes | The existing pattern of dual-emitting via `this.log`/module-level `log` (Phase 12.2's `D-09` precedent for concord) is not required here since `Relay`'s logging is already the sole error-visibility channel for this subsystem — no separate `console.warn`/`console.error` calls exist in the auth path today (`relay.ts` uses only `this.log(...)` throughout `req()`/`count()`/`event()`/`negentropy()`/`authenticate()`). No change needed; this phase should not introduce a second parallel logging channel. |
| V6 Cryptography | No | No cryptographic material is logged or handled directly by this phase — the AUTH event itself is signed by the caller-supplied signer before `auth()`/`authenticate()` ever see it; `authenticate()` (`relay.ts:1303`) only calls `signer.signEvent(...)`, it never touches raw key material. Confirm no log line accidentally includes the full signed AUTH event object (which contains the pubkey and signature, both public/non-secret, but still worth keeping out of log lines per D-06's "counted not spelled out" discipline — log the pubkey, never the full event). |
| V4 Access Control | No | This phase does not change who can authenticate or what an authenticated pubkey can do — it only makes the existing state machine observable. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Log injection / unbounded log-line size from an adversarial relay (a malicious or misbehaving relay returns an oversized `CLOSED` `reason` or `OK` message) | Denial of Service (resource exhaustion via log volume) | D-06's existing "kinds spelled out, rest counted" discipline should extend to any relay-supplied free-text string carried into a log line — truncate `reason`/`message` text to a bounded length before interpolating into the log prose, consistent with D-05's "truncated for display only" rule already applied to ids |
| Leaking AUTH event/signature material into debug output | Information Disclosure (low severity — pubkey/sig are not secrets, but full event objects can be large and are unnecessary in prose logs) | Log only the pubkey (already D-08's join key) and a short summary, never the full signed event object, matching D-06's filter-summary precedent |

## Sources

### Primary (HIGH confidence — direct source verification in this repository, this session)
- `packages/relay/src/relay.ts` (full read, 1697 lines) — every cited line number individually checked
- `packages/relay/src/types.ts` (full read) — `RelayAuthOperation`, `RelayAuthContext`, `PublishResponse`, `RelayStatus` line numbers confirmed exact
- `packages/relay/src/operators/auth-retry.ts` (full read) — `log?` config field, single existing log call, `AuthPhaseGate`/`suspendableTimeout`/`authRetry` mechanics
- `packages/relay/src/negentropy.ts` (full read) — `id = nanoid()` mint site, module-level `log` const
- `packages/relay/src/group.ts` (full read) — `RelayGroup` logger, D-19 dropped-relay line (found already implemented), `errorToPublishResponse`
- `packages/loaders/src/loaders/sync-loader.ts` (full read, 763 lines) — full D-18 sweep, `SyncAuthContext` shape confirmed to have no `operation` field
- `packages/loaders/src/loaders/timeline-loader.ts` (full read, 490 lines) — all 7 cited logger-derivation sites confirmed compliant
- `packages/concord/src/helpers/__tests__/relays.test.ts` — `captureDebugOutput()` harness, the D-16 precedent
- `packages/concord/src/client/__tests__/sync-logging.test.ts` — the DI-spy alternative pattern (not applicable to `Relay`, applicable to loaders if desired)
- `packages/relay/src/__tests__/relay.test.ts`, `group.test.ts`, `auth-retry.test.ts` — existing test conventions (`WS` mock server, `subscribeSpyTo`, real clock per 13-D-20)
- `.changeset/*.md` (46 files enumerated, 14 confirmed targeting `applesauce-relay`) — `relay-operation-scoped-auth-callbacks.md` and `relay-publish-response-error-field.md` read in full
- `.planning/seeds/SEED-001-avoid-inline-debug-extend.md`, `.planning/phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — cross-referenced for prior-phase decisions and drift

### Secondary (MEDIUM confidence)
- None — no external documentation or web sources were needed for this phase; it is entirely internal codebase research plus one empirical runtime check.

### Tertiary (LOW confidence / needs planner attention)
- The four Assumptions Log entries (A1-A4) — naming/routing/API-shape judgment calls this research recommends but that CONTEXT.md leaves as Claude's Discretion.

**Empirical verification performed this session:** `node -e '...'` against the installed `node_modules/.pnpm/debug@4.4.3/node_modules/debug` package, confirming `DEBUG=applesauce:Relay:*` matches both a relay's base namespace and its `:auth` child, and `DEBUG=applesauce:Relay:*:auth` narrows to only the child — directly confirming D-13's namespace-glob claim.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all versions read directly from `package.json`/lockfile
- Architecture: HIGH — every cited line individually re-verified against current `master`; three drift corrections documented; one stale-claim correction (D-19 line already exists) documented
- Pitfalls: HIGH — all six pitfalls derived from direct source inspection or an empirical test, not speculation

**Research date:** 2026-08-08
**Valid until:** This research is tied to specific line numbers in fast-moving files (`relay.ts` has been rewritten across 14 plans in Phase 13 alone) — treat line references as stale if any further commits land on `packages/relay/src/relay.ts`, `group.ts`, `negentropy.ts`, or `packages/loaders/src/loaders/sync-loader.ts` / `timeline-loader.ts` before planning begins. Re-grep the specific `read_first` targets at plan-writing time as a cheap sanity check. The package-version and namespace-glob-behavior findings are stable (30+ days).
