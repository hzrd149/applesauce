# Architecture Research — v7.0.0 relay-method-layering

**Domain:** Re-layering the low/high method families of `applesauce-relay` (TypeScript reactive Nostr SDK, RxJS-based)
**Researched:** 2026-08-19
**Confidence:** HIGH — every claim below was checked against the actual source in `packages/relay/src/`, `packages/loaders/src/loaders/sync-loader.ts`, `packages/concord/src/`, `packages/wallet/src/`, and `apps/examples/src/`, not restated from ROADMAP.md without verification. Discrepancies between the roadmap's own citations and source are called out explicitly where found.

## System Overview

### The five method families and where policy sits today (verified)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Relay (packages/relay/src/relay.ts, 1828 lines)                         │
│                                                                            │
│  EVENT family        REQ family              AUTH family    COUNT family │
│  ─────────────       ──────────              ───────────    ─────────── │
│  event()  (low)      req()        (low)      auth()  (low)  count() only│
│    │ owns:              │ owns:                 │ correct       │       │
│    │  authRetry ✗       │  authRetry ✗           │ (single       │ owns: │
│    │  eventTimeout ✗    │  reconnect ✗           │  AUTH frame,  │ auth  │
│    │  (should be at     │  resubscribe ✗         │  correct low) │ retry,│
│    │   publish() only)  │  (should all be at     │               │ HARD- │
│    ▼                    │   request()/           ▼               │ CODED │
│  publish() (high)       │   subscription())    authenticate()    │ 10s   │
│    also owns authRetry  ▼                     (high, but owns    │ clock,│
│    AGAIN (duplicated)  request()/subscription()  NO policy today │ no    │
│    — 999.24 bug         (high) own NEITHER      — reads          │ opts  │
│                          reconnect NOR           this.challenge  │ vocab │
│                          resubscribe today       synchronously,  │       │
│                          (999.25 bug)            races a slow    │       │
│                                                   signer)         │       │
│                                                   — 999.26 bug    │       │
│                                                                            │
│  NEGENTROPY family                                                        │
│  ──────────────────                                                       │
│  negentropy() (low, but owns the auth retry loop today — belongs above    │
│    it once sync() exists as the true high-level owner)                    │
│  sync()  (high, but the multi-round follow-up NEG-MSG is *never sent* —   │
│    negentropy.ts:144-148 computes `newMsg` and drops it; only the first   │
│    NEG-OPEN ever reaches the wire — 999.13, absorbed into 999.28)         │
└──────────────────────────────────────────────────────────────────────────┘

RelayGroup (group.ts, 431 lines) — fans every method out across N relays.
  req()/event()/count()          → thin per-relay pass-through, no policy of its own
  request()/subscription()       → RE-IMPLEMENT the req()→request() wrapping
                                    themselves (own AuthPhaseGate, own
                                    completeWhen/suspendableTimeout call) rather
                                    than calling relay.request()/subscription(),
                                    because they need the raw RelayReqMessage
                                    stream across all relays, not one relay's
                                    unwrapped NostrEvent stream (see group.ts
                                    comments at :278 and :310)
  count()                        → combineLatest(): ONE relay erroring kills
                                    every relay's count (no isolation) — 999.21
  publish()                      → correctly wraps relay.publish() (isolated,
                                    errorToPublishResponse per relay) — the
                                    ALREADY-CORRECT precedent for what
                                    group.count() should become
  sync()/negentropy()            → drop failures to EMPTY / a bare `true`
                                    literal — undesigned, left open by 999.28

RelayPool (pool.ts, 264 lines) — pure delegation to .group(relays).<method>().
  Every option type on RelayPool methods is derived structurally via
  `Parameters<RelayGroup["x"]>[n]`, never hand-declared. This means the pool
  layer needs ZERO type edits for this whole milestone — it inherits every
  RelayGroup type change automatically. Verified: pool.ts has no local
  option-type declarations at all.
```

### The layering rule (999.23, amending D-01)

> **Low-level methods (`event()`, `req()`, `negentropy()`, `auth()`) are one interaction with the relay.** Send one frame, wait for its reply, throw on failure.
> **High-level methods (`publish()`, `request()`, `subscription()`, `sync()`, `authenticate()`) own the configurable policy**: retries, reconnects, auth retries, resubscribes, the operation clock, and (for `sync()`) transfer concurrency.
> **`count()` is the exception**: per 999.23's resolution, the family has only a high-level member — there is no separate low-level COUNT method, because the raw form has exactly one consumer in the repo (`RelayGroup.count()`) and no other caller needs single-attempt access.

This is a **relocation-of-ownership** refactor, not a rewrite of the underlying RxJS machinery. The shared operators (`authRetry`, `suspendableTimeout`, `AuthPhaseGate`) stay in `operators/auth-retry.ts`; what moves is which method's `.pipe(...)` invokes them.

## Component Responsibilities (verified against source)

| Component | File | Today's role | Role after re-layering |
|-----------|------|---------------|-------------------------|
| `Relay.event()` | `relay.ts:1186-1299` | Low-level name, but owns a full `authRetryOperator` retry loop (`:1283`) plus its own 10s timeout (`:1245-1258`) that manufactures a *value* instead of throwing | One EVENT write, one OK wait, throws `AuthRequiredError`/typed errors on failure. No retry loop, no auth-required value-signal round-trip |
| `Relay.publish()` | `relay.ts:1588-1623` | Calls `event()` (already the correct high→low pairing) but `event()`'s own duplicated retry loop means "max EVENT sends is `authRetries + 1`, independent of `retries`" (publish()'s own comment, `:1612-1615`, confirmed verbatim) | Sole owner of the auth retry loop, `customRetryOperator`, and `customSuspendableTimeoutOperator`. `event()` throwing is what it catches — legal under 999.23's retry-layer carve-out |
| `Relay.req()` | `relay.ts:919-1073` | Low-level name, but owns `authRetryOperator` (`:1064`), `customConnectionRetryOperator` for `reconnect` (`:1066`), and `customRepeatOperator` for `resubscribe` (`:1069`) | One REQ interaction cycle; sheds reconnect/resubscribe machinery upward |
| `Relay.request()` | `relay.ts:1556-1585` | Owns *only* the completion condition (`completeWhen`) and its own `suspendableTimeout` clock; owns no reconnect/resubscribe (both are silently `req()`'s today) | Becomes owner of reconnect + resubscribe machinery too |
| `Relay.subscription()` | `relay.ts:1542-1554` | Same gap as `request()`, plus it is long-lived (no natural end) — the hardest re-establish-loop design decision in the milestone | Owner of the re-establish loop for a persistent subscription — a structural rewrite, not a relocation, per 999.25's own text |
| `Relay.count()` | `relay.ts:1076-1183` | Low-level shape (named for the wire verb, `take(1)` on one frame) but already owns an auth retry loop and a **hardcoded 10s clock with no option field** (`relay.ts:1177`, `suspendableTimeout<RelayCountResponse>(10_000, gate, …)` — see line-number note below) | Becomes the family's *only* member; gains `reconnect`/`retries`/configurable `timeout` matching `PublishOptions`; response widens past `{count}` |
| `Relay.auth()` | `relay.ts:1302-1340` | Already correctly low: signs nothing itself, calls `event(event, "AUTH")` (`:1319`), records `authentications$` bookkeeping | Stays as-is; 999.26 explicitly protects this — `auth()` must keep calling `event()`, never `publish()`, or it recurses into 999.24's auth loop |
| `Relay.authenticate()` | `relay.ts:1429-1441` | High-level name but owns **no policy at all**: reads `this.challenge` synchronously (`:1430`), signs, calls `auth()`. No retry, no reconnect option, no options parameter of any kind exists on this method signature today | Becomes owner of challenge-acquisition-as-a-wait, freshness verification, and a bounded resign policy |
| `Relay.negentropy()` | `relay.ts:1343-1426` | Low-level name, owns the auth retry loop (`:1404`) — correct under the layering rule since `sync()` doesn't exist as negentropy's high-level owner in practice yet | Stays low; keeps owning the wire negotiation, but emits per-round instead of blocking |
| `Relay.sync()` | `relay.ts:1626-1723` | High-level name, but its SEND path calls `event()` **directly** (`:1677`) and its RECEIVE path calls `req()` **directly** (`:1689`) — both bypass their own high-level siblings entirely, and the `await reconcile()` inside `negentropySync` (`negentropy.ts:144-148`) serializes what NIP-77 explicitly permits in parallel | Owns auth (moved from `negentropy()`), an operation clock (none exists today), reconnect/`waitForReady`, and explicit bounded transfer concurrency |
| `RelayGroup.request()`/`.subscription()` | `group.ts:266-322` | No error condition at all; `request()` "completes empty" on total failure, `subscription()` hangs forever with no clock | Gains a caller-supplied error condition (999.20), defaulting to "every relay failed" raising an aggregate error |
| `RelayGroup.count()` | `group.ts:324-337` | `combineLatest()` — one relay's failure ends every relay's count; no progressive record | Per-relay isolation + progressive accumulation (999.21), depends on 999.27 |
| `RelayPool` | `pool.ts` (all 264 lines) | Zero local option types; every method's options type is `Parameters<RelayGroup["x"]>[n]` | No changes needed anywhere in this milestone — verified structurally, not asserted |

**Line-number correction against the roadmap's own citation.** ROADMAP.md's 999.20/999.21/999.27 entries cite `relay.ts:1175` for the count clock's hardcoded 10s value. On the actual source (re-read fresh for this research), line 1175 is inside the D-15 comment block; the literal `10_000` argument to `suspendableTimeout` is at **`relay.ts:1177`**. The claim itself ("hardcoded, no option to override") is correct — only the exact line number is off by two, almost certainly because the file gained two comment lines since that citation was recorded. Everything else checked (the `D-01` count of 14, `group.ts:177`/`:98-101`/`:284`/`:311`/`:330-336`, `relay.ts:1207-1221` (approximately — the `const control = defer(...)` statement itself starts at `:1212`, the range includes leading comment), `relay.ts:1429-1430`, `relay.ts:1607`, `operators/auth-retry.ts:366-371`, `types.ts:182-184`) matched source exactly.

## New vs. Modified Components

**New files (none exist yet; all proposed in backlog entries, not yet promoted to plans):**

| File | Introduced by | Purpose |
|------|----------------|---------|
| `operators/error-when.ts` | 999.20 | `errorWhen(operator)` — mirrors `complete-when.ts`'s `connect()` structure; the emitted value *is* the error to raise (deliberate asymmetry vs. `completeWhen`'s truthy-only check) |
| A `GroupRequestErrorOperator` type (`types.ts` or the new file) | 999.20 | `OperatorFunction<GroupReqMessage, unknown>` |
| `RelayGroup.errorOnAllRelaysFailed()` / `.errorOnAny(...)` | 999.20 | Default and composable error-condition builders, static on `RelayGroup` (mirrors `completeOnAllEose`/`completeOnAny`) |
| A `GroupAllRelaysFailedError` (or similarly named aggregate) class | 999.20 | Carries `errors: Record<string, unknown>` keyed by relay URL |
| An options type for `authenticate()` (no name settled yet — `RelayAuthenticateOptions` is a reasonable guess) | 999.26 | `authenticate()` currently takes **zero** options — `authenticate(signer: AuthSigner): Promise<PublishResponse>` at `relay.ts:1429` has no second parameter at all. Adding retry/reconnect vocabulary is a genuinely new type, not a modification |
| A `SyncMessage` discriminated union (`{type:"received"|"sent"|"send-failed"|...}`) | 999.28 | Replaces `Observable<NostrEvent>` as `sync()`'s emission type |

**Modified components (existing files/methods with confirmed edit sites):**

| File | Sections touched | By |
|------|-------------------|-----|
| `relay.ts` | `event()`, `publish()`, `auth()` (comment only) | 999.24 |
| `relay.ts` | `req()`, `request()`, `subscription()`, `sync()`'s RECEIVE path (rewire `req()` call → `request()`/`subscription()`) | 999.25 |
| `relay.ts` | `authenticate()` | 999.26 (subsuming 999.22's `defer()`-wrap fix) |
| `relay.ts` | `count()` | 999.27 |
| `relay.ts`, `negentropy.ts` | `negentropy()`, `sync()`'s SEND path (rewire `event()` call → `publish()`), `negentropySync`'s round loop | 999.28 (absorbing 999.13) |
| `group.ts` | `request()`, `subscription()` | 999.20, then 999.25 |
| `group.ts` | `count()` | 999.21 (depends on 999.27) |
| `group.ts` | `event()` (one-line signature via `Parameters<Relay["event"]>[2]`) | 999.24, incidentally |
| `types.ts` | `RelayEventOptions`, `PublishOptions` | 999.24 |
| `types.ts` | `RelayReqOptions`, `RelayRequestOptions`, `RelaySubscriptionOptions`, `GroupRequestOptions` | 999.25, 999.20 |
| `types.ts` | `RelayCountOptions`, `RelayCountResponse` | 999.27 |
| `types.ts` | `NegentropySyncOptions`, `RelaySyncOptions` | 999.28 |
| `operators/auth-retry.ts` | Possibly `suspendableTimeout`'s signature (999.20's Option 1: a `ctx: {gate}`-carrying factory instead of a bare operator, so time-based error conditions can suspend across an auth phase) | 999.20, then inherited by 999.25/999.27/999.28's call sites |
| `pool.ts` | **None** — verified structurally derived, zero edits needed | n/a |
| `13-CONTEXT.md` + 14 shipped-source `D-01` citations (`relay.ts` ×10, `operators/auth-retry.ts` ×3, `__tests__/relay.test.ts` ×1) | Comment text only | 999.23 |
| `apps/docs/loading/relays/relays.md` | The SEND-direction `.sync()` example (`complete: () => console.log("Upload complete")`) — confirmed present, will not type-check once `sync()` emits `SyncMessage` | 999.28 |

## Data Flow — the call graph (verified, file:line)

### EVENT family bypasses (the 999.24 problem)

```
auth()  (relay.ts:1302)  ──▶  event(event, "AUTH")  (relay.ts:1319)      [correct: low calls low]
publish() (relay.ts:1588) ──▶ event(event, "EVENT", {...})  (relay.ts:1594)  [correct PAIRING, but
                                                                              event() ALSO retries —
                                                                              duplicated policy, not a
                                                                              wrong caller]
sync() SEND (relay.ts:1626) ──▶ event(event, "EVENT", authOptions)  (relay.ts:1677)
                                  [BYPASSES publish() entirely — sync() gets only auth options
                                   threaded through, no retries/reconnect/timeout of its own on
                                   the SEND direction. Confirmed: this call site passes `authOptions`
                                   only, an object built at :1641-1646 containing exactly the four
                                   RelayAuthOptions fields.]
RelayGroup.event() (group.ts:234) ──▶ relay.event(event, "EVENT", opts)  (group.ts:235)
                                  [via internalPublish, which only adds per-relay catchError
                                   (errorToPublishResponse, group.ts:77-89) — becomes a raw,
                                   uncoordinated per-relay single attempt once event() stops
                                   retrying, while RelayGroup.publish() (group.ts:260-264) keeps
                                   full policy by wrapping relay.publish(). A real behavior
                                   change, flagged by the roadmap as "defensible and arguably
                                   clarifying" but breaking.]
```

### REQ family bypasses (the 999.25 problem)

```
subscription() (relay.ts:1542) ──▶ req(filters, {...opts, reconnect: ...})  (relay.ts:1543)  [correct pairing]
request()      (relay.ts:1557) ──▶ req(filters, {...opts, reconnect: ..., [AUTH_PHASE_GATE]: gate})  (relay.ts:1562)  [correct pairing]
sync() RECEIVE (relay.ts:1626) ──▶ req({ids: need}, authOptions)  (relay.ts:1689)
                                  [BYPASSES request()/subscription() — same shape as the SEND-side
                                   bypass above: only the four auth fields are threaded, no
                                   reconnect/resubscribe/timeout policy at all on this path today]
RelayGroup.req()          (group.ts:229) ──▶ relay.req(filters, opts)  (group.ts:230)  [thin — the
                                  deliberate REQ-family "escape hatch" per 999.20's own text: "req()
                                  is deliberately excluded — it already surfaces {type:"ERROR"} to
                                  the consumer and is the honest member of the family"]
RelayGroup.request()      (group.ts:267) ──▶ relay.req(filters, {...opts, reconnect: opts?.reconnect
                                  ?? relay.requestReconnect, [AUTH_PHASE_GATE]: gate})  (group.ts:280)
                                  [does NOT call relay.request() — re-implements the req()→request()
                                   wrapping itself (own completeWhen + suspendableTimeout below,
                                   group.ts:288-295) because it needs the raw RelayReqMessage shape
                                   fanned out across all relays, not one relay's unwrapped NostrEvent
                                   stream. Comment at group.ts:278 states this explicitly.]
RelayGroup.subscription()  (group.ts:308) ──▶ relay.req(filters, {...opts, reconnect: opts?.reconnect
                                  ?? relay.subscriptionReconnect})  (group.ts:311)  [same pattern]
```

### AUTH family — no group/pool surface exists

Verified by exhaustive grep: **zero** call sites of `.authenticate(` anywhere in `group.ts` or `pool.ts`. `authenticate()` today is a `Relay`-only method with no group or pool equivalent, and none of the recorded backlog entries (999.22, 999.26) propose adding one. This is a genuine, currently-unaddressed gap the roadmap does not flag — worth raising to the roadmapper as an open question (a caller wanting "authenticate this pubkey against every relay in the group" has no built-in primitive today, before or after this milestone).

### COUNT family — self-contained, no cross-family call-graph coupling

`RelayGroup.count()` (`group.ts:324-337`) is the only in-repo consumer of `Relay.count()`. `RelayPool.count()` (`pool.ts:241-249`) delegates straight through with `ignoreOffline` hardcoded `false` (`pool.ts:248`, confirmed). No other method family calls into `count()` and `count()` calls into none of them — this is why 999.27's file footprint (relay.ts's `count()` method + `types.ts`'s `RelayCountOptions`/`RelayCountResponse`) has zero overlap with the EVENT/REQ/AUTH re-layering work.

## Architectural Patterns

### Pattern 1: The `AUTH_PHASE_GATE` threading symbol

**What:** A module-private `Symbol` (`operators/auth-retry.ts:100`) that lets a high-level method construct one `AuthPhaseGate` and hand it *down* into the low-level method it drives internally, via a structural mixin type (`WithAuthPhaseGate`, `:103`) intersected into the low-level method's options — never appearing in any public option type.
**When to use:** Any time a high-level method's own operation clock (`suspendableTimeout`) needs to suspend across an auth phase that a low-level method it calls will itself trigger. Example: `request()` builds a `gate` (`relay.ts:1560`), threads it into `req()` via `[AUTH_PHASE_GATE]: gate` (`:1565`), then uses the same `gate` for its own `suspendableTimeout` (`:1575`).
**Trade-off:** Keeps the gate out of the public API surface (good — it's an implementation detail), but means every new high/low pairing that wants this suspension must repeat the same three-line pattern (build gate → thread down → consume in own clock). This is exactly the shape 999.24's EVENT re-layer and 999.28's negentropy re-layer both need to replicate.

**Example (verified, `relay.ts:1558-1566`):**
```typescript
const gate = new AuthPhaseGate();
const req = this.req(filters, { ...opts, reconnect: ..., [AUTH_PHASE_GATE]: gate });
return req.pipe(..., suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: isReqProgress }), ...);
```

### Pattern 2: Progress predicates are required, never defaulted (CR-01/WR-01 precedent)

**What:** Every consumer of `authRetry`/`suspendableTimeout` must supply an explicit `ProgressPredicate<T>` (`isProgress`/`firstWhen`) — there is no permissive default. `isReqProgress` (`relay.ts:195-197`) and `isGroupReqProgress` (`group.ts:64-67`) are the two concrete instances; both are **total** switches over their own union with no `as` cast, so a new arm added to `RelayReqMessage`/`GroupReqMessage` is a compile error at the predicate, not a silent "counts as progress" default.
**When to use:** Any new high-level method built during this milestone that wraps a stream with `authRetry` or `suspendableTimeout` (`count()`'s widened response, `sync()`'s new `SyncMessage` union) must define its own total predicate the same way — a `() => true` shortcut is only valid when the wrapped type truly carries no call-site bookkeeping value (as `event()`'s `PublishResponse` and `count()`'s `RelayCountResponse` legitimately do not).
**Trade-off:** More boilerplate per call site, but this is the exact defect class (CR-01/CR-02/CR-03, WR-01) that took three verification rounds to close in Phase 13 — PROJECT.md records this explicitly as a carry-forward risk for this milestone ("Re-verify them RED/GREEN rather than assuming a green suite means they survived").

### Pattern 3: Structural type mirroring across a deliberate no-dependency boundary (D-06)

**What:** `applesauce-loaders` declares **zero** dependency on `applesauce-relay` — verified via `package.json` (no entry in `dependencies` or `devDependencies`) — and instead hand-declares structurally-equivalent types in `sync-loader.ts`: `SyncAuthRequirement` mirrors `AuthRequirement`, `SyncAuthContext` mirrors `RelayAuthContext` (narrowed), `SyncAuthHandler` mirrors `RelayAuthHandler`, `SyncMethodOptions` mirrors the four `RelayAuthOptions` fields verbatim, and `RELAY_AUTH_ERROR_NAMES` (`sync-loader.ts:90`) duck-types the three terminal auth error classes' `.name` strings instead of importing the classes.
**When to use:** Only at this one deliberate package boundary — this is not a general pattern to replicate elsewhere in the monorepo. The docblocks at every mirror site say so explicitly ("Structurally matches applesauce-relay's ...", "D-06").
**Trade-off — the risk this milestone must manage:** because these are structural, not nominal, TypeScript will **not** raise a compile error in `applesauce-loaders` if `applesauce-relay`'s real types drift out of sync with the mirrors, *unless* the drift happens to make the loader's own code stop type-checking against its own mirror (which it won't, since the mirror is self-contained). See **Cross-Package Blast Radius** below for the concrete risk surface this creates for this specific milestone.

### Pattern 4: Throw-as-signal is a smell except at an aggregator/retry boundary (999.23's amended D-01)

**What:** The original D-01 banned throwing as an internal signal outright; 999.23 narrows it to a carve-out for exactly two roles: an aggregator over upstream calls (`RelayGroup.internalSubscription`'s `catchError` at `group.ts:177`, `RelayGroup.internalPublish`'s `errorToPublishResponse` at `group.ts:77-89`) or a retry layer over upstream calls (`customRetryOperator`/`customConnectionRetryOperator`, both skip-on-`RelayClosedError`).
**When to use:** `event()` throwing to `publish()` (one hop, `publish()`'s whole purpose is to catch) is now correct under the amendment. `req()` throwing to `request()`/`subscription()`/the group operators (many hops, intermediaries that do not want to catch) stays a smell — this is *why* `req()` keeps signalling `auth-required:` as a value rather than a throw, even after re-layering.
**Trade-off:** This is the one pattern in the milestone that is **pure documentation/comment work** with zero behavior change (999.23 itself), but it gates everything else — the four costs the original D-01 cited (special-casing `RelayClosedError`, `AuthRequiredError extends RelayClosedError` encoding routing, `count()` re-throwing someone else's signal, forced teardown-and-resubscribe) do not arise at a one-hop retry boundary, which is the structural reason `event()`→`publish()` and `count()` (single-hop, self-contained) are safe to leave as throws while `req()`'s multi-hop chain is not.

## Cross-Package Blast Radius

### `applesauce-loaders` — the structural-mirror risk (verified, most important finding)

**Confirmed: zero `applesauce-relay` dependency.** `packages/loaders/package.json` has no `applesauce-relay` entry in either `dependencies` or `devDependencies` (grep confirmed; the only `applesauce-relay` string in the whole `packages/loaders/src` tree is inside comments explaining the mirror, and one test file explaining why `applesauce-relay` is *not* imported).

**What is mirrored and what happens to each mirror under this milestone's changes:**

| Loaders mirror (`sync-loader.ts`) | Mirrors (relay's real type) | Does this milestone change the real type's shape? | Risk |
|---|---|---|---|
| `SyncAuthRequirement` (`:37`) | `AuthRequirement` (`types.ts:28`) | No entry proposes changing `AuthRequirement`'s `boolean \| string \| string[]` shape | None |
| `SyncMethodOptions` (`:131-139`) | `RelayAuthOptions`'s 4 fields (`types.ts:102-118`) | No entry proposes adding/removing fields from `RelayAuthOptions` itself — the re-layering moves *which parent type* carries those fields (e.g., off `RelayReqOptions`), not the field set | Low — the mirror only copies the 4-field shape, not the parent interfaces, so it is largely insulated from 999.24/999.25/999.27's parent-interface restructuring |
| `RELAY_AUTH_ERROR_NAMES` (`:90`) duck-typing `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError`'s `.name` | The three classes' pinned `.name` strings (`relay.ts:131-161`) | **999.26/999.22 discuss adding a new typed error** (a `MissingChallengeError`-shaped class, explicitly flagged as an open decision: "decide alongside 999.20's error type rather than separately") | **HIGH — this is the real silent-breakage surface.** If a new terminal auth error class is added and the loader's `RELAY_AUTH_ERROR_NAMES` set is not updated in the same change, `sync-loader.ts`'s `forceCloseAuthPhases()`/status-classification logic will silently treat the new error as a generic failure rather than an auth failure — no compile error, no test failure unless a loaders test specifically exercises the new class, because the check is a runtime string comparison against a hand-maintained `Set`. The relay-side comment at `relay.ts:139-143` already documents this as "load-bearing wire between packages" and instructs "renaming... requires updating that check in the same change" — the same discipline must extend to *adding* a class, which the comment does not currently say |
| `SyncLoaderRelay`/`SyncLoaderPool` (`:152-161`) | `Relay`/`RelayPool`'s method signatures (`request`, `getSupported`, `sync`) | **999.25 changes `request()`'s option type composition** (reconnect/resubscribe become directly declared instead of inherited) and **999.28 changes `sync()`'s return type** from `Observable<NostrEvent>` to `Observable<SyncMessage>` | **HIGH for `sync()` specifically.** `SyncLoaderRelay.sync()` is declared `sync(store, filter, direction?, opts?): Observable<NostrEvent>` (`:155`) — once the real `Relay.sync()` returns `Observable<SyncMessage>`, a real `Relay` **no longer structurally satisfies** `SyncLoaderRelay`, and `sync-loader.ts`'s own call site (`sync-loader.ts:307`, `pool.relay(relay).sync(eventStore, filter, undefined, opts)`) will emit `SyncMessage` values where the loader's pipeline still expects raw `NostrEvent` — this **will** surface as a TypeScript compile error in `applesauce-loaders` (a structural interface mismatch is still caught at the loader's own call site, even though the interface itself is hand-declared), so it is not silent, but it *is* a required coordinated edit that 999.28's plan must include explicitly: update `SyncLoaderRelay.sync()`'s return type and the `sync-loader.ts:307` call site's `.pipe(filter(...))` in the same change the roadmap already calls "one migration rather than two" for the six RECEIVE-only consumers |

### `applesauce-loaders`'s own diverged suspendable clock (see dedicated section below)

`sync-loader.ts`'s `withTimeout` (`:503-581`) independently reimplements the same "suspend across an auth phase" idea as `operators/auth-retry.ts`'s `suspendableTimeout`, and has **diverged in semantics**, not just implementation — confirmed by direct reading of both functions (see the dedicated section below).

### `applesauce-concord` — nominal imports, compiler-enforced, but no release gate

**Confirmed: real dependency**, `applesauce-relay: "^6.2.0"` in both `dependencies` and `devDependencies` (`packages/concord/package.json`). Unlike loaders, concord uses `import type { ... } from "applesauce-relay"` — **nominal**, not structural — across 7 files: `client.ts`, `types.ts`, `invite-watcher.ts`, `community.ts`, `invite-manager.ts`, `auth.ts`, `private-channel.ts`, `sync.ts`. Specifically:

- `community.ts:32` imports `PublishOptions` directly — under 999.24, if `PublishOptions`'s field set narrows or its semantics change, any call site in `community.ts` passing an incompatible shape fails to compile (safe — the compiler catches it, unlike loaders' duck-typed risk).
- `auth.ts:23` imports `RelayAuthHandler`, `RelayPool`, `RelayStatus`, and separately hand-writes `isOkResponse()` (`auth.ts:34-38`) to unify `Relay.authenticate()`'s real `Promise<PublishResponse>` return with `SyncAuthContext.relay.authenticate`'s looser `Promise<unknown>` — the roadmap's own 999.26 entry flags that concord's two handlers "differ in how they read the response (`isOkResponse(res) && res.ok` vs a bare `res.ok`)" and recommends reconciling this while re-layering `authenticate()`.
- Every other file imports only `RelayAuthHandler`/`RelayPool` (unaffected by this milestone's changes) or `RelayPool` alone (`private-channel.ts`, `sync.ts`).

**Because `applesauce-concord` is unreleased (`next`-tag snapshot only, confirmed by ROADMAP.md's own record and re-confirmed by the user 2026-08-19), no changeset is required for concord regardless of breakage.** But the workspace build gate (`pnpm run build`, 14/14 packages) still requires concord to compile — a `PublishOptions` or `authenticate()` signature change that concord doesn't adapt to will block the whole v7 build, not just concord's own release.

### `applesauce-wallet` — low risk, high-level-only consumer

**Confirmed:** `applesauce-relay` is a peer dependency (`^6.0.3`) and dev dependency (`^6.2.2`) in `packages/wallet/package.json`; this is the **only** package the roadmap's own v7-coordination note names as depending on `applesauce-relay` besides `applesauce-relay` itself and `applesauce-concord`. Verified call sites in `packages/wallet/src/wallet/*.ts`: `.subscription(...)` (`loading.ts:141`) and `.publish(...)` (`nut-wallet.ts:251,774,865,1076`, both direct `RelayGroup.publish` and `this.pool.publish`). **No direct `.event()`, `.req()`, `.count()`, or `.negentropy()` call sites found** — wallet exclusively uses the two already-correctly-paired high-level methods. Since 999.24/999.25/999.26 are additive-or-compatible at the `subscription()`/`publish()` call-site level (the option fields these call sites might pass — none were found passing `reconnect`/`resubscribe`/`retries` explicitly), wallet's blast radius is low. `RelayStatus` is imported as a type in `nut-wallet.ts`/`types.ts` and is unaffected by any entry in this milestone.

### `apps/examples` — source-compatible, but one docs snippet needs an update

111 files reference `applesauce-relay`. Concrete option usage found: `reconnect`/`resubscribe`/`waitForAuth`/`onAuthRequired` are passed to `.subscription()`, `.publish()`, and `.sync()` — all high-level methods — e.g. `apps/examples/src/examples/stream/viewer.tsx:259` passes `{ reconnect: true, resubscribe: true }` directly to `pool.subscription(...)`. Because 999.25's plan is to make `RelaySubscriptionOptions` **directly declare** `reconnect`/`resubscribe` rather than inherit them from `RelayReqOptions`, this call site keeps compiling unchanged — the type moves parent interfaces, but the field remains present on the interface the call site actually uses. **The one confirmed casualty:** `apps/docs/loading/relays/relays.md`'s SEND-direction snippet, `relay.sync(eventStore, { kinds: [1] }, SyncDirection.SEND).subscribe({ complete: () => console.log("Upload complete") })` — verified present verbatim — will not type-check once `sync()` returns `Observable<SyncMessage>` instead of `Observable<NostrEvent>`; per 999.28's own text this needs a `filter(...)` clause added, and this is a docs-source edit, not a `.d.ts` blast-radius concern.

## Suggested Build Order

The four recorded dependencies (999.23 gates all; 999.24 before 999.25; 999.27 before 999.21; 999.20 before 999.25) are all confirmed real by the call-graph and type-surface analysis above — none of them turned out to be spurious. Two additional dependencies emerged from source that the roadmap's own dependency list does **not** currently state:

1. **999.28 (negentropy) should serialize behind 999.24 and 999.25, not run parallel to them.** `Relay.sync()`'s SEND path calls `event()` directly (`relay.ts:1677`) and its RECEIVE path calls `req()` directly (`relay.ts:1689`) — both are exactly the bypasses 999.24 and 999.25 are re-layering. 999.28's own plan already intends to rewire these call sites to the high-level shape (implied by "sync() owns auth/clock/reconnect/transfer concurrency"); if 999.28 lands before or alongside 999.24/999.25, its rewiring of `sync()`'s internals gets written once against the *old* `event()`/`req()` shape and then has to be rewritten again once those methods change underneath it. Land it after.
2. **999.20 and 999.25 share more file surface than "the same clock"** — they both touch `group.ts`'s `request()`/`subscription()` method bodies directly (not just the AuthPhaseGate/suspendableTimeout call), and 999.20's own text raises a design fork (`ctx: {gate}`-carrying condition factories vs. widening `GroupReqMessage`) that constrains the shape `operators/auth-retry.ts`'s `suspendableTimeout` must have for 999.25's call sites too. This reinforces — does not merely repeat — the recorded "999.20 before 999.25" ordering: the file conflict is real, not just a risk-management preference.

### Waves

**Wave 0 — 999.23 (solo, blocking).** Comment/doc-only: amends D-01 across its 14 shipped citations (`relay.ts` ×10, `operators/auth-retry.ts` ×3, `__tests__/relay.test.ts` ×1) plus `13-CONTEXT.md`. Zero behavior risk, but nothing else should start until it lands, since every subsequent phase's plan text cites the amended rule.

**Wave 1 — three independent tracks, all depend only on Wave 0, no shared files between tracks:**

| Track | Entries | Files touched | Overlap with other Wave-1 tracks |
|---|---|---|---|
| A | 999.24 (EVENT) | `relay.ts` (`event()`/`publish()`/`auth()`), `types.ts` (`PublishOptions`/`RelayEventOptions`), `group.ts` (`event()` signature, one line) | None |
| B | 999.27 (COUNT) | `relay.ts` (`count()` only), `types.ts` (`RelayCountOptions`/`RelayCountResponse`) | None — verified `count()` has no call-graph coupling to any other family |
| C | 999.26 + 999.22 (AUTH, plan together per roadmap's explicit instruction) | `relay.ts` (`authenticate()`), a new options type | Light — only overlaps Track A if 999.26 chooses to literally reuse `PublishOptions`'s field names; recommend Track C pick its own type rather than block on Track A's completion, or sequence C to start once A's `PublishOptions` shape is stable if it wants field-for-field reuse |

**Wave 2 — sequenced, shared-file (`relay.ts` request/subscription section + `group.ts` request/subscription section + `operators/auth-retry.ts`):**

1. 999.20 (group error conditions) — depends on Wave 0 only; must resolve its `ctx`-carrying-gate design fork before 999.25 starts, since that fork shapes `suspendableTimeout`'s signature.
2. 999.25 (REQ re-layer) — depends on 999.24 (Wave 1 Track A, "pattern proven on the smaller surface") and 999.20 (immediately above). Largest, highest-risk single entry in the milestone (the roadmap's own words); do not parallelize anything else against `relay.ts`'s `req()`/`request()`/`subscription()` or `group.ts`'s same methods while this is in flight.

**Wave 3 — two entries, independent of each other, each depending on different earlier waves:**

- 999.21 (group count isolation) — depends on 999.27 (Wave 1 Track B) only; its files (`group.ts`'s `count()`, `pool.ts`'s `count()`) do not overlap `request()`/`subscription()`, so it can start as soon as Track B merges, in parallel with Wave 2.
- 999.28 (negentropy re-layer, absorbs 999.13) — depends on 999.24 and 999.25 both landing (the newly-identified dependency above), so it starts only after Wave 2 closes. Its own footprint (`negentropy.ts`'s protocol rewrite + `relay.ts`'s `negentropy()`/`sync()`) has no file overlap with 999.21, so the two Wave-3 entries can run concurrently with each other even though they start at different times relative to Wave 2.

**Sequencing summary:** `999.23 → {999.24 ∥ 999.27 ∥ 999.26+999.22} → 999.20 → 999.25 → {999.21 (needs only 999.27) ∥ 999.28 (needs 999.24+999.25)}`. Six of the eight backlog entries in this cluster (999.20, 999.21, 999.24, 999.26/999.22, 999.27, 999.28) can be organized into three real parallel tracks; only 999.25 and its Wave-2 predecessor 999.20 are forced into strict serialization by genuine shared-file conflict, not by caution.

## The Two Diverged Suspendable Clocks

Both implementations were read in full for this research; the divergence the roadmap describes is confirmed exactly:

- **`operators/auth-retry.ts`'s `suspendableTimeout`** (`:115-199`) is **first-progress-only**. Its `next` handler (`:172-176`): `if (!firstEmitted && opts.firstWhen(value)) { firstEmitted = true; clearTimer(); }` — once a value the predicate accepts as progress arrives, `firstEmitted` latches permanently `true` and the timer is cleared **forever**; no later `arm()` call can re-fire because `arm()` itself checks `if (settled || firstEmitted) return;` (`:148`). This is a "time-to-first-progress" budget.
- **`sync-loader.ts`'s `withTimeout`** (`:503-581`) is a **true idle/silence timer**. Its `next` handler (`:549-557`): every accepted emission does `remaining = timeoutMs; arm();` — the budget resets to its full value and re-arms on **every** progress emission, for the entire life of the stream. This is a "no progress for N ms" watchdog.

**D-06 forbids literally sharing this code across the package boundary** (`applesauce-loaders` must not depend on `applesauce-relay`). Architectural options that reconcile the *semantics* without sharing *code*:

1. **Pick one semantic as the applesauce-wide standard and change the other file to match it — behaviorally, not by import.** The roadmap's own 999.20 analysis already leans toward idle/silence being correct ("idle is very likely the right answer, and it is a behavior change either way"). If `suspendableTimeout` in `operators/auth-retry.ts` is changed to re-arm on every `firstWhen`-accepted value (matching `withTimeout`'s shape), the two files converge in *behavior* while remaining two independently-maintained, textually-unrelated implementations — satisfying D-06 by construction, since nothing is imported either direction. This is a **breaking behavioral change** to every existing `suspendableTimeout` consumer (`count()`, `request()`, `publish()`, `RelayGroup.request()`), so it should be decided exactly once — logically inside 999.20, since that is where the roadmap already opens the question — and then simply inherited by every later phase's own `suspendableTimeout` call site rather than re-litigated per phase.
2. **A shared behavioral test contract, not shared code.** Define a small table of RED/GREEN scenarios (e.g., "an emission at t=5s under a 10s budget → clock has 10s remaining, not zero") that both packages' own test suites independently assert against. This is exactly the "spec-derived assertion" discipline PROJECT.md already records as a hard-won lesson from v1.1/v1.2 ("Test-methodology finding" / "assert against a value derived independently"), applied here to a cross-package behavioral contract instead of a cross-implementation spec. A future edit that silently reverts one file to the other's semantics fails its own package's suite rather than being caught only by a human diffing two files.
3. **Do not build a shared types/interface package for this.** A tiny internal `@applesauce/timing-contract` package (or similar) would technically avoid a *runtime* dependency from `loaders` on `relay`, but it reintroduces the exact cross-package coupling D-06 exists to avoid, for one non-exported internal helper function. Not recommended.
4. **Cheapest immediate fix, independent of the semantic decision above: cross-referencing comments.** Neither file's docblock currently points at the other (999.18's WR-10 flags this explicitly, and it was independently confirmed by reading both files for this research — `operators/auth-retry.ts`'s `suspendableTimeout` docblock at `:105-114` says nothing about `sync-loader.ts`, and `sync-loader.ts`'s `withTimeout` at `:503` has no comment at all pointing back). This is a two-line comment addition in each file, zero behavior risk, and should land in the 999.23 wave (comment-only, already in flight) or as a standalone one-line gap-closure task ahead of 999.25, rather than waiting for the semantic decision to be made.

## Anti-Patterns Observed in the Current Code (worth calling out explicitly to the roadmapper)

### Anti-Pattern 1: A high-level method's own multi-hop call bypasses its sibling high-level methods

**What happens:** `Relay.sync()` — itself the high-level member of the negentropy family — calls the *low-level* `event()` and `req()` directly instead of the *high-level* `publish()`/`request()`/`subscription()`, forfeiting all of their policy on the way (`relay.ts:1677`, `:1689`).
**Why it's wrong:** It means one high-level method's internal plumbing silently loses the policy guarantees another high-level method exists to provide — a caller who trusts "high-level methods own retries" is wrong specifically about `sync()`'s SEND/RECEIVE legs today.
**Do this instead:** Once 999.24/999.25 land, `sync()` should call `publish()`/`request()`-or-`subscription()` for its two legs, or explicitly document (and test) why it cannot and must own an equivalent policy itself — the roadmap's 999.28 entry already leans toward the latter (`sync()` owning its own bounded transfer concurrency), which is a legitimate exception but should be a stated design decision, not an accident of what `event()`/`req()` happened to be convenient to call.

### Anti-Pattern 2: An unconfigurable hardcoded operation clock

**What happens:** `count()`'s 10s timeout (`relay.ts:1177`) has no options-object escape hatch at all — every other operation clock in the package (`eventTimeout`, `publishTimeout`, `request()`'s `opts?.timeout ?? 30_000`) is either a constructor option or a per-call option; `count()`'s is neither.
**Why it's wrong:** A caller with a slow relay or a deliberately long `authTimeout` cannot avoid `count()` racing its own auth wait against an immovable 10s ceiling.
**Do this instead:** 999.27 already fixes this by folding the constant into `opts.timeout` — flagged here only to confirm the roadmap's characterization is accurate and to note it is the *only* such unconfigurable clock found in the file during this research (every other timeout site was checked and does expose an option).

### Anti-Pattern 3: Structural type mirrors across a package boundary without a change-coordination mechanism

**What happens:** `applesauce-loaders`'s structural mirrors of `applesauce-relay`'s auth types are correct today but have no enforcement mechanism beyond a human-written comment ("a rename... must update this set in the same change") — there is no lint rule, no shared fixture, no CI check that fails when the two drift.
**Why it's wrong:** It is precisely the failure mode PROJECT.md's own retrospectives repeatedly flag across this codebase's history — "a correct helper that exists but is never called," "a comment describing an invariant was false," "the guard was defaulted to permit" — applied here to a cross-package type contract instead of a single-file invariant.
**Do this instead:** At minimum, this milestone's plans for 999.24/999.25/999.26/999.28 should each include an explicit checklist item — "does this change any of the 6 mirrored shapes/names in `sync-loader.ts`? If yes, update them in the same plan" — rather than relying on a future reader noticing the drift. This research did not find a drift *yet* (the loaders mirrors are accurate as of this reading), but the milestone is exactly the kind of change most likely to introduce one, particularly if a new terminal auth error class is added under 999.26/999.22's open "typed `MissingChallengeError`" question.

## Sources

All findings verified by direct reading of, and `grep`/`wc` cross-checks against, the following files on the `feat/relay-auth-rework` branch at the time of this research (2026-08-19):

- `packages/relay/src/relay.ts` (1828 lines, read in full)
- `packages/relay/src/group.ts` (431 lines, read in full)
- `packages/relay/src/pool.ts` (264 lines, read in full)
- `packages/relay/src/negentropy.ts` (166 lines, read in full)
- `packages/relay/src/types.ts` (270 lines, read in full)
- `packages/relay/src/operators/auth-retry.ts` (386 lines, read in full)
- `packages/relay/src/operators/complete-when.ts` (20 lines, read in full)
- `packages/relay/src/operators/index.ts` (barrel export, confirms `auth-retry.ts`/`complete-when.ts` are deliberately not public)
- `packages/loaders/src/loaders/sync-loader.ts` (lines 1-230 and 362-592 read; `withTimeout` at `:503-581` read in full)
- `packages/loaders/package.json` (confirms zero `applesauce-relay` dependency)
- `packages/concord/package.json`, `packages/concord/src/client/auth.ts`, `packages/concord/src/client/community.ts`, and grep across all `packages/concord/src/**/*.ts` for `applesauce-relay` imports
- `packages/wallet/package.json` and grep across `packages/wallet/src/wallet/*.ts` for relay method call sites
- `apps/examples/src/**` grep for `reconnect:`/`resubscribe:`/`waitForAuth:`/`.sync(` usage, plus `apps/examples/src/examples/stream/viewer.tsx:250-262` read directly
- `apps/docs/loading/relays/relays.md:350-375` read directly
- `.planning/PROJECT.md` (Current Milestone section, Key Decisions, Context)
- `.planning/ROADMAP.md` (Backlog entries 999.13, 999.14, 999.16, 999.18, 999.19, 999.20, 999.21, 999.22, 999.23, 999.24, 999.25, 999.26, 999.27, 999.28 — every file:line citation in these entries that this research could check against source was checked; the one discrepancy found is documented above)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md` (baseline system map, dated 2026-07-09, predates this milestone's scoping)

---
*Architecture research for: applesauce v7.0.0 relay-method-layering milestone*
*Researched: 2026-08-19*
