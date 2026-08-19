# Pitfalls Research: v7.0.0 relay-method-layering

**Domain:** Relocating retry/reconnect/timeout/auth policy across method layers in an RxJS-based
WebSocket networking library, shipped as a coordinated 14-package breaking major (`applesauce-*@7.0.0`).
**Researched:** 2026-08-19
**Confidence:** HIGH for the changesets/release-tooling findings (verified against the actual
`.changeset/config.json` and package manifests in this repo, cross-checked against upstream
changesets docs). HIGH for the RxJS/defer/retry findings (verified against the actual source in
`packages/relay/src/operators/auth-retry.ts`, `relay.ts`, `group.ts`, `negentropy.ts`). MEDIUM for
general RxJS operator-composition folklore not specific to this codebase.

## Critical Pitfalls

### Pitfall 1: The "coordinated lockstep major" premise is not actually guaranteed by `linked` — it is guaranteed by `fixed`, and this repo uses `linked`

**NOT ANTICIPATED BY THE RECORDED BACKLOG ANALYSIS.** ROADMAP.md's "v7 release coordination" section
states as settled fact: *"A major version bumps **every** applesauce package, whether or not its own
surface changed. This is an intentional property of the release process, not an accident of
tooling."* That is the behavior of a changesets **`fixed`** group. `.changeset/config.json` in this
repo has `"fixed": []` and puts all 14 packages under `"linked"` instead — and changesets' own docs
are explicit that this is a different guarantee: *"unlike fixed packages, there is no guarantee that
all packages in the group of linked packages will be version-bumped and published, only those with
changeset(s) will be."* A linked package is swept into a release only if (a) it has a changeset of
its own, or (b) it is a **regular** dependent of a package that does, sized by
`updateInternalDependencies` (here `"minor"`) before the linked-group's "highest bump type in the
set" rule elevates it back to major.

**What goes wrong:** `applesauce-concord` is planned to ship as v7's first official stable release
with **zero changesets of its own** (the explicit, repeatedly-recorded v1.2/v7 convention:
"concord is unreleased and needs no changesets"). Nothing in the monorepo depends on concord, so it
cannot be swept in by cascade either — its only two regular `dependencies` that could carry a
cascade are `applesauce-common` and `applesauce-core`. Concord's route into 7.0.0 is entirely
contingent on **one of those two packages** getting a changeset from something else in scope (e.g.
999.15 touches `packages/common/src/helpers/groups.ts`). If that entry is deferred, resequenced, or
its changeset is filed narrowly enough that changesets' dependency graph doesn't see it as touching
`applesauce-common`'s published surface, `changeset version` will leave concord's `package.json`
untouched at `6.2.0` — silently. The same risk applies to `applesauce-react` and `applesauce-sqlite`,
whose only path in is a cascade from `applesauce-core`, which nothing in the confirmed 999.x scope
touches directly today. The only mechanism that plausibly sweeps every one of the 14 packages is
SEED-002/003/004 (TypeScript 7 / React 19 / `@snort/worker-relay` v2) — and those seeds are still
unfilled stubs ("To be filled in," effort "Unknown") with no confirmed package footprint.

**Why it happens:** `linked` and `fixed` are easy to conflate — both "move together" in the common
case where every package actually changes. The gap only shows up for packages that have *no* work
item in a given release, which is exactly concord's and (likely) react/sqlite's situation here.
Nobody has run the tooling against this milestone's actual changeset set yet; the ROADMAP's own "worth
confirming on a dry run" note treats this as a version-*number* interaction (does dependent get major
or minor), not as a version-*existence* question (does the dependent get touched at all).

**How to avoid:**
1. Before cutting, run `pnpm changeset version` (or `--snapshot` for a throwaway probe) on a branch
   and diff **all 14** `package.json` versions against the expected `7.0.0` — not just the packages
   known to have code changes. Any package still reading `6.x` is the defect.
2. Do not rely on cascade for concord, react, or sqlite. File one explicit changeset per package that
   has no other v7-scoped work — even a one-line "chore: republish under the v7 lockstep major" body
   — so the linked group's "highest bump type in the set" rule has something to attach to. This is
   cheaper and more auditable than restructuring `config.json` to `fixed` mid-milestone (which would
   also change future non-major release cadences, a bigger blast radius than intended here).
3. Treat "which packages get a v7 changeset" as an explicit checklist item in 999.23 (which already
   gates everything else) rather than an assumption baked into scope.

**Warning signs:** A dry-run `changeset version` leaves any package's `version` field unchanged from
its pre-milestone 6.x value. `changeset status` reports fewer than 14 packages as "will be bumped."
Concord's `package.json` still exists on the pre-v7 branch's `6.2.0` after a version run.

**Phase to address:** 999.23 (gates release mechanics for everything downstream) plus a dedicated
pre-flight check immediately before `changeset version`/`changeset publish` are run for real — not a
one-time check done at milestone-scoping time, since scope (and therefore which packages get
changesets) will still be moving through 999.24-28.

---

### Pitfall 2: Nested retry/reconnect budgets multiply when a retry loop moves up a layer

**What goes wrong:** Every re-layering entry in this milestone is, mechanically, "take a retry loop
that lived inside a low-level method and move it (or add a second one) at the high-level method that
calls it." The moment two retry mechanisms exist over the same failure at two layers, their product —
not their sum — is the effective retry count, unless one loop is explicitly taught to skip what the
other one owns. This codebase has already hit this once and fixed it structurally: `customRetryOperator`
skips (re-throws rather than retries) any `RelayClosedError` specifically so `publish()`'s reconnect
retries cannot multiply against `event()`'s auth retries (D-07). 999.24 explicitly flags that this
skip "needs re-deriving" once both loops move inside `publish()` together — the current skip was
written for a two-*method* boundary, not a two-*loop-in-one-method* boundary, and its ordering was
never made explicit, only inherited. 999.26 independently flags the same shape: `authenticate()`'s new
resign budget and the operation-level `authRetries` one layer out are "two nested budgets over the
same failure" that "need a deliberate relationship."

**Why it happens:** A retry operator's `delay`/`count` callback typically only sees "an error came
through," not "which layer's failure this is or whether an outer loop already retried this exact
cause." Once a loop is relocated rather than deleted, the discriminator that made the old boundary
safe (a distinct error type, a distinct method) can quietly stop discriminating anything once both
loops share a scope.

**How to avoid:** For every re-layered pair, write down explicitly (in the plan, not just in code
comments) which loop owns which failure class, and enforce it the same way D-07 does today — a type
check (`instanceof RelayClosedError`/its subclasses) that makes one loop's retry a structural no-op
for the other loop's failure class, not an implicit ordering assumption. Where two loops legitimately
both need to fire for the same failure (e.g. a stale-challenge resign *and* the operation's outer
`authRetries`), cap the total observable attempts with a test that asserts the actual wire-send count
under a worst-case relay, not just that each loop's own counter is individually bounded.

**Warning signs:** A relay that always returns `auth-required:` (or always closes with the same
prefix) produces more than `retries × authRetries` (or the documented product) EVENT/REQ/COUNT sends
in a test harness. A hostile-relay test that previously existed for the two-method boundary (D-07) has
no analogue once both loops share a method.

**Phase to address:** 999.24 (explicitly named as the concentration point for this risk), 999.25,
999.26. Each of these phases should carry its own hot-loop regression test asserting an exact wire-send
upper bound against an always-refusing relay, not just "eventually gives up."

---

### Pitfall 3: `suspendableTimeout` regresses to a bare `rxjs timeout()` somewhere in the re-layered call chain

**What goes wrong:** Every high-level method in this milestone gains or keeps an operation clock, and
the one implementation this codebase trusts (`suspendableTimeout` driven by an `AuthPhaseGate`) is
non-trivial: it has to track `remaining`/`armedAt`, disarm on gate-active, and re-arm on gate-inactive
by hand, rather than delegating to rxjs's own `timeout()`. A re-layering plan that treats the clock as
"just move the existing `timeout(...)` call to the new method" — because that is the smallest textual
diff — silently reintroduces a clock that keeps counting through a 30s auth wait, which is precisely
the closed defect class the call site's own comment warns against. This is a live risk specifically
because 999.20's extension proposes new *conditions* (`errorAfterSilence`, idle timers) that must also
be gate-aware, and 999.27/999.28 both introduce **new** operation clocks (`count()`'s configurable
timeout, `sync()`'s clock that "does not exist on this path at all") that have no existing suspendable
implementation to copy from — they have to be built correctly the first time, not migrated correctly.

**Why it happens:** `suspendableTimeout` and rxjs's `timeout()` have nearly identical call-site shapes
(`operator(ms, opts)`), so a refactor performed by pattern-matching on "what does a timeout look like
elsewhere in the file" rather than "what does this timeout need to survive" can select the wrong one
without a type error — both compile.

**How to avoid:** Treat "does this clock suspend across every auth phase in its scope" as a required,
independently-written regression test per new/moved clock — not an inherited property. The concrete
non-vacuity check: temporarily replace the call site's `suspendableTimeout(...)` with a bare
`timeout(...)` and confirm the existing "auth wait longer than the operation timeout must still
succeed" test goes **red**. If no such test exists for a given method yet (true for `count()` and
`sync()`, which are gaining clocks for the first time), write it before writing the fix, not after.

**Warning signs:** A test where the mocked signer/handler takes, say, 20s to resolve and the
configured operation timeout is 15s starts failing intermittently or consistently once a re-layered
method's clock is wired up. Any new `import { timeout } from "rxjs"` call site added inside a phase
scoped to this milestone should be treated as a finding until proven not to cross an auth boundary.

**Phase to address:** 999.25 (subscription's re-establish loop needs its own clock across reconnects
*and* auth phases), 999.27 (`count()`'s newly-configurable timeout), 999.28 (`sync()`'s clock, which
has no precedent to inherit from at all — this is the highest-risk instance since 999.13's own closing
note already flagged "no operation clock on that path").

---

### Pitfall 4: The progress-predicate / message-union totality guard regresses under an `as` cast when a union widens

**What goes wrong:** This codebase's own carried-forward lesson (Phase 13, three rounds to close) is
that "a call site's own bookkeeping value being counted as real progress by a shared consumer"
recurred at every layer it reached, and the fix that finally held was structural — `isReqProgress`,
`isGroupReqProgress`, `ProgressPredicate<T>` as a *required* parameter, so a predicate must be total
over its own union with no cast. This milestone widens several unions that a progress predicate (or an
equivalent exhaustiveness check) must stay total over: `RelayCountResponse` gains `approximate`/`hll`
fields and drops its `m[2] as RelayCountResponse` cast (999.27); `sync()`'s emission widens from
`Observable<NostrEvent>` to a `received | sent | send-failed` union, and `RelayGroup.sync()`/`negentropy()`
gain new arms for per-relay failure (999.28); `RelayGroup.request()`/`subscription()` gain an error
condition observing the same `GroupReqMessage` stream a progress predicate already covers (999.20).
Each widening is a fresh opportunity to reach for `as` at the boundary "just to get it to compile" —
which is exactly the shortcut the original defect class was born from, and exactly what the closed fix
was designed to make impossible only where it was applied.

**Why it happens:** The totality guard is local to the functions it was written for
(`isReqProgress`/`isGroupReqProgress`). It is not a generic TypeScript feature that automatically
extends coverage to a brand-new union introduced in a different file (`RelayCountResponse`,
`SyncMessage`) — each new union needs its *own* exhaustive, uncast predicate/switch, and nothing
forces a reviewer to notice that one wasn't written.

**How to avoid:** For every widened union or new discriminated type introduced by 999.20/21/27/28,
write the totality check the same way: a `switch`/mapped predicate with no `default` arm and no `as`
cast, so TypeScript's own exhaustiveness checking makes a missed arm a compile error. Grep for `as
Relay` / `as Sync` / `as GroupReq` casts introduced or retained across the diff as an explicit review
step — the fix pattern in this codebase is "no cast reaches a consumer that treats the value as a
progress/completion signal," and that pattern needs to be re-derived per new union, not assumed to
transfer.

**Warning signs:** Any `switch` or predicate over one of the new/widened unions that has a `default:`
branch or ends in `return false` / `return true` unconditionally rather than exhausting every named
arm. A code review comment reading "this cast is safe because X" over one of these unions — that
sentence is the exact shape of reasoning the closed defect class defeated twice before it was made
structural.

**Phase to address:** 999.27 (`RelayCountResponse`), 999.28 (`SyncMessage`, `RelayGroup.sync()`/
`negentropy()`'s new arms), 999.20/999.21 (the error-condition operator's view of `GroupReqMessage`).

---

### Pitfall 5: Moving a `defer`-wrapped socket write across a subscribe boundary reintroduces double-send or lost-send (the CR-02 class)

**What goes wrong:** `req()`'s per-attempt `defer` factory exists because an earlier version of this
exact mechanism let a synchronous `onAuthRequired` resolution rejoin a still-connected `share()`'d
chain and skip the resend entirely — "REQ never written to the socket at all." `event()`'s `control`
is deliberately an **unshared** `defer` whose body is `this.socket.next([verb, event])` for the same
reason: it must "always re-send on every subscription." 999.24's whole design is to relocate *when*
that unshared defer gets resubscribed — from an internal `expand()` inside `event()` to an external
`catch` + resubscribe inside `publish()`. That relocation is precisely the kind of change that
re-derives CR-02's conditions: a `defer` that must re-execute its side effect on every resubscribe, now
being driven from one layer further out, potentially through an intermediate `share()`/`switchMap()`
that was not there before and can silently make the resubscribe a no-op (rejoining a live multicast
instead of re-running the source) or a double-fire (two independent subscriptions to the same unshared
defer racing two socket writes).

**Why it happens:** `share()`/`shareReplay()`/`connect()` change whether "subscribe" means "run the
source again" or "attach to what's already running," and that meaning depends on *where in the pipe*
the operator sits relative to the defer, not on the defer itself. Relocating the retry/resubscribe
trigger without re-deriving where `share()` needs to sit relative to it is the exact mechanism CR-02
exploited.

**How to avoid:** For 999.24 and 999.25, treat "does the intended resend actually reach
`socket.next()` exactly once per attempt" as its own regression test, independent of "does the retry
eventually succeed" — a mock socket counting `next()` calls per logical attempt, asserted against a
relay that requires exactly N auth phases. Keep the unshared-defer-per-attempt shape when moving the
loop; do not introduce a `share()`/`shareReplay()` between the defer and its trigger unless the new
design has explicitly reasoned about resubscription semantics the way `req()`'s existing comment does.

**Warning signs:** A mock-socket send-counting test shows more sends than logical attempts (double
send) or fewer (lost send — the resend silently rejoins a completed/shared chain and nothing reaches
the wire). Any new `share()`/`shareReplay()` added between a `defer` that must re-run a side effect and
the operator that resubscribes it is a finding until proven safe.

**Phase to address:** 999.24 (event/publish boundary — the smaller surface, meant to prove the pattern
first per the milestone's own sequencing rationale), 999.25 (req/subscription boundary — larger and
explicitly flagged as highest-risk).

---

### Pitfall 6: `subscription()`'s re-establish loop delivers duplicate events, or silently drops the dedupe boundary, across a reconnect

**What goes wrong:** Once `req()` can no longer survive a reconnect on its own (999.25's central
design decision), `subscription()` must own re-establishing the REQ after a socket drop — and every
long-lived-subscription reconnect design has the same three failure shapes: (a) a relay resends
events the consumer already saw before the drop, because a fresh REQ has no "since last event" cursor
by default; (b) the re-established REQ reuses the old subscription id in a way that collides with
stale relay-side state from before the reconnect (or, conversely, mints a new id in a way that breaks
a consumer keying its own state off a stable id); (c) the consumer sees a synthetic second `OPEN` (or
a second `EOSE`) that a naive `filter`/`take(1)` downstream was written assuming happens exactly once
per subscription lifetime. 999.25 lists exactly these three questions as unresolved design decisions
("does the same REQ id... mint a new one," "what does a re-established subscription emit... does the
consumer see a second OPEN," "does filterDuplicateEvents still hold across the boundary") — which is
the right list, but each is a place a plausible-looking default silently ships the wrong answer.

**Why it happens:** A brand-new socket is, from the relay's point of view, a brand-new client with no
memory of what it already sent — there is no protocol-level "resume" for a plain REQ. Anything that
prevents duplicate delivery after a reconnect has to be built entirely client-side, and it is easy to
build "resubscribe" correctly (the REQ gets re-sent) while leaving "de-duplicate across the boundary"
unbuilt, because the resubscribe alone looks like it works in any manual test that doesn't specifically
check for a repeated event id.

**How to avoid:** Decide and document, as part of 999.25's plan (not discovered during execution):
whether reconnect re-establishment carries a "since" watermark (last-seen `created_at`/id) into the
new REQ's filter, and whether `filterDuplicateEvents` (or an equivalent) is explicitly re-scoped to
span the whole `subscription()` lifetime rather than one `req()` attempt. Write the regression test as
"simulate a mid-stream socket drop with 3 events already delivered, resume, relay resends those 3 plus
2 new ones, assert exactly 2 new events reach the consumer" — not "assert the subscription reconnects
and events keep flowing," which cannot distinguish correct behavior from silent duplication.

**Warning signs:** Manual testing "looks fine" (events keep arriving after a reconnect) while an
automated duplicate-id assertion is absent. A consumer-facing `EOSE`/`OPEN` count that isn't asserted
to stay at exactly one per subscription across a forced reconnect in the test suite.

**Phase to address:** 999.25 — this is that phase's own stated highest-risk area; it should carry a
dedicated verification requirement rather than being folded into the general "retries eventually
succeed" acceptance criteria.

---

### Pitfall 7: `AuthPhaseGate` gets re-created at the wrong layer instead of threaded through, causing double-suspension or a clock that never actually pauses

**What goes wrong:** The gate is deliberately call-scoped and passed down via the module-private
`AUTH_PHASE_GATE` symbol so an *outer* method's clock can suspend across an *inner* method's auth
phase (`request()` creates a gate and threads it into `req()`; `publish()` creates one and threads it
into `event()`). Every re-layering entry that moves an auth loop from a low-level method up to its
high-level counterpart has to re-derive which layer now owns the gate. Getting this wrong in either
direction is silent: creating a *second*, independent gate at the new layer means the outer clock
never sees the inner phase as active (it suspends against a gate nothing ever calls `.begin()`/`.end()`
on, so the clock behaves like a bare timeout again — Pitfall 3's failure mode via a different
mechanism); routing the *same* gate through two independent auth-retry operators that each call
`.begin()`/`.end()` for what is logically one phase can leave the count above zero after the phase
resolves (permanently paused clock) if one path's `.end()` is on a code path the refactor didn't carry
forward.

**Why it happens:** `AuthPhaseGate` is a plain mutable counter with no assertion that `begin`/`end`
calls are balanced or that only one "owner" exists per operation. Nothing fails loudly if a re-layered
method forgets to thread the gate it received, or threads a fresh one instead — both compile and both
usually still retry successfully, just without suspending the right clock.

**How to avoid:** For every phase that relocates or adds an auth loop, add an explicit assertion-style
test: after every auth phase resolves (success or failure), `gate.active$` must have emitted back to
`false`/count-zero before the operation completes or errors — not just "the operation eventually
settles." Treat "which single object is `new AuthPhaseGate()`'d for this whole operation, and where is
it threaded" as a one-sentence note in each phase's plan, mirroring how 999.23's layering rule itself
is meant to be recorded.

**Warning signs:** A suspendable clock that never fires even when it clearly should (a relay that
never resolves the operation, with `authTimeout: false` set, hangs forever with no timeout ever
elapsing) — the opposite symptom from Pitfall 3, but the same root cause from the other direction.

**Phase to address:** 999.24, 999.25, 999.26, 999.27, 999.28 — anywhere a gate is threaded across a
newly-relocated boundary.

---

### Pitfall 8: The existing suite cannot see the exact defect a phase is fixing, and a superficially-plausible test will pass without exercising it

**What goes wrong:** This is a documented, recurring property of this codebase, not a hypothetical:
`relay.test.ts:2748` deliberately keeps both negentropy sides under the 32-item frame-size threshold
so multi-round reconciliation — the entire subject of 999.28 — is never exercised, and 999.28's own
text says "no current test can see it." The same shape shows up in 999.21's NIP-45 `hll` merge
requirement: a test that asserts `count()` "returns a number" proves nothing about whether summing
per-relay counts (wrong — double-counts shared events) versus merging HyperLogLog registers (right) was
implemented, because both produce *a* number that passes a shallow assertion. And the milestone's own
carried-forward lesson from Phase 15 is structurally the same trap one level up: two mechanisms shipped
for one gap, the suite went green, and only a mutation check (revert one mechanism, keep the other,
see if the regression test still passes) revealed that only one of the two was load-bearing.

**Why it happens:** A regression test written *for* a known symptom ("multi-round sync hangs") is easy
to satisfy by construction without exercising the actual mechanism if the test author reaches for the
smallest fixture that reproduces the old bug report, rather than the smallest fixture that forces the
new mechanism to run. Comparing an aggregate's output to what the implementation itself computes (self-
comparison) rather than to an independently-derived expected value has already been identified in this
codebase (v1.1's TEST-01) as the single most common way 43 real bugs hid behind 189 green tests.

**How to avoid:** Per this codebase's own established practice — not a new tool — apply it explicitly
here:
1. **Force the threshold, don't approximate it.** 999.28's test fixtures must exceed the negentropy
   frame-size limit (32 items observed; verify the actual constant) so a second round is *structurally
   required*, not merely possible.
2. **Assert against an independently-derived value**, not the implementation's own output. For
   999.21's NIP-45 merge: compute the true union cardinality of two known, overlapping synthetic event
   sets by hand (or via a trusted reference HLL implementation) and assert the merged estimate is close
   to *that*, not that it differs from the naive-sum result — a test that only checks "merge output ≠
   sum output" would pass even if the merge is a different kind of wrong.
3. **Write the RED→GREEN non-vacuity probe as an artifact, not just a habit.** Before landing the fix,
   confirm the new test fails against the pre-fix code for the reason expected (not a type error, not
   an unrelated crash) — record that this was done, the way ALOG-03/CAUTH-03's restatements are
   recorded, so a future reader does not have to re-derive whether the test is real.
4. **Mutation-check dual mechanisms.** Where a fix ships more than one change for one gap (as Phase
   15's gap-closure did), revert each individually against the full regression suite and confirm each
   one's absence is independently detected — do not assume both are load-bearing just because the
   suite is green with both present.

**Warning signs:** A negentropy test whose fixture size is a round number suspiciously close to a
power of two without a comment explaining why it was chosen relative to the frame-size constant. A
`count()`/aggregate test whose assertion is `expect(result).toBeGreaterThan(0)` or compares two
implementation-derived values to each other rather than to a hand-computed one. Any "this closes the
gap" claim in a phase's own verification notes that isn't backed by a recorded RED run.

**Phase to address:** 999.28 (multi-round negentropy — the sharpest, already-flagged instance),
999.21 (NIP-45 count merge correctness), and as a standing verification requirement across every phase
in this milestone given the pattern's repeated recurrence in this codebase's history.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Shipping the group error-condition default as "error only when we choose to enable it" instead of on-by-default | Zero behavior change, no changeset urgency | Perpetuates the exact "completes empty/hangs silently" defect the milestone exists to close, on a package already taking a major bump anyway | Never in this milestone — the major is already paid for; deferring the default wastes the only free window to change it |
| Widening the `D-01` throw-as-signal carve-out beyond "aggregator or retry-layer consumer" because it's convenient at a new call site | Faster to write, avoids a value-signal plumbing pass | Re-opens the exact four costs D-01 was written to prevent (signal traveling through intermediaries that don't care about it) | Never without amending 999.23's rule text first and citing the new consumer as a genuine aggregator/retry layer |
| Rejecting slightly-malformed NIP-45 `hll`/`approximate` fields outright once `count()` moves from cast to validation | Simpler validation code, fails fast on bad data | Nostr relays are independently implemented and protocol-adjacent fields are exactly where real-world relays drift from spec first; hard-rejecting turns an interoperability wrinkle into a hard failure for legitimate but slightly-off relays | Acceptable only for structurally impossible values (negative count, wrong `hll` byte length); log-and-degrade (treat as absent) for anything else |
| Leaving `RelayGroup.negentropy()`'s group-level shape undesigned past 999.28, since 999.28's own text says it "does not fit the layering rule at all and may simply not deserve to exist" | Ships the relay-level fix without blocking on a group-level redesign | A group-level low-level method with no clear owner tends to accumulate ad-hoc callers before anyone revisits it | Acceptable short-term if explicitly filed as a follow-up backlog entry with the "may not deserve to exist" framing preserved, not silently left as-is |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|--------------|------------------|--------------------|
| changesets `linked` group across 14 packages | Assuming `linked` behaves like `fixed` — that every package moves together regardless of whether it has a changeset | Verify via dry-run version diff (Pitfall 1); file explicit changesets for packages with no other v7 work rather than trusting cascade |
| `applesauce-loaders` mirroring `applesauce-relay`'s types structurally with **no package dependency** (D-06, "mirrors the types structurally") | Assuming a breaking type change in `applesauce-relay` (e.g. `RelayReqOptions` losing `reconnect`/`resubscribe`, `sync()`'s emission union widening) will surface as a compile error in `applesauce-loaders` | There is no dependency edge to force that error — `applesauce-loaders` can drift silently. Add (or confirm) a structural-compatibility test that imports both packages' relevant types in one file and asserts assignability, so drift is a CI failure, not a runtime surprise for a downstream consumer |
| `applesauce-concord`'s `applesauce-relay`/`applesauce-loaders`/`applesauce-signers` as `optionalDependencies` (not `dependencies` or `peerDependencies`) | Assuming changesets' internal-dependency cascade treats `optionalDependencies` the same as regular `dependencies` for triggering a bump | Confirm explicitly in the dry run (Pitfall 1) whether an `optionalDependencies` edge participates in the cascade at all — do not assume it does just because concord's code imports from those packages |
| TypeScript 7 (SEED-002) bundled into the same release as the exhaustiveness-check pattern this milestone relies on (Pitfall 4) | Treating the TS version bump as an unrelated, parallel-track change | TS7 changes to control-flow narrowing/exhaustiveness diagnostics can change whether the totality guards this milestone depends on (no-`default`, no-`as`) still compile the same way — run the TS7 bump *before* or *isolated from* the exhaustiveness-guard-heavy phases (999.20/21/27/28) so a compiler-behavior change isn't misattributed to a logic bug, or vice versa |
| React 19 (SEED-003) and `@snort/worker-relay` v2 (SEED-004) landing in the same major as the relay re-layering | Reviewing the whole diff as one undifferentiated changeset when regressions surface | Keep each ecosystem rider's changes in separately-reviewable commits/PRs even though they publish under one coordinated version, so a regression can be bisected to "relay re-layering" vs. "ecosystem bump" without re-deriving which files belong to which |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Removing negentropy's `await reconcile(...)` (999.28) without capping cross-round transfer concurrency | Large diffs open unbounded concurrent `Promise.allSettled` publishes/fetches across rounds, not just within one round | Make transfer concurrency an explicit, bounded `mergeMap`/semaphore on `sync()`, configurable, not inherited serialization from the old callback shape (999.28 already names this explicitly — do not skip it as an optimization-only concern) | A sync against a relay with a large one-sided diff (thousands of events) |
| `RelayGroup.count()`'s `combineLatest`-style all-or-nothing gating, even after per-relay isolation lands | One slow relay still delays the whole record's first emission even though no relay errored | Prefer the progressive-`scan`-accumulation shape 999.21 already floats over a `catchError`-per-relay-but-still-`combineLatest`-shaped fix | Any pool with more than a couple of relays and one consistently-slow member |
| A group-level idle/silence clock (999.20's extension) re-arming on every message from *any* relay in a large group | A single chatty-but-useless relay resets the idle timer indefinitely, masking that the operation is not making progress toward the caller's actual goal | Scope the idle condition to progress the caller cares about (e.g. new unique events), not raw message traffic, when defining the default `errorAfterSilence`-style builder | Group sizes where at least one relay reliably sends keepalive-adjacent traffic (EOSE repeats, etc.) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| A new relay-controlled string used as an object-literal lookup key anywhere in the re-layered code (the 999.14 `parseClosedError` prototype-chain class) | A relay sending `constructor: ...` or `__proto__: ...` as part of a CLOSED/NEG-ERR/COUNT reason resolves to an inherited `Object.prototype` member instead of `undefined`, producing a wrong-but-truthy branch | Any new reason-prefix or verb dispatch introduced by 999.20/21/24-28 must use a `null`-prototype map or `Object.hasOwn`, never a plain object literal keyed by relay-controlled text — audit every new lookup, don't assume 999.14's eventual fix covers call sites written after it |
| Aggregate error types (999.20/21's `GroupAllRelaysFailedError` and friends) embedding raw, unbounded relay-supplied reason strings | Same class as the closed Phase 14 defect where relay-controlled text flowed into a log format argument unbounded — an aggregate error's `.message`/`toString()` is just as reachable a sink as a debug log line | Route every relay-supplied string reaching a new aggregate error's message through the same bounding/truncation helper (`truncateForLog` or equivalent) established in Phase 14, at construction, not left to each call site |
| A stale-challenge AUTH (999.26) being silently retried against a **new** relay identity after a reconnect mid-sign | If the socket reconnects to what the consumer believes is the same relay but the challenge/identity actually rotated, a naive "just resend with the new challenge" retry could sign and send an AUTH event without the caller ever being told the relay connection changed underneath them | `authenticate()`'s resign path should re-validate that the relay identity it is signing for is still the one the caller intended, not merely that *a* challenge is now present |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| `request()` going from "completes empty" to "throws" by default with no migration note reaching consumers who treat an empty array as a legitimate "no results" | An app that did `const events = await firstValueFrom(relay.request(...).pipe(toArray()))` and handled `[]` gracefully now gets an unhandled promise rejection on every relay outage instead of an empty list | Ship a changeset that states the behavior change in terms of the *symptom* consumers will see ("a fully-failed relay set now rejects instead of resolving empty"), not just the type signature change; consider whether `RelayGroup.request()`'s docs example needs updating alongside the changeset, the way 999.28 already flags for `sync()`'s docs |
| `sync()`'s SEND direction printing "Upload complete" when every send failed (999.28's own documented finding) | A user-facing sync UI reports success on total failure | Emit `sent`/`send-failed` as real values before completion, and make any docs/example code that logs on `complete` alone a review flag — completion is not success |
| A type-only breaking change (an option moving from `RelayReqOptions` to `RelayRequestOptions`/`RelaySubscriptionOptions`) shipping with no runtime signal | A consumer who doesn't recompile against the new `.d.ts` (e.g. pins `applesauce-relay` but doesn't rebuild immediately) sees no error until they finally do rebuild, at which point the failure is far from the actual behavior change | Changeset prose should describe the *shape* of the compile error a consumer will see ("passing `reconnect` to `req()` is now a type error; move it to `request()`/`subscription()`"), so it's greppable when the error eventually surfaces |

## "Looks Done But Isn't" Checklist

- [ ] **"Retries eventually succeed":** verify the *upper bound* on wire sends against an
      always-refusing relay, not just that a well-behaved relay eventually gets through (Pitfall 2).
- [ ] **"The clock is suspendable":** verify by mutation — swap the new/moved clock for a bare
      `timeout()` and confirm a specific regression test goes red, don't just confirm the happy path
      passes (Pitfall 3).
- [ ] **"Every relay's failure reaches the caller":** verify the *per-relay cause* survives into the
      aggregate error's structure (inspectable, not just present in a log line) — an aggregate that
      raises `Error("all relays failed")` with no `errors` map technically "throws on total failure"
      while still losing the information 999.20 exists to preserve.
- [ ] **"v7 ships lockstep":** verify via a dry-run version diff across all 14 `package.json` files,
      not by trusting the `linked` config to guarantee it (Pitfall 1).
- [ ] **"The NIP-45 count aggregate is correct":** verify the merged estimate against an
      independently-computed union cardinality on a synthetic overlapping data set, not just that the
      code runs without throwing (Pitfall 8).
- [ ] **"Multi-round negentropy works":** verify with a fixture that provably exceeds the frame-size
      threshold, and assert the follow-up `NEG-MSG` was actually written to the (mock) socket — not
      just that the promise eventually resolves (Pitfall 8, and 999.13's own root cause).
- [ ] **"The reconnect doesn't lose or duplicate events":** verify with a forced mid-stream socket
      drop against a relay mock that resends prior events, asserting the exact set the consumer
      receives — not just that events keep flowing after reconnect (Pitfall 6).
- [ ] **"D-01's citations were updated":** grep all 14 shipped-source citations plus `13-CONTEXT.md`
      after 999.23 lands and confirm each now states the amended rule — a citation count check, not a
      sampling check, since this is exactly the kind of sweep 999.16's WR-06 shows can be missed even
      when the underlying fix is real.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| A linked-group package (e.g. concord) is discovered *after* `changeset publish` to have stayed on 6.x while the rest moved to 7.0.0 | MEDIUM | npm publishes cannot be unpublished after ~72 hours by policy; cut an immediate follow-up release for the orphaned package(s) carrying an explicit changeset that jumps it to `7.0.0` (or `7.0.1` if `7.0.0` is claimed by another package's history), and correct the release notes to explain the gap rather than let the version-number mismatch stand unexplained |
| A nested retry budget multiplication is discovered in production against a hostile/misbehaving relay | MEDIUM–HIGH | Patch release adding the missing failure-class skip (mirroring D-07) to whichever loop is over-firing; needs the hot-loop regression test written retroactively before the fix, so the fix can be proven rather than merely applied |
| Duplicate event delivery across a subscription reconnect is discovered by a downstream consumer in production | HIGH | Requires a design decision (watermark vs. dedupe-window) that should have been made at plan time (Pitfall 6) — retrofitting it without reopening 999.25's design is likely to just move the bug rather than close it; treat this as cause to reopen the phase's own decision record, not a one-line patch |
| A widened union (Pitfall 4) is found to have an `as`-cast escape hatch after release, silently defeating the totality guard | LOW–MEDIUM | Removing the cast and making the switch/predicate exhaustive is a compile-time-only fix if no runtime behavior depended on the cast's silent default; audit whether any consumer code came to rely on the cast's incorrect-but-tolerated shape before tightening it in a patch |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1. `linked` group leaves untouched packages behind | 999.23 (release mechanics gate) + a pre-publish check run again just before cutting | Dry-run `changeset version`/`status`, diff all 14 versions |
| 2. Nested retry budgets multiply across a relocated loop | 999.24, 999.25, 999.26 | Hot-loop test: exact wire-send count against an always-refusing relay |
| 3. `suspendableTimeout` regresses to bare `timeout()` | 999.25, 999.27, 999.28 | Mutation check: swap to bare `timeout()`, confirm a named test goes red |
| 4. Progress-predicate/union totality regresses under `as` | 999.20, 999.21, 999.27, 999.28 | Grep for `as Relay*`/`as Sync*`/`as GroupReq*` casts; confirm exhaustive switch with no `default` |
| 5. `defer`-wrapped send double-fires or is lost across a relocated resubscribe | 999.24, 999.25 | Mock-socket send-count test per logical attempt against a scripted multi-phase relay |
| 6. `subscription()` reconnect loop duplicates/drops events | 999.25 | Forced mid-stream drop + resend fixture, exact-set assertion |
| 7. `AuthPhaseGate` ownership drifts across a relocated boundary | 999.24, 999.25, 999.26, 999.27, 999.28 | Assert `gate.active$` returns to false/zero after every phase; assert a clock suspends when it should |
| 8. Existing suite is structurally blind to the defect being fixed | 999.28 (negentropy), 999.21 (NIP-45 merge), standing across all phases | Frame-size-exceeding fixture; independently-derived expected values; recorded RED→GREEN probes; mutation-check dual mechanisms |

## Sources

- `.planning/PROJECT.md`, `.planning/ROADMAP.md` (this repo) — Current State/Current Milestone
  sections and backlog entries 999.13, 999.14, 999.16, 999.18, 999.19, 999.20, 999.21, 999.22,
  999.23, 999.24, 999.25, 999.26, 999.27, 999.28.
- `packages/relay/src/operators/auth-retry.ts`, `packages/relay/src/relay.ts` (req/request/subscription/
  publish/count/customRetryOperator/customConnectionRetryOperator/customRepeatOperator),
  `packages/relay/src/negentropy.ts`, `packages/relay/src/group.ts` — read directly to verify every
  code-shape claim above (`AuthPhaseGate`, `suspendableTimeout`, `resubscribeHolder`, `isReqProgress`,
  the D-07 `RelayClosedError` skip, the dropped `socket.next` follow-up in `negentropySync`).
- `.changeset/config.json`, `packages/concord/package.json` (this repo) — verified `linked` (not
  `fixed`) configuration and concord's `optionalDependencies` shape directly.
- [changesets: linked packages](https://github.com/changesets/changesets/blob/main/docs/linked-packages.md) — HIGH confidence, official docs, fetched directly: confirms linked packages are only
  bumped when they have a changeset (own or dependent-triggered), unlike `fixed`.
- [changesets: snapshot releases](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md) — HIGH confidence, official docs: confirms the `--tag` safeguard against an
  accidental `latest` publish, relevant to concord's existing snapshot-only history.
- [changesets: configuration](https://changesets.dev/guide/config) — MEDIUM confidence: confirms
  `updateInternalDependencies` only updates a dependent's range when that dependent is itself being
  released, but does not fully resolve its interaction with `linked`'s "highest bump type" rule —
  flagged above as something this milestone must resolve via dry run, not assumption.
- General RxJS `retry`/`repeat`/`timeout` operator documentation (ReactiveX, learnrxjs) — MEDIUM
  confidence, folklore-level community sources; used only to corroborate composition hazards already
  independently verified against this codebase's own source and defect history.
- Mutation testing practice (Stryker docs/community writeups) — MEDIUM confidence; this repo has no
  mutation-testing tool configured today, so the recommendation above is framed as the manual
  RED→GREEN / mechanism-revert practice this codebase already uses (per Phase 15's mutation-by-hand
  finding), not as a tooling adoption.

---
*Pitfalls research for: applesauce v7.0.0 relay-method-layering*
*Researched: 2026-08-19*
