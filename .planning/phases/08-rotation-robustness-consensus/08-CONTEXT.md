# Phase 8: Rotation Robustness & Consensus - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Rotation behaves correctly under real-world adversity — **racing Refoundings** (two authorized rotations to the same epoch), a **bunker signer that blips mid-decrypt**, and **malformed or partial chunk sets** — instead of silently forking the community or evicting a member who was never removed. This is the robustness layer on top of Phase 6's base-Refounding correctness: Phase 6 made a single Refounding rotate every plane and enforce authority; Phase 8 makes *concurrent, resumed, and failure-interrupted* rotations converge deterministically.

**Requirements:** ROTATE-05, ROTATE-06, ROTATE-07, ROTATE-08, ROTATE-09, ROTATE-10, ROTATE-11, ROTATE-12, ROTATE-13, plus TEST-01 (standing — spec-derived assertions for every derivation/fold this phase touches).

**Two items were "blocked on a spec ruling" — both ruled this session (see D-01, D-02); neither resolved to "no change needed."**

**In scope:** transient-decrypt retry vs. removal (ROTATE-05); deterministic same-epoch convergence + down-only re-heal + anti-refork latch (ROTATE-06/07); `vac` citation + fail-closed receiver verification on the rekey path (ROTATE-08); root-roll publish confirmation gating adoption (ROTATE-09); chunk-set consistency guards for `chunkCount`/`prevepoch` (ROTATE-10/11); historical-epoch `refounder` de-inheritance (ROTATE-12); compaction abort-on-unfoldable (ROTATE-13); spec-derived tests (TEST-01).

**Out of scope (own phases / deferred):** authority/permission folds — Grant/Kick/Ban/Role rank comparisons (Phase 9, AUTH-03..08); invite lifecycle + event-time (Phase 10, INVITE/TIME); a future multi-fork community client that preserves and follows *both* forks (deferred, see `<deferred>`). This phase's convergence is **spec-strict single-community** — it does not attempt to preserve losing forks.
</domain>

<decisions>
## Implementation Decisions

### Spec rulings (the phase's mandatory first task — both ruled, neither "no change")

- **D-01 — ROTATE-13 (compaction abort) = BUG, fail-closed.** The CORD-06 vs CORD-02 agent conflict (`helpers/keys.ts` compaction loop, ~`:376-382`) is ruled a bug. Convert the silent `if (!head.seal || sealKind !== PLAINTEXT_SEAL_KIND) continue;` + `try { rewrapSeal } catch {}` into **detect-and-abort**: if any control head cannot be re-wrapped/folded, `buildRefounding` throws *before any publish*, so a Refounding never ships a partial `compactionWraps`. CORD-06 §3 verbatim: *"If the Refounder cannot reliably fold all Control events, the Refounding must be aborted."* Ruled fail-closed **regardless** of whether "control heads are plaintext by construction" holds today — silent-continue-where-the-spec-says-MUST is this milestone's canonical defect shape, and Phase 6/7 resolved their rulings the same way (implement the spec-true behavior, don't conclude "no change"). Rejected: "correct-by-design, test-only" — leaves a branch that degrades quietly if the invariant ever breaks. Carries a spec-derived test.
- **D-02 — ROTATE-10 (chunk correlation) = consistency-guard, NOT a correlation-key change.** Upstream CORD-06 correlates a rotation's chunks by **(rotator, newepoch, prevcommit)** — `chunkCount`/`n` is *deliberately not* a correlation field. The current key `${rotator}:${scopeIdHex}:${newEpoch}:${prevCommit}` (`helpers/rekey.ts` `groupRotations`) already matches the spec. The real defect: inside one bucket, the first-arriving chunk fixes `set.chunkCount` and `if (p.chunkCount === set.chunkCount)` silently drops disagreeing chunks, so arrival order can complete a *stale* generation. **Fix:** when chunks under one `(rotator,newEpoch,prevCommit)` disagree on `n`, mark the set **inconsistent** — never `complete`, refetch — instead of first-arrival-wins. This is reachable: `prevCommit = epochKeyCommitment(oldEpoch, oldRoot)` is identical across resumes of the same N→N+1 rotation, so a resumed rotation with a changed keep-list re-enters the same bucket with a different `n`. Rejected: **add `chunkCount` to the key** (audit's literal fix — diverges from upstream and still lets a stale n-set complete on its own); **"no change if unreachable"** (rests on the "not reachable in practice" hypothesis the H07 post-mortem says to distrust). Biases toward adoption over removal. Carries a spec-derived test.

### Same-epoch convergence & anti-refork (ROTATE-06/07 — M01/M02)

- **D-03 — SPEC-STRICT single-community convergence.** When two (or more) authorized rotations race to epoch N+1 (a fork), compute the winner **deterministically as the lexicographically lowest new key** among **all** authorized + complete + continuity-checked candidates — *not* only the rotations that carried a blob for us (fixes M02), and *not* by arrival order (arrival order IS the M01 split). Then:
  - Winner's complete set **includes** our locator → adopt its key.
  - Winner's complete set **excludes** our locator → we are **removed** — even if a *higher*-keyed authorized fork retained us. One community, no residual fork.
  - This kills M02's "silently orphaned on a dead root": we never sit on a higher root when a lower authorized one exists.
  - **User ruled spec-strict over the inclusion-biased alternative** ("follow the lowest fork we're *in*, removed only if no fork includes us"). The inclusion-biased reading was on the table (the earlier stated instinct was "follow the fork we're still in"); after seeing the tradeoff the user chose strict global-winner convergence. The excluded-from-winner case is where CORD-06 §3 is genuinely silent — this is a deliberate resolution of that ambiguity toward the spec's clear "every client computes the same winner / can never re-fork" intent.
- **D-04 — Down-only re-heal across syncs + per-epoch latch.** The permanence of M01 comes from `client/sync.ts` marking non-tip epochs `"known"` and never re-reading their rekey plane, plus `rekeyHandled` blocking a second outcome and the engine being disposed. Fix: a **held/adopted epoch's rekey plane is re-read on later syncs** so a strictly-**lower** sibling that arrives late is adopted (down-only); a **latch records the lowest-keyed fork adopted per epoch** so we (a) never move *up* to a higher sibling and (b) a settled epoch can never re-fork. CORD-06 §3 verbatim: *"a held epoch re-converges solely to a strictly lower sibling ... can never re-fork a settled epoch."*
- **D-05 — "Compute among all candidates" satisfies ROTATE-07 as written.** The winner set includes forks with no blob for us — we must *see* every authorized fork to detect the split and pick the global winner, even though spec-strict then removes us when the winner excluded us.

### Transient-signer retry (ROTATE-05 — H09)

- **D-06 — Decrypt failure at our locator ≠ locator absence.** In `readRekeyScoped` (`helpers/keys.ts`, the `try { decrypt … adoptedHere = true } catch { /* treat as absent */ }` at ~`:508-517`), a caught decrypt error at *our own* locator is **positive evidence we're in the set, unreadable right now** — it must **not** fall through to `removed = true`. Return a signal distinct from absence so we keep our current key and conclude nothing. Removal fires only when the winning set is **complete** and our locator is **genuinely absent** (composes with D-03's spec-strict removal). A NIP-46 bunker timeout / rejected approval / dropped socket therefore never self-evicts.
- **D-07 — Passive retry, no bespoke retry machinery.** The retry is realized by D-04's down-only re-read: the next sync re-attempts the decrypt. No in-call retry loop, no backoff timers, no keeping the engine alive. Matches the spec's *"the client refetches until the set is complete before concluding anything."* This makes fixing the `rekeyHandled`/`"known"` short-circuit (D-04) a **prerequisite** — passive retry only works if the re-read path actually re-runs. Rejected: bounded active in-call retry-with-backoff (adds config, blocks the sync pass on a possibly-dead bunker, still needs the passive backstop).

### `vac` citation + verification (ROTATE-08 — M03)

- **D-08 — Fail-closed vac, owner exempt.** Mirror the existing `includeKickTarget` pattern (which already threads a `vac`) onto the rekey path (`operations/rekey.ts`, `helpers/rekey.ts`): a **non-owner** rotation MUST cite the Grant it acts under (`vac`), and the receiver **verifies that Grant against its folded Roster before honoring** the rotation, rejecting it if the `vac` is missing or unverifiable. The **owner is exempt** — they act under inherent ownership, not a delegated Grant (matches how `refoundAuthority` already treats ownership). This closes M03's "a just-demoted admin's rotation is honored by a lagging client off a stale roster." Rejected: vac-required-for-everyone (forces the owner to manufacture a self-Grant, diverges from the ownership model); cite-only-defer-rejection (leaves the hole open).

### Publish confirmation gating (ROTATE-09 — M04)

- **D-09 — Gate adoption + compaction/snapshot on a MAJORITY-confirmed root roll.** `pool.publish(relays, wrap)` returns `Promise<PublishResponse[]>` (one `{ok, from, message}` per relay); today the root-roll and compaction/snapshot publishes `.catch(() => {})` the array and `adoptRefounding` runs unconditionally (`client/community.ts` `refound`, ~`:1239-1246`). Fix: **await the root-roll publish, require a strict majority of the configured relays to return `ok:true`**, and only then publish the channel-rekey/compaction/snapshot wraps and call `adoptRefounding`; **abort (throw) otherwise** rather than rolling forward alone onto an epoch nobody can discover. Root roll lands first (the existing "land them first" comment). **User chose majority over the ≥1-relay minimum** — define "confirmed" as `> 50%` of the relays published to. (Note: the spec says "confirmed" without a number; majority is a deliberate client-policy choice, stricter than the minimal bar.)

### Research-surfaced rulings (resolved 2026-07-19 during plan-phase, after 08-RESEARCH.md)

- **D-10 — Opaque competing fork → DEFER (`readRekeyScoped` returns `none`), refining D-03/D-05's mechanism.** Research proved the crypto makes D-03's "compute the winner among ALL authorized candidates" unimplementable as literal key comparison: a rekey blob's plaintext is NIP-44-encrypted per-recipient, so a client with **no locator in a competing fork has no ciphertext to decrypt it** — it can see (from the public-derivable outer envelope) that the fork exists, is authorized, complete, and continuity-matched, but can **never learn its key value**. When `readRekeyScoped` holds its own decryptable candidate **and** an authorized+complete+continuity-matched competing fork it cannot decrypt also exists, it must return **`none` (defer)** — neither adopt its own candidate (can't prove it's the true global-lowest) nor self-evict (may itself be the true winner). Fail-closed against **both** adopting a dead root and wrongly self-evicting; matches the passive-retry philosophy of D-06/D-07 (the re-read spine re-attempts each sync). **User ruled DEFER** over self-evict-on-any-exclusion (over-aggressive — evicts a possible true winner) and adopt-ours-anyway (revives M02's silent-dead-root bug). Accepted cost: a client can stay deferred indefinitely if the opaque fork truly is lower and never grants access another way. This resolves the case CORD-06 §3 is genuinely silent on (excluded-member ranking) — it does **not** loosen D-03's spec-strict removal when the winner **is** decryptable and excludes us (that path is unchanged). Carries a spec-derived test (opaque-fork-deferral).
- **D-11 — Majority gate is PER-WRAP (D-09 arithmetic resolved).** A Refounding's root-roll can chunk across multiple kind-3303 events. **Every published wrap (each root-roll chunk and each channel-rekey wrap) must independently clear strict majority** — `> 50%` (i.e. `⌈(n+1)/2⌉`) of the **configured `this.relays()` count** returning `ok:true` — before `refound()` proceeds to compaction/snapshot publish or `adoptRefounding`; otherwise **throw** (D-01's abort-before-further-publish shape). `PublishResponse.ok === false`, including the `"Timeout"` message, counts as **not-ok**; a relay that never responds counts against the denominator (not excluded). Rationale: a complete rotation set requires ALL chunks to reach recipients, so each chunk needs its own majority. **User chose per-wrap** over aggregate-once-across-the-rotation (more lenient, weaker discoverability). Carries a spec-derived test (majority-gated publish: minority `ok:true` ⇒ `refound()` throws, no `adoptRefounding`).
- **D-12 — `vac` verification is a folded-Roster structural check (D-08 shape, default confirmed).** The receiver verifies the cited `vac` by checking it **structurally resolves to `grantLocator(communityId, rotator)`** and that the **current folded Roster still grants the rotator** the relevant permission — **not** by re-fetching the cited edition's exact `version`/`hash` against a live control-plane store. Keeps `readRekeyScoped` a pure function of folded `CommunityState` (mirrors how `canRemoveSelf` is built); the stronger edition-match check is **not** adopted for v1 (would force the pure convergence function to reach into the control-plane store). Owner remains exempt (matches `vacFor`).

### Claude's Discretion (fix now, same fail-closed shape)

- **ROTATE-11 (L08) — validate `prevepoch` consistency across a rotation's chunks.** Rides the D-02 consistency-guard: chunks in one set must agree on `prevepoch`; a disagreement marks the set inconsistent. Not exploitable today, fixed defensively. (`helpers/rekey.ts` ~`:207,213-217`.)
- **ROTATE-12 (L01) — de-inherit the tip `refounder` in `buildChain`.** `buildChain`'s spread stamps the tip's `refounder` onto every historical epoch's material (`client/sync.ts` ~`:239-247`); genesis (epoch 0) has none, and a snapshot must be honored only from the npub whose Refounding minted that epoch. Latent today (`syncEpoch`'s per-epoch `members` is computed but never consumed) — a forged-roster trap the moment any per-epoch fold is surfaced. Strip `refounder` per-epoch (explicit, genesis = none).
- Exact signalling shape for D-06 (a new `ScopedRekeyOutcome`/internal-flag variant such as `retry`/`decryptFailed` vs. reusing `{kind:"none"}` with a distinct internal marker) — resolve during research against the `readRekeyScoped` control flow and the `removed` accumulation.
- Where the anti-refork latch (D-04) is stored (in-memory per-engine adopted-key map vs. persisted) — resolve against how `rekeyHandled` and the epoch walk already track state; persist only if a settled epoch's latch must survive a client restart.
- Exact majority arithmetic and tie/timeout handling for D-09 (`⌈(n+1)/2⌉` of `this.relays()`; `PublishResponse.ok:false` "Timeout" counts as not-ok).
- Wire-format placement of the `vac` citation (D-08) — mirror `includeKickTarget`'s tag/rumor shape.
- Plan/commit sequencing, within the fixed constraint that every behavioral fix lands with its own spec-derived regression test (TEST-01).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative protocol spec (verify fixes against this, not only the audit paraphrase)
- Upstream Concord spec — `https://github.com/concord-protocol/concord` (raw: `https://raw.githubusercontent.com/concord-protocol/concord/main/06.md`). For this phase, **CORD-06** governs the rekey wire + convergence:
  - **§2** — the removal rule: *"Only once you hold **all `n` chunks** and none contains your locator have you been removed. A missing chunk is never a removal — the client refetches until the set is complete before concluding anything."* (grounds D-06/D-07/D-02).
  - **§3** — convergence: *"the lexicographically lowest new key wins, every client computes the same winner"*; *"a held epoch re-converges solely to a strictly lower sibling, so a flaky fetch that returns only the higher sibling can never re-fork a settled epoch"*; winner chosen *"among authorized candidates at the same continuity point"*; *"a rotation cites the Grant it acts under like any authority action (CORD-04's `vac`)"*; *"only after confirmed publication of the root roll"*; *"If the Refounder cannot reliably fold all Control events, the Refounding must be aborted."* (grounds D-03/D-04/D-08/D-09/D-01). **§3 is deliberately SILENT on the excluded-from-winner case** — D-03 resolves that ambiguity spec-strict. Chunks correlate by *"the Rotator ... at one `newepoch` and `prevcommit`"* — `chunkCount` is NOT a correlation field (grounds D-02). *(Standing user direction from Phase 6/7: trust upstream over the audit paraphrase.)*

### Milestone authority
- `.planning/concord-audit.md` — the 2026-07-15 conformance audit. This phase: **H09** (ROTATE-05, `keys.ts:477-489` transient-decrypt-as-removal), **M01** (ROTATE-06, no same-epoch down-only heal — `keys.ts:463`, `community.ts:670-671,1107-1108`, `sync.ts:208,216`), **M02** (ROTATE-07, winner computed only among rotations that included us — `keys.ts:472-492`), **M03** (ROTATE-08, no `vac` citation — `operations/rekey.ts:27-34`, `helpers/rekey.ts:139-184`, `keys.ts:464`), **M04** (ROTATE-09, publish without confirmation — `community.ts:1098-1108`), **S03** (ROTATE-10, chunkCount not correlated — `helpers/rekey.ts`), **L08** (ROTATE-11, prevepoch unvalidated — `helpers/rekey.ts:207,213-217`), **L01** (ROTATE-12, historical refounder inherited — `sync.ts:239-247`), and the **unresolved conflict #1** (ROTATE-13, compaction silent-skip — `keys.ts:345-352` / `community.ts:1046-1056`). *Line numbers predate Phase 7's edits — verify current positions (e.g. `controlHeadsWithSeals` is now `community.ts:1177`, the compaction loop `keys.ts:376-382`, `readRekeyScoped` decrypt/removal `keys.ts:~500-525`).*
- `.planning/REQUIREMENTS.md` — ROTATE-05..13 (ROTATE-10 & ROTATE-13 were "blocked on ruling" — now ruled, D-02/D-01), TEST-01 (standing, does NOT close here).
- `.planning/ROADMAP.md` — Phase 8 detail (~`:197-212`): goal, success criteria 1-6 (criterion 6 = TEST-01 standing, naming continuity math / `lowerKeyWins` tie-break / complete-set gate), and the two-ruling first-task note.
- `.planning/PROJECT.md` — v1.1 constraints: smallest-change-that-makes-the-spec-sentence-true; the fail-closed standard (the four canonical defect shapes, incl. "a `catch`/`continue` that degrades where the spec says MUST"); spec-derived-test verification standard (assert against independently-derived spec values, never implementation output); default `EventStore` consumers see no behavior change.
- `.planning/phases/06-refounding-rotation-authority-correctness/06-CONTEXT.md` — the fail-closed guard pattern (`canRemoveSelf` outrank predicate) and the "cache fix resolved H01 at source ⇒ rotation derivations are test-only" precedent that TEST-01 extends here.
- `.planning/phases/07-private-channel-keying/07-CONTEXT.md` — the immediately-prior rotation work (channel rekey / `rollForwardChannel`); the "trust upstream verbatim" precedent and the spec-derived-probe pattern.

### Primary source files (positions verified this session, 2026-07-19)
- `packages/concord/src/helpers/keys.ts` — `readRekeyScoped` (`:486-527`: the authorized+complete+continuity `groupRotations().filter(...)`, the `findBlob`/decrypt/`lowerKeyWins` winner loop, and the `catch { treat as absent }` → `removed = true` path — D-03/D-05/D-06); `buildRefounding` compaction loop (`:376-382`, D-01); the root-roll construction (`:344-365`).
- `packages/concord/src/helpers/rekey.ts` — `groupRotations` correlation key + the `if (p.chunkCount === set.chunkCount)` drop (`:204-225`, D-02); `prevEpoch` field (`:207`, ROTATE-11); `checkContinuity` (continuity math for TEST-01).
- `packages/concord/src/operations/rekey.ts` — the rekey operation (`:27-34`), where the `vac` citation is added (D-08).
- `packages/concord/src/client/sync.ts` — `syncEpoch`/`syncEpochs` (`:195-245`): the `"known"`/`"adopt"`/`"removed"` transition handling and the never-re-read gap (D-04); `buildChain` refounder spread (`:239-247`, ROTATE-12).
- `packages/concord/src/client/community.ts` — `refound` (`:1189-1246`: outrank loop, `buildRefounding` call, the `.catch(()=>{})` publishes, `rekeyHandled.add`, `adoptRefounding` — D-09); `controlHeadsWithSeals` (`:1177-1187`, D-01 input); `rekeyHandled` (~`:670`, D-04).

### Existing tests (extend / add alongside — spec-derived only, TEST-01)
- `packages/concord/src/helpers/__tests__/` — the rekey/rotation suites (e.g. `channel-rekey.test.ts` spec-derived channel-plane probe at `:92`; `keys.test.ts` control-address probe at `:191`). Add hand-derived oracles for: the continuity math, the `lowerKeyWins` / lowest-key tie-break (D-03), the complete-set gate + the `n`-disagreement consistency guard (D-02), the transient-decrypt-≠-removal case (D-06), the down-only re-heal + anti-refork latch (D-04), the abort-on-unfoldable-head (D-01), and the `vac`-verification reject (D-08) — each expected value computed by hand from CORD-06 §2/§3, never by calling the implementation under test.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`readRekeyScoped` + `groupRotations` + `checkContinuity` + `lowerKeyWins`** (`helpers/keys.ts`, `helpers/rekey.ts`) — the scope-generic convergence core shared by root Refoundings and channel rekeys. All of this phase's convergence work (D-02/D-03/D-04) threads through it once and benefits both scopes.
- **`canRemoveSelf` outrank predicate** (Phase 6) — the fail-closed authority pattern; D-08's `vac` verification is its receive-path sibling.
- **`includeKickTarget` `vac` threading** — the existing citation pattern D-08 mirrors onto the rekey path.
- **`PublishResponse[]` from `pool.publish`** (`packages/relay`) — `{ok, from, message}` per relay; D-09 inspects `ok` instead of discarding the array.
- **The Phase 5/6 spec-derived probe pattern** (`keys.test.ts:191`, `channel-rekey.test.ts:92`) — the TEST-01 shape to extend to convergence/continuity/tie-break.

### Established Patterns
- **Fail-closed / total branches** (milestone standard) — every decision here bends the same way: a decrypt blip, an inconsistent chunk set, an unverifiable `vac`, an unconfirmed publish, or an unfoldable head all *stop and refetch/abort*, never *degrade silently*. The recurring defect class is "a guard that silently downgrades."
- **`material`/held-key as source of truth, edition JSON as display** — carried from Phase 7; unchanged here.
- **Spec-derived tests only** — expected addresses/keys/winners computed by hand from CORD-06, never read back from the impl (the exact gap that let all 43 findings pass CI).
- **Deterministic cross-client convergence** — the winner must be a pure function of the observed authorized candidates (lowest key), never of arrival order or of which blobs *this* client happened to receive.

### Integration Points
- `client/sync.ts` `syncEpoch(s)` → `readRekeyScoped` (`keys.ts`): the down-only re-heal (D-04) requires `syncEpochs` to re-read held/adopted epochs rather than short-circuiting on `"known"`, and `rekeyHandled` to permit a strictly-lower re-adoption. This is the prerequisite that makes passive retry (D-07) work.
- `client/community.ts` `refound` → `buildRefounding` (`keys.ts`) → `pool.publish`: D-09 gates `adoptRefounding` on the awaited majority-confirmed root roll; D-01 makes `buildRefounding` throw before returning a partial `compactionWraps`.
- `operations/rekey.ts` → `helpers/rekey.ts` (emit) and `readRekeyScoped` `isAuthorized` (receive): D-08 adds the `vac` on emit and verifies it against the folded Roster on receive.
</code_context>

<specifics>
## Specific Ideas

- **Spec-strict over inclusion-biased** — the user explicitly chose that an excluded-from-the-global-winner member is *removed*, even when a higher authorized fork retained them, in exchange for guaranteed single-community convergence. This is the load-bearing policy call; the "follow the fork we're in" alternative was considered and rejected for v1.
- **Majority, not ≥1**, for "confirmed publication" — the user wanted a stricter discoverability bar than the minimal one-relay-ack.
- **Two rulings are real fixes, not "no change"** — ROTATE-13 becomes a fail-closed abort and ROTATE-10 a consistency guard; neither concludes the disputed code is fine as-is.
- **`chunkCount` must NOT enter the correlation key** — the audit's literal suggestion is anti-spec; the fix is detecting `n`-disagreement, not partitioning on `n`.
- **The keyless of this phase is the re-read** — D-04's re-reading of held epochs is the single mechanism that unblocks M01 convergence *and* ROTATE-05 passive retry; plan it as the spine, not as two separate features.
</specifics>

<deferred>
## Deferred Ideas

- **Multi-fork community client** — a future client that *preserves all forks* and can *follow both* (rather than spec-strict converging to one and removing the excluded). Needs its own machinery (re-derive from raw events, per-fork state) and is explicitly out of scope for v1. Raised by the user as "a later version."
- **Spec-strict "global winner excluded you → removed" as the only removal path** is v1's choice; the inclusion-biased removal reading ("removed only if no fork includes us") is the fallback the multi-fork client would revisit.
- Persisted anti-refork latch (survives client restart) — only if research shows a settled epoch's latch must outlive the in-memory engine; otherwise in-memory suffices.

### Reviewed Todos (not folded)
- **`05.1-review-followups.md`** ("Phase 05.1 code-review follow-ups") — reviewed, **not folded**. It collects `applesauce-core`/`applesauce-common` gift-wrap and cache-symbol follow-ups (CR-01 author-spoofing verify, WR-01 replaceable symbol copy, WR-04 EventFactory.kind, etc.), unrelated to concord rotation. Matched only on generic keywords; stays deferred to its own cleanup.
</deferred>

---

*Phase: 8-Rotation Robustness & Consensus*
*Context gathered: 2026-07-19*
