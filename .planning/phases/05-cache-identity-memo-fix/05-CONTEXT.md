# Phase 5: Cache Identity Memo Fix - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

`applesauce-core`'s cache helper stops writing memos as enumerable properties, so an object spread drops them and a rolled-forward copy recomputes its derivation instead of returning the source's stale memo. This kills the single root cause behind all three CONCORD-H01 instances and unmasks H02.

**In scope:** the `packages/core/src/helpers/cache.ts` write mechanism; a documented convention distinguishing memo writes from carry-forward writes; a classify-and-comment pass over hand-rolled symbol-write sites in `core` + `common`; regression tests proving both halves of the convention; spec-derived tests proving H01 instances (a) and (c) are dead.

**Out of scope:** fixing `rollForward`/`rollForwardChannel`/`buildChain` logic (Phases 6–7); ROTATE-02's epoch-walk `planeStoreKey`/`PlaneInfo` defects; H02's memberlist fold (Phase 6); H08's metadata-threading root cause (Phase 7); migrating any hand-rolled site onto the helper.

</domain>

<decisions>
## Implementation Decisions

### The Fix Itself

- **D-01:** Change `setCachedValue` and `getOrComputeCachedValue` **in place** — do not add a `defineCachedValue` alongside them and do not rename. All ~149 call sites get correct semantics with no migration. The audit's `defineCachedValue` is a name it floats, not a decision. Rationale: this is the exact diff the audit proved green (full monorepo, 1989 tests, exit 0); a new-helper-plus-deprecation would leave the fix unlanded for nearly every caller, which is the one outcome this phase cannot accept.
- **D-02:** Write with **`Object.defineProperty(…, { enumerable: false, writable: true, configurable: true })`** — not `Reflect.defineProperty`. The flags are load-bearing, not stylistic: `configurable: true` is required by `pipeFromAsyncArray`'s `Reflect.deleteProperty` (`packages/core/src/helpers/pipeline.ts:63`), and `writable: true` by `setCachedValue` overwrites. `Object.defineProperty` throwing on a frozen event (where `Reflect.set` failed silently) is accepted and considered correct — it surfaces a real programming error rather than silently returning a stale value forever. Nothing in the monorepo calls `Object.freeze`/`seal`/`preventExtensions`, so this is only reachable by an external consumer.
- **D-03:** Changeset bump is **patch** — this is a defect fix, no documented behavior ever promised memos survive a spread, and the audit's blast-radius analysis found ~all call sites cache onto immutable signed `NostrEvent`s that are never spread. One changeset file, single sentence, per CLAUDE.md.

### The Convention (CACHE-02)

- **D-04:** **Three named categories**, not two: *identity memo* (must NOT survive a spread), *carry-forward payload* (MUST survive a spread), *accumulated state* (mutable, propagated by the store's merge rather than by spread — e.g. `SeenRelaysSymbol`, the gift-wrap `Seal`/`Rumor`/`GiftWrap` symbols). CACHE-02 names only two; the code has three, and forcing `relays.ts:16` into "carry-forward" would mislabel it, defeating the requirement's purpose.
- **D-05:** **Categories classify WRITE SITES, not symbols.** The rule an author reads is "must this write survive a spread?", decided per call site. This is the decisive framing — see the finding under Specific Ideas: `EncryptedContentSymbol` is a carry-forward payload at `operations/tags.ts:87` and an identity memo at `helpers/encrypted-content.ts:117`. A symbol→category table would be wrong on its single most important example.
- **D-06:** **Canonical taxonomy prose lives in `packages/core/src/helpers/cache.ts`** (satisfying Success Criterion 2, which requires it in the helper's source). Every classified site gets a one-liner naming its category and pointing at `cache.ts`. No duplicated prose, no separate docs page.
- **D-07:** **Cross-reference the two existing executable definitions** from the taxonomy: `PRESERVE_EVENT_SYMBOLS` (`helpers/pipeline.ts:5`) is in effect the machine-readable definition of *carry-forward*, and `event-store.ts:219`'s `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` merge list the definition of *accumulated state*. This makes the prose checkable against code rather than free-floating.

### Sweep Scope

- **D-08:** **Classify and comment the hand-rolled sites; do not change their behavior and do not migrate them onto the helper.** Zero behavior risk, and it removes the "safe only by accident" problem the audit flags. Explicitly rejected: migrating `filter.ts:23`, `event.ts:128`, `lists.ts:47` onto the helper — they are hot paths, none sits on a spread object today, and widening the blast radius of the phase everything else depends on is the wrong trade.
- **D-09:** Sweep covers **`core` + `common`** — which captures all three `EncryptedContentSymbol` write-sites the audit names, including `common/operations/gift-wrap.ts:121`. Concord is excluded (its memo sites are rewritten in Phases 6–7; comments written now would churn immediately).
- **D-10:** **The sweep's contract is a defined grep pattern**, stated in the plan: every `Reflect.set` of a symbol-keyed property under `packages/{core,common}/src`, excluding `__tests__`. Scout found ~20 such sites. Reproducible and re-runnable to confirm completeness — not a stale file:line checklist, and not executor discretion.
- **D-11:** **One narrow, comment-only exception to the core+common scope:** correct `packages/concord/src/helpers/keys.ts:98-104`. That comment states the reasoning that caused H01 — *"a rekey/Refounding mints a fresh `material` — exactly when the keys must change"* is false today and this phase's fix is what makes it true. Phases 6–7 authors will read it while working on `rollForward`. Not a reopening of concord scope.
- **D-12:** The gift-wrap `Seal`/`Rumor`/`GiftWrap` symbols classify as **accumulated state** — mutated in place by `addParentSealReference`, same shape as `SeenRelaysSymbol`.

### Enforcement (CACHE-02 / CACHE-03)

- **D-13:** **Comment + two-sided regression test.** A comment alone is precisely what failed at `keys.ts:100-103` — that site had a comment and the comment was confidently wrong. One test asserts a `cache.ts` memo is **dropped** by spread; the other asserts plaintext **survives** encrypt-op → spreads → signing. A future tidy-up onto `setCachedValue` turns the second red immediately. Prose explains; the test enforces. A lint rule was considered and rejected as disproportionate machinery for one symbol.
- **D-14:** **Both halves live in a new `packages/core/src/helpers/__tests__/cache.test.ts`** — note that `cache.ts` currently has **no test file at all**. The contrast between the two halves *is* the lesson, so they belong on one screen, co-located with the taxonomy prose.
- **D-15:** **The carry-forward half reproduces the audit's probe end-to-end** — real factory pipe, real spread operations, real signing, then `getEncryptedContent`/`getHiddenTags` off the signed event. This is Success Criterion 3's literal wording ("passed through the factory pipe's spread operations"), it exercises `PRESERVE_EVENT_SYMBOLS`, and it promotes a known-good hand-run probe into CI rather than inventing coverage.

### Spec-Derived Tests (TEST-01, standing)

- **D-16:** **Phase 5 lands the concord spec-derived test**, despite being a core phase — Criterion 5 is explicit that it reproduces and closes H01's exact failure mode. Without it, Phase 5 ships a mechanism change with no evidence it fixed the bug it exists to fix. Phase 6 inherits it as a regression guard.
- **D-17:** **Cover H01 instances (a) and (c)** — `rollForward`'s control address (hand-derived from CORD-02 §4) and `rollForwardChannel`'s plane address (hand-derived from CORD-03 §1), which is what the audit asks for. Instance (b), the epoch walk, is **excluded**: its collapse also involves `planeStoreKey`/`PlaneInfo` defects (ROTATE-02/H02 territory), so a test there would be asserting Phase 6's work from Phase 5. Instance (c) is also H08's second root cause — proving the memo half dead here lets Phase 7 focus purely on the threading half.
- **D-18:** Expected values are **computed by hand from the spec formula, never by calling the implementation under test.** This is the milestone's whole point: all 189 concord tests passed while 9 HIGH bugs were live because every test compared the implementation to itself.

### Claude's Discretion

None — every question in this discussion resolved to an explicit choice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative for this phase
- `.planning/concord-audit.md` — the 2026-07-15 conformance audit; **the CONCORD-H01 entry (lines 32–65) is the single most important read for this phase.** Carries the root cause (`cache.ts:15`), all three memo sites with file:line, runtime-reproduced proof output, the proven-safe analysis of the `EncryptedContentSymbol` carry-forward, and the two-conventions warning that CACHE-02 exists to satisfy.
- `.planning/REQUIREMENTS.md` — CACHE-01/02/03 (lines 15–17) and TEST-01 (line 89); traceability table lines 117–120; the TEST-01 closure rule at lines 176–181.
- `.planning/ROADMAP.md` — Phase 5 detail (lines 43–53), including the five success criteria this phase is verified against.
- `.planning/PROJECT.md` — Key Decisions table (line 104) locks the central-fix-in-core decision and its safety rationale; Constraints (lines 89–91) lock the v1.1 sequencing and test standard.

### Protocol specs (for the spec-derived tests)
- **CORD-02 §4** — the epoch-address formula; the hand-derived expected value for H01 instance (a). Cited by the audit as the violated spec ("Rotating the epoch rotates the `pk`, keeping a plane's traffic unlinkable across epochs").
- **CORD-03 §1** — the channel `group_key` formula; the hand-derived expected value for H01 instance (c).
- Read these via the `mcp__nostr__read_protocol` / `read_nip` tooling, or the concord package's spec docs — do not derive expected values from the implementation.

### Primary source files
- `packages/core/src/helpers/cache.ts` — the 18-line root cause; where the fix and the canonical taxonomy prose land. Publicly exported via `packages/core/src/helpers/index.ts:1`.
- `packages/core/src/helpers/pipeline.ts:5,51-70` — `PRESERVE_EVENT_SYMBOLS` and `pipeFromAsyncArray`; the `Reflect.deleteProperty` at :63 is why `configurable: true` is required.
- `packages/core/src/helpers/encrypted-content.ts:97-125` — `unlockEncryptedContent` / `setEncryptedContentCache`; the read-path memo half of the dual-path finding.
- `packages/core/src/operations/tags.ts:87` — the deliberate enumerable carry-forward write; the hazard the fix must not disturb (CACHE-03).
- `packages/core/src/event-store/event-store.ts:219` — the merge symbol list.
- `packages/concord/src/helpers/keys.ts:98-104` (the false comment, D-11), `:241-256` (`rollForward`), `:508` (`rollForwardChannel`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The audit's hand-run probe** — already written and passing; D-15 promotes it into `cache.test.ts` rather than inventing new coverage.
- **`PRESERVE_EVENT_SYMBOLS`** (`pipeline.ts:5`) — an existing allowlist that already encodes "carry-forward"; the taxonomy cites it (D-07) instead of restating it.
- **Concord's existing test suite** — `packages/concord/src/helpers/__tests__/keys.test.ts` and `channel-rekey.test.ts` are the natural homes for the D-17 spec-derived tests.

### Established Patterns
- **Symbol-keyed caching on events is pervasive and idiomatic** — ~149 call sites go through `cache.ts`, plus ~20 hand-rolled `Reflect.set` sites. The fix's leverage comes from this concentration; so does its risk.
- **`cache.ts` is public API** (`export * from "./cache.js"`), consumed by common, wallet, and concord, so this is a behavior change to a published surface — hence the changeset (D-03).
- **The at-risk pattern is narrow:** caching onto a *mutable config object that is later spread*. ~All call sites cache onto immutable signed `NostrEvent`s (spreading one invalidates its `id`/`sig`, so nobody does). Concord's `material`/`ChannelKey` are the only instances found.

### Integration Points
- `rollForward` (`keys.ts:248-255`) and `rollForwardChannel` (`:508`) are **pure spreads with no other defect** — verified by reading them. Once the memo stops surviving, `deriveConcordKeys` → `baseKeysFor` recomputes from the new root and their existing logic is already correct.
- `buildChain` (`client/sync.ts:239-247`) is the third spread site, driving instance (b) — excluded per D-17.

</code_context>

<specifics>
## Specific Ideas

**Finding: `EncryptedContentSymbol` has two lifecycles with opposite semantics.** Surfaced by the user's question during discussion ("are the carry-forward symbols only used when building events in the factories and operations?"). The answer is no, and it reshaped CACHE-02's deliverable:

- **Write/build path** (`operations/tags.ts:87`, `operations/encrypted-content.ts:29`, `operations/event.ts:133-134,162-163`, gated by `PRESERVE_EVENT_SYMBOLS`) — true carry-forward; plaintext must survive spreads through the pipe into the signed event.
- **Read/unlock path** (`unlockEncryptedContent` at `encrypted-content.ts:97-112` → `setEncryptedContentCache`, which also fires `notifyEventUpdate`) — callers are nothing to do with factories: `common/helpers/encrypted-content-cache.ts:91,123`, `wallet/src/wallet/nut-wallet.ts:484`, `common/helpers/gift-wrap.ts:230,250`, `core/models/encrypted-content.ts:14`. Here it is an **identity memo on an immutable signed event**, avoiding a repeat signer round-trip. Never spread; propagates via the store's merge, which is why it's in the `event-store.ts:219` list.

This drives D-05 and explains something the audit left as an open puzzle — *why* `setEncryptedContentCache` hand-rolls its own `Reflect.set` instead of using the shared helper: it must stay enumerable because of the write path, even though its own read-path usage would be perfectly safe non-enumerable. **The taxonomy should use this split as its worked example.**

**Finding for Phase 6 (per D-16 discussion): ROTATE-01 may close on the cache fix alone.** `rollForward` is a pure spread with no other defect, so its ROTATE-01 criterion — `rollForward(...).control.pk` equals the spec formula over the new root — should go green once the memo stops surviving. Phase 6 planning should **verify rather than re-implement** it, and must not mistake an already-green criterion for outstanding work. Phase 6 still owns ROTATE-02 (epoch walk), ROTATE-04 (memberlist), and AUTH-01/02.

**Reassurance on Success Criterion 4:** the audit ran the full suite with this change applied — 1989 tests, exit 0. Unmasking H02 turns nothing red today, because no existing test covers the memberlist behavior H02 breaks.

**On `rollForward` vs the memo (clarified during discussion):** they are orthogonal. `rollForward`'s job is the epoch transition — mint new material, **archive the prior root into `held_roots`** so past epochs stay decodable, and retain prior planes so already-fetched wraps still decode. It would be needed with zero caching. The memo is an unrelated optimization inside `baseKeysFor` caching expensive secp256k1 derivations, because `reconcileLive` threads one `material` object through every state emission. The bug is only that the memo rides along on the object `rollForward` spreads.

</specifics>

<deferred>
## Deferred Ideas

- **`setCarryForwardValue` — a symmetrical helper making the write-site choice structural rather than advisory.** Deferred, not rejected: the carry-forward sites number three and are stable, a new public export is scope this phase doesn't need, and `tags.ts:87` is a spread expression in an object literal that couldn't use a helper anyway. Revisit if the convention proves hard to hold across Phases 6–12.
- **Migrating the true identity memos (`filter.ts:23`, `event.ts:128`, `lists.ts:47`) onto the helper.** Deferred: hot paths, none on a spread object today. Their comments (D-08) will make them easy to find if a future caller does put one on a spread object.
- **An ESLint rule banning `EncryptedContentSymbol` from `setCachedValue`.** Rejected as disproportionate for one symbol; the D-13 test covers the same failure.
- **A test enforcing the D-10 grep contract** (failing CI when a new undocumented symbol-write site appears). Raised and set aside — revisit if the convention drifts.

</deferred>

---

*Phase: 5-Cache Identity Memo Fix*
*Context gathered: 2026-07-15*
