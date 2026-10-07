# Roadmap: Applesauce

## Milestones

- ✅ **v1.0 event-store-supports-rumors** — Phases 1–4 (shipped 2026-07-09)
- ✅ **v1.1 first-fixes** — Phases 5–12.3 (shipped 2026-08-04)
- ✅ **v1.2 operation-scoped-relay-auth** — Phases 13–15 (shipped 2026-08-19)
- ✅ **v7.0.0 relay-method-layering** — Phases 16–26 (closed 2026-09-28; npm release cut manually)

## Phases

<details>
<summary>✅ v1.0 event-store-supports-rumors (Phases 1–4) — SHIPPED 2026-07-09</summary>

Genericized the applesauce event layer over `E extends StoreEvent = NostrEvent` so it can operate on unsigned NIP-59 `Rumor` events, with zero behavior change for signed-`NostrEvent` consumers. Full details: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md).

- [x] Phase 1: Generic store foundation (4/4 plans) — completed 2026-07-09
- [x] Phase 2: Generic models & casts (3/3 plans) — completed 2026-07-09
- [x] Phase 3: RumorStore & verification (3/3 plans, Part A gate) — completed 2026-07-09
- [x] Phase 4: Common package rumor support (1/1 plan) — completed 2026-07-09

</details>

<details>
<summary>✅ v1.1 first-fixes (Phases 5–12.3) — SHIPPED 2026-08-04</summary>

- [x] Phase 5: Cache Identity Memo Fix (14/14 plans) — completed 2026-07-29
- [x] Phase 5.1: Symbol Propagation Redesign (INSERTED) (13/13 plans) — completed 2026-07-16
- [x] Phase 6: Refounding Rotation & Authority Correctness (3/3 plans) — completed 2026-07-16
- [x] Phase 7: Private Channel Keying (4/4 plans) — completed 2026-07-17
- [x] Phase 8: Rotation Robustness & Consensus (6/6 plans) — completed 2026-07-19
- [x] Phase 9: Authority & Permission Fold Correctness (5/5 plans) — completed 2026-07-19
- [x] Phase 10: Invite Lifecycle & Event Time Consistency (6/6 plans) — completed 2026-07-21
- [x] Phase 11: Messaging Wire Conformance (6/6 plans) — completed 2026-07-29
- [x] Phase 12: Document & Caps Conformance (11/11 plans) — completed 2026-08-01
- [x] Phase 12.3: Transport-Only Extra Relays (INSERTED) (14/14 plans) — completed 2026-07-25

**Breaking changes shipped:** `ChannelMetadata.voice` removed (CORD-03 §2 and CORD-07 §1 both state no per-channel voice flag exists); `ChannelMetadata.key`/`.epoch` removed (client-tracked keying must not ride folded edition metadata).

**Carried forward as debt:** three Nyquist validation gaps (Phases 10 and 12.2 partial, 12.1 missing); five accepted overrides; one `low` follow-ups todo. Detail in STATE.md → Deferred Items.

</details>

<details>
<summary>✅ v1.2 operation-scoped-relay-auth (Phases 13–15) — SHIPPED 2026-08-19</summary>

- [x] Phase 13: Operation-Scoped NIP-42 Auth Hooks (14/14 plans, 3 verification rounds) — completed 2026-08-07
- [x] Phase 14: Auth Lifecycle Debug Logging (9/9 plans) — completed 2026-08-11

**Breaking changes shipped:** none published — v1.2 ships no npm release. Its `applesauce-relay` and `applesauce-loaders` changesets are held for **v7.0.0**, which also carries the relay/auth re-layering cluster (999.23–999.28).

**Carried forward as debt:** 23 open review residuals, all filed — Phase 13's in 999.18, Phase 14's in 999.16, Phase 15's in 999.19. Phase 14's WR-06 (the auth-exhausted `PublishResponse` omitting `.error` while a shipped changeset claims otherwise) is absorbed into 999.24 and corrected before anything publishes. Detail in [`milestones/v1.2-MILESTONE-AUDIT.md`](milestones/v1.2-MILESTONE-AUDIT.md).

</details>

<details>
<summary>✅ v7.0.0 relay-method-layering (Phases 16–26) — CLOSED 2026-09-28</summary>

- [x] Phase 16: Method Layering Foundation & TypeScript 7
- [x] Phase 18: EVENT Family Re-layer — completed 2026-08-20
- [x] Phase 19: COUNT Becomes the High-Level Member — completed 2026-08-21
- [x] Phase 20: AUTH Family Re-layer — completed 2026-08-31
- [x] Phase 21: Group Error Surface — request()/subscription() — completed 2026-09-01
- [x] Phase 22: REQ Family Re-layer — completed 2026-09-01
- [x] Phase 23: Group count() Isolation — completed 2026-09-02
- [x] Phase 24: Negentropy & Sync Re-layer — completed 2026-09-02
- [x] Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 — completed 2026-09-03
- [x] Phase 25.4: Replace the `debug` Dependency — completed 2026-09-06
- [x] Phase 25.5: Repository Extraction Cleanup
- [x] Phase 26: Release Coordination — changeset cleanup only; closed manually 2026-09-28

**Release:** not published by GSD. `next` carries 74 single-sentence changesets bumping all thirteen packages to 7.0.0; the operator publishes a `next` snapshot and the stable release manually. Full detail in [`milestones/v7.0.0-ROADMAP.md`](milestones/v7.0.0-ROADMAP.md).

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Generic store foundation | v1.0 | 4/4 | Complete | 2026-07-09 |
| 2. Generic models & casts | v1.0 | 3/3 | Complete | 2026-07-09 |
| 3. RumorStore & verification | v1.0 | 3/3 | Complete | 2026-07-09 |
| 4. Common package rumor support | v1.0 | 1/1 | Complete | 2026-07-09 |
| 5. Cache Identity Memo Fix | v1.1 | 14/14 | Complete | 2026-07-29 |
| 5.1 Symbol Propagation Redesign (INSERTED) | v1.1 | 13/13 | Complete | 2026-07-16 |
| 6. Refounding Rotation & Authority Correctness | v1.1 | 3/3 | Complete | 2026-07-16 |
| 7. Private Channel Keying | v1.1 | 4/4 | Complete | 2026-07-17 |
| 8. Rotation Robustness & Consensus | v1.1 | 6/6 | Complete | 2026-07-19 |
| 9. Authority & Permission Fold Correctness | v1.1 | 5/5 | Complete | 2026-07-19 |
| 10. Invite Lifecycle & Event Time Consistency | v1.1 | 6/6 | Complete | 2026-07-21 |
| 11. Messaging Wire Conformance | v1.1 | 6/6 | Complete | 2026-07-29 |
| 12. Document & Caps Conformance | v1.1 | 11/11 | Complete | 2026-08-01 |
| 12.3 Transport-Only Extra Relays (INSERTED) | v1.1 | 14/14 | Complete | 2026-07-25 |
| 13. Operation-Scoped NIP-42 Auth Hooks | v1.2 | 14/14 | Complete    | 2026-08-06 |
| 14. Auth Lifecycle Debug Logging | v1.2 | 9/9 | Complete    | 2026-08-11 |
| 16–26. relay-method-layering | v7.0.0 | all | Complete | 2026-09-28 |


**Totals:** 20 phases across three shipped milestones; 135 plans shipped (98 across v1.0/v1.1, 37 across v1.2). v7.0.0 contains 16 phases (Phases 16–26, including 25.1–25.5); release coordination remains last.

## Backlog

### Phase 999.1: Correctly Handle Delete Event `e` Tags for Replaceable Event Versions (BACKLOG)

**Goal:** Correctly apply delete-event `e` tags when they reference versions of replaceable events.
**Source:** [ngit issue](https://gitworkshop.dev/hzrd149.com/applesauce/issues/nevent1qqs0a76lfxteytscg4yrdul6a748vvjynmakdaaw69unt9gf3xdfzuq5erla7?unread=fefb5f4997922e1&gitworkshop-reload=2c022d8#fefb5f4997922e1)
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with $gsd-review-backlog when ready)

### Phase 999.2: Adaptive Relay Signature Verification (BACKLOG)

**Goal:** Investigate and build a flexible, responsive event signature verification system for selected relays that tracks counts of verified good and bad signatures over a configurable time period, gradually reduces Schnorr signature verification as each relay earns trust through valid events, and continues infrequent checks even when a relay is fully trusted; any invalid signature immediately resets that relay's trust to zero and records a permanent or long-standing strike against it.
**Requirements:** TBD
**Open questions:** Trust growth and verification backoff policy, time-window accounting, minimum sampling frequency, and strike persistence and expiry.
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with $gsd-review-backlog when ready)

## v7 release coordination

**Recorded 2026-08-19.** The relay re-layering cluster below is breaking, so it ships as **applesauce v7.0.0**. Everything is on 6.x today (`applesauce-relay` 6.2.1, most of the suite 6.2.0, `applesauce-react`/`applesauce-sqlite` 6.0.0).

| Entry | Breaking? | Why |
|-------|-----------|-----|
| 999.23 amend D-01 + layering rule | no | comments and docs only — but **gates every entry below** |
| 999.24 EVENT re-layer | **yes** | `event()` stops erroring for auth, starts erroring for refusals |
| 999.25 REQ re-layer | **yes** | `reconnect`/`resubscribe` move between public option types |
| 999.26 AUTH re-layer | mostly additive | one breaking edge: the missing-challenge behavior |
| 999.27 `count()` high-level | **yes** | return type changes, options widen |
| 999.28 negentropy re-layer | **yes** | `negentropy()` signature, `sync()` emission type |
| 999.20 group error conditions | **yes** if on by default | `request()` goes from completing empty to erroring |
| 999.21 group `count()` isolation | **yes** | record value shape changes |
| 999.18 / 999.19 residuals | no | non-breaking fixes; can ship on 6.x |

**RESOLVED — v7 is a coordinated suite-wide major (user, 2026-08-19).** A major version bumps **every** applesauce package, whether or not its own surface changed. This is an intentional property of the release process, not an accident of tooling: a consumer can tell at a glance that `applesauce-*@7.x` packages work together, without cross-checking a compatibility matrix. Minor and patch versions remain per-package, which is why the suite sits at 6.0.0 / 6.2.0 / 6.2.1 / 6.2.2 today — all on 6.x, drifting only below the major.

Two consequences for planning v7:

- **The dependency-cascade analysis stops being the deciding factor.** Only `applesauce-wallet` depends on `applesauce-relay` (`^6.0.3`); `applesauce-loaders` deliberately carries **no** relay dependency (D-06 — it mirrors the types structurally). Under lockstep majors that narrowness no longer limits the release, though it does still mean very few packages need *code* changes.

**Corollary — non-breaking work can ride along.** Since every package is being republished anyway, v7 is the cheapest moment to land ecosystem bumps that would otherwise justify their own major: SEED-002 (TypeScript 7), SEED-003 (React 19 while keeping 18), SEED-004 (`@snort/worker-relay` v2). Flagged at the v1.2 close as v7 candidates; this makes the case stronger, not weaker.
