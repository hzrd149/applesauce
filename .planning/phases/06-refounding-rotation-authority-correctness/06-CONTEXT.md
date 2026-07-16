# Phase 6: Refounding Rotation & Authority Correctness - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A Refounding stops being a cryptographic no-op in-session: it rotates every plane address (control/guestbook/rekey), actually drops excluded members from the Complete Memberlist, and is honored only from a rotator who **strictly outranks every removed target** on both the send (`refound()`) and receive (`readRekey`) paths.

**Requirements:** ROTATE-01, ROTATE-02, ROTATE-04, AUTH-01, AUTH-02, plus TEST-01 (standing).

**Load-bearing fact that reshapes this phase:** Phase 5/5.1's core cache fix (memoized symbol writes are now non-enumerable) **already resolved H01 at the source.** `rollForward`/`rollForwardChannel` now spread clean material because the memos are dropped by spread; concord already routes every memo through `getOrComputeCachedValue` (no `Reflect.set`). So **ROTATE-01/02 are a test-coverage obligation at the derivation level, not a source change.** The remaining source work is H02 (ROTATE-04, memberlist) and H03 (AUTH-01/02, authority).

**In scope:** the memberlist epoch-scoping fix (H02), the two authority guards (H03), and the spec-derived rotation/memberlist tests (TEST-01 for this phase).

**Out of scope (own phases):** channel keying / private-channel derivation (Phase 7, H07/H08); rotation robustness, racing rotations, `vac` citation, transient-signer retry (Phase 8, ROTATE-05..13); the permission/grant folds (Phase 9, AUTH-03..08). The outrank guards here evaluate the rotator against the **current folded roster** — the `vac`-citation refinement (honoring a just-demoted admin's rotation) is explicitly ROTATE-08/Phase 8.
</domain>

<decisions>
## Implementation Decisions

### ROTATE-04 — memberlist epoch-scoping (H02)

- **D-01: The fix is epoch-scoping, not a timestamp heuristic.** CORD-02 §5 states "**the Guestbook rides the epoch**" — each epoch's Guestbook is a structurally separate plane; the new epoch's Guestbook starts empty and is seeded **only** by the refounder's snapshot (which subtracts the removed). A removed member has no activity on the new epoch's plane (they lost the keys), so correct removal falls out of epoch separation. The bug is that the implementation flattens all epochs into one store (`planeStoreKey` in `client/sync.ts` maps every epoch's guestbook to the single `"guestbook"` store key) and one `observed` map (`models/community.ts:37-42` merges control + guestbook + all channel stores across every epoch), so `foldMembers` re-admits a removed member's prior-epoch activity at `guestbook.ts:111`'s `!c` branch. An earlier "snapshot-ms floor" idea was rejected — it reproduces the observed-correct output without matching the spec's structural model.
- **D-02: Key plane stores per epoch** (audit's first suggested fix). Change `planeStoreKey` so the guestbook (and observed community-plane) store key includes the epoch. The current-epoch store then naturally contains only current-epoch rumors; the membership fold reads only that store, and `observed` is scoped to the current epoch's planes. Old-epoch stores remain addressable for reading history. This is the same "epoch walk keeps planes distinct" mechanism ROTATE-02 needs — ROTATE-04 and ROTATE-02 are the same underlying concern.
- **D-03: Old-epoch stores are disposed when their root drops out of `held_roots`.** Keys and stores share one retention horizon — you can't decode an epoch you no longer hold the root for, so its store is dead weight. On rotation/retention-trim, dispose+delete the stores for any epoch no longer in `held_roots`. (Current code disposes stores only at community dispose — `community.ts:355`; this adds a per-epoch trim.)
- **D-04: Success-criterion-3 keep-list footgun is resolved structurally by D-01/D-02.** Once the fold drops removed members, `state.members` no longer contains them, so passing `state.members` as the next `refound()`'s `keep` list cannot re-admit them; `refound()`'s `exclude` set is also applied over `recipients` regardless. No separate defense needed beyond the fold fix — but the phase's tests must assert it (a removed member is absent even when passed through a subsequent `keep`).

### AUTH-02 — send-path outrank (H03, `refound()`)

- **D-05: Add a per-target `BAN` outrank loop to `refound()`, mirroring `rotateChannel` (`community.ts:885-888`).** After the `refoundAuthority` check and before building/publishing anything, loop over `opts.exclude`; throw `cannot exclude ${target} — you do not outrank them` on the first target where `!this.canDo(PERM.BAN, this.standingOf(target).position)`.
- **D-06: Throw and abort the whole Refounding on failure — atomic, no partial rotation, no publishes.** A Refounding is heavier than a channel rekey; a partial one is worse than none. Consistent with `rotateChannel` and the already-shipped `concord-channel-rekey-outrank` changeset. Rejected: silently dropping un-outranked targets and proceeding.

### AUTH-01 — receive-path outrank (H03, `readRekey`)

- **D-07: Fail closed — an unsupplied `canRemoveSelf` DENIES the `removed` outcome.** Change `readRekeyScoped:506` from `(!held.canRemoveSelf || held.canRemoveSelf(set.rotator))` to `held.canRemoveSelf?.(set.rotator) === true`. This kills the "guard defaults to permit" shape that is the milestone's recurring defect class.
- **D-08: The root path always supplies `canRemoveSelf`,** requiring the rotator to strictly outrank self via `canActOn(standingOf(rotator), standingOf(self), PERM.BAN)` — mirroring the channel path (`readChannelRekey`, wired at `community.ts:589-590`). Rewrite the docstring at `keys.ts:447-454` that currently declares the root-path omission intentional; CORD-06 §3 says the outrank check applies "**in both**," so the stated intent is itself the defect.
- **D-09: Rank semantics are inherited, not reinvented.** "Strictly outrank" = `canActOn`: holds the bit AND `position < target.position`; owner is position 0 (supreme, unremovable); a roleless member is `0xffffffff` (removable by any BAN holder). No new rank logic — reuse `resolveStanding`/`canActOn`/`canDo`.

### ROTATE-01 / ROTATE-02 / TEST-01 — spec-derived tests

- **D-10: ROTATE-01/02 are test-only at the derivation level** (the cache fix resolved the source; the per-epoch *store* change is captured under D-02). Add hand-derived spec assertions — computed from the CORD-02 §4 / §5 formula in `crypto.ts`, never by calling the implementation under test — for the new epoch's **control, guestbook, and rekey** addresses (Phase 5 covered only control at `keys.test.ts:191` and the channel plane at `channel-rekey.test.ts:92`) and for the post-Refounding **memberlist** (a removed member is absent even given a prior-epoch Join/observation).
- **D-11: Add a concord-level anti-regression spread guard.** Extend the existing `keys.test.ts:191` pattern to guestbook + rekey: seed the memo on `material`, `rollForward`, and assert the rolled-forward object derives the NEW epoch's address — the exact 4-line probe that caught H01. Cheap insurance at the concord layer, independent of the core cache helper's own Phase 5/5.1 tests; H01 self-heals on restart so it can regress silently otherwise.

### Claude's Discretion
- Exactly which planes feed the current-epoch `observed` set (guestbook only vs. guestbook + control + current-epoch chat) — resolve during research against the full plane-routing code; the requirement is "current-epoch activity counts, prior-epoch does not."
- Error-message wording for the send-path throw (D-05/D-06) and any receive-path logging.
- Whether the per-epoch store-key change also needs to touch channel routing here or defer channel epoch-keying entirely to Phase 7 (channels have their own sub-engine lifecycle).
- Exact plan/commit sequencing within the fixed constraints (behavioral fix + its spec-derived test land together; the anti-regression guard can land with the derivation tests).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative protocol spec (verify fixes against this, not only the audit paraphrase)
- Upstream Concord spec — `https://github.com/concord-protocol/concord` (raw: `https://raw.githubusercontent.com/concord-protocol/concord/main/<NN>.md`). For this phase: **CORD-02 §4/§5** (`02.md` — epoch rotation rotates the plane `pk`; "the Guestbook rides the epoch"; snapshot seeds present-members-only; "observation only counts forward"), **CORD-06 §2/§3** (`06.md` — rekey wire, "the Rotator must strictly outrank every removed target … in both"), **CORD-04 §2/§3** (`04.md` — owner supreme/unremovable, rank comparison). `examples.md` for wire fixtures. *(User directed during discussion 2026-07-16: check the upstream spec, not just the audit — the audit is a faithful prior but paraphrases.)*

### Milestone authority
- `.planning/concord-audit.md` — CONCORD-H01 (memo-survives-spread, root cause; note the "verified correct" register wrongly cleared `rollForwardChannel`), H02 (memberlist folds across all epochs), H03 (root Refounding honors an under-ranked rotator). Carries file:line, violated spec sentence, symptom, and fix per finding.
- `.planning/REQUIREMENTS.md` — ROTATE-01, ROTATE-02, ROTATE-04, AUTH-01, AUTH-02, TEST-01 (and the standing TEST-01 closure rule — does NOT close at this phase).
- `.planning/ROADMAP.md` — Phase 6 detail (lines 136-149): goal, success criteria 1-5, the TEST-01-standing criterion.
- `.planning/PROJECT.md` — v1.1 constraints: cache-fix-lands-first sequencing; the spec-derived-test verification standard (assert against independently-derived spec values, never implementation output).

### Primary source files (current line numbers — verified this session)
- `packages/concord/src/helpers/guestbook.ts` — `foldMembers` (`:49-116`); the observed re-admit at `:109-112` (`!c` branch is the H02 leak); snapshot seeding gated to the refounder at `:89`.
- `packages/concord/src/models/community.ts` — `ConcordCommunityStateModel`; `observed` merged across control + guestbook + all channel stores at `:37-42`; fold wired at `:44-58`.
- `packages/concord/src/client/sync.ts` — `planeStoreKey` (`:252-256`, keys community planes by `info.type` → epoch collapse); `buildChain` (`:235-250`, distinct per-epoch materials); `syncEpochs` (`:202-228`, the epoch walk).
- `packages/concord/src/client/community.ts` — `refound()` (`:1055-1106`, needs the outrank loop); `rotateChannel()` (`:878-904`, the pattern to mirror at `:885-888`); `storeFor`/`this.stores` (`:199,:379-388`); `rewireState` (`:393-411`, selects `"guestbook"` + all-stores observed); store disposal (`:355`).
- `packages/concord/src/helpers/keys.ts` — `readRekeyScoped` (`:468-512`, the `:506` default-permit short-circuit); `ScopedHeld.canRemoveSelf` (`:454`) + its misleading docstring (`:447-454`); `readRekey` root caller (`~:397-427`); `readChannelRekey` (`~:642-673`, supplies `canRemoveSelf` — the correct precedent); `rollForward` (`:265-273`); `deriveConcordKeys` (`:179-186`).
- `packages/concord/src/helpers/permissions.ts` — `resolveStanding` (`:38-59`), `canActOn` (`:61-66`), `refoundAuthority` (`:75-80`, bare BAN bit check, no rank).

### Existing tests (extend / add alongside)
- `packages/concord/src/helpers/__tests__/keys.test.ts` — `:191` control address spec-derived (H01(a), CORD-02 §4); `:216+` memoization suite. Extend to guestbook + rekey addresses (D-10/D-11); add a root-path outrank-removal test (currently untested).
- `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` — `:92` channel plane spec-derived; `:206`/`:227` channel outrank-on-removal (the precedent; no root-path equivalent exists yet).
- `packages/concord/src/helpers/__tests__/guestbook.test.ts` — snapshot honoring; **no observed-re-admission-across-refounding test** (the H02 gap — add one).
- `packages/concord/src/client/__tests__/community.test.ts` — refound tests at `:347/:451/:515`; none cover excluding a higher-ranked member (AUTH-02) or observed re-admission (ROTATE-04).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`canActOn` / `canDo` / `standingOf`** (`permissions.ts:61-66`) — the rank-comparison primitive for both authority guards; owner=0, roleless=`0xffffffff`. No new rank logic needed.
- **`rotateChannel`'s outrank loop** (`community.ts:885-888`) — the exact template for `refound()`'s new loop (swap `MANAGE_CHANNELS` → `BAN`).
- **`readChannelRekey` supplying `canRemoveSelf`** (`keys.ts` + `community.ts:589-590`) — the correct precedent the root path must copy.
- **`buildChain`** (`sync.ts:235-250`) — already mints distinct per-epoch materials; the epoch walk is structurally ready for per-epoch stores.
- **The Phase-5 spec-derived test at `keys.test.ts:191`** — the H01 probe pattern to extend to guestbook/rekey.

### Established Patterns
- **The recurring defect class is "a guard that defaults to permit"** — AUTH-01's `!held.canRemoveSelf ||` is a textbook instance; the fix is to make the guard fail closed.
- **The channel path is correct; the root path is not** — for both H03 halves (send and receive) the fix is to bring the root path up to the channel path's shape, which already exists.
- **Spec-derived tests only** (milestone standard) — expected addresses/memberlists are computed by hand from the CORD formula (via `crypto.ts` primitives), never by calling `rollForward`/`deriveConcordKeys`/`foldMembers`.

### Integration Points
- `planeStoreKey` (`sync.ts`) → `storeFor` (`community.ts:379`) → `rewireState` (`community.ts:393`): the epoch-keying change threads through all three — the store key gains an epoch, `rewireState` must select the current-epoch guestbook and current-epoch observed set, and the retention trim (D-03) disposes stores whose epoch left `held_roots`.
- Private-channel sub-engines (`private-channel.ts`) run their own epoch lifecycle — confirm the community-plane epoch-keying doesn't disturb channel routing (or defer channel epoch-keying to Phase 7).
</code_context>

<specifics>
## Specific Ideas

- **"The Guestbook rides the epoch" (CORD-02 §5) is the load-bearing insight for ROTATE-04.** The correct fix reproduces the protocol's structural epoch separation; a timestamp-floor heuristic that merely yields the observed-correct output was explicitly considered and rejected. Surfaced by reading the upstream spec at the user's direction — the audit paraphrase alone would have led to the heuristic.
- **ROTATE-02 and ROTATE-04 are one mechanism.** "Each held epoch addresses a distinct plane" and "a Refounding removes members" are both the per-epoch store-keying change; don't plan them as unrelated fixes.
- **Fail-closed everywhere.** Both authority halves and the receive-path guard default to deny; the milestone exists because guards defaulted to permit.
</specifics>

<deferred>
## Deferred Ideas

- **`vac` citation on rotations** (a just-demoted admin's rotation honored by a lagging client) — ROTATE-08, Phase 8. The Phase 6 outrank guards evaluate against the current folded roster only.
- **Channel keying / private-channel derivation** (H07/H08) — Phase 7. If community-plane epoch-keying touches channel routing, keep the channel-epoch work minimal and defer the substantive channel fixes to Phase 7.
- **A grep/lint contract failing CI on a new undocumented enumerable symbol-write** (carried from Phase 5.1's deferred list) — reconsider milestone-wide if the convention drifts; the D-11 concord-level guard is the Phase 6 slice of this concern.
- **Rotation robustness** (racing rotations, transient-signer retry, partial chunk sets) — ROTATE-05..13, Phase 8.

None of the above are new capabilities — discussion stayed within the phase's fixed boundary.
</deferred>

---

*Phase: 6-Refounding Rotation & Authority Correctness*
*Context gathered: 2026-07-16*
