# Phase 15: Concord Stream-Auth Cleanup - Research

**Researched:** 2026-08-13
**Domain:** Internal API migration — replacing client-wide ambient NIP-42 auth with operation-scoped `onAuthRequired` handlers, inside an already-shipped `applesauce-relay`/`applesauce-loaders` auth API (Phase 13/14)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Auth is reactive everywhere, with no proactive machinery left in concord.** Every operation — sync, live subscription, and all 13 publishes — passes `waitForAuth` + `onAuthRequired` and authenticates only when a relay actually refuses it. After this phase, nothing in concord subscribes to `relay.challenge$` or `pool.status$` to drive an AUTH.
- **D-02: The handler body is the whole mechanism** — `missingPubkeys` from the relay is already the operation-scoped filter; a scope-level signer map intersected with it is already operation-scoped. No per-operation key-set threading needed.
- **D-03: Reconnect re-auth rides `authRetryOperator` — concord adds nothing.** Verified by trace through `relay.ts`/`auth-retry.ts`; CAUTH-02's reconnect clause is a test assertion, not a mechanism to build.
- **D-04: An idle scope re-authenticates nothing on reconnect, by design.** Accepted as correct under demand-driven auth (behavior change from the old driver).
- **D-05: `authRetries` stays at default `1`; `authTimeout` stays at default `30_000`.**
- **D-06: A new scope-owned signer holder, instantiated per community and per private channel.** `ConcordRelayAuth` is deleted outright — `registry`, `version$`, `drivers`, the refcounted `Driver` interface, `authenticateStreamKeys`, `registerStreamKeys`, `streamSigners`, `streamPubkeys`, `autoAuthenticate`, `connected$`, `authenticated$`, and both duplicated `ensureAuth` bodies go with it.
- **D-07: The scope's signer map accumulates within the scope** (not client-wide append-only). A historical epoch re-walk still needs old keys; invisible at the wire under `missingPubkeys`.
- **D-08: The user-auth handler is one client-wide thing, built once from the user's signer.** One logged-in identity — no churn to remove. This is the one thing that stays client-wide.
- **D-09: The user handler stays separate from the stream handler.** Different latency/consequences (in-memory `PrivateKeySigner` vs. possibly-prompting user signer). `invite-watcher.ts` takes only the user handler.
- **D-10: `authenticated$` is removed.** Removes `ConcordCommunity.authenticated$`, `ConcordPrivateChannel.authenticated$`, the `authenticated` field from `ConcordCommunityStatus`/`ConcordPrivateChannelStatus`, and the `authenticated` leg of the `status$` composite. Marked revisitable, not permanently rejected.
- **D-11: The old `authenticated$` definition breaks under per-operation auth in two independent ways** — cross-scope bleed via shared relay-wide flags, and an unsatisfiable all-of check over `currentAuthors()`.
- **D-12: `connected$` survives, inlined on each engine** (~6 lines each, including `lookupStatus`).
- **D-13: An auth failure folds into the existing `error$`** (`community.ts:247`, already `BehaviorSubject<string | null>`). No new status surface.
- **D-14: Neither concord path dies on a single relay's auth failure — already true upstream, must not regress** (`RelayGroup.internalSubscription`'s per-relay `catchError`, `syncAuthors`' completed-or-errored gate).
- **D-15: All 13 `pool.publish` call sites get `waitForAuth` + `onAuthRequired`.**
- **D-16: Each publish waits on its own event's author — `waitForAuth: [event.pubkey]`.** A concord wrap is signed by the stream secret key (`operations/gift-wrap.ts:81-89`), not the user — that's the key a gating relay checks.
- **D-17: 11 of 13 publishes resolve from an in-memory key** (stream `sk`, invite-link `sk`, NIP-59 ephemeral) and can never prompt. Only `invite-manager.ts:297` and `client.ts:1287` sign with the user's signer, and neither is in a loop.
- **D-18: No dedupe of concurrent AUTHs anywhere.** Deliberate reversal of the refcounted driver's rationale — priced against a whole-registry AUTH, not against one key.

**One deliberate widening (D-06/D-13 area, captured in `<domain>`):** the phase covers **user-key** authentication as well as stream-key authentication — `autoAuthenticate` and the invite watcher's two flag readers die with the rest. `REQUIREMENTS.md` CAUTH-03 and `ROADMAP.md` Phase 15 success criterion 3 need amending to name `autoAuthenticate` and the invite watcher's two flag readers explicitly.

**Not this phase:** any change to `applesauce-relay` or `applesauce-loaders` (pure consumer). No relay-internal dedupe (RAUTH-05 forbids it). No new proactive/ambient auth of any kind. No concord changesets (unreleased).

### Claude's Discretion

- Naming and file placement of the scope-owned signer holder (D-06), and its exact API for registering keys as epochs advance and channels are revealed.
- Whether `connected$`'s `lookupStatus` normalization is duplicated per engine or extracted to a free function (D-12) — mechanical either way.
- The wording and granularity of the `error$` message written on auth failure (D-13).
- How the two user-signed publishes (D-17) receive the client-wide user handler — constructor injection vs. threading through options.

### Deferred Ideas (OUT OF SCOPE)

- A standing "am I authenticated" surface for UI — declined as premature, not wrong.
- Relay-side prompt/AUTH dedupe — declined at three levels (RAUTH-05, REQUIREMENTS.md Out of Scope, D-18).
- Value-signalling the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — carried forward unchanged from Phases 13/14, untouched here.
- `05.1-review-followups.md` — reviewed, not folded (unrelated content).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAUTH-01 | Each community/private-channel engine authenticates only the `waitForAuth` pubkeys its own operation is missing, using keys held by that scope | Confirmed the relay-provided `missingPubkeys` (computed server-side from the operation's own `waitForAuth`) is the exact scoping filter D-02 relies on — see "The Phase 13 API Surface" below. Confirmed every read site already passes a correctly-scoped `waitForAuth`. |
| CAUTH-02 | A relay is asked to authenticate only the stream keys operations using it require, and a reconnect re-authenticates only that same scoped set | Traced `authRetry`'s `defer`-scoped `consecutive` counter and `resetState()`'s clearing of `authentications$` (which backs `authenticatedPubkeys`) — confirms D-03's "reconnect = fresh auth budget, no concord mechanism needed" claim. See "Retry-Behavior Parity" and "Validation Architecture" below for the no-committed-before-recording oracle. |
| CAUTH-03 | `authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, and relay-status-driven stream auth are removed or narrowed to zero call sites | Full call-site inventory below — includes two site classes CONTEXT.md's canonical_refs did NOT enumerate: `apps/examples/` direct consumers of `ConcordRelayAuth`, and `client.ts`'s `ConcordClientStatus.authenticated` aggregation over child `.authenticated` fields. |
| CAUTH-04 | Per-operation auth retries are preserved through the migration | `authRetries` default `1` / `authTimeout` default `30_000` confirmed unchanged upstream (Phase 13); D-05 keeps concord's call sites on those defaults. See "Retry-Behavior Parity" below. |
</phase_requirements>

## Summary

This is a pure internal migration inside `packages/concord/` — no new dependencies, no new packages, no changes to `applesauce-relay` or `applesauce-loaders`. Phase 13 already shipped the target API (`onAuthRequired`/`waitForAuth`/`authTimeout`/`authRetries` on every relay-level operation, including both the paginated REQ path and the negentropy sync path via `SyncLoadRequest`), and Phase 14 added the debug-logging namespace around it. This phase's job is entirely subtractive-and-rewiring: delete `ConcordRelayAuth` (`relay-auth.ts`, the whole file) and every one of its call sites, replace it with a small per-scope in-memory signer holder whose keys get intersected against the relay-supplied `missingPubkeys` inside an `onAuthRequired` handler passed to every read/sync/publish call, and remove the `authenticated$`/`authenticated` status surface it drove.

CONTEXT.md already did exceptionally deep tracing (line-number-precise) of the in-package call sites, the upstream retry mechanism, and the publish-site key ownership. This research's incremental contribution is threefold: (1) verifying every one of those line-number citations against the current source (all confirmed accurate, some drifted by 1-2 lines from formatting but structurally identical), (2) two call-site classes CONTEXT.md's `<canonical_refs>` section did not enumerate — `apps/examples/` direct API consumers and `client.ts`'s `ConcordClientStatus.authenticated` aggregation — both of which will fail to compile once `ConcordRelayAuth`/`ConcordCommunityStatus.authenticated` are removed, and (3) a concrete Validation Architecture mapping each requirement to a test, including the design-derived (not before/after) oracle CAUTH-02 needs.

**Primary recommendation:** Delete `relay-auth.ts` outright; give each `ConcordCommunity`/`ConcordPrivateChannel` a small internal `Map<string, ISigner>` (or equivalent) that grows via the existing `registerStreamKeys`-shaped call sites (renamed), and pass one `onAuthRequired` closure — `for (const pk of missingPubkeys ?? []) { const signer = map.get(pk); if (signer) await relay.authenticate(signer); }` — as `waitForAuth`/`onAuthRequired` on every read, sync, and publish call in that scope. Build the client-wide user handler once in `ConcordClient`'s (and `InviteWatcher`'s own, separately per D-09) constructor from `this.signer`. Update `apps/examples/` and `client.ts`'s status aggregation as part of the same migration — they are real call sites, not out-of-scope consumers.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| NIP-42 challenge/response wire mechanics (AUTH event, `authenticatedPubkeys`, retry/timeout budget) | `applesauce-relay` (library) | — | Already owns this since Phase 13; this phase is a read-only consumer (per canonical_refs, do not modify) |
| Deciding *which* pubkeys need authenticating for one operation | `applesauce-relay` (library, via `missingPubkeys`) | Concord engine (the `onAuthRequired` handler intersects the relay's answer against its own held signers) | The relay already narrows to the operation's own `waitForAuth` set; concord only needs to look up signers for the pubkeys named, never compute the "missing" set itself |
| Holding stream secret keys and resolving pubkey → signer | Concord engine (`ConcordCommunity`/`ConcordPrivateChannel`, scope-owned) | — | D-06/D-07: keys accumulate per scope, not client-wide; this is the entire replacement for `ConcordRelayAuth.registry` |
| Holding the user's signer for user-authored publishes/reads | `ConcordClient` (client-wide) + `InviteWatcher` (its own copy, per D-09) | — | One logged-in identity — no per-scope duplication needed; the two engines that need it get separate instances because their latency/consequence profile differs |
| Surfacing connection/error state to UI | Concord engine `status$`/`error$`/`connected$` (each engine, inlined) | — | D-10/D-12/D-13: `authenticated$` is removed entirely; `connected$` is engine-local; auth failure folds into `error$` |
| Auth event lifecycle observability (challenge received / AUTH sent / result) | `applesauce-loaders`/`applesauce-relay`'s `:auth` debug namespace (Phase 14) | — | Concord's own `logger.extend("auth")` in `relay-auth.ts` is deleted with the file; whatever replaces it (if anything) should not re-derive a logger per call (SEED-001) |

## Standard Stack

No new packages. This phase touches only `packages/concord/` internals and its own example apps; it consumes the already-installed `applesauce-relay`, `applesauce-loaders`, `applesauce-signers`, and `rxjs` exactly as they are used today. **No `npm install` / Package Legitimacy Audit is applicable to this phase.**

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A scope-owned plain object/Map for the signer holder (D-06's chosen shape) | Keep `ConcordRelayAuth`'s class shape, scope-instantiated | Rejected in discussion — the class's *value* was its client-wide registry + driver machinery, both being deleted; a scope-instantiated version would just be a Map wearing a class, discussed and explicitly not selected (`15-DISCUSSION-LOG.md` "Where scoped signers live") |
| One handler branching on `missingPubkeys === null` (user) vs. an array (stream) | Two separate handlers (D-09's chosen shape) | Rejected — the "one holder" option was the *recommended* option in discussion and the user explicitly went against it for the latency/consequence reason; do not re-litigate this in planning |

## Package Legitimacy Audit

Not applicable — no external packages are installed by this phase.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │  ConcordCommunity / ConcordPrivateChannel │
                    │                                            │
  registerStreamKeys│  ┌──────────────────────────────────┐    │
  (sync.ts,         │  │  scope-owned signer holder (D-06)  │    │
  channel-sync.ts,  ├─▶│  Map<pubkey, PrivateKeySigner>      │    │
  openLive)          │  │  (accumulates within scope, D-07)  │    │
                    │  └──────────────┬───────────────────┘    │
                    │                 │ .get(pk) lookups         │
                    │                 ▼                          │
                    │  onAuthRequired: ({missingPubkeys}) => {   │
                    │    for (pk of missingPubkeys ?? [])        │
                    │      signer = holder.get(pk)               │
                    │      if (signer) relay.authenticate(signer)│
                    │  }                                          │
                    └────────┬──────────────────┬────────────────┘
                             │ passed as opts    │ passed as opts
                             ▼                   ▼
                 pool.subscription(...,   loader({...,          pool.publish(relays,
                 {waitForAuth, onAuth-    waitForAuth,           event, {waitForAuth:
                 Required})   (live sub)  onAuthRequired,        [event.pubkey],
                              (openLive)  authTimeout,           onAuthRequired})
                                          authRetries})            (13 sites, D-15/16)
                              (syncAuthors → createSyncLoader)
                                     │
                                     ▼
                    ┌──────────────────────────────────────────┐
                    │  applesauce-relay: authRetryOperator        │
                    │  (relay.ts / auth-retry.ts — READ ONLY)     │
                    │  - computes missingPubkeys from waitForAuth │
                    │  - invokes onAuthRequired on auth-required: │
                    │  - retries per authRetries/authTimeout      │
                    │  - resetState() clears auth on disconnect   │
                    │    → reconnect gets a fresh auth budget      │
                    │    (D-03, no concord mechanism needed)       │
                    └──────────────────────────────────────────┘

  Separately, client-wide (D-08/D-09):
  ConcordClient / InviteWatcher  ──▶  own onAuthRequired built once
  from `this.signer`, used only on user-authored operations
  (invite-manager.ts:297, client.ts:1287, invite-watcher's inbox reads)
```

### Recommended Project Structure

No new files/folders required beyond what CONTEXT.md's canonical_refs already scope. `relay-auth.ts` is deleted; its replacement (the scope-owned signer holder) is Claude's discretion for naming/placement per the Deferred/Discretion section — a reasonable default is a small internal type/class colocated in each engine's own file (`community.ts`, `private-channel.ts`) or a shared tiny module (e.g. `helpers/stream-signers.ts`) if the two engines' bodies would otherwise duplicate more than a few lines.

```
packages/concord/src/client/
├── community.ts         # scope-owned signer holder + onAuthRequired handler (was relayAuth field)
├── private-channel.ts   # same, mirrored (was relayAuth option)
├── sync.ts               # SyncContext drops relayAuth/ensureAuth; syncAuthors adds onAuthRequired
├── channel-sync.ts       # same pattern for private-channel sync walk
├── invite-watcher.ts     # separate user-only onAuthRequired (D-09); loses autoAuthenticate/ConcordRelayAuth
├── client.ts             # client-wide user onAuthRequired built once; status$ aggregation drops .authenticated
├── invite-manager.ts     # two user-signed publishes get the client-wide user handler
└── relay-auth.ts         # DELETED (D-06)
```

### Pattern 1: Operation-scoped auth handler (D-02)

**What:** A closure over the scope's own signer map, passed as `onAuthRequired` to every operation that scope issues. It never inspects client-wide state and never runs proactively.
**When to use:** Every read (`pool.subscription`/`pool.request`), sync (`createSyncLoader`'s `SyncLoadRequest`), and publish (`pool.publish`) call site owned by a community or private-channel engine.
**Example:**
```typescript
// Source: 15-CONTEXT.md D-02, cross-checked against packages/relay/src/types.ts's
// RelayAuthContext (missingPubkeys: string[] | null — null only when waitForAuth is `true`)
onAuthRequired: async ({ relay, missingPubkeys }) => {
  for (const pk of missingPubkeys ?? []) {
    const signer = signers.get(pk);
    if (signer) await relay.authenticate(signer);
  }
};
```
Because every concord call site already passes a specific `waitForAuth` (an array of authors, or `[event.pubkey]` for publishes — never bare `true`), `missingPubkeys` is never `null` in concord's own call sites; the `?? []` guard is defensive, not load-bearing.

### Pattern 2: Client-wide user handler, built once (D-08/D-09)

**What:** A single `onAuthRequired` closure per engine-with-user-auth (`ConcordClient`, `InviteWatcher` — two *separate* instances, not one shared value), built once from `this.signer` at construction, never per-call.
**When to use:** `invite-manager.ts:297` (invite list publish), `client.ts:1287` (community list publish), and `invite-watcher.ts`'s inbox reads (replacing `autoAuthenticate`/`authenticateUser`'s manual path — D-09 confirmed invite-watcher holds no stream keys).
**Example:**
```typescript
// Source: 15-CONTEXT.md D-08/D-09 — separate instances, same shape
const userOnAuthRequired: RelayAuthHandler = async ({ relay, missingPubkeys }) => {
  if (missingPubkeys === null || missingPubkeys.includes(pubkey)) await relay.authenticate(signer);
};
```

### Anti-Patterns to Avoid

- **Reintroducing a client-wide or engine-wide append-only registry:** D-06/D-07 are explicit — the replacement holder is *scope*-owned (community or private-channel), not client-wide. A shared `Map` passed by reference into every scope reintroduces exactly the churn CAUTH-01/02 remove.
- **Subscribing to `relay.challenge$` or `pool.status$` to drive an AUTH:** D-01 is explicit that nothing in concord does this after this phase. If a call site's migration seems to need this, it is a sign the call site needs `onAuthRequired` added instead, not that the ambient pattern should survive there.
- **Deduping concurrent AUTHs "just in case":** D-18 is explicit that this is a deliberate reversal, not an oversight to be quietly restored. `relay.authenticate()` has no in-flight dedupe of its own by design (`relay.ts:1416`), and none is to be added at any layer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Computing which pubkeys still need auth for an operation | A concord-side "missing" set diff against `relay.isAuthenticated()` | `RelayAuthContext.missingPubkeys` (already computed by `applesauce-relay` from the operation's own `waitForAuth`) | D-02's whole simplification — recomputing this in concord would silently diverge from the relay's own per-operation view and reintroduce cross-operation coupling |
| Reconnect re-authentication | A concord-side reconnect listener that re-fires `authenticateStreamKeys` on `challenge$` | Nothing — `authRetryOperator`'s per-subscription `consecutive` counter plus `resetState()` clearing auth state on disconnect already grants a fresh auth budget on every reconnect (D-03) | Verified by trace (this research, "Retry-Behavior Parity" below); building a parallel mechanism would double-fire AUTH on reconnect |
| Auth-required retry/backoff | A concord-side retry loop around `relay.authenticate()` | `authRetries`/`authTimeout` (already RAUTH-03/04, defaults `1`/`30_000`, D-05 keeps them) | Any concord-side retry duplicates budget accounting the relay layer already owns and risks disagreeing with it |

**Key insight:** Every mechanism CAUTH-01..04 ask for already exists one layer down (`applesauce-relay`/`applesauce-loaders`, Phase 13). This phase's entire job is *deletion* of a parallel implementation, plus wiring the one call at each site that was missing (`onAuthRequired`). Any task in the plan that proposes building new auth *logic* (beyond the one-line handler body) is very likely solving an already-solved problem.

## Call-Site Inventory (CAUTH-03 — exhaustive)

CONTEXT.md's `<canonical_refs>` "Source under change" section already lists file/line citations for every in-package site; all were spot-verified against current source in this session and are accurate (line numbers may drift ±1-2 from the cited values due to intervening edits, but every named symbol and call shape was confirmed present). This section adds two site classes not covered there.

### In `packages/concord/src/` (already covered by CONTEXT.md canonical_refs, verified accurate)

| File | Symbols to remove/change | Verified |
|------|---------------------------|----------|
| `client/relay-auth.ts` | Whole file deleted | Read in full — `registry`, `version$` (`BehaviorSubject<number>`), `drivers` (refcounted `Map<string, Driver>`), `registerStreamKeys`, `streamPubkeys`, `streamSigners`, `authenticateStreamKeys` (combineLatest on `challenge$`+`version$`), `autoAuthenticate` (subscribes `pool.status$`), `connected$`, `authenticated$`, `lookupStatus` all present exactly as described |
| `client/community.ts` | `relayAuth` field (:296), `authDrivers` Map (:340), `connected$`/`authenticated$` (:440-455), `ensureAuth()` (:741), `publicChannelKeys()`/`currentAuthors()` (:755/:764), `openLive()` (:770-795, `waitForAuth: authors` present, no `onAuthRequired`), `reconcileLive()` (:802-820), 9 `pool.publish` sites | All confirmed via grep+read; publish sites at :1246, :1300, :1352, :1375, :1414, :1543, :1564, :1565, :1584 confirmed exact |
| `client/private-channel.ts` | `relayAuth` option (:46), `authDrivers` (:139), `connected$`/`authenticated$` (:187/:190), `ensureAuth()` (:365), `openLive()` (:378-404, same `waitForAuth`-only shape) | Confirmed via read |
| `client/sync.ts` | `SyncContext.relayAuth`/`.ensureAuth` (:71/:82), `syncAuthors()`'s `loader({...waitForAuth: authors})` call with **no `onAuthRequired`** (:104-115), two `registerStreamKeys`+`ensureAuth` pairs (:136-137, :190-191) | Read in full — confirmed `createSyncLoader`'s `SyncLoadRequest` accepts `onAuthRequired`/`authTimeout`/`authRetries` alongside `waitForAuth` (see next section) but `syncAuthors` currently passes none of the first three |
| `client/channel-sync.ts` | Same `registerStreamKeys`+`ensureAuth` pattern at two sites (:48-49, :95-96) | Confirmed via grep |
| `client/invite-watcher.ts` | `ConcordRelayAuth` construction (:156), `autoAuthenticate` option/field (:78/:122/:243), `authenticateUser()` (:249-267), `userNeedsAuth()` (:426-438), flag readers at **exactly** `:258` and `:435` | Confirmed via grep — line numbers match CONTEXT.md's canonical_refs precisely, not drifted |
| `client/client.ts` | `relayAuth` field (:248), `autoAuthenticate` (:186/:250/:354/:549-552), construction (:357), publish at `:1287` | Confirmed via grep |
| `client/invite-manager.ts` | Publishes at `:257` (stream-authored) and `:297` (user-authored) | Confirmed via read |
| `types.ts` | `ConcordCommunityStatus.authenticated` (:293), `ConcordPrivateChannelStatus.authenticated` (:304) | Confirmed via read |
| `__tests__/exports.test.ts` | `ConcordRelayAuth` in the export snapshot (`:16`) | Confirmed |

### NOT enumerated in CONTEXT.md's canonical_refs — found in this research session

**1. `client.ts:369-404` — `ConcordClientStatus.authenticated` aggregation.** A third `authenticated` field exists, on `ConcordClientStatus` (`types.ts:321`, distinct from the two CONTEXT.md names at `:293`/`:304`), computed in `client.ts`'s constructor by folding every child community's `status$.authenticated`:
```typescript
// packages/concord/src/client/client.ts:381-403 (verified current)
this.status$ = combineLatest({ phase: this.phase$, children: childStatuses$ }).pipe(
  map(({ phase, children }): ConcordClientStatus => {
    const connectedChildren = children.filter((s) => s.connected);
    return {
      ...
      authenticated: connectedChildren.length > 0 && connectedChildren.every((s) => s.authenticated),
    };
  }),
  distinctUntilChanged((a, b) => /* ...&& a.authenticated === b.authenticated */),
  ...
);
```
This reads `s.authenticated` off `ConcordCommunityStatus`. Once D-10 removes that field, **this is a TypeScript compile error**, not a silent drift — but it is a real call site the plan must explicitly assign a task to (drop the `authenticated` field/logic from `ConcordClientStatus` and its `distinctUntilChanged` comparator, and from the `ConcordClientStatus` type itself, `types.ts:309-322`). This is in scope under D-10's stated rationale (auth is a property of an operation now, not standing state) but was not named in the canonical_refs list.

**2. `apps/examples/src/examples/concord/*.tsx` — direct `ConcordRelayAuth` consumers.** Three example apps construct and use the class being deleted outright:

| File | Lines | Usage |
|------|-------|-------|
| `direct-invites.tsx` | `:8` (import), `:34` (`new ConcordRelayAuth(pool)`), `:256` (`registerStreamKeys`), `:257` (`authenticateStreamKeys`) | Manual per-relay driver wiring, mirroring the pre-Phase-15 pattern |
| `rumor-stores.tsx` | `:10`, `:41`, `:142`, `:165`, `:359` | Same pattern, twice registers keys (core planes then channels) |
| `crypto-history.tsx` | `:8`, `:47`, `:138`, `:162`, `:432` | Same pattern |

These will fail to build the moment `ConcordRelayAuth` is deleted from `applesauce-concord`'s exports (`__tests__/exports.test.ts:16` confirms it is a public export today). They are `apps/examples/`, not `packages/`, so they are lower-stakes than a published package but are still committed source that a `pnpm build`/CI run will fail on if left unmigrated — CAUTH-03's "zero remaining call sites" is a repo-wide claim, not a `packages/concord/` one.

**3. `apps/examples/src/examples/concord/admin-management.tsx` — reads the field being removed.** Lines `:111-112` and `:341-342` render a UI badge off `status.authenticated`:
```tsx
<span className={`badge badge-sm ${status.authenticated ? "badge-success" : "badge-warning"}`}>
  {status.authenticated ? "stream keys authed" : "stream keys pending"}
</span>
```
Once `ConcordCommunityStatus.authenticated`/`ConcordClientStatus.authenticated` are removed (D-10 + finding #1 above), this is a compile error. `apps/examples/src/examples/concord/invite-manager.tsx` and `community-list.tsx` were checked and have **no** references to any of `relayAuth`/`ConcordRelayAuth`/`authenticated`/`autoAuthenticate`/`needsAuth`/`authenticateUser` — clean.

**No other package** (`packages/core`, `packages/relay`, `packages/loaders`, `packages/signers`, `packages/common`, etc.) imports `ConcordRelayAuth` or anything from `packages/concord/src/client/relay-auth.ts` — confirmed via a cross-package grep. The blast radius is fully contained to `packages/concord/` and `apps/examples/src/examples/concord/`.

### Test files affected (not CAUTH-03 call sites per se, but load-bearing for the migration)

`relayAuth: new ConcordRelayAuth(pool)` or equivalent appears **74 times** (recount; CONTEXT.md's "~60 times" was an estimate) across:

| File | Count |
|------|-------|
| `community.test.ts` | 50 |
| `private-channel.test.ts` | 12 |
| `sync.test.ts` | 3 |
| `relay-auth.test.ts` | 3 (whole file — deleted with `relay-auth.ts`) |
| `sync-logging.test.ts` | 2 |
| `channel-sync.test.ts` | 2 |
| `invite-watcher.ts` (source, not test — `new ConcordRelayAuth` construction site already counted above) | — |
| `client.ts` (source, already counted above) | — |

`community.test.ts:3016`'s `spyOnDrivers` helper (and `private-channel.test.ts`'s equivalent near `:514`) spies on `authenticateStreamKeys` as the only observable signal for the WR-04 prune/re-add auth-driver lifecycle tests — these need re-deriving against the new design (not deletion; the underlying question, "does a de-configured relay stop receiving our AUTHs," is still meaningful and answerable via "no operation targets it").

## The Phase 13 API Surface Actually Available

Confirmed by reading `packages/relay/src/types.ts` and `packages/loaders/src/loaders/sync-loader.ts` directly (both marked read-only for this phase per CONTEXT.md's canonical_refs).

### `applesauce-relay` — `RelayAuthOptions` mixin (`packages/relay/src/types.ts:95-119`)

```typescript
export type RelayAuthContext = {
  relay: Relay;
  url: string;
  challenge: string | null;
  request: RelayAuthWireRequest;      // discriminated union: REQ | COUNT | EVENT | NEG-OPEN
  requirement: AuthRequirement;
  missingPubkeys: string[] | null;    // null ONLY when requirement (waitForAuth) is literal `true`
  reason: string;
};
export type RelayAuthHandler = (context: RelayAuthContext) => void | Promise<void>;
export type RelayAuthOptions = {
  waitForAuth?: AuthRequirement;      // default true; a pubkey/array narrows missingPubkeys
  onAuthRequired?: RelayAuthHandler;
  authTimeout?: number | false;       // default 30_000
  authRetries?: number;               // default 1
};
```
`RelayAuthOptions` is intersected into `RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, `RelayCountOptions`, `RelayEventOptions`, `RelaySyncOptions` (D-05 mixin, one declaration site) — confirmed present on all six via grep of `packages/relay/src/types.ts`. Concord's `pool.subscription(...)` and `pool.publish(...)` calls both accept this options bag directly (`pool.subscription` delegates to `group.subscription`, which spreads `GroupSubscriptionOptions` including `RelayAuthOptions`).

### `applesauce-loaders` — `SyncLoadRequest` (`packages/loaders/src/loaders/sync-loader.ts:180-220`)

```typescript
export type SyncLoadRequest = {
  relays: string[];
  filter: Filter;
  limit?: number;
  timeout?: number | false;
  concurrency?: number;
  waitForAuth?: SyncAuthRequirement;   // default true
  onAuthRequired?: SyncAuthHandler;    // "for both the negentropy sync and the paginated request
                                        //  path identically (RAUTH-08)" — verbatim doc comment
  authTimeout?: number | false;        // default 30_000
  authRetries?: number;                // default 1
};
```
This is the type concord's `sync.ts`'s `syncAuthors()` already partially uses (`waitForAuth: authors`, `sync.ts:110`) via `createSyncLoader(...)({...})`. **Confirmed present on both paths** — the doc comment explicitly states the paginated-request and negentropy-sync internals both receive the same `SyncMethodOptions` (`sync-loader.ts:130-139`, threaded at `:344-355` and narrowed per-relay at `:417-496`). This closes the phase description's stated risk ("the plan cannot migrate onto an API shape it guesses at") — `syncAuthors` needs exactly one addition: `onAuthRequired` alongside its existing `waitForAuth: authors`.

## Scope Ownership

Where each engine holds its own keys today (this IS the D-06 replacement's starting point):

- **`ConcordCommunity`** derives `ConcordKeys` (`this.keys`, from `deriveConcordKeys`) on every epoch advance and channel reveal (`community.ts:135`, `:187`, `reconcileLive`). `publicChannelKeys()`/`currentAuthors()` already compute exactly the pubkey set the scope's live subscription and syncs target. The scope-owned holder should accumulate signers alongside these existing derive points — the two `registerStreamKeys` call sites in `sync.ts`/`community.ts` are precisely where a new key becomes known to the scope and is the natural place to also register it with the new holder.
- **`ConcordPrivateChannel`** mirrors this shape 1:1 (`private-channel.ts:395` `registerStreamKeys` call, `channel-sync.ts`'s two pairs) — same replacement pattern, independently instantiated (D-06: "per community and per private channel").
- **An operation's `onAuthRequired` handler knows which pubkeys its scope is missing** entirely from the relay's own `missingPubkeys` answer (Pattern 1 above) — it does not need to separately track "what does this operation need" itself, because every concord call site already computes and passes the correct `waitForAuth` (confirmed: `sync.ts:110`, `community.ts:792`/`:400`'s `openLive`, and D-16's `[event.pubkey]` for publishes).

## Retry-Behavior Parity (CAUTH-04)

**Pre-migration behavior (traced, not assumed):** `authenticateStreamKeys`'s driver loop (`relay-auth.ts:143-169`) retries by looping until a full pass makes no progress ("stop when a full pass makes no progress"), triggered by `combineLatest([relay.challenge$, this.version$])` — i.e. every reconnect (new challenge) or every newly-registered key re-triggers the whole loop for every held key.

**Post-migration behavior (verified via source read):**
- `authRetryOperator` (`packages/relay/src/relay.ts`, applied innermost in the `req`/`sync`/`publish` pipes, confirmed at `relay.ts:1051-1058` for `req`) owns a per-subscription `consecutive` counter living inside `authRetry`'s `defer()` closure (`packages/relay/src/operators/auth-retry.ts:253`, confirmed: `let consecutive = 0;` inside `defer(() => {...})`).
- `resetState()` (`relay.ts:438-461`) clears `challenge$`, `authentications$` (which backs the `authenticatedPubkeys` getter, confirmed at `relay.ts:347` / `:505`), and the two `receivedAuthRequiredFor*` flags on every disconnect.
- The reconnect path (`customConnectionRetryOperator`/`customRepeatOperator`, layered outside `authRetryOperator`) resubscribes the **whole inner chain including `authRetry`'s `defer`** — so `consecutive` resets to 0 and the relay's auth state is already cleared by `resetState()`. **Every reconnect gets a fresh `authRetries` budget** (default 1), matching (in effect exceeding, since the old driver had no bounded-retry concept at all) the pre-migration "keep trying on every challenge" behavior.
- **Parity claim for the plan to assert:** a stream operation that fails auth once retries per-operation (bounded by `authRetries: 1`) within its own connection lifetime, and gets a fresh attempt on reconnect — this is a strict behavioral match for "auth failure doesn't permanently wedge an operation," which is the property CAUTH-04 protects. It is *not* an infinite-loop-until-success match (the old driver's "loop until no progress" had no retry ceiling) — this is a deliberate, already-decided tightening (D-05), not a gap.

## Common Pitfalls

### Pitfall 1: Treating `missingPubkeys: null` as "authenticate everyone I hold"

**What goes wrong:** `missingPubkeys` is `null` only when the operation's `waitForAuth` was the literal boolean `true` (any authenticated user). A handler that does `missingPubkeys ?? [...allMyKeys]` on a `null` would authenticate the *entire* scope's key set on any operation that happens to pass bare `true` — reintroducing exactly the client-wide churn this phase removes.
**Why it happens:** The two truthy states of `waitForAuth` (`true` vs. an explicit array) look similar in a handler that doesn't check which one produced the `null`.
**How to avoid:** Every concord call site D-15/D-16 specifies already passes an explicit array (`authors`, `[event.pubkey]`) — never bare `true` — so `missingPubkeys` is never `null` at any concord call site in practice. The `?? []` fallback in Pattern 1 is defensive dead code for concord's own call sites, not a real branch to design around. Do not add a "fall back to authenticating everything" branch.
**Warning signs:** A handler body that does anything other than iterate `missingPubkeys ?? []` and look up/authenticate each one individually.

### Pitfall 2: Reading `status.authRequiredForRead`/`authRequiredForPublish` as a pre-check

**What goes wrong:** These flags (RAUTH-09, kept as informational status) are relay-wide, not operation-scoped — they flip on when *any* operation on that relay gets refused, not just this scope's. Phase 14's D-04 already deferred concord's four readers (`relay-auth.ts:110`/`:206`, `invite-watcher.ts:258`/`:435`) to this phase specifically because using them as a pre-block gate reproduces CAUTH-02's cross-scope bleed at the status layer (this is D-11's exact finding). All four readers are removed by this phase's scope, not repurposed.
**Why it happens:** They look like a cheap "do I need to auth" check, but they are relay-state, not operation-state.
**How to avoid:** Never gate an `onAuthRequired` registration or an operation's dispatch on these flags. Let the relay's own `auth-required:` response (surfaced via `onAuthRequired` being invoked) be the sole trigger — that's the whole point of Phase 13's design.
**Warning signs:** Any new code reading `.authRequiredForRead`/`.authRequiredForPublish` outside of UI-informational display.

### Pitfall 3: Missing the `ConcordClientStatus.authenticated` aggregation site

**What goes wrong:** CONTEXT.md's canonical_refs names `ConcordCommunityStatus.authenticated` and `ConcordPrivateChannelStatus.authenticated` for removal but does not name `client.ts`'s fold of those into `ConcordClientStatus.authenticated` (`client.ts:369-404`, `types.ts:309-322`). A plan that follows canonical_refs literally will hit a TypeScript compile error here that isn't explicitly assigned to a task.
**Why it happens:** The aggregation is a derived `combineLatest`+`map`, one level removed from the fields being deleted — easy to miss in a file-by-file read.
**How to avoid:** Treat this research's "Call-Site Inventory" finding #1 as an explicit task target: remove `authenticated` from `ConcordClientStatus` (`types.ts:321`) and its computation/comparator in `client.ts`.
**Warning signs:** `tsc`/build failing on `client.ts` after `ConcordCommunityStatus.authenticated` is removed, with an error pointing at the `status$` `combineLatest`/`map`.

### Pitfall 4: Forgetting `apps/examples/`

**What goes wrong:** `packages/concord/`'s own test suite and source can be fully green while `apps/examples/` fails to build, because three example files (`direct-invites.tsx`, `rumor-stores.tsx`, `crypto-history.tsx`) directly `import { ConcordRelayAuth } from "applesauce-concord"` and a fourth (`admin-management.tsx`) reads the removed `status.authenticated` field.
**Why it happens:** `apps/examples/` is a separate workspace package; `pnpm --filter applesauce-concord test` (the Verification Standard's minimum gate) does not build it.
**How to avoid:** Add an explicit task (or a verification step) that updates or at minimum confirms `apps/examples` builds after the migration — e.g. `pnpm --filter applesauce-examples build` or equivalent, mirroring the pattern the milestone already used to build/test `applesauce-relay`/`applesauce-loaders`/`applesauce-concord`.
**Warning signs:** `tsc`/vite build errors in `apps/examples/src/examples/concord/*.tsx` referencing `ConcordRelayAuth` or `.authenticated` after the migration lands.

## Code Examples

### Migrating `syncAuthors` to add `onAuthRequired`

```typescript
// Source: packages/concord/src/client/sync.ts:104-115 (current, verified) — the ONLY change
// needed is adding onAuthRequired; waitForAuth: authors is already correct today.
export async function syncAuthors(ctx: SyncContext, authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  const loader = createSyncLoader({ eventStore: ctx.eventStore, pool: ctx.pool });
  const { events$ } = loader({
    relays: ctx.relays,
    filter: { kinds: BACKFILL_KINDS, authors },
    waitForAuth: authors,
    onAuthRequired: ctx.onAuthRequired, // NEW — replaces ctx.relayAuth/ctx.ensureAuth entirely
  });
  return firstValueFrom(events$.pipe(toArray()));
}
```

### Migrating a publish site (D-15/D-16 shape)

```typescript
// Source: packages/concord/src/client/community.ts:1246 (current shape) + D-16's ruling
// Before: this.pool.publish(relays, wrap).catch(...)
// After:
await this.pool.publish(relays, wrap, {
  waitForAuth: [wrap.pubkey],       // the wrap's OWN author (stream sk), per D-16
  onAuthRequired: this.streamOnAuthRequired, // the scope's own handler, not the user's
}).catch((err) => { /* unchanged */ });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Client-wide `ConcordRelayAuth` registry + refcounted per-relay drivers subscribed to `challenge$`/`version$` | Operation-scoped `onAuthRequired` handlers using the relay's own `missingPubkeys` | This phase (Phase 15), building on Phase 13's `applesauce-relay`/`applesauce-loaders` API | Every operation authenticates only its own scope's needed keys; a relay sees AUTH only for the k pubkeys actually in play, not the whole client's held set |
| `pool.status$`-driven `autoAuthenticate` for user auth | One-time-built `onAuthRequired` handler passed per-operation (client-wide instance for `ConcordClient`/`invite-manager.ts`, separate instance for `InviteWatcher`) | This phase (widened per user's D-06/D-13-area ruling) | No standing subscription watching `pool.status$` for auth purposes anywhere in concord |
| `ConcordCommunity.authenticated$`/`ConcordPrivateChannel.authenticated$` status booleans | Removed; auth failure folds into existing `error$` | This phase (D-10/D-13) | No standing "am I authenticated" surface; explicitly marked revisitable, not permanent |

**Deprecated/outdated:**
- `ConcordRelayAuth` (whole class): superseded by scope-owned signer holders + `onAuthRequired` handlers.
- `authRequiredForRead$`/`authRequiredForPublish$` as internal *gates* inside concord: remain public API on `applesauce-relay` (RAUTH-09), but concord's own four readers of them are removed, not repurposed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The scope-owned signer holder's exact API shape (e.g. a plain `Map` vs. a small class with a `register`/`get` method) is Claude's discretion per CONTEXT.md, and this research does not prescribe one beyond "not client-wide, not a driver" | Architecture Patterns / Recommended Project Structure | Low — CONTEXT.md explicitly delegates this to executor discretion; any reasonable shape satisfies D-06/D-07 |
| A2 | `apps/examples/` is expected to be kept building (not deliberately left broken) as part of this phase, based on the project's general CI/build conventions (`pnpm build`/turbo filters covering `./packages/*` per config, plus prior-phase precedent of fixing `apps/examples`-adjacent code when it's touched) | Common Pitfall 4 | Medium — if the user intends to leave `apps/examples/concord/*` broken and fix it in a follow-up, the plan should say so explicitly rather than silently include or silently omit the fix; flag as a discuss-phase-worthy gap if the planner is uncertain, since CONTEXT.md's discussion log never surfaced `apps/examples` at all |

**If this table is empty:** N/A — see above two assumptions, both low/medium risk and explicitly flagged for planner attention.

## Open Questions

1. **Does `apps/examples/src/examples/concord/*.tsx` get fixed in this phase or deferred?**
   - What we know: three example files directly construct `ConcordRelayAuth` and will fail to compile once it's deleted; a fourth reads the removed `authenticated` status field. CONTEXT.md's discussion log and canonical_refs never mention `apps/examples/` at all.
   - What's unclear: whether the user considers `apps/examples/concord/*` in-scope "callers that must migrate" (CAUTH-03's literal wording: "once callers migrate") or acceptable transient breakage for examples specifically.
   - Recommendation: the planner should include example-app fixes as explicit tasks (mechanical — same pattern as the D-15/D-16 publish migration, applied to `direct-invites.tsx`/`rumor-stores.tsx`/`crypto-history.tsx`, plus dropping the `admin-management.tsx` badge or repointing it at `connected$`/`error$`), since leaving `apps/examples` non-building contradicts CAUTH-03's "zero remaining call sites" framing even if it's a stretch of the requirement's literal package scope. If the planner disagrees, this should be an explicit, stated exclusion rather than a silent gap.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond the existing pnpm/vitest/turbo toolchain already used by every other phase in this monorepo, with no new packages installed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`, no per-package config in `packages/concord`) |
| Config file | `/vitest.config.ts` (repo root) |
| Quick run command | `pnpm vitest run packages/concord/src/client/__tests__/<file>.test.ts` (per-file; **the `pnpm --filter … -- <path>` form silently runs the whole suite instead — do not use it**, per project memory) |
| Full suite command | `pnpm --filter applesauce-concord test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAUTH-01 | A community/private-channel operation's `onAuthRequired` handler is invoked with `missingPubkeys` narrowed to that operation's own `waitForAuth`, and authenticates only signers the scope holds for those pubkeys | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ (rewrite existing `spyOnDrivers`-based WR-04 tests; add new handler-invocation assertions) |
| CAUTH-02 | A mock relay observed during a scoped operation receives AUTH for exactly the k pubkeys that scope's own operations required — not the union of every key the client holds — and a reconnect re-authenticates exactly that same scoped set | unit/integration | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` (extend `fakePool()`/`fakePoolWithStatus()` fixtures, `community.test.ts:57-98`, to count `relay.authenticate(signer)` calls per pubkey across a multi-community/multi-channel scenario) | ❌ Wave 0 — new test; oracle is design-derived (see below), not a before/after diff |
| CAUTH-03 | Zero remaining call sites for `authenticateStreamKeys`, `version$`, driver refcounting, `ensureAuth()`, and relay-status-driven stream/user auth | structural | `grep -rn "authenticateStreamKeys\|ensureAuth\|ConcordRelayAuth\|autoAuthenticate" packages/concord/src apps/examples/src/examples/concord` — must return zero matches outside historical comments/changelogs; plus `pnpm --filter applesauce-concord build` and `pnpm --filter applesauce-examples build` both green | ✅ (grep-based structural check; add as a Wave-0 or final-verification script, following the precedent of Phase 12's `cord-citations.test.ts` file-walk guard) |
| CAUTH-04 | A stream operation that fails auth once still retries per-operation (bounded by `authRetries: 1`) after migration, and gets a fresh budget on reconnect | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` (or a new focused file) — assert against `authRetries`'s documented default behavior (retry once, then propagate), not against the old driver's loop-until-no-progress shape | ❌ Wave 0 — new test; parity target is the *documented* `applesauce-relay` retry contract (already tested at the relay layer in Phase 13), concord's test only needs to confirm it isn't overridden/suppressed |

### Sampling Rate

- **Per task commit:** `pnpm vitest run <touched-test-file>`
- **Per wave merge:** `pnpm --filter applesauce-concord test`
- **Phase gate:** `pnpm --filter applesauce-concord test` full suite green, plus `pnpm --filter applesauce-examples build` green (Pitfall 4), before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] A CAUTH-02 oracle test extending `fakePool()`/`fakePoolWithStatus()` (`community.test.ts:57-98`) with an `authenticate` spy that records `(pubkey, relayUrl)` pairs, run across a fixture with **two** communities (or a community + a private channel) sharing a relay, asserting: (a) each scope's operations authenticate only that scope's own pubkeys on that relay, never the other scope's, and (b) a simulated `resetState()`/reconnect re-triggers exactly the same per-scope set, not a union. This is the design-derived, independently-computed oracle the Verification Standard requires for CAUTH-02 in the absence of any committed "before" recording — derive the expected pubkey set `k` from each operation's own `waitForAuth`/filter `authors`, independently of what the handler under test actually did, per the "Specific Ideas" oracle in CONTEXT.md.
- [ ] A CAUTH-04 retry-parity test: drive a fake relay that answers `auth-required:` once, succeeds on the second attempt, and assert the operation still resolves (retry happened); then a fake relay that refuses auth twice in one connection and assert the operation rejects/errors rather than looping forever (bounding to `authRetries: 1`'s documented contract) — this is a **new** assertion, since the old driver had no bounded-retry concept to test against.
- [ ] A CAUTH-03 structural grep guard (see table above), ideally as an actual Vitest test file (mirroring `packages/concord/src/__tests__/cord-citations.test.ts`'s precedent of a source-tree-walk guard) rather than a manual one-off grep, so a future re-introduction of any of the five removed mechanisms fails CI automatically.
- [ ] Non-vacuity: for each of the above, follow the project's established RED→GREEN discipline (temporarily revert the fix, confirm the new test fails for the stated reason, restore) per the Verification Standard's explicit "record a RED→GREEN non-vacuity probe" requirement, applied "with particular force to CAUTH-02."

*Existing test infrastructure (`fakePool`, `fakePoolWithStatus`, `mkStatus`, `spyOnDrivers`) already covers the fixture-construction needs; no new test framework or config is required, only new assertions/fixtures within the existing files.*

## Security Domain

`security_enforcement` is not present in `.planning/config.json` (absent = enabled per instructions), so this section is included. This phase is a security-adjacent internal migration (NIP-42 authentication plumbing) but introduces no new attack surface — it re-wires which pubkeys get authenticated when, using an already-shipped, already-reviewed relay-layer mechanism (Phase 13).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes | NIP-42 AUTH via `applesauce-relay`'s `relay.authenticate(signer)` — unchanged by this phase, consumed read-only |
| V3 Session Management | No | No session/cookie concept here; per-connection auth state is `applesauce-relay`'s (`authenticatedPubkeys`), untouched |
| V4 Access Control | No | This phase does not change what a signer is *authorized* to do — only which signer authenticates which relay connection, and when |
| V5 Input Validation | No | No new external input parsing introduced |
| V6 Cryptography | No | No key derivation, signing, or encryption logic changes — stream secret keys are read from already-derived `ConcordKeys`/`GroupKey` structures unchanged by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A scope's `onAuthRequired` handler authenticating a pubkey it does NOT hold a signer for (e.g. a copy-paste bug pulling from the wrong scope's map) | Spoofing | Handler must `.get(pk)` from its own scope's holder and no-op (never throw, never fall back to another scope's map) when absent — matches D-02's exact wording ("if (signer) await relay.authenticate(signer)") |
| A duplicate/racing AUTH from concurrent operations on the same relay (accepted risk per D-18) | — (explicitly accepted, not a defect) | `relay.authenticate()` has no in-flight dedupe by design; D-18 confirms this is intentional for in-memory keys. Not a mitigation gap — a documented, ruled-on tradeoff. |
| Stream secret keys accumulating unboundedly in a long-lived scope holder (D-07's "accumulate within the scope") | — (memory-growth concern, not strictly STRIDE) | Out of this phase's scope per the user's explicit ruling (accepted risk, "invisible at the wire"); no mitigation task should be invented here unless the planner surfaces it as a new discussion item |

## Sources

### Primary (HIGH confidence — verified in this session by reading source)
- `packages/concord/src/client/relay-auth.ts` — read in full, confirms every mechanism CONTEXT.md describes for deletion
- `packages/concord/src/client/community.ts`, `private-channel.ts`, `sync.ts`, `channel-sync.ts`, `invite-watcher.ts`, `client.ts`, `invite-manager.ts` — grepped/read for every call site cited
- `packages/concord/src/types.ts` — `ConcordCommunityStatus`/`ConcordPrivateChannelStatus`/`ConcordClientStatus`, all three `authenticated` fields located and cross-referenced
- `packages/concord/src/__tests__/exports.test.ts` — `ConcordRelayAuth` confirmed as current public export
- `packages/relay/src/types.ts` — `RelayAuthOptions`/`RelayAuthContext`/`RelayAuthHandler` read verbatim
- `packages/relay/src/relay.ts` — `resetState()`, `req`'s operator pipe order, `authenticatedPubkeys` getter chain, all read directly
- `packages/relay/src/operators/auth-retry.ts` — `authRetry`'s `defer`-scoped `consecutive` counter read directly
- `packages/relay/src/group.ts` — per-relay `catchError`→`merge` read directly
- `packages/loaders/src/loaders/sync-loader.ts` — `SyncMethodOptions`/`SyncLoadRequest` read verbatim, confirms both paginated and negentropy paths accept identical auth options
- `apps/examples/src/examples/concord/*.tsx` — grepped for `ConcordRelayAuth`/`authenticated`/`autoAuthenticate` usage, found three consumers + one status-field reader not covered by CONTEXT.md
- `.planning/config.json` — confirmed no `workflow.nyquist_validation` key (treated as enabled) and no `security_enforcement` key (treated as enabled)

### Secondary (MEDIUM confidence)
- `.planning/phases/15-concord-stream-auth-cleanup/15-CONTEXT.md` and `15-DISCUSSION-LOG.md` — user-ruled decisions, treated as locked constraints, not independently re-litigated

### Tertiary (LOW confidence)
- None — this phase's research was entirely source-verification against an already-thoroughly-traced CONTEXT.md; no web/external sources were needed since the "domain" is this repo's own already-shipped API

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external packages, confidence not applicable
- Architecture: HIGH — every pattern cited is either read directly from current source in this session or copied verbatim from CONTEXT.md's own line-verified trace
- Call-site inventory (CAUTH-03): HIGH — cross-checked every CONTEXT.md citation against current source, plus found and verified two additional site classes via independent grep
- Pitfalls: HIGH — each pitfall is grounded in either a direct source read (Pitfalls 1-3) or a direct grep confirming real, uncited call sites (Pitfall 4)
- Validation Architecture: MEDIUM-HIGH — test framework/commands are HIGH confidence (read directly); the CAUTH-02/CAUTH-04 oracle designs are a reasoned proposal (matching CONTEXT.md's own "Specific Ideas" oracle sketch) rather than an already-existing test, so MEDIUM on the exact fixture shape until the planner/executor build it

**Research date:** 2026-08-13
**Valid until:** Effectively pinned to this milestone (v1.2) — this research is tightly coupled to Phase 13/14's already-shipped, unreleased-until-shipped API surface; re-verify call sites if any other phase touches `packages/concord/src/client/` before Phase 15 executes
