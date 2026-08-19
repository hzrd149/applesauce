# Phase 15: Concord Stream-Auth Cleanup - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Every NIP-42 authentication in `applesauce-concord` becomes reactive and operation-scoped: a
relay's `auth-required:` on a specific request is answered by that operation's own
`onAuthRequired` handler, using keys held by the scope that issued it. The client-wide,
append-only stream-signer registry and its ambient relay drivers are deleted.

**One deliberate widening (D-06/D-13):** the phase covers **user-key** authentication as well as
stream-key authentication. CAUTH-01/02/04 name stream keys only; CAUTH-03's "relay-status-driven
stream authentication" is ambiguous about `autoAuthenticate`. The user ruled both in, because the
same ambient-status-driven pattern is what drives both and leaving one behind would keep
`pool.status$`-driven auth alive in the package. **`REQUIREMENTS.md` CAUTH-03 and `ROADMAP.md`
Phase 15 success criterion 3 need amending to name `autoAuthenticate` and the invite watcher's
two flag readers explicitly.**

**Not this phase:** any change to `applesauce-relay` or `applesauce-loaders` — Phases 13 and 14
landed everything needed and this phase is a pure consumer (so **no changesets**: concord is
unreleased, and the published packages are untouched). No relay-internal dedupe (RAUTH-05
forbids it). No new proactive/ambient auth of any kind.

</domain>

<decisions>
## Implementation Decisions

### The shape of the migration

- **D-01: Auth is reactive everywhere, with no proactive machinery left in concord.** The user's
  own framing, applied to the last remaining path: *"publishing should take the same reactive
  authentication approach that we did with subscribing and syncing."* Every operation — sync,
  live subscription, and all 13 publishes — passes `waitForAuth` + `onAuthRequired` and
  authenticates only when a relay actually refuses it. After this phase, **nothing in concord
  subscribes to `relay.challenge$` or `pool.status$` to drive an AUTH.**
- **D-02: The handler body is the whole mechanism.** Roughly:
  ```ts
  onAuthRequired: async ({ relay, missingPubkeys }) => {
    for (const pk of missingPubkeys ?? []) {
      const signer = signers.get(pk);
      if (signer) await relay.authenticate(signer);
    }
  }
  ```
  `missingPubkeys` is computed from *that operation's* `waitForAuth`, so a scope-level signer map
  intersected with it is **already operation-scoped**. CAUTH-01 does not require threading a
  per-operation key set through every call site — this is the load-bearing simplification of the
  phase.

### Reconnect and retry (CAUTH-02, CAUTH-04)

- **D-03: Reconnect re-auth rides `authRetryOperator` — concord adds nothing.** Verified by trace:
  `resetState()` (`relay.ts:438-461`) clears `authenticatedPubkeys` and the challenge on
  disconnect; `req` is piped `authRetry` (innermost) → `customConnectionRetryOperator` →
  `customRepeatOperator` (`relay.ts:1053-1058`); the reconnect `retry()` resubscribes the whole
  inner chain **including `authRetry`'s `defer`**, and `consecutive` lives in that closure
  (`auth-retry.ts:253`). So every reconnect gets a fresh auth budget, re-sends its REQ, is refused
  again, and fires the handler with `missingPubkeys` = exactly that scope's set. CAUTH-02's
  reconnect clause is therefore a **test assertion, not a mechanism to build**.
- **D-04: An idle scope re-authenticates nothing on reconnect, by design.** A private channel
  between syncs holds no live operation, so nothing re-auths until its next operation. This is a
  behavior change from the driver, which re-authed every held key on every `challenge$` emission
  whether anything needed it or not. Accepted as correct under demand-driven auth.
- **D-05: `authRetries` stays at its default of `1`; `authTimeout` stays at its default of `30_000`.**
  The connection-level retry already grants a fresh budget per reconnect, and a relay
  that refuses a correctly-signed AUTH twice within one connection is refusing for a
  non-transient reason. Stream-key signing is local and instant, so the 30s budget is almost
  entirely the relay's `OK` reply. This retains the per-operation retry CAUTH-04 requires.

### Where the keys live (CAUTH-01, CAUTH-03)

- **D-06: A new scope-owned signer holder, instantiated per community and per private channel.**
  `ConcordRelayAuth` is **deleted outright** — `registry`, `version$`, `drivers`, the refcounted
  `Driver` interface, `authenticateStreamKeys`, `registerStreamKeys`, `streamSigners`,
  `streamPubkeys`, `autoAuthenticate`, `connected$`, `authenticated$`, and both verbatim-duplicated
  `ensureAuth` bodies (`community.ts:741`, `private-channel.ts:365`) go with it. The new holder is
  the single replacement those two duplicated bodies get, and the export snapshot
  (`__tests__/exports.test.ts:16`) changes accordingly.
- **D-07: The scope's signer map accumulates within the scope.** The sync walk derives fresh keys
  per epoch (`sync.ts:136`, `:190`) and a historical re-walk still needs the old ones. Append-only
  *within one community or channel* is a different thing from the client-wide append-only registry
  CAUTH-01 names, and the `missingPubkeys` filter makes the accumulation invisible at the wire —
  a held key is only ever signed when this operation's relay asked about it.
- **D-08: The user-auth handler is one client-wide thing, built once from the user's signer.**
  There is one logged-in identity, so per-scope copies would authenticate the same single pubkey —
  there is no churn to remove. This is the one thing that stays client-wide, and legitimately so.
- **D-09: The user handler stays separate from the stream handler.** Stream signers are in-memory
  `PrivateKeySigner`s that never prompt; the user signer can be a NIP-46 bunker or an extension
  dialog. Different latency and different user-visible consequences — they do not belong on one
  code path. `invite-watcher.ts` (which holds **no** stream keys and constructs `ConcordRelayAuth`
  at `:156` purely for `autoAuthenticate`) takes the user handler and nothing else.

### Status surface

- **D-10: `authenticated$` is removed.** In the user's words: *"since auth is handled all from
  within the sync and live requests now there isn't a need for the client to see it. At least for
  the moment."* Auth is a property of an operation, not standing state, so there is nothing for a
  client to observe between operations. Removes `ConcordCommunity.authenticated$`
  (`community.ts:265`), `ConcordPrivateChannel.authenticated$` (`private-channel.ts:104`), the
  `authenticated` field from `ConcordCommunityStatus` (`types.ts:293`) and
  `ConcordPrivateChannelStatus` (`types.ts:304`), and the `authenticated` leg of the `status$`
  composite (`community.ts:448`). Concord is unreleased, so this costs nothing downstream. Marked
  as revisitable if an app asks for it.
- **D-11: It had to go — the old definition breaks under per-operation auth, in two independent ways.**
  (a) Its gate leaks across scopes: `relay-auth.ts:110` counts a relay satisfied when
  neither `authRequiredForRead` nor `authRequiredForPublish` is set, but those flags are relay-wide
  and set by *any* operation's refusal — so community A's `authenticated$` drops because community
  B's REQ was refused on a shared relay, and A can never recover it (A has no operation running, so
  A's keys are never authenticated). That is CAUTH-02's cross-scope bleed reappearing in the status
  layer. (b) It is an all-of check over `currentAuthors()` (`community.ts:764`), the scope's
  *entire* current key set, while only the subset an operation actually requested is ever
  authenticated — unsatisfiable in general. Both flag readers CAUTH-03 names die with it.
- **D-12: `connected$` survives, inlined on each engine.** It reads only `status.connected` — no
  auth flags — so CAUTH-03 does not touch it. It needs a new home once the class is deleted;
  ~6 lines each including the `normalizeURL`-tolerant `lookupStatus` (`relay-auth.ts:76`), and the
  `switchMap` over `extras.relays$` already lives on the engines (`community.ts:440`).
- **D-13: An auth failure folds into the existing `error$`.** `community.ts:247` is already a
  `BehaviorSubject<string | null>` in the `status$` composite. When auth failure is the reason a
  sync returned nothing, write it there so the UI can say *why* a community looks empty rather than
  showing a silent blank. **No new status surface** — this replaces the earlier idea of a per-relay
  auth-state field, which `authenticated$`'s removal made unnecessary.
- **D-14: Neither concord path dies on a single relay's auth failure — this is already true upstream and must not regress.**
  `RelayGroup.internalSubscription` wraps each relay in
  `catchError` → an `ERROR` message, then merges (`group.ts:177-183`), so the live subscription
  survives. `syncAuthors`' `events$` completes when every relay has finished *completed or errored*
  (`sync.ts:112`), so the sync just returns fewer events. The engine catches at its own boundary
  and stays alive.

### Publishes

- **D-15: All 13 `pool.publish` call sites get `waitForAuth` + `onAuthRequired`.** Nothing publishes
  on the assumption that something else already authenticated. Sites: `community.ts:1246`, `:1300`,
  `:1352`, `:1375`, `:1414`, `:1543`, `:1564`, `:1565`, `:1584`; `invite-manager.ts:257`, `:297`;
  `client.ts:1287`. (`admin.ts:149` delegates to the community's own publish.)
- **D-16: Each publish waits on its own event's author — `waitForAuth: [event.pubkey]`.** The
  discovery that settles this: **a concord wrap is signed by the stream secret key**, not by the
  user and not by an ephemeral key — `finalizeEvent({ kind: GIFT_WRAP_KIND, …, tags: [["p",
  decoyPubkey]] }, streamSk)` at `operations/gift-wrap.ts:81-89`. The `p` tag decoy is ephemeral;
  the *author* is the stream pubkey, which is what makes reads work at all
  (`filter: { authors: streamPubkeys }`). So a gating relay checking a write wants **that** key
  authenticated, and an earlier framing of "user handler on publishes" was pointed at the wrong key.
- **D-17: 11 of the 13 resolve from an in-memory key and can never prompt.** Stream `sk`:
  `community.ts:1246` (rekey wraps), `:1543`, `:1564` (compaction), `:1565` (snapshot), `:1584`.
  Invite-link `sk` (`linkSk` freshly generated, or `link.signerSk`/`invite.signerSk` stored):
  `community.ts:1300`, `:1352`, `:1375`, `invite-manager.ts:257`. NIP-59 ephemeral:
  `community.ts:1414` (channel grant, `DirectInviteFactory.create`). **Only
  `invite-manager.ts:297` (invite list) and `client.ts:1287` (community list) sign with
  `this.signer`** — the user's — and are answered by D-08's client-wide user handler. Neither is
  in a loop.
- **D-18: No dedupe of concurrent AUTHs anywhere.** The user's ruling, on the grounds that these
  are internal keys always held in memory: a duplicate AUTH is one extra local signature and one
  extra frame. This is truest to "each operation authenticates independently" (RAUTH-05's spirit)
  and adds no shared state to the scope holder. It is a deliberate reversal of what the refcounted
  driver existed for (`relay-auth.ts:35-38`: *"a driver per subscription would send duplicate
  AUTHs"*) — that concern was priced against a whole-registry AUTH, not against one key.
  `relay.authenticate()` (`relay.ts:1416`) has no in-flight dedupe of its own, correctly, and none
  is to be added at any layer.

### Examples

- **D-19: The four concord examples migrate in this phase.** Surfaced by 15-RESEARCH.md, not by the
  discussion — CONTEXT.md never mentioned `apps/examples`, but `apps/*` is in the pnpm workspace and
  root `pnpm build` runs `turbo build` across it, so deleting `ConcordRelayAuth` breaks the build.
  Three files construct it and call `authenticateStreamKeys` (`direct-invites.tsx:8,34,257`,
  `crypto-history.tsx:8,47,133,139,428,432,443`, `rumor-stores.tsx:10,41,130,143,355,359,392` — the
  latter two also hand-roll their own `ensureAuth`), and `admin-management.tsx:111,112,341,342` reads
  the removed `status.authenticated`. Ruled in-phase: rewrite the three consumers onto operation-scoped
  `onAuthRequired` so the examples demonstrate the new pattern, and drop or replace the
  `status.authenticated` badges. This is what makes CAUTH-03's zero-remaining-call-sites claim honest
  rather than scoped-around. Note `pnpm test` alone would not have caught this — it filters to
  `./packages/*`, so `pnpm --filter applesauce-examples build` is the gate that matters.

### Claude's Discretion

- Naming and file placement of the scope-owned signer holder (D-06), and its exact API for
  registering keys as epochs advance and channels are revealed.
- Whether `connected$`'s `lookupStatus` normalization is duplicated per engine or extracted to a
  free function (D-12) — mechanical either way.
- The wording and granularity of the `error$` message written on auth failure (D-13).
- How the two user-signed publishes (D-17) receive the client-wide user handler — constructor
  injection vs. threading through options.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/REQUIREMENTS.md` § CAUTH — CAUTH-01/02/03/04; the **Out of Scope table** (relay-internal
  auth dedupe and single-flight guards are forbidden — apps and libraries own dedupe, and D-18
  declines it here too; reconstructing `.planning/debug/concord-multi-user-auth-churn.md` is out of
  scope, the file was never committed; **no concord changesets** — it is unreleased); and the
  **Verification Standard**, which applies "with particular force to CAUTH-02". **Needs amending per
  D-06/D-13 to name `autoAuthenticate` and the invite watcher's flag readers.**
- `.planning/ROADMAP.md` § Phase 15 — goal and four success criteria. **Criterion 3 needs amending
  per the same widening.**

### Prior phase decisions this phase depends on
- `.planning/phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` — the whole auth design.
  Load-bearing here: **D-05** (`RelayAuthOptions` mixin — the option shape every concord call site
  now passes), **D-08** (the consecutive counter resets on progress; `resetState()` clears auth on
  every disconnect — D-03's trace depends on both), **D-11** (the handler always runs, even when
  `waitForAuth` is already satisfied), **D-01/D-02** (no throw as an internal signal).
- `.planning/phases/14-auth-lifecycle-debug-logging/14-CONTEXT.md` — **D-02** (the wire-verb
  discriminated union `RelayAuthWireRequest`, which concord handlers may branch on), **D-04**
  (`authRequiredForRead$`/`authRequiredForPublish$` stay as public API but nothing internal reads
  them — concord's four readers at `relay-auth.ts:110`, `:206`, `invite-watcher.ts:258`, `:435` were
  explicitly deferred to *this* phase), **D-13** (the `:auth` debug namespace, which is where an
  auth failure is observable now that no status surface reports it).

### Source under change
- `packages/concord/src/client/relay-auth.ts` — the whole file. Deleted per D-06.
- `packages/concord/src/client/community.ts` — `relayAuth` field (`:296`), `connected$`/
  `authenticated$`/`status$` (`:256`, `:265`, `:267`, `:440-455`), `error$` (`:247`),
  `syncContext()` (`:710`), `ensureAuth()` (`:741`), `publicChannelKeys()` (`:755`),
  `currentAuthors()` (`:764`), `openLive()` (`:770-795`), `reconcileLive()` (`:802-820`), and the
  nine `pool.publish` sites listed in D-15.
- `packages/concord/src/client/private-channel.ts` — the mirrored surface: `relayAuth` option
  (`:46`), `connected$`/`authenticated$` (`:98`, `:104`), `authDrivers` (`:139`, cleared at
  `:242-243`), `syncContext()`
  (`:338`), `ensureAuth()` (`:365`), `openLive()` (`:378-404`).
- `packages/concord/src/client/sync.ts` — `SyncContext.relayAuth` (`:71`) and `.ensureAuth` (`:82`),
  `syncAuthors()` (`:104-115`, the `waitForAuth: authors` site that now also carries the handler),
  and the two `registerStreamKeys` + `ensureAuth` pairs at `:136-137` and `:190-191`.
- `packages/concord/src/client/channel-sync.ts` — the same pairs at `:48-49` and `:95-96`.
- `packages/concord/src/client/invite-watcher.ts` — `ConcordRelayAuth` construction (`:156`),
  `autoAuthenticate` option and field (`:78`, `:122`, `:243`), `authenticateUser()` (`:433`),
  `userNeedsAuth()` (`:428-438`), and the flag readers at `:258` and `:435`.
- `packages/concord/src/client/client.ts` — `relayAuth` field (`:248`), `autoAuthenticate`
  (`:186`, `:250`, `:354`, `:549-552`), construction (`:357`), and the publish at `:1287`.
- `packages/concord/src/client/invite-manager.ts` — publishes at `:257` and `:297`.
- `packages/concord/src/types.ts` — `ConcordCommunityStatus.authenticated` (`:293`) and
  `ConcordPrivateChannelStatus.authenticated` (`:304`), both removed per D-10.
- `packages/concord/src/__tests__/exports.test.ts:16` — the `ConcordRelayAuth` export snapshot.

### Upstream API this phase consumes (read-only — do not modify)
- `packages/relay/src/types.ts` — `RelayAuthOptions` (`:102`), `RelayAuthContext` (`:77`) and its
  `missingPubkeys` (`:89`, **`null` when `waitForAuth` is `true`**), `RelayAuthWireRequest` (`:64`),
  `RelayAuthHandler` (`:95`).
- `packages/relay/src/operators/auth-retry.ts` — the shared operator; `consecutive` in the `defer`
  closure (`:253`) is what makes D-03 true.
- `packages/relay/src/relay.ts` — `resetState()` (`:438-461`), the `req` pipe order
  (`:1053-1058`), `authenticate()` (`:1416`, no in-flight dedupe by design).
- `packages/relay/src/group.ts` — per-relay `catchError` → `ERROR` message then `merge`
  (`:177-183`), the reason D-14 holds for the live subscription.
- `packages/loaders/src/loaders/sync-loader.ts` — `waitForAuth`/`onAuthRequired`/`authTimeout`/
  `authRetries` threading (`:132-138`, `:344-355`, `:417-496`), the path `syncAuthors` uses.

### Protocol and conventions
- `packages/concord/src/operations/gift-wrap.ts:78-89` — `buildWrap`: the wrap is
  `finalizeEvent(…, streamSk)`. **D-16's whole basis.** NIP-42 is explicitly *not* part of the
  frozen CORD-01..06 spec (`relay-auth.ts:17-20`) — this is a relay-access convention.
- `CLAUDE.md` § Writing Changesets — no changesets are needed for this phase (concord unreleased,
  published packages untouched), but the one-change-per-file, single-sentence rule applies if that
  assumption turns out to be wrong.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`waitForAuth` is already scoped at every read site.** `syncAuthors` (`sync.ts:110`),
  `community.openLive` (`:792`), and `privateChannel.openLive` (`:400`) already pass
  `waitForAuth: authors` — the exact pubkey set that operation reads. **Only the *authenticating*
  is client-wide today, not the waiting.** The migration adds a handler beside an argument that is
  already correct.
- **`missingPubkeys`** — the relay computes it from the operation's own `waitForAuth`, so it is the
  ready-made operation-scoping filter D-02 relies on. No concord-side set arithmetic needed.
- **`relay.isAuthenticated(pubkey)`** (used at `relay-auth.ts:144`, `:148`, `:208`) — still
  available if a handler wants a cheap skip, though D-18 declines to require one.
- **`error$`** (`community.ts:247`) — already a `BehaviorSubject<string | null>` wired into the
  `status$` composite; D-13's destination exists.
- **`lookupStatus`** (`relay-auth.ts:76`) — the `normalizeURL`-tolerant status lookup `connected$`
  needs; moves with D-12 rather than being rewritten.

### Established Patterns
- **Granular `$` fields plus a derived composite `status$`** — `community.ts:439-455` composes
  `phase`/`epoch`/`dissolved`/`connected`/`authenticated`/`error` with a custom
  `distinctUntilChanged`. D-10 removes one leg; the shape is unchanged and is the shape to keep.
- **`transport()` as the single merge point** — `community.ts:706`, `private-channel.ts:334`. Every
  auth-related call site must take a **complete** transport snapshot; the existing `ensureAuth`
  doc-comments warn about this explicitly and the replacement inherits the constraint.
- **Compute-once-and-reuse for the churn guard** — `openLive()`'s `targets`/`sig` locals
  (`community.ts:775-780`, `private-channel.ts:392-396`) exist so the guard can never disagree with
  what was dialled. Whatever replaces `ensureAuth` in those methods must not reintroduce a second
  `transport()` call.
- **Derive-and-store loggers** — `logger.extend("auth")` at module scope (`relay-auth.ts:32`).
  Wherever the auth log lines land after the file is deleted, derive once (SEED-001, 14-D-18).

### Integration Points
- **`SyncContext` / `ChannelSyncContext` change shape** — `relayAuth` (`sync.ts:71`) and
  `ensureAuth` (`:82`) are both removed; what replaces them is the scope's handler (or the holder
  that produces it). Every test constructing these contexts (`sync.test.ts`, `channel-sync.test.ts`,
  `community.test.ts`, `private-channel.test.ts`, `sync-logging.test.ts`) is affected — the
  `relayAuth: new ConcordRelayAuth(pool)` line appears **~60 times** across the concord suite.
- **`spyOnDrivers`** (`community.test.ts:3012`, `private-channel.test.ts:514`) spies on
  `authenticateStreamKeys` as the only observable signal for auth-driver lifecycle. With the drivers
  gone, the WR-04 prune/re-add tests these back (`community.test.ts:2965+`,
  `private-channel.test.ts:460+`) lose their subject and need re-derivation against the new design —
  not deletion, since the underlying question (does a de-configured relay stop receiving our AUTHs?)
  is still meaningful and is now answered by "no operation targets it".
- **`invite-watcher.ts` has no stream keys.** It is the one consumer that needs only D-08's user
  handler, and its `autoAuthenticate: false` test (`invite-watcher.test.ts:137`) documents the
  manual `authenticateUser()` path that must keep working.

</code_context>

<specifics>
## Specific Ideas

- **The user's framing for publishes:** *"publishing should take the same reactive authentication
  approach that we did with subscribing and syncing."* This is D-01 and D-15/D-16 — planner and
  executor should treat "one reactive pattern, no special-cased auth path" as general guidance for
  anything they add. If a new call site needs auth, it gets `waitForAuth` + `onAuthRequired`; it
  does not get a driver, a pre-check, or a status subscription.
- **On dedupe:** *"if it's the internal keys for the concord group then it's probably [fine] since
  the private keys will always be in memory."* D-18. The corollary worth carrying: **the cost of a
  duplicate AUTH is a function of which signer answers it**, and 11 of 13 publishes plus every read
  answer from raw in-memory secret keys. Any future proposal to add dedupe should first establish
  which signer it is protecting.
- **On removing `authenticated$`:** *"since auth is handled all from within the sync and live
  requests now there isn't a need for the client to see it. At least for the moment."* D-10 —
  noted as revisitable, not permanently rejected.
- **CAUTH-02's oracle has no "before" recording** and REQUIREMENTS.md's Verification Standard
  singles it out. The design-derived oracle available: count AUTH events a mock relay receives in a
  multi-community / multi-channel scenario and assert it equals the k pubkeys that scope's own
  operations requested — not the union of every key the client holds. Derive k from the operation's
  filter `authors`, independently of what the handler did. Record the RED→GREEN non-vacuity probe.

</specifics>

<deferred>
## Deferred Ideas

- **A standing "am I authenticated" surface for UI** — `authenticated$` is removed per D-10 "at
  least for the moment". If an app needs to show an auth problem *before* attempting an operation,
  the demand-driven per-relay record discussed (url → attempted/authenticated/rejected/reason) is
  the shape to build; it was declined here as premature, not as wrong.
- **Relay-side prompt/AUTH dedupe** — declined at three levels now: forbidden in `applesauce-relay`
  by RAUTH-05, assigned to apps/libraries by REQUIREMENTS.md's Out of Scope table, and declined in
  concord by D-18. If a downstream app with a slow NIP-46 bunker reports duplicate prompts, the
  place to fix it is the app's signer, not either library.
- **Value-signalling the remaining `CLOSED` prefixes** (blocked, rate-limited, invalid) — carried
  forward unchanged from 13-CONTEXT.md and 14-CONTEXT.md's deferred lists. Untouched by this phase.

### Reviewed Todos (not folded)
- `05.1-review-followups.md` — "Phase 05.1 code-review follow-ups". Surfaced by `todo.match-phase`
  at score 0.6, but the match is on generic keywords ("phase", "pre", "status", "2026"); the content
  is gift-wrap/seal helpers in `applesauce-common` with no relation to relay authentication. Not
  folded — same disposition as Phases 13 and 14.

</deferred>

---

*Phase: 15-concord-stream-auth-cleanup*
*Context gathered: 2026-08-13*
