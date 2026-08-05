# Phase 5: Cache Identity Memo Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 5-Cache Identity Memo Fix
**Areas discussed:** Hand-rolled memo sites, Helper API shape, Enforcement of conventions, Phase 5/6 test boundary

**Carried forward from prior context (not re-asked):** central fix in `applesauce-core` rather than local stripping in concord (PROJECT.md Key Decisions, line 104); `Object.defineProperty` with `{enumerable:false, writable:true, configurable:true}` as the proven change (concord-audit.md H01); the `EncryptedContentSymbol` carry-forward must keep working (CACHE-03); TEST-01's independently-derived-spec-value standard (PROJECT.md Constraints).

---

## Hand-rolled memo sites

Scout finding that opened the area: ~20 identity memos are written by hand-rolled `Reflect.set` that bypass `cache.ts` entirely, so the central fix does not reach them. They split into three shapes — true identity memos (`filter.ts:23`, `event.ts:128`, `lists.ts:47`), accumulated state (`relays.ts:16`), and decryption results (`hidden-tags.ts:105`, `contacts.ts:95`).

### Q1: How far should Phase 5 reach beyond cache.ts?

| Option | Description | Selected |
|--------|-------------|----------|
| Helper + classify/comment hand-rolled sites | Fix cache.ts; leave the sites' behavior untouched, comment each with its convention | ✓ |
| Helper only — roadmap-literal | Change cache.ts and nothing else | |
| Helper + migrate true identity memos onto it | Also convert filter.ts:23, event.ts:128, lists.ts:47 | |

**User's choice:** Helper + classify/comment hand-rolled sites
**Notes:** Zero behavior risk while removing the "safe only by accident" problem the audit flags. Migration rejected — hot paths, none on a spread object today, and widening the blast radius of the phase everything else depends on is the wrong trade.

### Q2: How wide should the sweep go?

| Option | Description | Selected |
|--------|-------------|----------|
| applesauce-core only | Sites in packages/core/src; core is where cache.ts and the convention live | |
| core + common | Also lists.ts, app-data.ts, groups.ts, trusted-assertions.ts, gift-wrap.ts | ✓ |
| Every package incl. concord | Full sweep | |

**User's choice:** core + common
**Notes:** Captures all three `EncryptedContentSymbol` write-sites the audit names, including `common/operations/gift-wrap.ts:121`. Concord excluded — its memo sites are rewritten in Phases 6–7, so comments would churn immediately.

### Q3: How to handle SeenRelaysSymbol, which is neither memo nor carry-forward?

| Option | Description | Selected |
|--------|-------------|----------|
| Three named categories | identity memo / carry-forward payload / accumulated state | ✓ |
| Two categories, per CACHE-02 literally | Fold accumulators under carry-forward | |
| Two categories + note the accumulator as an aside | Binary rule authoritative, odd site explained locally | |

**User's choice:** Three named categories
**Notes:** CACHE-02 names two; the code has three. `relays.ts:16` survives a *merge*, not a spread — mislabeling it would defeat the requirement's purpose.

### Q4: Where does the taxonomy live?

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical in cache.ts, sites point to it | Full prose in cache.ts per Criterion 2; one-liners elsewhere | ✓ |
| Taxonomy in cache.ts + a docs page | Also a docs write-up | |
| Full prose at each site | Self-documenting, no indirection | |

**User's choice:** Canonical in cache.ts, sites point to it
**Notes:** One source of truth; the rule sits on the mechanism a future cleanup would reach for. Docs page rejected against CLAUDE.md's guidance on standalone restating files.

### Q5: Does Phase 5 correct concord keys.ts:98-104's false comment?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — correct it in Phase 5 | Comment-only change, narrow exception to the sweep scope | ✓ |
| No — leave it to Phase 6 | Phase 6 owns rollForward and can fix it with the logic | |
| Yes, and note the JSON.stringify non-sequitur | Correct it and name why stringify never established spread-safety | |

**User's choice:** Yes — correct it in Phase 5
**Notes:** The comment claims *"a rekey/Refounding mints a fresh `material` — exactly when the keys must change"* — false today, and this phase's fix is what makes it true. Phases 6–7 authors read this exact comment while working on `rollForward`.

### Q6: Category for the gift-wrap Seal/Rumor/GiftWrap symbols?

| Option | Description | Selected |
|--------|-------------|----------|
| Accumulated state | Mutated in place by addParentSealReference, same shape as SeenRelaysSymbol | ✓ |
| A fourth category: object-graph link | Back-references are arguably distinct from accumulators | |
| Let Claude decide during the sweep | Classify on inspection | |

**User's choice:** Accumulated state
**Notes:** Confirms the third category describes more than one site — a good sign the taxonomy is real rather than invented for `relays.ts`.

### Q7: Should the taxonomy cross-reference PRESERVE_EVENT_SYMBOLS and the merge list?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — cross-reference both from cache.ts | They're the executable definitions of carry-forward and accumulated state | ✓ |
| No — keep the taxonomy self-contained | Less coupling | |
| Cross-reference PRESERVE_EVENT_SYMBOLS only | The pipe allowlist governs spread-survival; merge is a different operation | |

**User's choice:** Yes — cross-reference both from cache.ts
**Notes:** Makes the prose checkable against code instead of floating free.

### Q8: How to bound the sweep so it's verifiably complete?

| Option | Description | Selected |
|--------|-------------|----------|
| Defined grep pattern as the sweep's contract | Every Reflect.set of a symbol prop under packages/{core,common}/src, excl. __tests__ | ✓ |
| Enumerate the exact file:line list in the plan | Execution as a checklist | |
| Let the executor discover sites as it goes | Lowest planning overhead | |

**User's choice:** Defined grep pattern as the sweep's contract
**Notes:** Reproducible and re-runnable. "We think we got them all" is the confidence level this milestone exists to distrust.

### Q9 (user-initiated): Are the carry-forward symbols only used when building events in factories and operations?

**User's question, asked mid-area.** Investigated rather than assumed — the answer is **no**, and it changed the shape of the CACHE-02 deliverable.

`EncryptedContentSymbol` has two lifecycles: a write/build path (factories/operations, gated by `PRESERVE_EVENT_SYMBOLS`) where it is genuinely carry-forward, and a read/unlock path (`unlockEncryptedContent` → `setEncryptedContentCache`, called from `encrypted-content-cache.ts`, `nut-wallet.ts`, `gift-wrap.ts`, `models/encrypted-content.ts`) where it is an identity memo on an immutable signed event.

Follow-up decision:

| Option | Description | Selected |
|--------|-------------|----------|
| Categories classify write sites, not symbols | Rule is "must this write survive a spread?", decided per call site | ✓ |
| Classify symbols, note EncryptedContentSymbol as an exception | Simpler model with one exception | |
| Classify both — symbol default + per-site override | Two-level rule | |

**User's choice:** Categories classify write sites, not symbols
**Notes:** A symbol→category table would be wrong on its most important example. This also explains what the audit left as an open puzzle — why `setEncryptedContentCache` hand-rolls its `Reflect.set` rather than using the shared helper.

---

## Helper API shape

### Q1: In-place change or a new helper?

| Option | Description | Selected |
|--------|-------------|----------|
| Change in place | setCachedValue/getOrComputeCachedValue switch to defineProperty; all ~149 sites fixed | ✓ |
| Add defineCachedValue, deprecate the old | New helper, old one deprecated | |
| Rename to defineCachedValue outright | One helper, self-describing name | |

**User's choice:** Change in place
**Notes:** The exact diff the audit proved green at 1989 tests. The new-helper option would leave the fix unlanded for nearly every caller. The audit's `defineCachedValue` is a name it floats, not a decision.

### Q2: Add a symmetrical setCarryForwardValue?

| Option | Description | Selected |
|--------|-------------|----------|
| No — prose only for now | cache.ts documents the categories; carry-forward sites keep hand-rolling with a comment | ✓ |
| Yes — add setCarryForwardValue | Makes the convention structural rather than advisory | |
| Defer the helper to a follow-up | Land prose now, revisit if the convention proves hard to hold | |

**User's choice:** No — prose only for now
**Notes:** Three stable carry-forward sites don't justify a new public export; `tags.ts:87` is a spread expression that couldn't use a helper anyway. Recorded as a deferred idea.

### Q3: Changeset bump?

| Option | Description | Selected |
|--------|-------------|----------|
| patch — bug fix | Defect fix; no documented behavior promised spread-survival | ✓ |
| minor — observable behavior change | Public helper's spread semantics change | |
| major — breaking | Any observable change to a published surface | |

**User's choice:** patch — bug fix
**Notes:** cache.ts is public API (`export * from "./cache.js"`). CLAUDE.md says pick the smallest applicable bump; the audit's blast-radius analysis shows no real consumer can rely on the old behavior.

### Q4: Object.defineProperty or Reflect.defineProperty?

| Option | Description | Selected |
|--------|-------------|----------|
| Object.defineProperty — the proven change | Throws on a frozen object; exactly what the audit validated | ✓ |
| Reflect.defineProperty — preserves silent-failure | Returns false instead of throwing; matches cache.ts's Reflect idiom | |
| You decide | Let the planner pick | |

**User's choice:** Object.defineProperty — the proven change
**Notes:** Raised because `Reflect.set` fails silently on a frozen object while `Object.defineProperty` throws — a behavior change beyond spread semantics. Verified nothing in the monorepo calls `Object.freeze`/`seal`/`preventExtensions`, so it's only reachable by an external consumer. A throw is arguably correct: it surfaces a real error rather than silently returning stale values forever.

---

## Enforcement of conventions

### Q1: What actually prevents a future cleanup from collapsing the conventions?

| Option | Description | Selected |
|--------|-------------|----------|
| Comment + two-sided regression test | One test asserts memo dropped by spread, one asserts plaintext survives to signing | ✓ |
| Comment only — requirement-literal | CACHE-02 as written | |
| Comment + tests + a lint rule | ESLint rule banning EncryptedContentSymbol from setCachedValue | |

**User's choice:** Comment + two-sided regression test
**Notes:** A comment is exactly what failed at `keys.ts:100-103` — that site had one and it was confidently wrong. The audit's own "ideally". Lint rule rejected as disproportionate for one symbol.

### Q2: Where do the two halves live?

| Option | Description | Selected |
|--------|-------------|----------|
| Both in a new helpers/__tests__/cache.test.ts | The contrast is the lesson; co-located with the taxonomy | ✓ |
| Split by mechanism | Memo test in cache.test.ts, carry-forward in operations/tags.test.ts | |
| Both in cache.test.ts + a pointer from tags.test.ts | Pair together, cross-referenced | |

**User's choice:** Both in a new helpers/__tests__/cache.test.ts
**Notes:** Scout finding: `cache.ts` currently has **no test file at all** — the 18-line helper root-causing three HIGH findings is untested.

### Q3: How faithful should CACHE-03's carry-forward test be?

| Option | Description | Selected |
|--------|-------------|----------|
| Reproduce the audit's probe end-to-end | Real pipe, real spreads, real signing, then getHiddenTags(signed) | ✓ |
| Minimal unit test with a fake signer | Assert enumerable survives spread, non-enumerable doesn't | |
| Both — unit + end-to-end | Maximum coverage | |

**User's choice:** Reproduce the audit's probe end-to-end
**Notes:** Matches Criterion 3's literal wording, exercises `PRESERVE_EVENT_SYMBOLS`, and promotes a known-good hand-run probe into CI rather than inventing coverage.

---

## Phase 5/6 test boundary

Scout finding that opened the area: `rollForward` (`keys.ts:248-255`) is a **pure spread** with no other defect, so its Criterion-5 assertion should pass on the cache fix alone — making Phase 5's test effectively ROTATE-01's acceptance test, though ROTATE-01 is assigned to Phase 6.

### Q1: Does Phase 5 land the concord spec-derived test?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — land it in concord, roadmap-literal | Criterion 5 is explicit that it reproduces/closes H01's failure mode | ✓ |
| No — core-only, defer to Phase 6 | Keeps the diff in core | |
| Yes, and flag that ROTATE-01 may close early | Land it and record the finding | |

**User's choice:** Yes — land it in concord, roadmap-literal
**Notes:** Without it, Phase 5 ships a mechanism change with no evidence it fixed the bug it exists to fix.

### Q2: Should CONTEXT.md record that ROTATE-01 may already be satisfied?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — as a note to Phase 6 | Factual scouting finding; Phase 6 should verify rather than re-implement | ✓ |
| No — let Phase 6 discover it | Keep CONTEXT.md to Phase 5's decisions | |

**User's choice:** Yes — as a note to Phase 6
**Notes:** Recorded under Specific Ideas, framed as a finding rather than a scope change.

### Q3 (user-initiated): What are the rollForward requirements for concord, and why does it need rollForward instead of just the memo behavior?

**User's question, asked via free-text.** Answered from the code rather than speculation: the two are orthogonal. `rollForward` is a state transition — mint new material, archive the prior root into `held_roots` so past epochs stay decodable, retain prior planes so already-fetched wraps still decode. It would be needed with zero caching. The memo is an unrelated optimization inside `baseKeysFor` caching expensive secp256k1 derivations, because `reconcileLive` threads one `material` object through every state emission. The bug is only that the memo rides along on the object `rollForward` spreads. Concord's requirements on the family: ROTATE-01/02 (`rollForward`), ROTATE-03 (`rollForwardChannel`), ROTATE-12 (`refounder` inheritance) — all Phase 6/7.

### Q4: Which H01 instances does Phase 5 prove?

| Option | Description | Selected |
|--------|-------------|----------|
| (a) and (c) — both instances the audit names | rollForward's control address + rollForwardChannel's plane address | ✓ |
| (a) only — exactly Criterion 5 | Smallest test surface | |
| All three — (a), (b) and (c) | Complete H01 closure proof | |

**User's choice:** (a) and (c) — both instances the audit names
**Notes:** (c) is H08's second root cause — proving the memo half dead here lets Phase 7 focus purely on the threading half. (b) excluded: the epoch-walk collapse also involves `planeStoreKey`/`PlaneInfo` defects (ROTATE-02/H02), so a test there would assert Phase 6's work from Phase 5.

---

## Claude's Discretion

None — every question resolved to an explicit user choice. The one "You decide" option offered (the write primitive) was not taken.

## Deferred Ideas

- `setCarryForwardValue` — a symmetrical helper making the write-site choice structural. Deferred, not rejected; revisit if the convention proves hard to hold across Phases 6–12.
- Migrating the true identity memos (`filter.ts:23`, `event.ts:128`, `lists.ts:47`) onto the helper.
- An ESLint rule banning `EncryptedContentSymbol` from `setCachedValue` — rejected as disproportionate.
- A test enforcing the grep contract, failing CI when a new undocumented symbol-write site appears.

**No scope creep occurred** — the discussion stayed inside the cache-mechanism boundary throughout. The two scope-adjacent decisions (D-11's concord comment fix, D-16/17's concord tests) were both admitted deliberately as narrow, roadmap-supported exceptions rather than new capabilities.
