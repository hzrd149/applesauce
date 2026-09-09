# Phase 7: Private Channel Keying - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Private channel access derives **only** from held key material — never a fallthrough to the public `community_root` formula (H07), never from Control-Plane edition JSON (H06) — and a channel Rekey takes effect immediately in-session (H08). A client can tell "visible metadata" apart from "key held" without hand-rolling a `material.channels` lookup. Closes the field-confirmed Accordian-blocking bug (H07/H08) end to end.

**Requirements:** CHAN-01, CHAN-02, CHAN-03, CHAN-04, CHAN-05, CHAN-06, CHAN-07, ROTATE-03, plus TEST-01 (standing, sharpest case) and TEST-02 (the five Accordian-named tests).

**Load-bearing fact that reshapes this phase:** H08's fix **subsumes H06 and H07** — the single root fix is making `material.channels` the sole source of truth for channel key material and removing `ChannelMetadata.key`/`.epoch` entirely (breaking). The audit's narrow "make the private branch total" H07 fix operates on the very field the deep fix deletes. All three (H06/H07/H08) collapse into one refactor.

**Carried forward from Phase 5/5.1 (already resolved at source):** The core cache fix made memoized symbol writes non-enumerable, so `rollForwardChannel`'s spread now drops the stale plane-key memo. **ROTATE-03 (H01c) is therefore almost certainly a test-coverage obligation at the derivation level, not a source change** — mirrors ROTATE-01/02 in Phase 6. Research must confirm this before assuming a source edit is needed.

**In scope:** the channel-key single-source-of-truth refactor (H06/H07/H08 as one change), the `accessible` API affordance (CHAN-06), the distinct send-reject error (CHAN-02), sticky channel-deletion terminality (CHAN-07), the `channelEpochs` correctness fix (CHAN-03), and the spec-derived + Accordian-named tests (TEST-01/TEST-02).

**Out of scope (own phases):** rotation robustness / racing rotations / transient-signer retry / `vac` citation (Phase 8, ROTATE-05..13); permission/grant folds (Phase 9, AUTH-03..08); public↔private channel conversion and rename (FUT-01); voice transport (FUT-02).
</domain>

<decisions>
## Implementation Decisions

### Channel-key source of truth (CHAN-04 / CHAN-05 / H06 / H07 / H08 — one refactor)

- **D-03: `channelEpochs` records the epoch the key was actually derived at (CHAN-03).** With `material.channels` as source, the epoch comes from the held entry (`held.epoch`), not `ch.epoch ?? 1` off the edition. Fixes the CORD-03 §3 receiver-binding check (`checkChatBinding`) validating the wrong number.
- **D-04: Edition fields are picked explicitly with type validation (CHAN-04).** `foldControl` must destructure `name`/`private`/`deleted`/`voice`/`custom` off the parsed edition with type checks, never blind-cast `JSON.parse(...) as ChannelMetadata`. Key material is never read from the edition.

### CHAN-06 — access-vs-key-possession API

- **D-05: `channels$` emits an enriched `ChannelView[]` carrying an `accessible` boolean.** Public channels: always `true`. Private: `true` iff a key is held in `material.channels`. `ChannelMetadata` stays pure edition-derived data — `accessible` is client-local state, so it lives on the emitted view, not on the edition type. Consumers get the flag inline on the object they already iterate; drives composer/invite enable-disable reactively. Rejected: an imperative `hasChannelKey(id)` method (not reactive) and a separate `accessibleChannels$` set (forces consumers to join two streams).

### CHAN-02 — send rejection surface


### CHAN-07 — channel-deletion terminality (spec ruling, phase's first task)

- **D-07: Ruling — terminal, id never reused.** Upstream CORD-03 (verified this session): *"Deletion is terminal: the id is never reused, clients drop the Channel from display and may discard its keys."* The id-reuse clause **removes** ambiguity rather than adding it — a deleted id is permanently dead, and any later edition (a `deleted:false` un-delete or a fresh creation reusing the id) is ignored. This is **not** "no change needed": the current fold pushes the head candidate whenever `!meta.deleted` (`control.ts:233`), so a newer `deleted:false` head resurrects the channel.
- **D-08: Enforce via a sticky-deleted rule in `foldControl`.** Deletion is monotonic within the entity: if **any** authorized edition for the id has `deleted:true`, drop the channel regardless of which edition is head, and never re-create the id. Scan the entity's authorized candidates for a `deleted:true` rather than reading only the head. Purely fold-time, no new persisted state. The head is still retained for compaction (`heads.set`). Rejected (for now): a persisted `deletedChannelIds` tombstone set — only needed if compaction could drop the deleting edition and lose the tombstone.
- **D-09: Research must confirm compaction cannot drop the deleting edition.** The `heads.set(eid, cand.source)` "retained even if deleted" comment (`control.ts:232`) suggests the deleting edition is kept, which is what makes the sticky rule sufficient. If compaction can drop it, escalate to D-08's rejected persisted-tombstone option.

### ROTATE-03 / TEST-01 — spec-derived tests

- **D-10: ROTATE-03 (H01c) is presumed test-only at the derivation level.** The Phase 5/5.1 non-enumerable cache fix already drops the `rollForwardChannel` spread memo at source. Add a hand-derived spec assertion (CORD-03 §1 formula, computed via `crypto.ts` primitives, never by calling the implementation) that a rolled-forward channel with a new key at a new epoch derives the **new** epoch's plane address — the exact 4-line probe that caught H01, extended to the channel plane. Research confirms no source change remains before planning treats it as test-only.
- **D-12: TEST-02 — the five Accordian-named tests, adopted verbatim.** (1) keyless private metadata derives nothing; (2) public still derives from `community_root`; (3) keyed private still derives from its own key; (4) send to a keyless private channel rejects (with `MissingChannelKeyError`); (5) the direct-invite/private-channel grant flow still works once key material is folded.

### Claude's Discretion
- Plan/commit sequencing within the fixed constraint that each behavioral fix lands with its spec-derived test.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative protocol spec (verify fixes against this, not only the audit paraphrase)

### Milestone authority
- `.planning/REQUIREMENTS.md` — CHAN-01..07 (CHAN-05 marked BREAKING, pairs with ROTATE-03; CHAN-07 was "blocked on ruling" — now ruled, see D-07), ROTATE-03, TEST-01 (standing, does NOT close here), TEST-02.
- `.planning/ROADMAP.md` — Phase 7 detail (lines 163-178): goal, success criteria 1-6 (criterion 6 is the TEST-01-standing "sharpest case"), and the CHAN-07 "resolve the reading as this phase's first task" note.
- `.planning/PROJECT.md` — v1.1 constraints: smallest-change-that-makes-the-spec-sentence-true; the spec-derived-test verification standard (assert against independently-derived spec values, never implementation output); default `EventStore` consumers see no behavior change.
- `.planning/phases/06-refounding-rotation-authority-correctness/06-CONTEXT.md` — the "cache fix resolved H01 at source ⇒ rotation derivations are test-only" precedent that D-10 extends to the channel plane; the fail-closed guard pattern.

### Primary source files (line numbers verified this session)

### Existing tests (extend / add alongside)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`material.channels` (`ChannelKey[]`)** — already the client-tracked source of truth (`id`/`key`/`epoch`/`name`/`held`), including `held` prior-epoch keys for the channel epoch walk. The refactor threads this in place of the folded `ChannelMetadata.key`.
- **`channelGroupKey` / `crypto.ts` primitives** — the CORD-03 §1 derivation used both by the implementation and (independently, by hand) by the spec-derived tests.
- **The Phase-5 spec-derived probe at `keys.test.ts:191`** — the H01 pattern to extend to the channel plane (D-10/D-11).

### Established Patterns
- **Fail-closed / total branches** (milestone standard) — the private branch becomes total (throws/derives-nothing rather than falling through to public); the recurring defect class is "a guard that silently downgrades."
- **`material.channels` as source of truth, not folded edition** — the H08 through-line; edition JSON is display metadata, keys are client-local.
- **Granular `$` fields + enriched views** (Relay-class pattern) — `accessible` rides the `channels$` view rather than being a separate stream.

### Integration Points
- `foldControl` (`control.ts`) → `CommunityState.channels` → `channels$` (`community.ts:245`): the `accessible` enrichment is computed where the view is emitted (needs both folded channels and `material.channels`); the sticky-deleted rule lives in `foldControl`.
- `sendMessage` (`community.ts`) → `planeKeyFor` (`keys.ts`): the CHAN-02 guard lives in `sendMessage` (has channel state + `accessible`); `planeKeyFor` stays the truly-unknown-id backstop.
</code_context>

<specifics>
## Specific Ideas

- **The audit's H07 narrow fix and H08 deep fix are the same change** — do not plan them as separate work; `ChannelMetadata.key`/`.epoch` removal is the through-line for H06/H07/H08 together.
- **CHAN-07 is genuinely resolvable, not blocked** — the upstream "the id is never reused" clause makes terminality crisp; the sticky-deleted fold rule is the whole fix. Adjudicated by reading upstream CORD-03 §2 verbatim this session (user's Phase-6 direction to trust upstream over the audit paraphrase).
- **The keyless-private test must assert "derives nothing," not "matches the public address"** — asserting a match would re-encode the exact H07 collision the phase exists to kill.
- **`accessible` is client-local, not edition data** — it belongs on the emitted `ChannelView`, never on `ChannelMetadata`.
</specifics>

<deferred>
## Deferred Ideas

- **Public↔private channel conversion and channel rename** (CORD-03 §2) — FUT-01, a feature gap not a conformance defect. Trap noted: `addChannelKey` hardcodes `epoch: 1`, correct only for a *first* privatisation.
- **Persisted `deletedChannelIds` tombstone set** — only if research finds compaction can drop the deleting edition (D-09); otherwise the sticky-deleted fold rule suffices.
- **Voice channel keying / SFU room derivation** (`voiceKeysFor`) beyond ensuring it no longer returns a wrong `community_root`-derived room for keyless private channels — CORD-07 transport is FUT-02, Phase-out-of-scope.
- **Rotation robustness** (racing rotations, transient-signer retry, `vac` citation, partial chunk sets) — ROTATE-05..13, Phase 8.

None of the above are new capabilities — discussion stayed within the phase's fixed boundary.
</deferred>

---

*Phase: 7-Private Channel Keying*
*Context gathered: 2026-07-17*
