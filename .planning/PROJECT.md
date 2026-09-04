# Applesauce

## What This Is

Applesauce is a reactive Nostr SDK for TypeScript/JavaScript, built as a pnpm monorepo of publishable packages (`core`, `common`, `actions`, `relay`, `loaders`, `react`, `accounts`, `signers`, `sqlite`, `content`, `wallet`, `concord`, and more) layered over a single in-memory `EventStore` and RxJS observables. It gives Nostr client developers event storage, models, timelines, filters, casts, loaders, signers, and React bindings.

## Core Value

The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

## Current State

**Phase 25.1 complete (2026-09-04).** Concord encrypted-media parsing now rejects malformed
AES-GCM nonce lengths through safe typed diagnostics while preserving attachment metadata and exact
wire emission; real cryptographic tests confirm historical per-file keys survive community
refounding and private-channel rekeying.

**Shipped v1.2 operation-scoped-relay-auth (2026-08-19).** Three milestones are complete: v1.0 made
the event layer generic over unsigned rumors, v1.1 brought `applesauce-concord` into conformance with
the CORD-01..07 protocol specs, and v1.2 moved NIP-42 authentication out of ambient relay-wide state
into the operation that actually receives `auth-required:` — then migrated Concord's stream auth onto
that hook and deleted its client-wide registry driver.

v1.2: 3 phases, 37 plans, 16/16 requirements, all three phases Nyquist-compliant. 1,029 tests pass
across `relay`/`loaders`/`concord`; the full workspace builds 14/14.

**No release has been cut from v1.2.** Its held changesets ship with the milestone now in
flight — **v7.0.0 relay-method-layering**, scoped 2026-08-19. The closing design review of v1.2
established that the relay method families are layered wrongly (low-level methods own retry,
reconnect and auth policy that belongs to their high-level counterparts), and correcting that is
breaking across `applesauce-relay`. See ROADMAP.md → Backlog → "v7 release coordination"; **999.23
must be planned first**, as it carries the amended D-01 and the layering rule four other entries
assume.

**Phase 17 complete (2026-08-20).** The v7 correctness riders now have prototype-safe relay
CLOSED classification, independently optional SQLite backend peers, lossless group-pointer relay
round trips, fatal-only Concord UI error state, and acknowledgement-checked invite revocation.
Re-verification passed 14/14 after the exported-admin required-publication path was made fail closed.

Full record: [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md) ·
[`milestones/v1.1-REQUIREMENTS.md`](milestones/v1.1-REQUIREMENTS.md) ·
[`milestones/v1.1-MILESTONE-AUDIT.md`](milestones/v1.1-MILESTONE-AUDIT.md) ·
[`MILESTONES.md`](MILESTONES.md)

**Phase 13 complete (2026-08-07)** — first phase of v1.2. NIP-42 auth is now operation-scoped:
all nine RAUTH requirements validated, 14 plans across 13 waves, suite at **2,585 passing / 2
skipped** across 274 files. The phase's central bet held — auth-on-every-operation is a property
of one shared operator (`packages/relay/src/operators/auth-retry.ts`) rather than eight agreeing
implementations, so each call site is a conversion onto it rather than a reimplementation.

It took three rounds to get there, and the reason is worth carrying forward: one defect class —
a call site's own bookkeeping value (`req()`'s synthetic `OPEN`, later `RelayGroup`'s manufactured
`ERROR`) being counted as real progress by a shared consumer — recurred at each layer it reached.
Making the progress predicate a *required* parameter closed it at the relay layer; it came back one
layer up behind an `as` cast that defeated exactly that guardrail. The fix that finally held was
structural: a predicate total over its own union with no cast, so a new message arm is a compile
error rather than a silent default. Requiring a parameter only helps where a cast cannot erase the
question.

**Phase 14 complete (2026-08-11)** — the auth surface Phase 13 built is now observable. ALOG-01/02/03
all verified; 9 plans across 4 waves, suite at **2,647 passing / 2 skipped** across 277 files. A NIP-42
attempt's position in its lifecycle and its outcome are readable from the `:auth` namespace, and the
coarse three-value `operation` bucket gave way to an exhaustive wire-verb union so two concurrent
operations stay attributable in one log stream.

The carry-forward lesson here is about *verifiability*, not auth. ALOG-03 originally read as a
zero-hits grep — a criterion that could be satisfied while being false — and had to be restated mid-phase
into a derive-once property before it could be honestly checked. Even then the sweep missed a second
derivation, and the regression guard written to prevent exactly that class was structurally blind to it
because it filtered on one namespace segment. Two lessons compound: a criterion phrased as *absence of
evidence* is not a criterion, and a guard that has never been observed to fail is not yet a guard.
Widening it to a total count over the scope is what closed the class.

Phase 14 also shipped a defect of its own kind: relay-controlled text flowed into `debug`'s *format*
argument, so a hostile relay could erase its own log line or forge one identical to a genuine
`accepted AUTH` line. Length-bounding the input looked like the mitigation and wasn't. It was caught by
code review, not by the phase's own oracles, because those oracles only exercised long strings. Fixed at
the single shared formatter so all seven sinks inherit it.

**Phase 15 complete (2026-08-18)** — Concord's stream auth is now operation-scoped, closing v1.2.
All four CAUTH requirements verified; 14 plans (8 original + 6 gap-closure) across 10 waves, suite at
**2,684 passing / 2 skipped** across 278 files. `ConcordRelayAuth` is gone, and `no-ambient-auth.test.ts`
makes its reintroduction fail loudly rather than merely being absent.

The phase took two verification rounds. The first passed its own gates, was marked complete, and was
then reopened by code review: every send into a private channel declared a `waitForAuth` pubkey the
community's own holder was never registered with, so on a gating relay the publish waited out a 30s
timeout, the `.catch` swallowed it, and the optimistic local echo had already rendered the message as
sent. The publish-answerability oracle that existed to catch exactly this had a scenario too narrow to
back its own name — it never performed a private-channel send.

Two lessons compound, and both are about how a fix is *checked*, not how it is written. First: the
gap-closure plan shipped two mechanisms for that blocker — an enumerated one (register the held private
channel keys) and a structural one (carry the finalizing `GroupKey` out of the builder so the declared
and registered key cannot drift). The suite went green and both were assumed load-bearing. Round-2
review established by mutation that only the structural one does any work; the enumerated one is
unreachable on that path and left dead code behind a comment that will mislead the next reader. A
passing test does not tell you *which* of two changes closed the gap. Second: the same review's earlier
round had asserted a Prettier finding was "introduced by this phase" — checking against the phase base
refuted it outright, while the same check confirmed the real blocker. Severity labels are hypotheses
until someone checks them against the base, in both directions.

## Current Milestone: v7.0.0 relay-method-layering

**Goal:** Make every relay method family honour one rule — a low-level method (`event()`, `req()`,
`negentropy()`) is a single interaction with the relay; a high-level method (`publish()`, `request()`,
`subscription()`, `count()`, `sync()`, `authenticate()`) owns the configurable policy: retries,
reconnects, auth retries, resubscribes, timeouts, and concurrency — then ship the result, plus v1.2's
held changesets, as the coordinated `applesauce-*@7.0.0` major.

**Target features:**

- **Re-layering core (999.23–999.28).** 999.23 amends D-01 to permit throw-as-signal where the consumer
  is an aggregator or a retry layer, and records the low/high layering rule — comments and docs only,
  but D-01 is cited **14 times in shipped source** and updating those is in scope. It lands first;
  four entries cite it. Then: 999.24 EVENT family (`event()` sends once and throws, `publish()` owns the
  auth loop; absorbs 999.16's WR-06, re-opens RAUTH-07 with a recorded restatement); 999.25 REQ family
  (`reconnect`/`resubscribe`/auth retry move up; `subscription()` becomes owner of the re-establish loop —
  largest and highest-risk); 999.26 AUTH family (`authenticate()` acquires a challenge rather than
  reading one and re-signs when it moves under a slow signer; **subsumes 999.22**); 999.27 `count()`
  becomes its family's only member, gaining `reconnect`/`retries`/`timeout` and NIP-45's `approximate`
  and `hll` with validation instead of an unchecked cast; 999.28 negentropy (`negentropy()` emits per
  round without blocking, `sync()` owns auth/clock/reconnect/transfer concurrency and widens to a
  `received`/`sent`/`send-failed` union; **absorbs 999.13**).
- **Group error surface (999.20, 999.21).** Caller-supplied error conditions for `RelayGroup.request()`
  and `subscription()`, defaulting to "every relay failed" and raising an aggregate carrying per-relay
  causes; the operation clock becomes a condition, which is what gives `subscription()` a clock at all.
  999.21 brings per-relay isolation to `RelayGroup.count()` — one dead relay currently destroys every
  relay's number — plus progressive record accumulation and the same error vocabulary.
- **Fixes and review residuals.** 999.14 `parseClosedError`'s prototype-chain lookup; 999.16 / 999.18 /
  999.19 (Phase 14, 13 and 15 residuals — WR-06 must be settled before publish, and 999.19's WR-10
  permanent `error$` latch is the one to fix first there); 999.12 `applesauce-sqlite` optional peer
  dependencies; 999.15 NIP-29 group address ports and `ws://`.
- **Ecosystem riders.** SEED-002 TypeScript 7, SEED-003 React 19 while keeping 18, SEED-004
  `@snort/worker-relay` v2. All three are minor-eligible on their own; pulled in because every package
  republishes under the lockstep major anyway.

**Key context:**

- **Lockstep majors.** `.changeset/config.json` puts all fourteen packages in one `linked` group, so one
  `major` changeset bumps every member. Do not hand-write eleven changesets — write against the package
  that actually changed. Confirm on a dry run before cutting, since `linked` and
  `updateInternalDependencies: "minor"` interact.
- **v7 is `applesauce-concord`'s first official stable release (user, 2026-08-19).** It has only ever
  published as `next`-tagged snapshots, so its changelog starts from zero rather than explaining removals
  from snapshots — Phase 15's deletions need no migration note. The consequence to accept deliberately:
  999.19's residuals and the FUT-01 channel-conversion gap ship as-is in a stable release.
- **v1.2 cut no npm release.** Its held `applesauce-relay` and `applesauce-loaders` changesets go out here.
- **Sequencing is load-bearing.** 999.23 first; 999.24 before 999.25 so the pattern proves on the smaller
  surface; 999.27 before 999.21, which consumes it; 999.20 before 999.25, since both touch the same two
  methods and the same clock.
- **Carry the closed defects forward.** `req()`'s per-attempt `defer` factory, the `resubscribeHolder`
  call-scoped object, and `isReqProgress`'s exclusion of the synthetic `OPEN` each exist because plans
  13-08..13-14 closed specific reentrancy and retry-counting defects (CR-01/CR-02/CR-03, WR-01).
  Re-verify them RED/GREEN rather than assuming a green suite means they survived.
- **999.28 has no working behavior to preserve** — multi-round sync has never reached the wire — and no
  current test can see it: `relay.test.ts:2748` deliberately keeps both sides under 32 items. Any test
  here must exceed the frame-size threshold to force a second round.
- **Deliberately out of scope:** 999.17 (`debug` replacement — wants a major, but the largest rider by far);
  999.2 / 999.7 / 999.9 concord entries; FUT-01 / FUT-02; the three Nyquist validation gaps.

<details>
<summary>Shipped: v1.2 operation-scoped-relay-auth (2026-08-19)</summary>

## Milestone: v1.2 operation-scoped-relay-auth — SHIPPED

**Goal:** Move NIP-42 authentication out of ambient, relay-wide cached state and into the
operation that actually receives `auth-required:`, then migrate Concord's stream auth onto that
hook instead of its own client-wide registry driver.

**Target features:**

- **Operation-scoped auth hooks** — `onAuthRequired` / `authTimeout` / `authRetries` across
  `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy in
  `applesauce-relay`, threaded through `applesauce-loaders`' sync loader. Promoted from backlog
  999.5, which carries a full drafted plan on disk.
- **NIP-42 lifecycle debug logging** in `applesauce-relay`, so an auth attempt's position in its
  lifecycle and its success/failure reason are observable rather than opaque. Promoted from
  backlog 999.4; scope includes SEED-001's `packages/loaders/` sweep (derive each `Debugger`
  once; never `.extend()` at a log call site).
- **Concord stream-auth cleanup** — per-operation handlers owned by each community and
  private-channel engine, retiring the client-wide append-only signer registry, its relay driver
  reference counting, and `ensureAuth()`. Promoted from backlog 999.11.

**Key context:** `waitForAuth` changes meaning — from "pre-block this operation if the relay-wide
flag is set" to "after this operation receives `auth-required:` and the handler resolves, wait
for this auth state before retrying". That is a behavior change for two *published* packages
(`applesauce-relay`, `applesauce-loaders`), so both need changesets; concord is unreleased and
needs none. The Concord cleanup is hard-blocked on the relay hooks landing first, including both
the paginated REQ and negentropy sync paths.

**Remaining backlog candidates** (deliberately not in this milestone): **999.7** Phase 8
rotation-robustness residuals — 12.3's majority-ack gate may have overtaken WR-01; check before
scoping. **999.9** invite-bundle rule-table hardening — guardrail only, zero live defects.
**999.2** concord media epoch-key decryption audit — its stated premise looks wrong:
`helpers/imeta.ts` carries per-file keys in the message's own tag rather than resolving from
epoch state, so there may be nothing to audit. **999.10** shipped 2026-08-05 as quick task
`260805-ds0` (PR #89). Also outstanding: FUT-01/FUT-02 feature gaps; three Nyquist validation
gaps (`/gsd-validate-phase` on 10, 12.1, 12.2); five accepted overrides; the `low` 05.1
follow-ups todo; and eight still-dormant seeds.

</details>

## Requirements

### Validated

<!-- Shipped and confirmed valuable — inferred from existing published packages. -->

- ✓ In-memory `EventStore` with insert/update/remove streams, delete + expiration handling, and model subscriptions
- ✓ Reactive models (event, replaceable, timeline, filters) over RxJS observables
- ✓ Cast infrastructure (`EventCast`, `castEvent`, cast streams) for signed events
- ✓ NIP-specific helpers/models/casts/factories in `applesauce-common`
- ✓ SQLite/async event database adapters
- ✓ Core `EventStore<E>`/`AsyncEventStore<E>` operate over unsigned NIP-59 `Rumor` events via a generic `E extends StoreEvent` parameter — v1.0
- ✓ `RumorStore` convenience class verifies rumors by recomputed event hash (`verifyRumor`, non-overridable default) — v1.0
- ✓ Constructor honors explicit `verifyEvent: undefined` to disable verification — v1.0
- ✓ Core helpers, store interfaces, managers, models, and cast infrastructure generic over `E extends StoreEvent` (`NostrEvent` defaults) — v1.0
- ✓ `applesauce-common` structural helpers genericized to support rumors (Part B; casts audited, kept `NostrEvent` per conservative scope) — v1.0
- ✓ A Refounding rotates every plane address and the epoch walk addresses each held epoch distinctly — Validated in Phase 6 (ROTATE-01/02)
- ✓ A Refounding removes excluded members from the Complete Memberlist — Validated in Phase 6 (ROTATE-04)
- ✓ A root Refounding is honored only from a rotator who strictly outranks every removed target, on both the send and receive paths — Validated in Phase 6 (AUTH-01/02)
- ✓ Protocol caps, tag shapes, and unknown-field round-trip discipline match the specs — Validated in Phase 12: Document & Caps Conformance (WIRE-06/07/08/09/10/12). Channel/community `name` (64B) and `description` (10000B) are capped by UTF-8 byte length on write; the Community List enforces the 50-membership protocol constant; both self-encrypted list documents round-trip unknown **top-level** fields, so two clients sharing one npub cannot wipe each other's data; the channel-edition fold validates every declared field through type-derived rule tables, so a hostile non-boolean `deleted` cannot yield a visible-but-silently-dead channel
- ✓ Regression tests assert against independently-derived spec values, not against implementation output — Validated in Phase 12 (TEST-01, standing across Phases 5–12; closed once all eight passed their own verification)
- ✓ Cache identity memos do not survive an object spread — v1.1 (Phase 5, then superseded by Phase 5.1: every symbol write is non-enumerable via `setCachedValue` and the pipeline carries `PRESERVE_EVENT_SYMBOLS` explicitly, so the memo-vs-carry-forward distinction collapsed into one rule rather than two conventions a cleanup could confuse)
- ✓ A channel Rekey rotates the channel's message plane — v1.1 (Phase 7, ROTATE-03/CHAN-05; both independent root causes of H08 fixed together)
- ✓ Private channel access derives only from held key material, never from `community_root`, and consumers can distinguish visible metadata from key possession — v1.1 (Phase 7, CHAN-01/02/03; `channels$` emits `ChannelView[]` with a client-local `accessible` flag that reacts to an out-of-band key grant alone. Unblocks the downstream Accordian consumer)
- ✓ Channel key material comes from `material.channels`, never from Control-Plane edition JSON — v1.1 (Phase 7; `ChannelMetadata.key`/`.epoch` removed outright)
- ✓ Revocation survives a lagging relay — v1.1 (Phase 10, INVITE-02; `joinByLink` resolves the invite coordinate to its NIP-01 newest event across the whole relay union before checking revocation, so one honest relay serving a fresher tombstone closes the link)
- ✓ Event time is one clock read: `created_at * 1000 + ms` is a true decomposition of a single instant — v1.1 (Phase 10, TIME-01/02/03; a single `splitTime` read threads through snapshot chunking so all N chunks share one instant)
- ✓ Attacker-crafted invite bundles fail closed at the validation boundary — v1.1 (Phase 12.3; `validateInviteBundle` rewritten as four exhaustive mapped-type rule tables plus a rebuild-never-spread walker, closing the class rather than adding another named check)

- ✓ NIP-42 auth is operation-scoped: `onAuthRequired`/`authTimeout`/`authRetries` on all eight request-like operations, passing through `RelayPool`/`RelayGroup` and both `SyncLoader` paths — v1.2 (Phase 13, RAUTH-01..09). An operation that never received `auth-required:` is no longer pre-blocked by one that did; the relay-wide flags survive as informational status only
- ✓ A single NIP-42 auth attempt is legible from debug output alone — challenge, signing, AUTH sent, result, and why it failed — with outcomes attributable to the operation that triggered them — v1.2 (Phase 14, ALOG-01/02). Proven against real captured `debug` output, not implementation strings
- ✓ Every `Debugger` in `packages/loaders/` is derived once per lifetime, never on a path a reactive pipeline can re-enter — v1.2 (Phase 14, ALOG-03; closes SEED-001). Restated from the original wording, which tested for a pattern that does not exist in this monorepo and so passed vacuously
- ✓ Concord authenticates per scope, not per client: each community and private-channel engine answers only the `missingPubkeys` its own scope holds keys for, and a reconnect re-authenticates exactly that set — v1.2 (Phase 15, CAUTH-01/02/04)
- ✓ Concord's client-wide auth driver machinery is gone — `relay-auth.ts` deleted along with `authenticateStreamKeys`, `version$`, driver reference counting, `ensureAuth()`, relay-status-driven authentication and `autoAuthenticate`, with a two-root structural guard failing CI on reintroduction — v1.2 (Phase 15, CAUTH-03, widened from stream-keys-only to cover the user-key half)
- ✓ Relay/SQLite/group-pointer correctness and Concord residual publication honesty — v7.0.0 (Phase 17, FIX-01/02/03 and RESID-01/02). Hostile CLOSED prefixes cannot reach the prototype chain, SQLite consumers install one backend, compatibility pointers retain relay identity, transient AUTH stays out of fatal UI state, and invite revocation requires acknowledged publication
- ✓ React 19 workspace support retains the React 18 consumer contract, and both OPFS examples run on `@snort/worker-relay` v2 without destructive migration — v7.0.0 (Phase 25, ECO-02/03)
- ✓ Concord encrypted attachments retain their own file keys across community refounding and private-channel rekeying, and malformed AES-GCM nonce lengths fail safely at parse time — Validated in Phase 25.1 (CONC-F3)

### Active

<!-- v7.0.0 relay-method-layering. REQ-IDs live in REQUIREMENTS.md; these are the outcomes they serve. -->

- [ ] Every relay method family splits cleanly: a low-level method is one interaction with the relay and reports its outcome; a high-level method owns retries, reconnects, auth retries, resubscribes, the operation clock, and concurrency
- [ ] D-01 states the rule that actually holds — throw-as-internal-signal is a smell *except* where the immediate consumer is an aggregator or a retry layer — and all 14 shipped citations say so too
- [ ] A group operation reports total failure as an event: `RelayGroup.request()`/`subscription()` error through a caller-supplied condition raising an aggregate with per-relay causes, instead of completing empty or hanging silently
- [ ] One failing relay costs the caller that relay's result, not the whole group's — `RelayGroup.count()` isolates per relay and accumulates progressively
- [ ] `count()` returns what NIP-45 defines (`approximate`, `hll`) through validation rather than an unchecked cast, so a cross-relay aggregate is constructible at all
- [ ] `authenticate()` acquires a challenge rather than reading one, and a challenge that moves under a slow signer produces a retried auth rather than a misreported relay refusal
- [ ] Multi-round negentropy reconciliation reaches the wire, transfers per round without stalling the protocol, and reports both directions honestly
- [ ] The v7.0.0 major publishes: all fourteen packages in lockstep, v1.2's held changesets included, `applesauce-concord` cut as its first official stable release, and no changeset claiming behavior the code does not have

### Out of Scope

<!-- Explicit boundaries. -->

- Converting all of `applesauce-common` to generic event types in the first pass — only helpers/casts with a concrete rumor use case are migrated, others stay `NostrEvent`
- Overload-heavy compatibility wrappers — prefer generic defaults (`= NostrEvent`) instead
- Changing public runtime behavior for default `EventStore` users — migration is type-level and runtime-light
- CORD-07 §2/§3/§5/§6/§7 voice transport (broker token grants kind 27235, AES-GCM framing, rendezvous, SFU) — HTTPS/WebRTC concerns, not Nostr event handling, and defensibly outside an events SDK (audit L13, FUT-02). *Reason still valid after v1.1 — nothing in the milestone moved the SDK boundary.*
- Public↔private channel conversion and channel rename (CORD-03 §2) — a genuine feature gap, not a conformance defect; deferred to a feature milestone (audit L12, FUT-01). *Reason still valid; now a candidate input for the next milestone, since v1.1 removed the conformance work that would have conflicted with it.*
- Re-auditing `concord-audit.md`'s "verified correct" register — seven agents checked that ground against both sides and found it faithful. *Reason weakened, deliberately kept: the register wrongly cleared `rollForwardChannel`, so it is a prior, not a proof. Treat it as such if a future defect points into cleared ground.*

## Context

- Codebase fully mapped under `.planning/codebase/` (ARCHITECTURE, STRUCTURE, STACK, CONVENTIONS, EVENT_KIND_PATTERNS, TESTING, INTEGRATIONS, CONCERNS) on 2026-07-08.
- Detailed migration plan exists at `.planning/rumor-store-migration.md` — the authoritative spec for this milestone.
- NIP-59 `Rumor` = `UnsignedEvent & { id: string }`; verified locally only by checking `getEventHash(rumor) === rumor.id`. Authorization/validity is assumed handled by the protocol layer that produced the rumor.
- This is the first GSD-tracked milestone; the packages themselves are already published and in use.
- **Shipped v1.0 (2026-07-09):** 4 phases, 11 plans, 23 tasks; 99 files changed (+7519/-427). A runtime-light type migration — `applesauce-core` fully generic over `StoreEvent`/`Rumor` with `RumorStore` + sig-gated `castEvent`; `applesauce-common` structural helpers genericized. Gates green: `applesauce-core` 601 tests, `applesauce-common` 500 tests, full workspace `pnpm run build` (18/18). All 16 v1 requirements satisfied, milestone audit passed, 0 open threats.
- **Known follow-ups (deferred):** COMMON-F1/F2 (genericize remaining common casts/helpers one-by-one as concrete rumor needs arise); a pre-existing `getHashtagTag` unsafe-`undefined` cast; a migration release-note for the `verifyEvent: undefined` verification-disable semantics.
- **v1.1 authoritative spec:** `.planning/concord-audit.md` — the 2026-07-15 conformance audit of `packages/concord/src/` against CORD-01..07, produced by seven parallel agents (one per spec doc) and orchestrator-verified. 43 findings: 9 HIGH, 17 MEDIUM, 4 suspected, 13 LOW. Carries file:line, the violated spec sentence, symptom, and fix per finding, plus a "verified correct" register marking ground that does not need re-auditing.
- **Why v1.1 exists:** a downstream app reported an incomplete member list after a Refounding. Root cause was `buildInviteBundle` dropping an optional `refounder` field from a hand-rolled literal — invisible to TypeScript, silent at runtime, green on all 189 tests. The audit was commissioned on the premise that a defect that quiet was unlikely to be alone; it was not. Nearly every finding is one of four variants of the same mistake: a guard that defaults to permit, a hand-rolled literal that drops an optional field, a correct helper that exists but is never called (`splitTime`, `store.replaceable`, `canRemoveSelf`, `grantLocator`), or a `catch`/`continue` that degrades where the spec says MUST.
- **Test-methodology finding (drives a v1.1 requirement):** all 189 concord tests passed while 9 HIGH bugs were live, because every test compares the implementation against itself. A four-line probe deriving the expected address from the spec formula caught the worst bug instantly. Spec-derived assertions are the gap.
- **CONCORD-H07's blocked downstream consumer (Accordian) is unblocked as of v1.1 Phase 7.** Private channel metadata without held key material previously derived the *public* address, so a composer could publish private content to a plane every community member can derive. Their acceptance criteria and five required tests were adopted verbatim into the audit register and are satisfied; `channels$` now carries a client-local `accessible` flag that reacts to a Direct Invite landing with no metadata edition change — the exact scenario they reported.
- **Shipped v1.1 (2026-08-04):** 12 phases, 87 plans, 203 tasks; 592 commits, 541 files changed (+77,363/−3,980) over 21 days. All 43 audit findings closed, 54/54 requirements satisfied, 12/12 phases verified, cross-phase integration clean, 5/5 E2E flows traced. Full workspace suite **2,466 passed / 2 skipped** across 272 files (from a 1,989 baseline). Closed as `override_closeout`: one `low` todo and nine dormant seeds acknowledged rather than resolved.
- **Not git-tagged, by decision.** This repo tags per-package via changesets (`applesauce-core@6.2.0`, …). `v1.0` and `v1.1` are planning milestones; package releases are cut separately and independently.
- **What v1.1 taught about verification.** Green tests remained necessary but not sufficient throughout. The milestone's own gap waves repeatedly found that a fix was real but its *test* compared the implementation to itself, or that a comment describing an invariant was false. Two habits came out of it and are worth keeping: assert against a value derived independently from the spec, and record a RED→GREEN non-vacuity probe so a passing test is known to fail for the right reason.
- **Known deferred at close:** three Nyquist validation gaps (Phases 10 and 12.2 partial, 12.1 missing); five accepted overrides; one `low` follow-ups todo with three cosmetic items. Enumerated with full context in STATE.md → Deferred Items.

## Constraints

- **Tech stack**: TypeScript 5.8–5.9, pnpm 11 workspace, Node >=20.19, RxJS, `nostr-tools`. Browser ES2022 targets must keep working.
- **Compatibility**: Default `EventStore` (no type param) must remain a signed `NostrEvent` store with unchanged behavior; downstream packages must keep compiling with minimal migration.
- **Sequencing**: `applesauce-common` migration (Part B) only begins after the core migration (Part A) is proven — rumor store + `EventCast<Rumor>` tests green and `applesauce-core` builds clean.
- **Verification**: `pnpm --filter applesauce-core test` + `build` minimum; broader `pnpm run build` when exports/downstream types are affected.
- **v1.1 sequencing**: the `applesauce-core` cache fix lands before any concord rotation work — H01 currently *masks* H02, so fixing H01 alone activates a latent memberlist bug. H08 has two independent root causes (metadata threading **and** the channel-plane memo); fixing either alone leaves a rekeyed channel on its old plane.
- **v1.1 test standard**: every fix carries a regression test asserting against an **independently-derived spec value**, not against implementation output. Comparing the implementation to itself is precisely what let all 43 findings pass CI.
- **v1.1 breaking changes** (accepted): remove `ChannelMetadata.voice` (CORD-03 §2 and CORD-07 §1 both state no per-channel voice flag exists); remove `ChannelMetadata.key`/`.epoch` (client-tracked keying must not ride folded edition metadata). Both need changesets and migration notes.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Genericize core `EventStore<E>` rather than fork a separate store | Reuse model/timeline/filter/claim/cast infrastructure; avoid duplication | ✓ Good — one generic store, zero duplication, all downstream packages still build |
| Add `RumorStore extends EventStore<Rumor>` convenience class | Ergonomic default for rumor consumers with `verifyRumor` wired in | ✓ Good — thin subclass, `verifyRumor` locked via `Omit<…, "verifyEvent">` |
| Keep `verifyRumor` = hash-only check | Rumors come from a protocol layer that already verified auth/validity | ✓ Good — documented integrity-not-authorization boundary |
| Defaults stay `= NostrEvent` everywhere | Minimize downstream migration churn | ✓ Good — zero behavior change; existing tests + export snapshots unchanged |
| Migrate `applesauce-common` only after core proves out (Part A gate) | De-risk the broad type change one layer at a time | ✓ Good — gate held; common work was minimal (4 helpers) once core was proven |
| Sig-gate `castEvent` input (`CastEventInput<T>`) + internal `performCast` | Restore the compile-time guard the Phase-2 generic widening dropped without over-tightening real rumor casts | ✓ Good — signed casts reject rumors at compile time; concord's rumor cast still compiles |
| Keep common casts `NostrEvent` (COMMON-02 empty targeted set) | No common cast has a concrete rumor use case; their `KnownEvent<K>` types are out-of-scope to genericize | ⚠️ Revisit — COMMON-F1/F2 will genericize one-by-one as needs arise |
| Fix the cache-memo defect centrally in `applesauce-core`, not locally in concord (v1.1) | The local fix patches 3 call sites and leaves the trap armed for the next caller. Central fix's only behavior change is that spread/`Object.assign` stop copying the cache — `JSON.stringify`/`Object.keys`/`Reflect.get` are unaffected either way, and ~all 101 call sites cache onto immutable signed `NostrEvent`s that are never spread. Proven not to disturb the deliberate `EncryptedContentSymbol` carry-forward (those 3 sites hand-roll their own writes); full monorepo green at 1989 tests. | ✓ Good — central fix held. It also exposed that a *documented two-category convention* was the wrong shape, which is what Phase 5.1 corrected |
| Insert Phase 5.1 to redesign symbol propagation rather than keep Phase 5's documented taxonomy | Phase 5 shipped a memo-vs-carry-forward taxonomy plus a comment pass across 22 files — and then a review found 14 of those comments were themselves false. A convention that needs 35 hand-audited call sites to stay true is not a convention; it is a standing defect source | ✓ Good — all symbol writes are now non-enumerable via one helper, carry-forward is an explicit whitelist the pipeline copies, and both strip loops are gone. The comment burden went with them |
| Scope v1.1 to all 43 findings rather than HIGH-only | HIGH-only still drags in a breaking change (H08 needs `ChannelMetadata.key` deleted), so the compatibility cost is paid either way; and the MEDIUM/LOW set is mostly the same four defect shapes, cheaper to fix in one pass than to re-derive context for later | ✓ Good — 43/43 closed. The premise held: the four defect shapes recurred throughout, so context carried across findings instead of being re-derived per fix |
| Make TEST-01 (spec-derived assertions) a standing criterion across Phases 5–12, not one phase's deliverable | All 189 concord tests passed while 9 HIGH bugs were live because every test compared the implementation to itself. A phase permitted to assert against its own output would reintroduce the milestone's root cause | ✓ Good — the sharpest case proved the point: Phase 7's spec-derived probe of the CORD-03 §1 channel derivations is exactly what exposed H07. Closed at Phase 12 once all eight phases passed their own criterion |
| Close defect classes structurally rather than patching enumerated instances | Repeated gap-closure rounds kept surfacing the next instance of the same class — a rule table drifting from its type, a symbol copied without a disposition, a validation check missed on a fifth field | ✓ Good — the pattern the milestone converged on. `validateInviteBundle`'s mapped-type rule tables, `copySymbolsToDuplicateEvent`'s tuple arity, and `CHANNEL_KEY_STRIPPED_FIELDS` deriving from its fold disposition each make the bad state a compile error instead of a review finding |
| Remove `ChannelMetadata.voice` and `.key`/`.epoch` as accepted breaking changes | CORD-03 §2 and CORD-07 §1 both state no per-channel voice flag exists; and client-tracked keying riding folded edition metadata is the root of H06/H07/H08 | ✓ Good — concord is unreleased, so the break cost nothing downstream. `material.channels` as sole key source made a keyless private channel derive nothing instead of silently deriving the public address |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-03 — Phase 25 ecosystem riders verified complete. React 18/19 share one rendering suite, worker-relay v2 preserves existing OPFS data, and Phase 26 release coordination is next.*

---
*Last updated: 2026-08-20 — Phase 17 correctness fixes and Concord residuals verified complete (14/14 must-haves).
The sole initial verification gap was closed by making exported-admin required publication fail closed
when no strict publisher is configured; Phase 18 is next, with no automatic transition performed.*

---
*Last updated: 2026-08-19 — milestone v7.0.0 relay-method-layering scoped via /gsd-new-milestone.
Scope assembled from the backlog rather than fresh discovery: the 999.23–999.28 re-layering core,
999.20/999.21's group error surface, four residual entries (999.14, 999.16, 999.18, 999.19), two
unrelated package fixes (999.12, 999.15), and three ecosystem seeds (SEED-002/003/004) pulled in
because the lockstep major republishes every package anyway. Two decisions taken at scoping: the
milestone carries the release version rather than continuing the v1.x planning sequence — this is
the first milestone that maps 1:1 to a package release — and **v7 is `applesauce-concord`'s first
official stable release** (user), which settles the open question recorded in ROADMAP.md's v7
release coordination note. 999.17 (`debug` replacement) was considered and deliberately left in the
backlog: it is the one rider that genuinely needs a major, but also the largest by far.*

---
*Last updated: 2026-09-04 — Phase 25.1 complete; Concord media attachment parsing and historical-key behavior verified 10/10.*

*Last updated: 2026-08-18 — Phase 15 complete; milestone v1.2 operation-scoped-relay-auth fully executed. Started from three promoted
backlog items (999.5, 999.4, 999.11) plus SEED-001's loaders sweep. Every premise was verified
against the code before scoping: the relay-wide pre-block is live at `relay.ts:846/944/995/1063`,
no `onAuthRequired` exists yet, and concord's churn mechanism is `relay-auth.ts:174`'s
`combineLatest([relay.challenge$, this.version$])` re-authing the whole registry on every key add
(`:65`). Noted gap: 999.11 cites `.planning/debug/concord-multi-user-auth-churn.md` as root-cause
evidence, but that file was never committed — the mechanism is confirmed independently, the
reproduction is not.*

*Updated 2026-08-11 — Phase 14 (auth lifecycle debug logging) complete: 9/9 plans, ALOG-01/02/03
verified, suite at 2,647 passing. Two code-review findings were closed as gap plans (14-08, 14-09);
eight were deliberately backlogged as ROADMAP item 999.16. Next: Phase 15, Concord stream-auth cleanup.*

*Last updated: 2026-08-19 after the v1.2 operation-scoped-relay-auth milestone. Full evolution review completed: "What This Is" and Core Value re-checked and unchanged (v1.2 restructured how auth reaches an operation, not what the SDK is); all v1.2 requirements moved to Validated; Current State rewritten with the v7 release constraint; the next milestone recorded as v7.0.0 relay/auth re-layering with 999.23 flagged as the required first phase.*

*Prior: 2026-08-04 after the v1.1 first-fixes milestone. Full evolution review completed: "What This Is" and Core Value re-checked and unchanged (v1.1 was a conformance milestone in `applesauce-concord`; it did not shift what the SDK is or what matters most about it); all eight v1.1 Active requirements moved to Validated; Out of Scope audited with each reason re-confirmed; six Key Decisions resolved to outcomes; Context updated with shipped state.*

*Prior: 2026-08-01 — Phase 12 complete (document & caps conformance; re-verification passed 7/7 after a gap wave closed CR-01, the channel-fold type-validation regression, as a class via type-derived rule tables rather than by enumeration).*
