# Requirements: Applesauce — v1.1 first-fixes

**Defined:** 2026-07-15
**Core Value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.
**Authoritative spec:** `.planning/concord-audit.md` — every requirement below cites its finding ID (H##/M##/S##/L##), which carries file:line, the violated spec sentence, symptom, repro, and fix.

Each requirement is phrased as the behavior the SDK must exhibit. "Client" = a Nostr app consuming these packages.

## v1.1 Requirements

### Cache Semantics — `applesauce-core` (CACHE)

*Must land first: CACHE-01 is the root cause of ROTATE-01/02/03, and H01 currently masks H02 (ROTATE-04).*

- [x] **CACHE-01**: A value memoized by `setCachedValue`/`getOrComputeCachedValue` does not survive an object spread — a copy with changed fields recomputes instead of returning the source's stale memo *(H01 root cause; `core/helpers/cache.ts:15`)*
- [ ] **CACHE-02**: The cache helper documents the identity-memo vs carry-forward-payload distinction, so a future cleanup cannot collapse `EncryptedContentSymbol`'s deliberate enumerable write onto the memo helper *(H01 note; the two conventions are currently distinguished only by which write mechanism an author happened to reach for)*
- [x] **CACHE-03**: Encrypted-content plaintext still survives the factory pipe and signing — `getEncryptedContent`/`getHiddenTags` read correctly off a signed event built through spread operations *(regression guard for CACHE-01; `core/operations/tags.ts:87`)*

### Key Rotation & Epoch Correctness (ROTATE)

- [ ] **ROTATE-01**: A Refounding derives its new epoch's control, guestbook, and rekey addresses from the newly minted root — `rollForward(...).control.pk` equals the spec formula over the new root *(H01a; Refounding is currently a no-op in-session, so a removed member keeps reading traffic)*
- [ ] **ROTATE-02**: The epoch walk addresses each held epoch distinctly, so historical epochs are actually fetched *(H01b; all per-epoch materials currently resolve to one address)*
- [ ] **ROTATE-03**: A channel Rekey derives the new epoch's message plane — `rollForwardChannel` output addresses the new key/epoch *(H01c; second root cause of H08)*
- [ ] **ROTATE-04**: A Refounding removes excluded members from the Complete Memberlist — the new epoch's Guestbook is seeded only by the snapshot, and prior-epoch entries/observations do not resurrect them *(H02; currently masked by H01 — activates when CACHE-01 lands)*
- [ ] **ROTATE-05**: A transient signer error while decrypting a rekey blob is retried, never interpreted as removal *(H09; a NIP-46 bunker blip currently self-evicts the user permanently)*
- [ ] **ROTATE-06**: Two rotations racing to one epoch converge down-only — a held epoch re-converges to a strictly lower sibling and can never re-fork *(M01; the community currently splits in half silently)*
- [ ] **ROTATE-07**: The winning rotation is computed among all authorized, complete, continuity-checked candidates, not only those carrying our blob *(M02)*
- [ ] **ROTATE-08**: A rotation cites the Grant it acts under (`vac`) and a receiver verifies it against its folded Roster before honoring it *(M03; a just-demoted admin's rotation is currently honored by any lagging client)*
- [ ] **ROTATE-09**: Compaction and snapshot wraps publish only after the root roll's publication is confirmed, and adoption is gated on it *(M04)*
- [ ] **ROTATE-10**: Rotation chunk sets correlate on `chunkCount`, so a resumed rotation's stale generation cannot complete a set and trigger a false removal *(S03 — verify the resume path can emit a differing `n` before implementing)*
- [ ] **ROTATE-11**: `prevepoch` identity is validated across a rotation's chunks *(L08)*
- [ ] **ROTATE-12**: Historical epoch material does not inherit the tip's `refounder` — a snapshot is honored only from the npub whose Refounding minted that epoch *(L01; latent today, a forged-roster vector the moment any per-epoch fold is surfaced)*
- [ ] **ROTATE-13**: A Refounding that cannot reliably fold the whole Control Plane aborts rather than publishing a partial compaction *(M-conflict — **BLOCKED on ruling**: the CORD-06 agent read this as a HIGH silent-skip; the CORD-02 agent read the same lines as correct-by-design, since `controlHeadsWithSeals` deliberately re-decodes wraps to restore stripped seals. Adjudicate before implementing; may resolve to "no change needed")*

### Authority & Permissions (AUTH)

- [ ] **AUTH-01**: A root Refounding's removal is honored only from a rotator who strictly outranks the removed target — the receive-path guard denies when absent rather than permitting *(H03a; any BAN holder can currently evict the owner)*
- [ ] **AUTH-02**: `refound()` rejects excluding any target the caller does not strictly outrank, mirroring `rotateChannel()` *(H03b; send-path half of the same hole)*
- [ ] **AUTH-03**: A Grant edition is folded only at its derived coordinate (`grantLocator`), so the roster is not delivery-order dependent *(M05; the helper exists and is used on the write path but never on the read path)*
- [ ] **AUTH-04**: A malformed Grant is skipped rather than throwing out of `foldControl` and failing every member's community state *(M06)*
- [ ] **AUTH-05**: `kick()` and `ban()` reject locally when the caller lacks the bit or the rank, matching `rotateChannel`/`refound` *(L04; no authority is gained today — the read path enforces — but the UI shows a removal that never happened)*
- [ ] **AUTH-06**: `Role.position` is validated as a positive integer before a role confers permission bits *(L05)*
- [ ] **AUTH-07**: A Grant that revokes or demotes is gated by a rank comparison against its target member *(S01 — **BLOCKED on ruling**: CORD-04 §2 states the rule as outranking the *roles handed out*, which is what the code implements; whether §3's "strictly outrank its target" also binds the Grant's target is unresolved by the spec text. The permissive reading yields a real privilege-escalation path. Needs a spec reading, possibly upstream clarification)*
- [ ] **AUTH-08**: A Kick's `vac` is validated against the cited Grant, and `vac` is required for non-owner Kicks *(S02 — **BLOCKED on ruling**: CORD-02 §5 defers the rule to CORD-04 §5; confirm there first)*

### Channel Keying (CHAN)

*CHAN-01/02/03 have a blocked downstream consumer (Accordian) — acceptance criteria and tests adopted verbatim from their report.*

- [ ] **CHAN-01**: A private channel with visible metadata but no held key material derives no channel `GroupKey` and gets no `keys.channels` entry, and its plane is never registered or subscribed *(H07; currently derives the PUBLIC address, byte-identical to the `community_root` formula)*
- [ ] **CHAN-02**: Sending to a private channel without key material rejects with a clear, distinct error (e.g. `missing private channel key`, not `unknown channel`) *(H07; `planeKeyFor` currently resolves and the send proceeds)*
- [ ] **CHAN-03**: `keys.channelEpochs` records the epoch the channel key was actually derived at, so CORD-03 §3's receiver binding check validates the right number *(H07 addendum — not in the upstream report; found during repro)*
- [ ] **CHAN-04**: Channel key material is taken only from `material.channels`, never from Control-Plane edition JSON, and edition fields are picked explicitly with type validation rather than blind-cast *(H06; a MANAGE_CHANNELS holder can currently publish a "private" channel whose key is cleartext on a member-readable plane)*
- [ ] **CHAN-05**: A channel's secret derives from `material.channels`, so a channel Rekey takes effect immediately without a reload *(H08 first root cause; requires deleting `ChannelMetadata.key`/`.epoch` — **BREAKING**. Pairs with ROTATE-03, the second root cause; either alone leaves the channel on its old plane)*
- [ ] **CHAN-06**: A client can distinguish a visible-but-inaccessible private channel from one it holds a key for, without hand-rolling a `material.channels` lookup *(API gap surfaced by the Accordian report)*
- [ ] **CHAN-07**: Channel deletion is terminal — a later edition cannot un-delete a channel *(S04 — **BLOCKED on ruling**: "Deletion is terminal" is followed by a clause about id reuse, admitting a narrow reading)*

### Invites (INVITE)

- [ ] **INVITE-01**: A revoked invite link is unjoinable even when a lagging relay still serves the old bundle — the coordinate resolves to its newest event first, then the tombstone is evaluated *(H05; revocation is currently weaker than the relay deletion the spec contrasts it against. `ConcordInviteList.bundles$` already does this correctly via `store.replaceable` — reuse that pattern)*
- [ ] **INVITE-02**: `validateInviteBundle` fails closed on a bundle whose `channels`/`relays` are not arrays, so the §1 MUST-bounds actually run on attacker input *(M07; same class as the fixed `refounder` bug)*
- [ ] **INVITE-03**: `refreshInviteBundles` skips a link it cannot rebuild and continues, rather than aborting every link after it *(M08; a subset of live links currently keeps serving pre-Refounding keys behind unchanged URLs)*
- [ ] **INVITE-04**: The Invite List's `expires_at` is written in the unit CORD-05 §4 specifies *(M09 — confirm the unit against the spec first; §4 never annotates it and the inference is from example magnitude)*
- [ ] **INVITE-05**: `decodeFragment` rejects a fragment version it does not know, rather than decoding it against the v4 dictionary *(L06)*

### Time Encoding (TIME)

- [ ] **TIME-01**: An event's `created_at` and `ms` tag are one clock read, so `created_at * 1000 + ms` is a true decomposition of a single instant *(H04; ~50% of all events currently carry +1000ms skew and the inconsistency reorders timelines on every plane. `splitTime` already exists and has zero call sites)*
- [ ] **TIME-02**: All chunks of one Guestbook snapshot share one timestamp, including `created_at` *(M10)*
- [ ] **TIME-03**: `rumorMs` and `hasMalformedMs` agree on what a valid `ms` tag is, so ordering and membership cannot disagree about the same rumor *(M11)*

### Wire Conformance & Caps (WIRE)

- [ ] **WIRE-01**: `ChannelMetadata.voice` is removed — every channel is callable and no per-channel voice flag exists *(M13 — **BREAKING**; needs a changeset and migration note)*
- [ ] **WIRE-02**: Kind 23313 voice presence reaches consumers instead of being silently dropped at the receive funnel, so a client can implement CORD-07 §4 *(M14)*
- [ ] **WIRE-03**: A reaction's `k` tag names its target's actual kind rather than a hardcoded 9 *(M15)*
- [ ] **WIRE-04**: A threaded reply inherits its parent's root tags verbatim and derives `K`/`k` from the real target kind, so replies off a kind-9 message and nesting beyond depth 1 are expressible *(M16)*
- [ ] **WIRE-05**: A delete carries the `k` tag naming its target's kind *(L03)*
- [ ] **WIRE-06**: A channel `name` is capped at 64 **bytes** (UTF-8, not UTF-16 units) on write, and defensively on read *(M17)*
- [ ] **WIRE-07**: Community `name` (64B) and `description` (10000B) byte caps are enforced *(L09)*
- [ ] **WIRE-08**: The Community List enforces the 50-membership protocol constant alongside the already-enforced byte cap *(M12)*
- [ ] **WIRE-09**: The Community List and Invite List round-trip unknown **top-level** document fields, so two clients sharing one npub cannot wipe each other's data *(L07; per-entry unknowns already survive)*
- [ ] **WIRE-10**: A `deleteChannel` edition preserves `custom` while still explicitly excluding client-only key material *(L02; the hand-roll is partly deliberate and correct — a naive spread would leak `ch.key`, so the fix is an explicit destructure, not a spread)*
- [ ] **WIRE-11**: A client can retain a wrap's ephemeral key so it can NIP-09-delete its own giftwrap by `p` tag *(L10)*
- [ ] **WIRE-12**: Code comments cite real spec sections — `CORD-06 §94` does not exist (CORD-06 has 3 sections; 94 is a line number) *(L11)*

### Test Methodology (TEST)

- [ ] **TEST-01**: Every key/address derivation the specs define has a regression test asserting against an **independently-derived spec value**, not against implementation output *(the cross-cutting cause: all 189 concord tests passed while 9 HIGH bugs were live because every test compares the implementation to itself; a 4-line spec-derived probe caught the worst one instantly)*
- [ ] **TEST-02**: The five tests named in the Accordian upstream report are covered *(keyless private metadata derives nothing; public still derives from `community_root`; keyed private still derives from its key; send to a keyless private channel rejects; the direct-invite grant flow still works once key material is folded)*

## Future Requirements

Deferred — acknowledged, not in this roadmap.

### Channels

- **FUT-01**: Public↔private channel conversion and channel rename (CORD-03 §2) — a feature gap, not a conformance defect *(L12. Trap for whoever builds it: `addChannelKey` hardcodes `epoch: 1`, correct only for a **first** privatisation; §2 turns on the channel epoch being monotonic and never resetting)*

### Voice

- **FUT-02**: CORD-07 §2 broker token grants (kind 27235), §3 AES-GCM media framing, §5 rendezvous tie-break, §6/§7 *(L13)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rewriting concord's architecture | The findings are conformance defects with localized fixes, not design faults. Every fix should be the smallest change that makes the spec sentence true. |
| Auditing the "verified correct" register | `.planning/concord-audit.md` records ground seven agents checked against both sides and found faithful (crypto/derivation, envelope, rekey wire, permission bits, merge semantics, kind registry). Re-auditing it spends the milestone twice. **One caveat: that register is not infallible — it wrongly cleared `rollForwardChannel`.** Treat it as a prior, not a proof. |
| CORD-07 voice transport | HTTPS/WebRTC concerns, not Nostr event handling — outside an events SDK (→ FUT-02) |
| Changing `applesauce-core` public behavior beyond the cache descriptor | Core Value constraint: default `EventStore` consumers see no behavior change. The cache fix's only observable delta is that spread/`Object.assign` stop copying memos. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CACHE-01 | Phase 5 | Complete |
| CACHE-02 | Phase 5 | Pending — taxonomy unsound (see 05-VERIFICATION.md); superseded by Phase 5.1 |
| CACHE-03 | Phase 5 | Complete |
| TEST-01 | Phase 5–12 (standing) | Pending — **cross-cutting; does NOT close at Phase 5** |
| ROTATE-01 | Phase 6 | Pending |
| ROTATE-02 | Phase 6 | Pending |
| ROTATE-04 | Phase 6 | Pending |
| AUTH-01 | Phase 6 | Pending |
| AUTH-02 | Phase 6 | Pending |
| CHAN-01 | Phase 7 | Pending |
| CHAN-02 | Phase 7 | Pending |
| CHAN-03 | Phase 7 | Pending |
| CHAN-04 | Phase 7 | Pending |
| CHAN-05 | Phase 7 | Pending |
| CHAN-06 | Phase 7 | Pending |
| CHAN-07 | Phase 7 | Pending — blocked on spec ruling |
| ROTATE-03 | Phase 7 | Pending |
| TEST-02 | Phase 7 | Pending |
| ROTATE-05 | Phase 8 | Pending |
| ROTATE-06 | Phase 8 | Pending |
| ROTATE-07 | Phase 8 | Pending |
| ROTATE-08 | Phase 8 | Pending |
| ROTATE-09 | Phase 8 | Pending |
| ROTATE-10 | Phase 8 | Pending — blocked on spec ruling |
| ROTATE-11 | Phase 8 | Pending |
| ROTATE-12 | Phase 8 | Pending |
| ROTATE-13 | Phase 8 | Pending — blocked on spec ruling |
| AUTH-03 | Phase 9 | Pending |
| AUTH-04 | Phase 9 | Pending |
| AUTH-05 | Phase 9 | Pending |
| AUTH-06 | Phase 9 | Pending |
| AUTH-07 | Phase 9 | Pending — blocked on spec ruling |
| AUTH-08 | Phase 9 | Pending — blocked on spec ruling |
| INVITE-01 | Phase 10 | Pending |
| INVITE-02 | Phase 10 | Pending |
| INVITE-03 | Phase 10 | Pending |
| INVITE-04 | Phase 10 | Pending |
| INVITE-05 | Phase 10 | Pending |
| TIME-01 | Phase 10 | Pending |
| TIME-02 | Phase 10 | Pending |
| TIME-03 | Phase 10 | Pending |
| WIRE-01 | Phase 11 | Pending — breaking |
| WIRE-02 | Phase 11 | Pending |
| WIRE-03 | Phase 11 | Pending |
| WIRE-04 | Phase 11 | Pending |
| WIRE-05 | Phase 11 | Pending |
| WIRE-11 | Phase 11 | Pending |
| WIRE-06 | Phase 12 | Pending |
| WIRE-07 | Phase 12 | Pending |
| WIRE-08 | Phase 12 | Pending |
| WIRE-09 | Phase 12 | Pending |
| WIRE-10 | Phase 12 | Pending |
| WIRE-12 | Phase 12 | Pending |

**Coverage:**

- v1.1 requirements: 53 total *(corrected from the "52 total" originally recorded here — a recount of every checklist item above finds 53 distinct REQ-IDs; no requirement content changed)*
- Mapped to phases: 53/53 ✓
- Blocked on a spec ruling: 5 (ROTATE-10 → Phase 8, ROTATE-13 → Phase 8, AUTH-07 → Phase 9, AUTH-08 → Phase 9, CHAN-07 → Phase 7) — each phase resolves its ruling(s) as its first task; any may conclude "no change needed"

**Cross-cutting standard — TEST-01 (read before closing any phase):**
TEST-01 is a **standing criterion across Phases 5–12**, not a Phase-5 deliverable. It is listed at Phase 5 for one-requirement-one-phase accounting only; its scope is the whole milestone. It is **not satisfied until Phase 12 completes** and must not be ticked Complete when Phase 5 closes.

Every phase touching a derivation, fold, or wire shape the specs define by formula or example carries an explicit `(TEST-01, standing)` criterion in its ROADMAP success-criteria list — Phases 5, 6, 7, 8, 9, 10, 11, and 12. Each is verified by that phase's own verification step; TEST-01 closes only when all eight have passed.

Why this is enforced per-phase rather than delegated to one phase: all 189 concord tests passed while 9 HIGH bugs were live *because every test compared the implementation against itself*. A phase permitted to assert against its own output reintroduces the exact root cause this milestone exists to fix. Phase 7 is the sharpest case — the CORD-03 §1 channel derivations are where H07 hid, and it was a spec-derived probe that exposed it. Phases 11 and 12 have no crypto derivations, so their obligation binds to the `examples.md` fixtures and transcribed spec constants instead of to formulas.

---
*Requirements defined: 2026-07-15*
*Last updated: 2026-07-15 after roadmap creation (8 phases, Phase 5–12, full coverage; TEST-01 scoped as a standing cross-phase criterion)*
