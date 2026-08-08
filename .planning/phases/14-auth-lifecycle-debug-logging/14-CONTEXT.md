# Phase 14: Auth Lifecycle Debug Logging - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A NIP-42 auth attempt becomes readable from `applesauce-relay`'s debug output — where it sits in
its lifecycle, why it ended the way it did, and which request owned it — and every `Debugger` in
`packages/loaders/` is derived off any repeating path.

Two things widened during discussion, both deliberately and both because the release window makes
them free right now (see D-01): the three-value `RelayAuthOperation` bucket is **retired** in favor
of a wire-verb discriminated union on `RelayAuthContext`, and `event()`'s locally-manufactured
timeout response stops masquerading as a relay verdict. Neither is "just logging", and the phase
should be planned as relay-API-touching, not observability-only.

**Not this phase:** Concord's stream-auth migration and its four remaining reads of
`authRequiredForRead$`/`authRequiredForPublish$` (Phase 15, CAUTH-01..04); a lint rule enforcing
the logger convention (explicitly out of scope per REQUIREMENTS.md, and D-19 declines the
alternatives too); any change to auth retry/timeout *behavior* beyond the two widenings above.

</domain>

<decisions>
## Implementation Decisions

### Retiring the read/publish/sync bucket

- **D-01:** **Phase 13's entire auth surface is unreleased.** `applesauce-relay` is published at
  6.2.1; `RelayAuthOperation`, `RelayAuthContext`, `onAuthRequired`, `authTimeout`, `authRetries`,
  and `PublishResponse.error` exist only on master, described by fourteen pending changesets in
  `.changeset/`. They have **zero downstream consumers today.** Every API widening in this phase is
  therefore an edit to a pending changeset body rather than a major bump — and that window closes at
  the next release. This fact is what justifies D-02 and D-11 living in a logging phase; it must be
  re-verified before planning, because a release in between invalidates the reasoning.
- **D-02:** `operation: "read" | "publish" | "sync"` is **removed** from `RelayAuthContext` and
  replaced by a **wire-verb discriminated union** carrying the request the relay actually refused —
  shape roughly `{ verb: "REQ"; id; filters } | { verb: "COUNT"; id; filters } | { verb: "EVENT";
  event } | { verb: "NEG-OPEN"; id; filter }`. Rationale, in the user's words: relays gate auth on
  *request shape* — auth to read kind 1059 but not other kinds, auth after 20 concurrent requests —
  so a three-value bucket cannot describe what a relay is actually demanding, and per-request
  `onAuthRequired` exists precisely because relays differ too much for a taxonomy. The discriminant
  is the NIP-01/NIP-77 verb, a protocol fact rather than an invented category, and it is exhaustive:
  a new verb is a compile error, matching Phase 13's total-predicate lesson (13-14/CR-02).
- **D-03:** The read/publish distinction survives in **exactly one place** — a compatibility adapter
  at the `receivedAuthRequiredForReq` / `receivedAuthRequiredForEvent` write, mapping verb to legacy
  flag. It is a mapping site, not a concept threaded through the internals.
- **D-04:** `authRequiredForRead$` / `authRequiredForPublish$` **stay as public API** for backwards
  compatibility (RAUTH-09 unchanged) but **nothing internal reads them.** Concretely: delete the two
  `take(1)` log subscriptions at `relay.ts:546` and `:554` — they are the last internal readers in
  the package *and* they are the bucketed lines this phase retires. Keep every write (`:931`,
  `:1056`, `:1147`, `:1262`), `resetState()`'s clears (`:413-414`), and the `status$` composition
  (`:571-572`). Concord's four readers (`relay-auth.ts:110`, `:206`, `invite-watcher.ts:258`,
  `:435`) consume `status$` and are CAUTH-03's, not this phase's.

### Operation attribution (ALOG-02)

- **D-05:** An operation is identified in its log lines by **its wire key plus a phase counter** —
  the id already carried on the union (REQ/COUNT subscription id, `event.id`, NEG-OPEN id),
  truncated for display only, with `phase n/N` for D-13's per-attempt attribution. One identity, not
  two: it greps against the relay's own server log. Consequence: **`negentropy()` must own its
  subscription id** instead of `negentropySync` minting it at `negentropy.ts:71` per negotiation, so
  the id stays stable across auth retries rather than identifying an attempt.
- **D-06:** The line carries a **summary of the triggering request: kinds spelled out, every other
  filter field reduced to a count** — e.g. `REQ nX7f2a kinds=[1059] authors=3 #e=1 limit=50`. Kinds
  are spelled out because that is what relays gate on (D-02's motivating case); everything else is
  counted so a 500-author filter cannot produce a multi-kilobyte line. A reader needing exact values
  goes to the context object.
- **D-07:** D-08's consecutive-counter reset gets **no line of its own** — it stays observable
  because the per-line phase counter restarts at 1.

### The connection track (AUTH send/result)

- **D-08:** **Pubkey is the join key** between the connection track and each operation track. The
  connection track prints the pubkey it authenticated; each operation track prints which pubkeys
  satisfied its wait. Rationale: the relationship is many-to-many *by protocol* — one AUTH
  authenticates a pubkey on the connection, and D-14 already banks on a concurrent operation's
  handler or an out-of-band `status$` watcher satisfying a wait with no handler involved. "Which
  operation sent this AUTH" has no well-defined answer. Having the AUTH leg name its waiters would
  require relay-scoped bookkeeping of in-flight phases — the shared state RAUTH-05 forbids and
  Phase 13 spent fourteen plans removing.
- **D-09:** The connection track logs **challenge → signing → sent → result**, with the relay's own
  `OK` message carried verbatim as the "why". The **signing** line is load-bearing: it is what
  separates "the signer never answered" from "the relay never replied", which is D-12's named
  scenario (hung NIP-46 bunker, unanswered extension dialog). Without it both are silence.
- **D-10:** Line placement: the **signing** line in `authenticate()` (`:1303`, the only place signing
  happens); **sent** and **result** in `auth()` (`:1201`), so a consumer signing their own AUTH event
  and calling `auth()` directly still gets the send and the outcome. *(Claude's discretion, stated
  and unchallenged.)*
- **D-11:** **`event()`'s locally-manufactured timeout marks itself.** Today `:1153` produces
  `{ ok: false, from, message: "Timeout" }` and `:1120` builds a relay rejection with the identical
  shape; `auth()` writes whichever it received into `authentications$[pubkey].response` and
  `authenticationResponse$`. So it is not only the log that cannot distinguish a local give-up from
  a relay verdict — **the state cannot either.** This is the defect class PROJECT.md records as
  recurring three times across Phase 13: a call site's own bookkeeping value consumed as real by a
  shared consumer. Fix structurally using the discriminator that already exists and is unused —
  `PublishResponse.error` (`types.ts:128`, D-18) — set on the timeout branch, absent on a relay
  rejection. Do not sniff the `"Timeout"` string.
- **D-12:** `resetState()` logs **auth-state invalidation when there was something to invalidate**,
  naming how many authenticated pubkeys were dropped and whether a challenge was held. Reuse the
  guards already at `:407-408` so a never-authenticated connection stays silent. This is the line
  that explains D-08's expected re-auth-per-reconnect cycle, which is otherwise invisible behind a
  bare `Disconnected` at `:493`.

### Namespace and line set (ALOG-01)

- **D-13:** Auth lines go to a **dedicated `:auth` sub-namespace**, derived once per relay in the
  constructor alongside `this.log` — the SEED-001 pattern applied to this phase's own output. It is
  strictly additive: `debug` matches anchored globs, so `DEBUG=applesauce:Relay:*` still shows the
  auth lines and `DEBUG=applesauce:Relay:*:auth` narrows to only them.
- **D-14:** Log **every state the operation actually blocks in** — handler invoked (or absent),
  waiting on auth state — plus every outcome: RAUTH-06's `waitForAuth: false` short-circuit,
  handler resolved/threw/rejected, wait satisfied, per-phase timeout, retries exhausted, and D-19's
  silently-dropped relay in `RelayGroup.sync`. **Not** internal bookkeeping (see D-07). Roughly five
  lines per phase. This satisfies ALOG-01's "where does it sit" because a blocked attempt always has
  a line naming what it is blocked on.
- **D-15:** Lines are **human prose with the key facts inline**, matching the package's existing
  voice (`Relay connection has become unresponsive, triggering reconnect`) rather than structured
  `key=value`.
- **D-16:** **Oracle: capture real `debug` output.** Enable the `:auth` namespace, collect emitted
  lines via `debug`'s output hook, and assert the expected sequence for a scripted auth scenario,
  with the sequence **derived from the NIP-42 exchange rather than from what the code prints**.
  Directly mirrors D-20's wire-trace approach and tests what ALOG-01 actually claims. `debug`'s
  enable state is global — tests need setup/teardown discipline. Per the standing Verification
  Standard, record a RED→GREEN non-vacuity probe per requirement.

### ALOG-03 sweep

- **D-17:** **ALOG-03's stated criterion already passes and must be restated.** Its test — *"a grep
  for inline `.extend(` at a log call site returns zero hits"* — finds nothing, because no
  extend-then-immediately-invoke pattern (`x.extend(…)(…)`) exists in `packages/loaders/` or
  anywhere in the monorepo. SEED-001's own rule additionally blesses the one site it flagged:
  *"`logger: this.log.extend("sync")` passed into a child's options object"* is exactly what
  `sync-loader.ts:611` does. Planning must not proceed on the original wording.
- **D-18:** The criterion is **tightened to "derived once per relay-or-loader lifetime, not on a
  repeating path"**, and the sweep is what that catches — principally `sync-loader.ts:611`, hoisting
  the per-url logger out of the `switchMap`. The `.extend(nanoid(n))` correlation loggers **stay**:
  they are per-call on purpose, and they do the same job the phase counter and wire key do for the
  relay package. `REQUIREMENTS.md` ALOG-03 and `ROADMAP.md` Phase 14 success criterion 3 both need
  amending to the new wording.
- **D-19:** **No enforcement mechanism.** One-time sweep, mark SEED-001 resolved, rely on review for
  regressions. A lint rule is scoped out by REQUIREMENTS.md; a grep-based repo test is that rule
  wearing different clothes; and a written-invariant comment was declined — Phase 5.1 found 14 of
  Phase 5's invariant comments had gone false, so the mechanism has a poor record here.
- **D-20:** `packages/relay/` is **already compliant** under the tightened rule — every logger is a
  class field or module const, and `management.ts:123` / `relay.ts:436` are constructor
  derive-and-store. The new `:auth` logger (D-13) must follow suit. No relay-side sweep needed.

### Claude's Discretion

- Exact naming and field shape of the wire-verb union (D-02), and whether it replaces `operation`
  in place or lands under a new key.
- How the request summary is rendered (D-06) beyond "kinds spelled out, rest counted".
- The exact prose of every line (D-15), and truncation width for ids (D-05).
- Where the `:auth` logger field lives on `Relay` and how `RelayGroup`/`RelayPool` route theirs.
- How `negentropy()` takes ownership of its subscription id (D-05).
- Test file placement and the capture harness's shape (D-16).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/REQUIREMENTS.md` — ALOG-01/02/03; the Out of Scope table (lint rule scoped out;
  `authRequiredForRead$`/`authRequiredForPublish$` stay as status; changesets required for
  `applesauce-relay` and `applesauce-loaders`, none for concord); and the Verification Standard.
  **Needs amending per D-18.**
- `.planning/ROADMAP.md` § Phase 14 — goal and three success criteria. **Criterion 3 needs amending
  per D-18.**
- `.planning/ROADMAP.md` § Phase 15 — the downstream consumer of `RelayAuthContext` (CAUTH-01..04);
  D-02's union is what those engines will branch on.

### Prior phase decisions this phase depends on
- `.planning/phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` — the whole auth design.
  Load-bearing here: **D-13** (each auth phase independently attributable in Phase 14's logs),
  **D-19** (`RelayGroup.sync`'s dropped relay is visible in debug output only — explicitly assigned
  to this phase), **D-08** (counter resets on progress; `resetState()` clears auth on every
  disconnect), **D-12/D-14** (one clock over handler + wait; the hung-signer scenario D-09 exists
  for), **D-18** (`PublishResponse.error`, the field D-11 puts to use), **D-01/D-02** (no throw as
  an internal signal).
- `.planning/seeds/SEED-001-avoid-inline-debug-extend.md` — the logger rule, its acceptable-usage
  carve-outs, and the breadcrumb list D-17 audits against. Mark resolved per D-19.

### Source under change
- `packages/relay/src/relay.ts` — `this.log` derivation (`:234`, `:436`); the flag subjects and their
  two internal log readers (`:398-403`, `:541-560`); `resetState()` (`:405-415`); challenge receipt
  (`:588-598`); `authSatisfied$` (`:748`), `missingPubkeysFor` (`:759`), `buildAuthContext` (`:766`),
  `authRetryOperator` (`:801`); the four auth sites and their bucketed lines (`:930`, `:1055`,
  `:1148`, `:1261`); `req()`'s send and `reqs$` tracking (`:946-976`); `event()`'s relay-rejection
  build (`:1120`) and manufactured timeout (`:1153`); `auth()` (`:1201`); `negentropy()` (`:1230`);
  `authenticate()` (`:1303`).
- `packages/relay/src/types.ts` — `RelayAuthOperation` (`:60`), `RelayAuthContext` (`:66`),
  `PublishResponse.error` (`:128`), `FilterInput` (`:199`), `RelayStatus`'s
  `authRequiredForRead`/`authRequiredForPublish` (`:50`, `:52`).
- `packages/relay/src/operators/auth-retry.ts` — the shared operator, its single existing log call
  (`:265`), and its injectable `log?` config field (`:232`).
- `packages/relay/src/negentropy.ts` — the per-negotiation id at `:71` that D-05 relocates.
- `packages/relay/src/group.ts` — `RelayGroup`'s logger (`:84`) and the `sync` per-relay
  `catchError` where D-19's dropped relay currently vanishes.
- `packages/loaders/src/loaders/sync-loader.ts` — `:611` (the sweep target), `:333`, `:346`, `:248`.
- `packages/loaders/src/loaders/timeline-loader.ts` — `:58`, `:136`, `:221`, `:241`, `:262`, `:446`,
  `:474`.

### Release state
- `.changeset/` — fourteen pending `applesauce-relay` changesets, including
  `relay-operation-scoped-auth-callbacks.md` (whose body names `operation` and must be edited per
  D-02) and `relay-publish-response-error-field.md` (D-11's field). **D-01's premise: verify none of
  these has shipped before planning.**

### Project conventions
- `CLAUDE.md` § Writing Changesets — one change per file, body is a single sentence of markdown, no
  bullets or code blocks.
- `.planning/codebase/CONVENTIONS.md` — repo-wide conventions (carries no logging convention today).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authRetry`'s `log?: (...args: unknown[]) => void` config field (`auth-retry.ts:232`) — already
  injected with `this.log` at `relay.ts:821`. The operation track's lines hang off this; only the
  injected value changes (to the `:auth` logger).
- `this.reqs$` (`relay.ts:959`) — already tracks `{ [id]: filters }` for every live REQ, keyed by the
  same subscription id the auth-required `CLOSED` returns on. The triggering request is recoverable
  at auth time without new bookkeeping.
- `PublishResponse.error` (`types.ts:128`) — added by D-18, currently unused on this path; D-11's
  discriminator.
- `resetState()`'s existing "only if it needs changing" guards (`:407-414`) — D-12's silence
  condition, already written.
- `buildAuthContext` (`:766`) — the single assembly point for what a handler sees; D-02's union
  lands here.

### Established Patterns
- **Derive-and-store loggers** — `logger.extend("Relay")` as a class field (`:234`) then
  `.extend(url)` in the constructor (`:436`); `negentropy.ts:26` as a module const. D-13's `:auth`
  logger follows this exactly, and D-20 confirms the package is already compliant.
- **Written invariants over conventions** — `relay.ts:787`'s SEND/LISTEN INVARIANT comment exists so
  the next call site checks itself. D-19 deliberately declines to add another one here, citing Phase
  5.1's finding that 14 such comments had gone false.
- **Value-signalling instead of throwing** (13-D-01) — D-11 continues it: a locally-manufactured
  value must be distinguishable from a relay-supplied one, structurally rather than by string.
- **Structural over enumerated** — the wire-verb union (D-02) makes an unhandled verb a compile
  error, following `validateInviteBundle`'s rule tables and 13-14's total progress predicate.

### Integration Points
- Phase 15's concord engines are the first consumer of D-02's union — they branch on request shape to
  pick which scoped key to authenticate with.
- `RelayGroup`/`RelayPool` forward the auth options unchanged; D-14 adds `RelayGroup.sync`'s
  dropped-relay line on `group.ts:84`'s logger.
- `applesauce-loaders` keeps its structural mirror of relay's auth types (13-D-06, no dependency) —
  if D-02 changes the handler context shape, `sync-loader.ts`'s `SyncAuthContext` mirror moves with
  it.

</code_context>

<specifics>
## Specific Ideas

- **The user's framing, stated during this discussion:** *"upstream on the relay side it can require
  auth for anything based on the shape of the request or event — for example requiring auth to read
  kind 1059 events but not other events, or requiring auth after 20 concurrent requests. So trying
  to bucket authentication state into three types isn't going to work going forward, and it's the
  thing I wanted to move away from. This is also why we are adding the onAuth callbacks on each
  request, because the relays are so different that handling auth on a per-request basis is the only
  way."* D-02 and D-06 are the direct application; planner and executor should treat "describe the
  actual request, never a category" as general guidance for anything they add here.
- **And:** *"auth state is still connection based, but we have already fixed that so we are good
  there."* D-08's two-track model follows from this — the connection track is connection-scoped
  because that is the truth of NIP-42, not a limitation to work around.
- **And:** *"we are doing away with the concept of 'auth required for read' or 'auth required for
  write'. Those reactive subjects must stay for backwards compatibility and not breaking the API,
  however the goal is to NOT use them internally."* D-03 and D-04.
- **Changesets:** this phase changes behavior in `applesauce-relay` beyond logging (D-02's context
  shape, D-11's `error` field on the timeout path), so it needs changesets — and, per D-01, it must
  also **edit** `.changeset/relay-operation-scoped-auth-callbacks.md`, whose body currently names
  `operation` in the context it advertises. One change per file, single-sentence body.
  `applesauce-loaders` needs one for the D-18 sweep only if its behavior changes; concord needs none.

</specifics>

<deferred>
## Deferred Ideas

- **Concord's four remaining reads of the auth-required flags** — `relay-auth.ts:110`, `:206`,
  `invite-watcher.ts:258`, `:435`, all consuming `status$`. They are the client-wide ambient driver
  CAUTH-03 retires. Phase 15, not here.
- **A lint rule enforcing the logger convention** — scoped out by REQUIREMENTS.md at milestone start
  and declined again by D-19, along with its grep-test and written-invariant substitutes. Remains
  available as a follow-up.
- **Value-signalling the remaining `CLOSED` prefixes** (blocked, rate-limited, invalid) — carried
  forward unchanged from 13-CONTEXT.md's deferred list. D-11 closes one instance of the adjacent
  "manufactured value indistinguishable from a real one" class, not the class itself; a broader
  audit of locally-manufactured `PublishResponse`/message values is worth a backlog entry.

### Reviewed Todos (not folded)
- `05.1-review-followups.md` — "Phase 05.1 code-review follow-ups". Surfaced by `todo.match-phase` at
  score 0.6, but the match is on generic keywords ("phase", "pre"); the content is gift-wrap/seal
  helpers in `applesauce-common` with no relation to auth logging. Not folded — same disposition as
  Phase 13.

</deferred>

---

*Phase: 14-auth-lifecycle-debug-logging*
*Context gathered: 2026-08-08*
