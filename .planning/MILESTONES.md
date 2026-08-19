# Milestones

## v1.2 operation-scoped-relay-auth (Shipped: 2026-08-19)

**Phases completed:** 3 phases, 37 plans, 100 tasks

**Delivered:** NIP-42 authentication moved out of ambient, relay-wide cached state and into the operation that actually receives `auth-required:` — then Concord's stream auth migrated onto that hook and off its own client-wide registry driver.

**Stats:** 269 commits (`e03939d4`..`e5ece2e9`), 208 files changed (+30,492 / −2,326), 14 days (2026-08-05 → 2026-08-19).

**Closeout:** `override_closeout` — 16/16 requirements satisfied, 3/3 phases verified, all three `nyquist_compliant: true`, but one `low` todo and eight dormant seeds were acknowledged rather than resolved at close. See STATE.md → Deferred Items.

**Key accomplishments:**

- **Auth became operation-scoped** (Phase 13) — `onAuthRequired`/`authTimeout`/`authRetries` reach all eight request-like operations (`req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, negentropy) through one shared `authRetry` operator, and pass through `RelayPool`/`RelayGroup`. `authRequiredForRead$`/`authRequiredForPublish$` survive as informational status only — their use as a *pre-block gate* is gone, so an operation that never saw `auth-required:` is never made to wait behind one that did.
- **Throw-as-internal-signal removed from the auth path** (Phase 13, D-01) — auth-required is carried as a value on an internal type and the error classes are constructed only at the caller boundary. This retired four costs the old model imposed, including `count()` catching and re-throwing a signal that was never its own.
- **Operation clocks learned to pause** (Phase 13, D-15) — every operation timeout became a `suspendableTimeout` that stops during an auth phase, so a 10s COUNT budget can absorb a 30s `authTimeout` instead of racing it.
- **A single auth attempt became legible** (Phase 14) — a `:auth` debug namespace traces the NIP-42 lifecycle (challenge → signing → AUTH sent → result) with per-operation attribution, so two concurrent attempts stay distinguishable in one log stream. Proven by an oracle reading real captured `debug` output rather than implementation strings, and hardened at `truncateForLog` against printf-specifier and CWE-117 newline injection from relay-controlled text.
- **Concord's ambient auth machinery deleted** (Phase 15) — `relay-auth.ts` removed outright along with `authenticateStreamKeys`, `version$`, driver reference counting, `ensureAuth()`, relay-status-driven authentication and the client-wide `autoAuthenticate` option. Each community and private-channel engine now owns a `StreamSigners` holder answering only the `missingPubkeys` its own scope holds keys for, and `no-ambient-auth.test.ts` walks both source roots to fail CI on any reintroduction.
- **Verification caught what the suite could not** (Phases 13 and 15) — Phase 13 needed three rounds: round 1 passed incorrectly, round 2 reopened RAUTH-03/07/08, and round 3 caught a regression that reintroduced the same defect class one layer up behind a cast, closed structurally by making the predicate total. Phase 15's re-verification ran its own mutation test and disproved the SUMMARY's account of which code closed the blocking gap.

**Known gaps carried forward:** 23 open review residuals, all now filed — Phase 13's in 999.18 (re-verified before filing; two were already closed), Phase 14's in 999.16, Phase 15's in 999.19. Three Nyquist gaps and five accepted overrides still carried from v1.1. Full detail in [`milestones/v1.2-MILESTONE-AUDIT.md`](milestones/v1.2-MILESTONE-AUDIT.md).

**No release cut.** v1.2 ships no npm release. Its held `applesauce-relay` and `applesauce-loaders` changesets go out with **v7.0.0**, which also carries the relay/auth re-layering cluster (999.23–999.28) — breaking work that came directly out of this milestone's closing design review. Phase 14's WR-06, where a shipped changeset claims a discriminator the code does not make total, is absorbed into 999.24 and corrected before anything publishes.

**Not tagged:** this repo tags per-package via changesets; `v1.2` is a planning milestone, and releases are cut separately.

---

## v1.1 first-fixes (Shipped: 2026-08-04)

**Phases completed:** 12 phases, 87 plans, 203 tasks

**Delivered:** `applesauce-concord` brought into conformance with the CORD-01..07 protocol specs — all 43 findings from the 2026-07-15 audit closed, along with the shared `applesauce-core` cache defect that caused three of them.

**Stats:** 592 commits (`05e68767`..`c7600501`), 541 files changed (+77,363 / −3,980), 21 days (2026-07-15 → 2026-08-04). Test suite grew from a 1,989-test baseline to **2,466 passing / 2 skipped** across 272 files; concord alone went from 189 to 554.

**Closeout:** `override_closeout` — 54/54 requirements satisfied and 12/12 phases verified, but one `low` todo and nine dormant seeds were acknowledged rather than resolved at close. See STATE.md → Deferred Items.

**Key accomplishments:**

- **Core symbol propagation redesigned** (Phases 5 + 5.1) — every symbol write is non-enumerable via `setCachedValue`, `PRESERVE_EVENT_SYMBOLS` is carried explicitly through `pipeFromAsyncArray`/`EventFactory.chain`, and both per-step strip loops are deleted. This was the root cause behind three HIGH concord findings; the memo-vs-carry-forward taxonomy it replaced collapsed into one rule.
- **Rotation and refounding made correct** (Phases 6 + 8) — a Refounding now actually rotates its plane addresses in-session, drops excluded members from the Complete Memberlist, and aborts atomically unless a majority of the protocol relay set acks. Racing rotations converge through a per-epoch down-only latch and a multiset-consistency gate instead of letting the first-arriving generation win.
- **Private channel keying rebuilt** (Phase 7) — `ChannelMetadata.key`/`.epoch` removed so `material.channels` is the sole source of channel key material. A keyless private channel derives nothing instead of silently deriving the public address (the Accordian-blocking H07), and `accessible` reacts to an out-of-band key grant with no control-plane fold required.
- **Authority folds enforce rank** (Phase 9) — Grant, Kick, Ban, and Role folds bind coordinates, reject malformed input without failing every member's community state, and require a non-owner Kick to cite its Grant against the *current* folded roster. Pre-publish `canDo`/`standingOf` guards close the UI-lie where an under-ranked caller's optimistic removal silently no-opped.
- **Wire and document conformance** (Phases 10 + 11 + 12) — reactions, threaded replies, and deletes route through the real factories rather than hand-built identity objects, making the hardcoded-kind wrong path unrepresentable; both document roots opened so unknown top-level fields round-trip; caps enforced against spec constants; and `validateInviteBundle` rewritten as exhaustive mapped-type rule tables that close the malformed-input class rather than adding a fifth named check.
- **Verification hygiene reversed** (standing TEST-01, Phases 5–12) — the milestone existed because all 189 concord tests passed while 9 HIGH bugs were live, every test comparing the implementation against itself. Load-bearing derivations now assert against hand-derived spec oracles computed independently from `crypto.ts`, with recorded RED→GREEN non-vacuity probes proving the new tests fail for the right reason.

**Known gaps carried forward:** three Nyquist validation gaps (Phases 10 and 12.2 partial, 12.1 missing); five accepted overrides (Phase 10 `inviteBundleKey` spec-value test, Phase 12 D-04/D-14, Phase 12.3 WR-08/CR5-01); six backlog phases (999.2/.4/.5/.7/.9/.10 — 999.8 was dropped in the post-close backlog review, its nostr-tools ~2.24 bump having already shipped inside v1.1); nine dormant seeds. Full detail in [`milestones/v1.1-MILESTONE-AUDIT.md`](milestones/v1.1-MILESTONE-AUDIT.md).

**Not tagged:** this repo tags per-package via changesets (`applesauce-core@6.2.0`, …); `v1.1` is a planning milestone, and releases are cut separately.
---

## v1.0 event-store-supports-rumors (Shipped: 2026-07-09)

**Phases completed:** 4 phases, 11 plans, 23 tasks

**Key accomplishments:**

- Genericized all eleven CORE-04 structural helpers over `E extends StoreEvent = NostrEvent` and added a hash-based `verifyRumor` NIP-59 verifier, with zero behavior change for signed-event callers.
- Genericized all 18 CORE-05 event-store interfaces (read, streams, actions, claims, subscriptions, delete/expiration managers, database, memory, missing-loader, and the composite IEventStore/IAsyncEventStore) over `E extends StoreEvent = NostrEvent`, with zero downstream edits.
- Genericized DeleteManager, AsyncDeleteManager, ExpirationManager, and EventMemory over `E extends StoreEvent = NostrEvent`, bridging the three non-CORE-04 helpers they call with localized casts, with zero runtime behavior change.
- Genericized `EventStore` and `AsyncEventStore` over `E extends StoreEvent = NostrEvent` and landed the phase's one intentional runtime change — the constructor now honors an explicit `verifyEvent: undefined` to disable verification while the D-01 `console.warn` still fires — proven by a new focused test, with zero behavior change for default signed stores.
- `claimEvents`/`claimLatest` and the four base models (`EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) genericized over `E extends StoreEvent = NostrEvent`, with a localized store bridge-cast standing in for the not-yet-threaded `Model` interface layer.
- `IEventSubscriptions<E>`'s type parameter made live end-to-end through `Model`/`ModelConstructor`/`ModelEventStore`/`EventModels<E,TStore>`, so `EventStore<E>`/`AsyncEventStore<E>` truly return `E`-typed observables from `event()`/`replaceable()`/`filters()`/`timeline()`, verified clean across the full 18-package workspace build.
- `CastRefEventStore<E>`/`CastConstructor<C,E>`/`castEvent<C,E>`/`castEventStream<C,E>`/`castTimelineStream<C,E>` now generic over `StoreEvent` with `NostrEvent` defaults, the documented contravariance trick intact, and a green full-workspace `pnpm -r build` closing out CORE-06/CORE-07.
- Added `RumorStore` (a thin `EventStore<Rumor>` subclass with `verifyRumor` locked as its non-overridable default verifier) and proved the whole Phase 1-2 generic store stack end-to-end over unsigned rumors with a new 7-case test suite.
- Split `castEvent` into a sig-gated public entry point (`CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent`) and an internal loose `performCast`, restoring the compile-time signature guard Phase 2's generic widening had dropped, without over-tightening concord's real narrowed-kind rumor cast.
- Proved a custom `EventCast<Rumor>` casts an unsigned rumor via `castEvent` against a genuine `RumorStore` (not a bare `EventStore()`), added a `@ts-expect-error` compile-time probe locking WR-01's sig-gate in place, regenerated the export snapshot, and cleared the whole-phase Part A gate (`applesauce-core` test + build green, full `pnpm -r build` exit 0).
- Genericized four structural-only `applesauce-common` helpers (`getNip10References`, `getReactionEmoji`, `getHashtagTag`, `getContentWarning`) over a defaulted `NostrEvent` type parameter, and audited the COMMON-02 targeted-cast set as empty with zero cast/model/factory changes.

---
