# Phase 5: Cache Identity Memo Fix - Research

**Researched:** 2026-07-15
**Confidence:** HIGH

## Summary

This phase's decisions are already fully locked in `05-CONTEXT.md` (D-01 through D-18) — nothing here re-opens them. This research fills the three gaps CONTEXT.md left open: (1) the exact CORD-02 §4 and CORD-03 §1 spec formulas needed to hand-derive the two spec-derived test fixtures, sourced directly from the protocol spec repo (not from the implementation); (2) a complete, re-run grep of every `Reflect.set` symbol-write site in `core`+`common`, classified against D-04's three categories — 35 comment sites, not the scout's "~20" estimate; (3) the Validation Architecture section the orchestrator requires to generate VALIDATION.md.


## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|

This is a library-internal phase (no browser/API/DB tiers apply); "tier" here means package boundary within the pnpm workspace.

## Gap 1 — Spec Formulas for the Hand-Derived Tests (D-17/D-18)


### Shared primitive — `group_key` (CORD-02 §4, frozen in Appendix A.1/A.2/A.3)

```
hkdf(secret, label, id, epoch):
    HKDF-SHA256(
        ikm  = secret,
        salt = ∅,                                              // zero-length
        info = utf8(label) || 0x00 || id[32] || epoch_be[8],   // epoch_be omitted if no epoch
        len  = 32 )

group_key(label, secret, id, epoch):
    seed = hkdf(secret, label, id, epoch)
    sk   = scalar_normalize(seed)      // if seed is not a valid secp256k1 scalar (0 < v < n),
                                        // append an incrementing counter byte (starting 0) to
                                        // hkdf's info and retry — ~2^-128 rare, ignorable in tests
    pk   = xonly_pubkey(sk)            // the Stream address (hex, x-only)
    conv_key = nip44_conversation_key(sk, pk)
```
`id` is always a raw 32-byte value (never hex). `epoch_be` is a `u64` big-endian encoding of the epoch number.

### Instance (a) — CORD-02 §4/§5: control-plane address

```
```
- `secret` = `community_root` (32 raw bytes)
- `id` = `community_id` (32 raw bytes, the sha256 commitment, NOT hex)
- `epoch` = the epoch number (`u64` BE)


### Instance (c) — CORD-03 §1: private-channel plane address

```
```
H01(c) is the **private** branch (a channel Rekey rotates `channel_key`/`channel_epoch`, not the community root):
- `secret` = the channel's own `channel_key` (32 raw bytes, hex-decoded from `ChannelKey.key`)
- `id` = `channel_id` (32 raw bytes, hex-decoded from `ChannelKey.id`)
- `epoch` = the channel's own `channel_epoch` (`u64` BE), **not** `root_epoch`

Test recipe for H01(c): pick a `newKey: string` (hex) and `newEpoch: number`, call `channelGroupKey(hexToBytes(newKey), channelIdBytes, newEpoch).pk` (from `crypto.ts:118`) as the expected value. Then call `rollForwardChannel(channel, newKey, newEpoch)` and assert the result's plane address (via `deriveChannelKeys(material, rolled).current.pk`) equals it.

### Why `crypto.ts` calls count as "hand-derived," not "calling the implementation under test"


### Byte-encoding gotchas for the test author
- `community_root`/`channel_key` are also hex strings on the material objects — same `hexToBytes` treatment.
- `epoch` is a plain JS `number`; `crypto.ts`'s `numberToBytesBE(epoch, 8)` handles the BE encoding internally — the test author does not need to hand-encode it.

## Gap 2 — D-10 Sweep: Classified `Reflect.set` Symbol-Write Sites

**Exact grep invocation** (re-runnable, matches D-10's contract verbatim):
```bash
grep -rn "Reflect\.set" packages/core/src packages/common/src --include="*.ts" | grep -v "__tests__"
```
`[VERIFIED: grep re-run 2026-07-15 against working tree; totals corrected during planning]` — **36 total grep hits** (16 in `core`, 20 in `common`), which reconcile as:

| | Count |
|---|---|
| Total `Reflect.set` grep hits | 36 |
| − `cache.ts`'s own 2 writes (the fix target, not a sweep classification target) | 34 grep sweep sites |
| + `core/operations/tags.ts:87` (row 15 — an object-literal spread, **not** a `Reflect.set`, so it never appears in the grep) | **35 comment sites** |

The classification table below has **35 rows**, splitting **15 IM / 16 AS / 4 CF**. This is notably more than the scout's "~20" estimate; treat the table as authoritative and re-run the grep at execution time to confirm nothing drifted.

**Useful post-fix property:** once D-01/D-02 land, `cache.ts` no longer uses `Reflect.set`, so this grep returns exactly **34** — every hit a sweep site, making it a clean 34/34 completeness check. `05-05-PLAN.md` re-runs it at gate time.

Categories per D-04/D-05 (classifying the **write site**, not the symbol):
- **IM** = identity memo — must NOT survive a spread (derived from the object's own current fields; a stale copy must recompute)
- **CF** = carry-forward payload — MUST survive a spread (deliberately propagated through the factory pipe)
- **AS** = accumulated state — mutable, propagated by the store's merge, not by spread (matches the executable definition at `event-store.ts:219`'s `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` merge list, D-07)

| # | File:Line | Symbol | Category | Notes |
|---|-----------|--------|----------|-------|
| 1 | `core/helpers/relays.ts:16` | `SeenRelaysSymbol` | AS | D-04's own named example |
| 2 | `core/helpers/hidden-tags.ts:105` | `HiddenTagsSymbol` | IM | Derived from decrypted content; recompute if content changes |
| 3 | `core/helpers/hidden-tags.ts:149` | `HiddenTagsSymbol` (`setHiddenTagsCache`) | IM | Same symbol, external-set path |
| 4 | `core/helpers/encrypted-content.ts:117` | `EncryptedContentSymbol` (`setEncryptedContentCache`) | IM | **The dual-lifecycle read-path half** — same symbol as #33/#8/#28 below but opposite semantics at this write site (D-05's worked example) |
| 5 | `core/helpers/filter.ts:23` | `EventIndexableTagsSymbol` | IM | Named in D-08 as a deferred-migration hot path |
| 6 | `core/helpers/event.ts:128` | `EventUIDSymbol` (`getEventUID`) | IM | Named in D-08 as a deferred-migration hot path |
| 7 | `core/helpers/event.ts:175` | `FromCacheSymbol` (`markFromCache`) | AS | In the `event-store.ts:219` merge list |
| 8 | `core/event-store/event-store.ts:222` | *(generic loop)* `FromCacheSymbol`/`verifiedSymbol`/`EncryptedContentSymbol` | AS | This is the **merge mechanism itself** (D-07's executable definition of "accumulated state"), not a single-symbol site — comment should point here as the canonical example, not reclassify it |
| 9 | `core/event-store/event-store.ts:295` | `EventStoreSymbol` | AS | Store-parentage marker; deliberately excluded from the #8 merge list (a duplicate keeps its own store ref) |
| 10 | `core/event-store/async-event-store.ts:265` | `EventStoreSymbol` | AS | Async-store twin of #9 |
| 11 | `core/helpers/contacts.ts:95` | `HiddenContactsSymbol` | IM | Derived from decrypted tags |
| 12 | `core/casts/cast.ts:56` | `CASTS_SYMBOL` | IM | Cast instances close over `this.event` by reference (getters read live fields); a stale cast on a spread copy would read the wrong underlying object — must not survive a spread |
| 13 | `core/operations/event.ts:134` | `EncryptedContentSymbol` (`stamp`) | CF | Carries plaintext across the pre-sign spread |
| 14 | `core/operations/event.ts:163` | `EncryptedContentSymbol` (`sign`) | CF | Carries plaintext onto the final signed event |
| 15 | `core/operations/tags.ts:87` | `EncryptedContentSymbol` (object literal, not `Reflect.set`) | CF | **D-05's canonical worked example** — flagged here for completeness though it's a literal spread, not `Reflect.set` (won't appear in the grep; call out explicitly in the comment pass since D-09 names it) |
| 16 | `common/helpers/mute.ts:88` | `MuteHiddenSymbol` | IM | Same shape as #2 |
| 17 | `common/helpers/encrypted-content-cache.ts:38` | `EncryptedContentFromCacheSymbol` (`markEncryptedContentFromCache`) | AS | Provenance flag, same shape as #7 but a distinct symbol not in the core merge list |
| 18 | `common/operations/gift-wrap.ts:83` | `RumorSymbol` (on seal) | AS | Same shape as #19/#20 — mutated/appended, not recomputed |
| 19 | `common/operations/gift-wrap.ts:88` | `SealSymbol` (on rumor, via `Set`) | AS | D-12's named example |
| 20 | `common/operations/gift-wrap.ts:115` | `GiftWrapSymbol` (on seal) | AS | D-12's named example |
| 21 | `common/operations/gift-wrap.ts:118` | `SealSymbol` (on gift) | AS | D-12's named example |
| 22 | `common/operations/gift-wrap.ts:121` | `EncryptedContentSymbol` (on gift) | CF | Explicitly named in D-09 as a write-path carry-forward site |
| 23 | `common/helpers/lists.ts:47` | `ListProfilePointersSymbol`/`ListEventPointersSymbol`/`ListAddressPointersSymbol`/`ListRelaysSymbol` (param `symbol`, two-level cache) | IM | Named in D-08 as a deferred-migration hot path; caches a `Partial<Record<ReadListTags,T>>` keyed further by `cacheType` |
| 24 | `common/helpers/bookmark.ts:102` | `BookmarkHiddenSymbol` | IM | Same shape as #2 |
| 25 | `common/helpers/groups.ts:108` | `GroupsHiddenSymbol` | IM | Same shape as #2 |
| 26 | `common/helpers/emoji-pack.ts:103` | `FavoriteEmojiPacksHiddenSymbol` | IM | Same shape as #2 |
| 27 | `common/helpers/emoji-pack.ts:120` | `FavoriteEmojiPacksHiddenPointersSymbol` | IM | Same shape as #2 |
| 28 | `common/helpers/app-data.ts:65` | `AppDataContentSymbol` | IM | Same shape as #2 |
| 29 | `common/helpers/trusted-assertions.ts:89` | `TrustedProvidersHiddenSymbol` | IM | Same shape as #2 |
| 30 | `common/helpers/gift-wrap.ts:53` | `SealSymbol` (`addParentSealReference`, via `Set`) | AS | D-12's named example — "mutated in place by `addParentSealReference`" |
| 31 | `common/helpers/gift-wrap.ts:91` | `SealSymbol` (`getRumorSeals` init) | AS | Same shape |
| 32 | `common/helpers/gift-wrap.ts:150` | `RumorSymbol` (parse-fail sentinel) | AS | Sets `undefined` as a negative-result cache; same shape |
| 33 | `common/helpers/gift-wrap.ts:170` | `RumorSymbol` (`getSealRumor` success) | AS | Same shape |
| 34 | `common/helpers/gift-wrap.ts:203` | `GiftWrapSymbol` (`getGiftWrapSeal`) | AS | Same shape |
| 35 | `common/helpers/gift-wrap.ts:207` | `SealSymbol` (`getGiftWrapSeal`) | AS | Same shape |

**Totals: 20 IM, 14 AS (incl. the #8 merge mechanism), 4 CF** (counting #15's literal-spread site alongside the 3 true `Reflect.set` CF hits). Every IM site is safe today only because none of these objects (all immutable signed `NostrEvent`s) is ever spread — exactly D-08's "safe only by accident" framing the comment pass exists to fix.


## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.15 (workspace-wide) |
| Config file | `vitest.config.ts` (root) |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-01 | Memo written non-enumerable; spread of a `material`-like object with a changed field drops the memo and recomputes | unit | `pnpm --filter applesauce-core test cache` | ❌ Wave 0 — `cache.ts` has no test file today (confirmed: `packages/core/src/helpers/__tests__/` has no `cache.test.ts`) |
| CACHE-02 | Taxonomy comment present in `cache.ts`; distinguishes IM from CF | manual/lint-of-comment (no automated assertion possible for prose) | code review at PR time | n/a — prose requirement, not test-automatable |
| CACHE-03 | `getEncryptedContent`/`getHiddenTags` correct after signed event passes through factory-pipe spreads | integration (end-to-end pipe) | `pnpm --filter applesauce-core test cache` (co-located per D-14/D-15) | ❌ Wave 0 — new test in the same new `cache.test.ts` |

### The D-13 two-sided test (enforcement mechanism, not a requirement ID but load-bearing for CACHE-02/03)
Both halves belong in one new file, `packages/core/src/helpers/__tests__/cache.test.ts` (D-14), asserting opposite outcomes on the *same convention*:
1. **Memo half (proves CACHE-01):** write a value via `setCachedValue`/`getOrComputeCachedValue` onto a plain mutable object, spread the object with one field changed, assert the symbol is **absent** on the spread copy (`Reflect.has(copy, symbol) === false`) and that recomputing yields the new-field-derived value, not the stale one.

### Sampling Rate
- **Per wave merge:** `pnpm -r test`
- **Phase gate:** `pnpm -r test` green, compared against the recorded baseline of **1989 tests, exit 0** (Success Criterion 4) — a changed total test count is expected (this phase adds tests) but a changed *pass* count (fewer passing, or any failure) is a regression signal, not an acceptable diff.

### Wave 0 Gaps
- [ ] `packages/core/src/helpers/__tests__/cache.test.ts` — new file; both D-13 halves (IM-drop + CF-survival)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Workspace runtime | ✓ | v26.4.0 (project floor: >=20.19 per PROJECT.md) | — |
| pnpm | Workspace package manager/test runner | ✓ | 11.10.0 | — |
| Vitest | Test framework | ✓ | ^4.0.15 (root `vitest.config.ts`) | — |

No missing dependencies; no fallback needed.

## Contradictions Found

None. `05-CONTEXT.md`'s D-01–D-18 are consistent with everything found in this research pass, including the confirmed absence of `Object.freeze`/`seal`/`preventExtensions` anywhere in the monorepo (D-02's premise) and the confirmed absence of `packages/core/src/helpers/__tests__/cache.test.ts` (D-14's premise). `[VERIFIED: grep run 2026-07-15]`

## Sources

### Primary (HIGH confidence)
- `grep -rn "Reflect\.set" packages/core/src packages/common/src --include="*.ts" | grep -v "__tests__"` — run directly against the working tree, 2026-07-15

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` Out of Scope table — "crypto/derivation... found faithful" register, underpinning the Gap 1 "why crypto.ts calls count as hand-derived" argument

## Metadata

**Confidence breakdown:**
- Spec formulas (Gap 1): HIGH — fetched directly from the protocol spec repo, cross-checked against `crypto.ts`'s (separately audit-verified) transcription
- Sweep classification (Gap 2): HIGH — every site read in context; classifications follow D-04/D-05/D-07/D-12's stated rules directly
- Validation architecture (Gap 3): HIGH — framework/config/commands confirmed by direct inspection; D-13/D-14/D-15 already fully specified by CONTEXT.md, this section only operationalizes them into a test map

**Research date:** 2026-07-15
**Valid until:** Stable for this milestone (v1.1); re-verify the sweep grep if any core/common source changes land between this research and Phase 5 execution.
