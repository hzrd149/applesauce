# Feature Research

**Domain:** Fan-out/group error handling, timeout semantics, progressive results, HyperLogLog COUNT merge, and negentropy transfer for a reactive Nostr relay SDK (`applesauce-relay` v7.0.0 re-layering)
**Researched:** 2026-08-19
**Confidence:** MEDIUM-HIGH (library conventions HIGH; NIP-45/NIP-77 spec text HIGH — quoted directly; JS-nostr-specific HLL prior art LOW — none found)

This file covers only the five NEW capabilities the v7.0.0 milestone adds on top of already-shipped
infrastructure (operation-scoped auth, `authRetry`, `suspendableTimeout`/`AuthPhaseGate`,
`RelayGroup`/`RelayPool` fan-out, `completeWhen`/`GroupRequestCompleteOperator`). Existing features are
not re-researched. The design analysis already recorded in ROADMAP.md's 999.20/999.21/999.27/999.28 is
treated as given — this file weighs it against outside convention, not against itself.

## Feature Landscape

### Table Stakes (Consumers Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Group operation raises a real error when every relay fails | `Promise.allSettled`/`AggregateError` and every batch-API convention surveyed (DynamoDB `UnprocessedKeys`, HTTP 207 multi-status) treat "all failed" as terminal and "some failed" as a value, never the reverse. `subscription()` hanging forever and `request()` completing empty on total failure both violate this — a consumer coming from any of those ecosystems will not think to check for it. | LOW–MEDIUM | Already the recorded default in 999.20/999.21 ("error only once every relay has failed"). This is the single most load-bearing default in the whole milestone — get it right once, both phases inherit it. |
| Aggregate error carries per-relay causes, not a flattened string | `AggregateError.errors` (ES2021, `Promise.any`) is the language-level precedent: an ordered array of the individual rejection reasons, not a joined message. Every batch-API convention surveyed does the same (DynamoDB returns `UnprocessedKeys`, not "some keys failed"; HTTP 207 returns a per-item results array). A consumer's first instinct on catching a group error is to iterate causes per source. | LOW | `GroupAllRelaysFailedError` with `errors: Record<string, unknown>` (per ROADMAP) already matches this. Prefer a `Record<url, unknown>` over an array — Nostr relay identity is the URL, and a keyed record is what every result-map capability below also needs, so the vocabulary should be the same shape in both places. |
| Idle/silence timeout for anything that streams multiple values over time | RxJS's own `timeout()` operator ships exactly this distinction (`first` vs `each`) precisely because the two are conventionally different features, not variants of one. A consumer using an option literally named `timeout` on a subscription-shaped API defaults to expecting "if nothing happens for N ms" — that is the idle reading, not "time to first result." | LOW (once suspendable machinery exists) | Confirms ROADMAP's own conclusion ("idle is very likely the right answer"). The current relay-layer clock (`suspendableTimeout`'s first-progress-only mode) is the surprising one, not the target idle mode — this is a case where the codebase's existing convention was the deviation from the wider ecosystem's, not the other way round. |
| Partial fan-out results surface success and failure in the same value, keyed by source | DynamoDB `BatchGetItem`'s `UnprocessedKeys`, HTTP multi-status's `results` array, and `Promise.allSettled`'s `{status, value \| reason}` union are the three most common shapes and they all do this. A caller who gets `Record<url, RelayCountResponse>` today with one relay silently missing cannot distinguish "failed" from "hasn't answered yet" — every convention surveyed treats that ambiguity as a defect to fix, never as acceptable. | LOW–MEDIUM | This is 999.21's "open decision — how a failed relay appears in the record." Widening the value to `RelayCountResponse \| { error: unknown }` (candidate 2 in ROADMAP) is the convention-matching choice; omitting the key (candidate 1) is the one every surveyed convention treats as a known anti-pattern (see Anti-Features). |
| `count()`'s optional NIP-45 fields (`approximate`, `hll`) are typed and validated, not cast | The spec (quoted below) defines three fields; discarding two of them at the type boundary is not a convention any surveyed batch/count API follows — every one either validates the full response shape or documents which subset it drops and why. An unchecked `as` cast turning a malformed payload into a typed lie is the specific anti-pattern D-01 already names elsewhere in this milestone. | LOW | Matches 999.27's plan exactly: widen to `{ count; approximate?; hll? }` and validate. Table stakes because *any* cross-relay aggregate work (999.21) is blocked without it — this is a hard dependency, not a nice-to-have. |
| Negentropy sync reaches the wire for more than one round | This is not really a "convention" question — it's closing a shipped-but-inert code path (999.13/999.28: only the initial NEG-OPEN reaches the wire today). Every implementation surveyed (strfry, rust-nostr) treats multi-round reconciliation as the entire point of the protocol; a client that can only do one round cannot sync any dataset that doesn't already agree within one round's frame size. | HIGH | Table stakes in the sense that *nothing* downstream works without it, but it's the highest-complexity item in the milestone — see 999.28's own note that no current test exceeds the frame-size threshold. |

### Differentiators (Where Applesauce Can Do Better Than Convention)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Composable error conditions (`errorWhen`/`errorOnAny`/`errorOnAllRelaysFailed`) symmetric with completion conditions | RxJS itself has no first-class multi-source "error condition operator" convention — `forkJoin`/`combineLatest`/`merge` all hard-code "first error terminates" or "all inputs required," and web search turned up no widely-known library that exposes a *composable, caller-suppliable* error-decision operator the way `completeWhen` already does for completion in this codebase. This is a genuine gap in the RxJS ecosystem applesauce is positioned to fill, not a "make X like everyone else" feature. | MEDIUM | The value is specifically the *symmetry* with `completeWhen` — a consumer who already learned `completeOnAllEose`/`completeAfterFirstRelay` gets `errorOnAllRelaysFailed`/`errorAfterSilence` for free, one vocabulary for both axes. This differentiator is cheap only because 999.20 is explicit about reusing `complete-when.ts`'s `connect(shared$ => …)` shape rather than inventing new plumbing. |
| Timeout-as-a-condition, expressible in the same vocabulary as failure conditions | `errorOnAny(errorOnAllRelaysFailed(), errorAfterSilence(60_000))` reading as one composed policy is not how any surveyed library models timeouts — RxJS's `timeout()` is a separate operator from `catchError`/error-selection, Node's `AbortSignal.any()` composes *cancellation* sources but carries no "why" beyond "first reason wins" (see Pitfalls below), and HTTP clients with multi-endpoint fallback (undici, axios) treat per-request timeout and aggregate-failure as unrelated concerns. Collapsing both into one composable vocabulary is a real ergonomic win specific to this design. | MEDIUM–HIGH | Gated entirely on the "hard constraint" already flagged in 999.20: a time-based condition must stay suspendable across `AuthPhaseGate` phases, which means condition builders need access to context (`gate`) a pure `OperatorFunction<GroupReqMessage, unknown>` can't see. Option 1 in ROADMAP (context-aware factory) is the only one of the three that doesn't sacrifice suspendability or the exhaustive-union guardrail — treat it as effectively decided, not still open. |
| `hll` merge helper shipped alongside the raw registers | js-hll (Aggregate Knowledge) and the general-purpose `hyperloglog`/`hll` npm packages expose merge-then-estimate as a first-class API (`merge()` + `estimate()`/`cardinality()`), but none of them are NIP-45-shaped (single-byte registers, 256-register fixed size, no MurmurHash bucketing choice to make — the spec's offset/register scheme is bespoke and simpler than generic HLL libraries). No existing JS library reads/writes the NIP-45 hex format directly. Shipping raw-register access *and* a merge+estimate helper (not just one) is what every general-purpose HLL library in the wider ecosystem does — expose the primitive, then a convenience on top. | MEDIUM | Register merge is a single `for` loop doing register-wise max over the two hex strings (spec quote below) — genuinely low complexity once decoded to bytes. Cardinality estimation from a merged register set is the harmonic-mean HLL estimator, standard and well-documented, but is a second, separable piece of work from the merge itself and could ship later without blocking 999.21. |
| Widened `sync()` emission (`received`/`sent`/`send-failed`, plus a `relay-failed` arm at group level) reporting both directions honestly | No negentropy implementation surveyed (strfry, rust-nostr) documents a *typed progress union* for sync — CLI tools like `strfry sync` report human-readable log lines, and rust-nostr's SDK-level API is asked-and-answered rather than streaming both directions as typed events. A discriminated union that lets a consumer branch on `send-failed` without losing partial progress is ahead of what the wider negentropy tooling ecosystem currently exposes. | MEDIUM | Precedent already exists in-repo: `subscription()`'s `Observable<NostrEvent | "EOSE">` union. Low incremental design risk because the shape-of-shapes question is already answered by a sibling method; the work is applying it here, not inventing it. |

### Anti-Features (Commonly Tempting, Often Problematic)

| Feature | Why Tempting | Why Problematic | Alternative |
|---------|--------------|------------------|-------------|
| Omitting a failed relay's key from the progressive result record | Simplest to implement — just don't write the entry. | Every convention surveyed (DynamoDB, HTTP multi-status, `Promise.allSettled`) treats "missing means undetermined" as an information-loss bug: the consumer cannot tell "this relay failed" from "this relay hasn't answered yet, keep waiting." This is candidate 1 in 999.21's own open-decision list, flagged there for the same reason. | Widen the value type (`RelayCountResponse \| { error: unknown }`) so every known relay always has an entry once the operation settles for that relay. |
| A bare `Error("All relays failed")` (or `Error("Timeout has occurred")`, the current behavior) | Fastest to ship — no new error class, no per-relay bookkeeping. | Forces the consumer onto string-matching, the exact anti-pattern `AggregateError`/`RelayClosedError`'s auth subclasses exist in this codebase to avoid. A consumer cannot branch on "which relays" or "why" without parsing prose. | Typed aggregate error with `errors: Record<url, unknown>`, following the vocabulary the package already established for `RelayClosedError`'s subclasses. |
| Reusing `suspendableTimeout`'s first-progress-only mode as the new idle/silence clock, just renamed | Reuses existing, tested code with zero new logic. | It is a *different feature* wearing the requested name — WR-10 already flags this as "two different timeout semantics under similar names," and shipping it under `timeout` when the consumer expects idle re-arm (RxJS's `each`, not `first`) is a silent correctness regression for anyone who assumes a stream is dead only after N ms of *silence*, not N ms since the *first* event. | A genuinely idle-reset clock (`sync-loader.ts`'s `withTimeout` is the in-repo idle precedent) wired to the same `AuthPhaseGate` suspend/resume the first-progress clock already has. |
| Plain rxjs `timeout()` for the group operation clock | Standard, well-known operator; least code. | Cannot pause — the codebase has a standing, explicit warning against exactly this at the call site the current clock lives in, because a bare `timeout()` re-introduces the auth-phase clock race Phase 13 was built to remove. This is a closed defect class, not a hypothetical. | `suspendableTimeout` (or its idle-mode successor) driven by the same `AuthPhaseGate`, exposed as an error condition per the timeout-as-condition design. |
| Unwrapping `count()`'s return to a bare `number` | Simpler call-site type; matches naive expectations of "count returns a count." | A caller handed `93412452` with no `approximate` flag cannot tell an exact count from an estimate — silently degrading precision information the spec puts there on purpose. Also forecloses 999.21's merge work, since dropping `hll` at this layer makes it unrecoverable one level up. | Keep `RelayCountResponse` as the return shape (`{ count, approximate?, hll? }`), matching NIP-45 as quoted below. |
| Summing per-relay counts into a group total instead of merging via HLL | Looks like the obvious aggregate — "add the numbers." | NIP-45's own rationale (quoted below) is that HLL exists *specifically* because summing double-counts every event present on more than one relay — this is not a marginal error, it is the exact failure mode the spec's HLL section was written to prevent. | Register-wise max-merge across relays' `hll` fields, then estimate cardinality from the merged register set (algorithm below) — only fall back to summing `count` when no relay returned `hll`, and even then document that it's an upper bound, not a total. |
| Keeping the `await reconcile(...)` inside the negentropy round loop, "for safety" | Feels conservative — bounds concurrency implicitly by serializing everything. | This is the actual defect 999.28 diagnoses: it directly contradicts the spec's "in parallel with subsequent NEG-MSG messages" language (quoted below), and it is accidental backpressure, not a deliberate policy — removing it without adding *explicit* transfer-concurrency policy just moves the danger from "too slow" to "uncapped concurrent publishes." | Drop the `await`, but pair it with an explicit bounded `mergeMap`-style concurrency control on `sync()`, not silence on the question. |

## Feature Dependencies

```
[999.27: count() widened response type, validated { count, approximate?, hll? }]
    └──requires──> [999.21: group count() per-relay isolation + progressive record]
                       └──requires──> [HLL register merge algorithm]
                                          └──enables──> [cardinality estimate helper] (separable, can ship later)

[999.20: errorWhen/errorOnAny/errorOnAllRelaysFailed operator + GroupAllRelaysFailedError]
    └──requires──> [999.21's error condition for count()]  (999.21 explicitly reuses 999.20's vocabulary)
    └──requires──> [999.20's timeout-as-condition extension] (same clock, same phase)
                       └──requires──> [AuthPhaseGate-aware condition factory]  (existing infra; must not
                                        regress the closed suspendable-clock defect class)

[999.20/999.21's aggregate-error shape: Record<url, unknown>]
    ──shares vocabulary with──> [999.21's progressive result-map value: T | { error: unknown }]
        (both are "per-source outcome keyed by relay url" — should use ONE representation convention,
         not two, or a consumer has to learn the difference between an error-map entry and a result-map
         failure entry that mean the same thing)

[999.28: negentropy() emits per round, non-blocking]
    └──requires──> [dropping the await in the round loop]
                       └──requires──> [explicit transfer-concurrency policy on sync()]  (the await was
                                        accidental backpressure; removing it without this is a regression)
    └──requires──> [sync() operation clock: idle-reset, suspendable]  (999.13's closing note: this clock
                       does not exist on this path at all today)
    └──enables──> [SyncMessage union: received/sent/send-failed]
                       └──enables──> [RelayGroup.sync()'s relay-failed arm]  (open, not resolved in 999.28)
                       └──enables──> [RelayGroup.negentropy()'s reporting]  (open, not resolved in 999.28)
```

### Dependency Notes

- **999.21 depends on 999.27, not the reverse.** Once `Relay.count()` is the high-level member (retry/reconnect/timeout/throw-on-failure owned there), the group's per-relay isolation becomes the same `catchError`-per-relay wrap `internalPublish` already uses — ROADMAP is explicit that 999.21's mechanics should be decided *against that shape*, not against today's `combineLatest`.
- **The aggregate-error shape and the progressive-result-map failure shape should converge on one representation.** Both are "here is what happened per relay, keyed by url, for the relays that didn't succeed." If 999.20 ships `Record<url, unknown>` for causes and 999.21 independently ships `T | { error: unknown }` for a different reason, a consumer now has to learn two shapes for the same concept. This is a design cost not called out explicitly in ROADMAP and worth flagging to the requirements author.
- **The idle-timeout clock and the negentropy operation clock are the same mechanism, applied twice.** 999.20 builds it for `request()`/`subscription()`/`count()`; 999.28 explicitly says `sync()`'s clock "should be the suspendable, idle-resetting kind from 999.20 rather than a bare `timeout()`." Building it generically once (context-aware factory taking `{ gate }`) rather than per-family is the leverage point — get 999.20's factory shape right and 999.21/999.28 are consumers, not reimplementations.
- **Dropping negentropy's `await` and adding transfer concurrency are one unit of work, not two.** ROADMAP is explicit that shipping the first without the second converts a "too slow" defect into an "uncapped concurrent publishes" defect — they must land in the same phase/plan.

## MVP Definition (per capability, not a single product MVP — see note below)

This milestone is five internal-library capabilities inside one already-shipped package, not a
product surface with a single launch line. "MVP" here means: what must land for the capability to be
usable at all, versus what can trail as a fast-follow without leaving the capability half-built.

### Land With The Phase (non-optional within its own phase)

- [ ] 999.20: `errorWhen` operator, `errorOnAllRelaysFailed` default builder, `errorOnAny` composition, `GroupAllRelaysFailedError` with per-relay causes, and the AuthPhaseGate-aware timeout-as-condition (idle mode) — these are one coherent unit; shipping the error condition without the suspendable clock leaves `subscription()` still clockless.
- [ ] 999.21: per-relay isolation (`catchError`-per-relay against 999.27's shape) + progressive `scan`-based record accumulation — ROADMAP calls the progressive-record change "probably the larger practical win" over isolation alone; shipping isolation without it half-solves the "one sluggish relay delays everyone" defect.
- [ ] 999.27: widened `{ count, approximate?, hll? }` response with validation, configurable `timeout`/`reconnect`/`retries` — the type widening and the policy vocabulary are both required before 999.21 can consume this method's shape.
- [ ] 999.28: non-blocking per-round `negentropy()` emission, explicit transfer-concurrency policy on `sync()`, the `SyncMessage` union (`received`/`sent`/`send-failed`) — dropping the `await` without concurrency policy is explicitly called out as unsafe; ship them together.

### Fast-Follow (can trail without leaving the capability broken)

- [ ] HLL cardinality-estimate helper (`estimate(mergedRegisters)`) — the register-merge itself is core (it's what makes a correct group aggregate *constructible*), but a convenience estimator on top is separable; a consumer can merge registers and estimate cardinality with their own harmonic-mean implementation in the interim.
- [ ] `RelayGroup.sync()`'s `relay-failed` arm and `RelayGroup.negentropy()`'s reporting — 999.28 leaves these explicitly open/undesigned; the single-relay shape (`negentropy()`/`sync()`) is the dependency, not the reverse.
- [ ] Emitting `sent` on negentropy SEND success — ROADMAP records this as "recommended yes" but still an open question, not settled; it doesn't block the union shape itself.

### Explicitly Deferred (not this milestone, per ROADMAP's own scope notes)

- [ ] `req()` gaining an error condition — deliberately excluded; it already surfaces `{type:"ERROR"}` raw and is meant to stay the escape hatch.
- [ ] A low-level COUNT method extracted alongside the high-level `count()` — 999.27 ships none; only reconsidered if 999.21 finds it genuinely needs raw wire access.
- [ ] `RelayGroup.negentropy()`'s fitness to exist at all — flagged as possibly not deserving to exist (it's a group-level *low*-level method, which doesn't fit the layering rule), left for a future decision.

## Feature Prioritization Matrix

| Feature | Consumer Value | Implementation Cost | Priority |
|---------|-----------------|----------------------|----------|
| Group error condition + aggregate error (999.20) | HIGH — closes a silent-hang and a silent-empty-result trap, both live defects today | MEDIUM | P1 |
| Timeout-as-condition, idle-reset semantics (999.20 extension) | HIGH — WR-10 is a live behavioral divergence between two "same-named" clocks in the package today | MEDIUM–HIGH (auth-phase suspendability is the hard part) | P1 |
| Progressive per-relay result record (999.21) | HIGH — "one dead relay costs the whole group's number" is the sharpest currently-live defect surveyed | MEDIUM | P1 |
| NIP-45 `hll`/`approximate` typed + validated (999.27) | HIGH — blocks all correct cross-relay count aggregation; currently an unchecked cast | LOW–MEDIUM | P1 |
| HLL register merge helper | MEDIUM — the point of exposing `hll` at all; without it consumers must implement the merge themselves from raw hex | MEDIUM | P1 (merge) / P2 (estimator convenience) |
| Non-blocking multi-round negentropy (999.28) | HIGH — multi-round sync has never worked; this is not an enhancement, it's making a shipped-but-inert feature functional | HIGH | P1 |
| Explicit transfer-concurrency policy on `sync()` | HIGH — required companion to the above, not optional | MEDIUM | P1 |
| Typed `SyncMessage` union (`received`/`sent`/`send-failed`) | MEDIUM–HIGH — fixes an existing false-completion message ("Upload complete" printed on total send failure) | MEDIUM | P1 |
| `RelayGroup.sync()`/`negentropy()` group-level reporting | MEDIUM — same defect class as 999.20/999.21 but explicitly left open | MEDIUM–HIGH | P2 (deferred by ROADMAP) |
| `sent` emission on negentropy SEND success | LOW–MEDIUM — nice-to-have honesty improvement, not required for the union to be useful | LOW | P2 |

**Priority key:**
- P1: Required within its own phase per ROADMAP's own phase boundaries
- P2: Explicitly recorded in ROADMAP as open/deferred beyond this milestone's phases

## Outside-Convention Findings, By Capability

### 1. Caller-supplied error conditions on a fan-out group operation

- **`Promise.allSettled`** is the base-layer JS precedent for "don't let one failure destroy the batch": returns `{status: 'fulfilled', value} | {status: 'rejected', reason}` per input, never throws on partial failure. This is the shape 999.21's progressive-record decision is choosing between (candidates 1–3 in ROADMAP largely re-derive this same design space).
- **`Promise.any`/`AggregateError`** is the base-layer precedent for "raise once, but keep everything": `AggregateError.errors` is an ordered array of every rejection reason, in *input order*, not resolution order. Applesauce's proposed `Record<url, unknown>` is a reasonable, arguably better, elaboration for this domain specifically because relay identity (the URL) is meaningful and array position isn't — but it's a deliberate deviation from the language-level precedent's array shape, worth naming as a choice rather than assuming it's "the same as `AggregateError`."
- **`AbortSignal.any()`** composes multiple cancellation sources into one signal, but its "reason" semantics are notably weaker than what 999.20 is proposing: the combined signal's `reason` is simply whichever input signal aborted *first* — it does not carry a per-source record. This is a useful negative data point: **the DOM's own answer to "combine N signals, report why" throws away everything except the first cause.** 999.20's design (an aggregate carrying every cause) is deliberately richer than the platform-level precedent, not merely matching it — that is the right call for a debugging-oriented SDK, but the requirements author should know it's exceeding the closest formal spec analog, not just conforming to it.
- **HTTP multi-endpoint / batch API convention** (HTTP 207 Multi-Status, DynamoDB `BatchGetItem`'s `UnprocessedKeys`) converges on the same two-part shape every time: a per-item/per-key outcome record, and the batch operation itself only fails outright when *nothing* succeeded. This matches 999.20/999.21's "error only on total failure" default precisely.
- **Consumer branching expectation:** across every convention surveyed, a consumer expects to be able to (a) catch/observe one terminal signal for "totally failed," (b) enumerate per-source causes from that signal without re-deriving them, and (c) distinguish "this source failed" from "this source hasn't reported yet" in any partial-result view. All three map directly onto open decisions already flagged in ROADMAP (aggregate error shape, progressive record's failure representation).

### 2. Timeout-as-a-condition; first-progress vs. idle/silence

- RxJS's own `timeout()` operator is the clearest naming precedent available: it distinguishes `first` (timeout condition for the *first* emission after subscription) from `each` (timeout condition *between* emissions, effectively re-arming on every value). There is no third RxJS-documented `between` alias — `each` is the canonical name for the idle/silence mode.
- **Convention is not universal, but idle/silence is the majority default for anything called plain `timeout` on a long-lived stream.** Node's `http.Server`/`net.Socket` `timeout` events are idle timers (fire after N ms of *inactivity*, reset on data). Most HTTP client libraries' `timeout` option (fetch's `AbortSignal.timeout`, axios's `timeout`) is actually closer to a *total* or *first-response* timeout rather than idle — so the convention is genuinely split by domain: request/response libraries lean toward "time to first/only response," long-lived stream/socket libraries lean toward "idle." Given `subscription()`/`request()`/`count()` are stream-shaped, not request/response-shaped, the idle reading is the correct default for this specific domain — but it's a contested convention overall, not a universal one, and worth stating that way rather than as settled fact.
- **What breaks if the wrong one ships under the name `timeout`:** a consumer who assumes idle semantics (the stream-library convention) and gets first-progress semantics (today's behavior) will see their subscription die mid-stream after one early event, with no further activity required to trigger it — this is exactly WR-10's live divergence, already identified as a correctness bug wearing a naming problem.

### 3. Progressive / partial results from a fan-out

- `combineLatest`'s all-or-nothing gate ("no emission until every source has emitted at least once") is a well-known RxJS pitfall, not a design goal — it's documented as suited to "long-lived observables that rely on each other," not fan-out-and-report scenarios. `scan` (accumulate-and-emit-each-step) is the standard RxJS idiom for progressive accumulation over a fan-out, and is what a `mergeScan`-style "emit a growing record as each relay answers" implementation would use.
- Every non-RxJS convention surveyed (DynamoDB `UnprocessedKeys`, HTTP 207, `Promise.allSettled`) represents "this participant failed" as a **value inside the same result structure**, never as a side-channel, and never by omission. The recurring shape is a discriminated per-key value (`{status, value|reason}` or `T | {error}`), keyed by a stable participant identity — for applesauce that's the relay URL, which the codebase already uses as the record key elsewhere (`Record<string, RelayCountResponse>`).

### 4. NIP-45 COUNT with HyperLogLog

Quoted directly from the spec (fetched from `nostr-protocol/nips` `45.md`):

- Basic response: `["COUNT", <query_id>, {"count": <integer>}]`, optionally `{"count": <integer>, "approximate": <true|false>}` for probabilistic counting.
- HLL response: `["COUNT", <subscription_id>, {"count": <integer>, "hll": "<hex>"}]` — "The HLL value is a 512-character hex string representing 256 uint8 registers concatenated together. This enables clients to merge results from multiple relays for accurate aggregate estimates while conserving bandwidth."
- **Merge algorithm, verbatim intent:** "go through all the registers in HLL values from each relay and picking the highest value for each register, regardless of the relay." This is standard HLL register-merge (element-wise max across register arrays) — no relay-specific variant; the standard algorithm applies directly.
- **Offset computation** (for relays that want deterministic, cacheable HLL): derive an 8-bit offset from the filter's first tag attribute (32-byte hex → nibble at position 32 → base-16 value + 8), so a relay can cache/precompute HLL state without re-querying.
- **Why merge instead of sum**, in spec intent: summing per-relay counts double-counts events present on more than one relay; register-wise max-merge followed by a standard HLL cardinality estimator avoids that, because it's estimating the union of sets, not summing set sizes.
- **Existing JS implementations:** general-purpose HyperLogLog packages exist on npm (`hyperloglog`/Optimizely, `hyperloglog-lite`, `hll`, `js-hll`/Aggregate Knowledge), and they all expose `merge()` + estimate/cardinality as the standard API split — but **none found are NIP-45-shaped.** NIP-45's format (256 fixed single-byte registers, spec-defined offset derivation, no bucket-count negotiation) is simpler than general HLL libraries, which typically support configurable register counts and MurmurHash bucketing choices. A NIP-45-specific merge+estimate implementation is a small amount of new code, not a wrapper around an existing package — register-wise max over two 512-hex-char strings decoded to byte arrays, then a standard harmonic-mean cardinality estimator over the merged registers.
- **What a client library conventionally exposes:** every general-purpose HLL library surveyed exposes the raw register state (for merge/persistence) *and* a convenience estimate function — never one without the other. Applesauce should follow that split: raw `hll` string on `RelayCountResponse` (already 999.27's plan) plus a merge helper (999.21's stated "or offers a merge helper" open decision) — and the estimator convenience can trail (see MVP section).

### 5. NIP-77 negentropy — transfer timing and progress reporting

Quoted directly from the spec (fetched from `nostr-protocol/nips` `77.md`):

- "Given these IDs, the client can upload events it has with `EVENT`, and/or download events it needs with `REQ`. This can be performed over the same websocket connection **in parallel with subsequent `NEG-MSG` messages**." — this is the exact sentence 999.28 already cites; independently confirmed against the raw spec text, not paraphrased.
- Message shapes: `NEG-OPEN` (subscription id, filter, initial hex message), `NEG-MSG` (subscription id, hex message, alternating both directions), `NEG-CLOSE` (subscription id). The negotiation and the transfer are explicitly separate concerns in the protocol's own design — a client "may skip transfer entirely."
- **strfry** (the reference implementation and origin of the negentropy protocol): transfer is documented as external to the negentropy set-reconciliation protocol itself — negotiation determines *which* IDs differ, and "after the records that are missing have been determined, this information can be used to transfer the missing data items." This describes the same "reconcile per round, then act on that round's result" shape 999.28 is converging on — it does not describe waiting for the entire multi-round negotiation to finish before any transfer starts.
- **rust-nostr**: documented behavior emphasizes that negentropy "always makes progress in every message in either direction" (equal-sized buckets independent of timestamps) — consistent with per-round incremental resolution, matching 999.28's own finding that `lib/negentropy.ts`'s per-round `haveIds`/`needIds` are increments, not cumulative, so "each id is reported in exactly one round."
- **No implementation surveyed exposes a typed bidirectional progress union** the way 999.28 proposes (`received`/`sent`/`send-failed`, plus a group-level `relay-failed` arm). strfry's CLI reports human-readable log lines; rust-nostr's SDK-level surface is documented at the level of "sync completes," not a streaming discriminated union per event. This is squarely a differentiator, not a place where applesauce is behind convention — but it also means there's no existing library shape to benchmark the design against; it has to be judged on its own merits (does it compose with `RelayGroup`'s per-relay reporting needs, does it let a consumer distinguish "relay refused the send" from "relay never responded") rather than against a prior art baseline.

## Sources

- [RxJS `timeout` operator docs (first/each distinction)](https://rxjs.dev/api/operators/timeout) — HIGH confidence, official docs
- [MDN: `AggregateError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError) — HIGH confidence, official spec reference
- [MDN: `Promise.any()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/any) — HIGH confidence
- [MDN: `Promise.allSettled` usage / `AggregateError` shape discussion](https://dmitripavlutin.com/promise-all-settled/) — MEDIUM confidence, secondary source consistent with MDN
- [MDN: `AbortSignal.any()` static method](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static) — HIGH confidence, official docs
- [AWS docs: `BatchGetItem` / `UnprocessedKeys`](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html) — HIGH confidence, official AWS docs
- [HTTP 207 Multi-Status / bulk API partial success pattern discussion](https://oneuptime.com/blog/post/2026-02-02-rest-bulk-api-partial-success/view) — MEDIUM confidence, practitioner blog, consistent with widely-documented HTTP semantics
- [`js-hll` — Aggregate Knowledge JS HyperLogLog implementation](https://github.com/aggregateknowledge/js-hll) — MEDIUM confidence, general-purpose (not NIP-45-shaped)
- [`hyperloglog` npm package (Optimizely)](https://github.com/optimizely/hyperloglog) — MEDIUM confidence, general-purpose HLL reference for merge/estimate API split
- [NIP-45 spec, `nostr-protocol/nips` raw `45.md`](https://raw.githubusercontent.com/nostr-protocol/nips/master/45.md) — HIGH confidence, primary source, fetched directly
- [NIP-77 spec, `nostr-protocol/nips` raw `77.md`](https://raw.githubusercontent.com/nostr-protocol/nips/master/77.md) — HIGH confidence, primary source, fetched directly
- [strfry README — negentropy protocol description](https://github.com/hoytech/strfry/blob/master/README.md) — HIGH confidence, reference implementation's own docs
- [rust-nostr negentropy crate](https://github.com/rust-nostr/negentropy) and [rust-nostr sync docs](https://rust-nostr.org/sdk/client/req/sync.html) — MEDIUM-HIGH confidence, official project docs
- In-repo primary sources (HIGH confidence, read directly): `packages/relay/src/group.ts`, `packages/relay/src/relay.ts`, `packages/relay/src/types.ts`, `packages/relay/src/operators/complete-when.ts`
- `.planning/ROADMAP.md` backlog entries 999.20, 999.21, 999.27, 999.28 — the design analysis this file weighs outside convention against, per task instructions, not re-derived

---
*Feature research for: applesauce-relay v7.0.0 relay-method-layering — group error surface, timeout semantics, progressive results, NIP-45 HLL, NIP-77 negentropy transfer*
*Researched: 2026-08-19*
