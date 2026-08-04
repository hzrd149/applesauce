# Milestones

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
