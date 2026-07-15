# Phase 5: Cache Identity Memo Fix - Research

**Researched:** 2026-07-15
**Domain:** JavaScript object identity / symbol-keyed memoization semantics; Concord protocol key-derivation formulas (spec-derived test fixtures)
**Confidence:** HIGH

## Summary

This phase's decisions are already fully locked in `05-CONTEXT.md` (D-01 through D-18) — nothing here re-opens them. This research fills the three gaps CONTEXT.md left open: (1) the exact CORD-02 §4 and CORD-03 §1 spec formulas needed to hand-derive the two spec-derived test fixtures, sourced directly from the protocol spec repo (not from the implementation); (2) a complete, re-run grep of every `Reflect.set` symbol-write site in `core`+`common`, classified against D-04's three categories — 33 sites, not the scout's "~20" estimate; (3) the Validation Architecture section the orchestrator requires to generate VALIDATION.md.

**Primary recommendation:** Derive the two spec-fixture expected values by calling `controlGroupKey`/`channelGroupKey` from `packages/concord/src/helpers/crypto.ts` directly with a hand-picked new root/epoch — **not** by calling `rollForward`/`rollForwardChannel`/`baseKeysFor`/`deriveChannelKeys` (those are the code under test). `crypto.ts` is the audit's separately-verified "crypto/derivation" register entry and is the literal transcription of CORD-02 Appendix A's frozen formulas — calling it independently of the caching-and-rollforward code path is exactly the "compute by hand from the spec formula" D-18 requires, and is what the audit's own proof did.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cache write mechanism (`setCachedValue`/`getOrComputeCachedValue`) | `applesauce-core` (shared SDK library) | `applesauce-common`, `applesauce-concord` (consumers) | Public API re-exported from `helpers/index.ts`; every downstream package calls it, so the fix must live at this single point, per D-01/PROJECT.md Key Decisions |
| Identity-memo vs. carry-forward taxonomy (comments + tests) | `applesauce-core` (`cache.ts`, `pipeline.ts`) | `applesauce-common` (hand-rolled sites), `applesauce-concord` (one comment-only correction) | Canonical prose lives in the helper's own source (D-06); sweep sites elsewhere just cite it |
| Spec-derived regression fixtures (H01 a/c) | `applesauce-concord` test suite | — | The bug only manifests in concord's `material`/`ChannelKey` spread pattern; `keys.test.ts`/`channel-rekey.test.ts` are the existing homes |
| Full-workspace regression baseline | Every package (`pnpm -r test`) | — | `cache.ts` is consumed by core, common, wallet, and concord — a behavior change here is workspace-wide by construction |

This is a library-internal phase (no browser/API/DB tiers apply); "tier" here means package boundary within the pnpm workspace.

## Gap 1 — Spec Formulas for the Hand-Derived Tests (D-17/D-18)

Fetched directly from `concord-protocol/concord` (branch `main`, files `02.md`, `03.md`) via `gh api repos/concord-protocol/concord/contents/{02,03}.md` — **not** read from `packages/concord/src/helpers/keys.ts` (the implementation under test). `[VERIFIED: github.com/concord-protocol/concord@main, 02.md/03.md fetched 2026-07-15]`

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
control_pk = group_key("concord/control", community_root, community_id, epoch).pk
```
- `secret` = `community_root` (32 raw bytes)
- `id` = `community_id` (32 raw bytes, the sha256 commitment, NOT hex)
- `epoch` = the epoch number (`u64` BE)

Test recipe for H01(a): pick a `newRoot: Uint8Array` and `newEpoch: number`, call `controlGroupKey(newRoot, communityIdBytes, newEpoch).pk` (from `packages/concord/src/helpers/crypto.ts:123`) to get the **expected** value, independent of `rollForward`. Then call `rollForward(keys, newRoot, newEpoch, refounder, channels)` and assert `deriveConcordKeys(result.material, channels).control.pk === expected` (or read `.control.pk` directly off whatever the fixed `rollForward`/`deriveConcordKeys` returns). This exactly reproduces the audit's own proof (`.planning/concord-audit.md:43-44`), which used `controlGroupKey(newRoot, cid, newEpoch)` as its "EXPECTED" line.

### Instance (c) — CORD-03 §1: private-channel plane address

```
Public  channel_pk = group_key("concord/channel", community_root, channel_id, root_epoch).pk
Private channel_pk = group_key("concord/channel", channel_key,    channel_id, channel_epoch).pk
```
H01(c) is the **private** branch (a channel Rekey rotates `channel_key`/`channel_epoch`, not the community root):
- `secret` = the channel's own `channel_key` (32 raw bytes, hex-decoded from `ChannelKey.key`)
- `id` = `channel_id` (32 raw bytes, hex-decoded from `ChannelKey.id`)
- `epoch` = the channel's own `channel_epoch` (`u64` BE), **not** `root_epoch`

Test recipe for H01(c): pick a `newKey: string` (hex) and `newEpoch: number`, call `channelGroupKey(hexToBytes(newKey), channelIdBytes, newEpoch).pk` (from `crypto.ts:118`) as the expected value. Then call `rollForwardChannel(channel, newKey, newEpoch)` and assert the result's plane address (via `deriveChannelKeys(material, rolled).current.pk`) equals it.

### Why `crypto.ts` calls count as "hand-derived," not "calling the implementation under test"

D-18 forbids deriving the expected value from the implementation under test. The implementation under test in this phase is the **caching + spread mechanism** — `cache.ts`, `baseKeysFor`, `deriveConcordKeys`, `rollForward`, `channelKeyMemo`, `deriveChannelKeys`, `rollForwardChannel`. `crypto.ts`'s `groupKey`/`controlGroupKey`/`channelGroupKey` are a distinct module: a byte-exact transcription of CORD-02 Appendix A that the audit's "verified correct" register separately confirmed (`.planning/PROJECT.md` Out of Scope table: "crypto/derivation... checked against both sides and found faithful"). Calling `controlGroupKey` directly — bypassing `baseKeysFor`/`rollForward` entirely — is structurally identical to "compute by hand": the test author supplies the spec's `(label, secret, id, epoch)` tuple explicitly and gets back the spec's output, with no dependency on whether the memo bug is present. This is also literally what the audit's own repro did. **Do not** assert `rollForward(...).control.pk === deriveConcordKeys(oldMaterialWithNewRoot).control.pk` or any other self-referential form — that reproduces the exact "test compares implementation to itself" failure this milestone exists to close.

### Byte-encoding gotchas for the test author
- `community_id`/`channel_id` are stored as **hex strings** on `JoinMaterial`/`ChannelKey` (see `packages/concord/src/types.ts` field shapes referenced in `keys.ts`) — `hexToBytes(...)` before passing to `crypto.ts` functions, matching the pattern at `keys.ts:114-115` and `keys.ts:541`.
- `community_root`/`channel_key` are also hex strings on the material objects — same `hexToBytes` treatment.
- `epoch` is a plain JS `number`; `crypto.ts`'s `numberToBytesBE(epoch, 8)` handles the BE encoding internally — the test author does not need to hand-encode it.

## Gap 2 — D-10 Sweep: Classified `Reflect.set` Symbol-Write Sites

**Exact grep invocation** (re-runnable, matches D-10's contract verbatim):
```bash
grep -rn "Reflect\.set" packages/core/src packages/common/src --include="*.ts" | grep -v "__tests__"
```
`[VERIFIED: grep run 2026-07-15 against working tree]` — **35 total hits**, of which 2 are `cache.ts`'s own definition (the fix target, not a sweep classification target) and **33 are sweep sites** to comment. This is notably more than the scout's "~20" estimate; treat the count below as authoritative and re-run the grep at execution time to confirm nothing drifted.

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

**Scope reminder (D-09/D-11):** `concord` is excluded from this sweep except the single comment-only correction at `packages/concord/src/helpers/keys.ts:98-104` (the false "a rekey/Refounding mints a fresh `material`" reasoning) — do not classify or comment any other concord symbol site in this phase.

## Gap 3 — Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.15 (workspace-wide) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm --filter applesauce-core test` (add `--filter applesauce-concord test` for the spec-derived fixtures) |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-01 | Memo written non-enumerable; spread of a `material`-like object with a changed field drops the memo and recomputes | unit | `pnpm --filter applesauce-core test cache` | ❌ Wave 0 — `cache.ts` has no test file today (confirmed: `packages/core/src/helpers/__tests__/` has no `cache.test.ts`) |
| CACHE-02 | Taxonomy comment present in `cache.ts`; distinguishes IM from CF | manual/lint-of-comment (no automated assertion possible for prose) | code review at PR time | n/a — prose requirement, not test-automatable |
| CACHE-03 | `getEncryptedContent`/`getHiddenTags` correct after signed event passes through factory-pipe spreads | integration (end-to-end pipe) | `pnpm --filter applesauce-core test cache` (co-located per D-14/D-15) | ❌ Wave 0 — new test in the same new `cache.test.ts` |
| TEST-01 (anchor, H01a) | `rollForward(...).control.pk` matches CORD-02 §4 formula over the new root, hand-derived via `controlGroupKey` | unit (spec-derived) | `pnpm --filter applesauce-concord test keys` | ❌ Wave 0 — new case in existing `packages/concord/src/helpers/__tests__/keys.test.ts` |
| TEST-01 (anchor, H01c) | `rollForwardChannel`'s plane address matches CORD-03 §1 private formula, hand-derived via `channelGroupKey` | unit (spec-derived) | `pnpm --filter applesauce-concord test channel-rekey` | ❌ Wave 0 — new case in existing `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` |

### The D-13 two-sided test (enforcement mechanism, not a requirement ID but load-bearing for CACHE-02/03)
Both halves belong in one new file, `packages/core/src/helpers/__tests__/cache.test.ts` (D-14), asserting opposite outcomes on the *same convention*:
1. **Memo half (proves CACHE-01):** write a value via `setCachedValue`/`getOrComputeCachedValue` onto a plain mutable object, spread the object with one field changed, assert the symbol is **absent** on the spread copy (`Reflect.has(copy, symbol) === false`) and that recomputing yields the new-field-derived value, not the stale one.
2. **Carry-forward half (proves CACHE-03, D-15's audit-probe promotion):** run a **real** encrypt operation → **real** `eventPipe`/`tagPipe` spreads → **real** `signer.signEvent` → then call `getEncryptedContent`/`getHiddenTags` on the signed result and assert the plaintext is correct. This is the exact probe the audit already ran by hand (`.planning/concord-audit.md:58`, "1989 tests, exit 0") — promote it verbatim into CI rather than re-inventing coverage. A future accidental migration of `EncryptedContentSymbol`'s write sites onto `setCachedValue` must turn this test red immediately; the memo half proving IM-drop and this half proving CF-survival on the *same mechanism* is the whole point of co-locating them (D-14).

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-core test` (+ `--filter applesauce-concord test` once the spec-fixture tasks land)
- **Per wave merge:** `pnpm -r test`
- **Phase gate:** `pnpm -r test` green, compared against the recorded baseline of **1989 tests, exit 0** (Success Criterion 4) — a changed total test count is expected (this phase adds tests) but a changed *pass* count (fewer passing, or any failure) is a regression signal, not an acceptable diff.

### Wave 0 Gaps
- [ ] `packages/core/src/helpers/__tests__/cache.test.ts` — new file; both D-13 halves (IM-drop + CF-survival)
- [ ] New case(s) in `packages/concord/src/helpers/__tests__/keys.test.ts` — H01(a) spec-derived fixture
- [ ] New case(s) in `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` — H01(c) spec-derived fixture
- [ ] No new framework/config install needed — Vitest is already wired at the workspace root and in both `core` and `concord` package configs

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Workspace runtime | ✓ | v26.4.0 (project floor: >=20.19 per PROJECT.md) | — |
| pnpm | Workspace package manager/test runner | ✓ | 11.10.0 | — |
| Vitest | Test framework | ✓ | ^4.0.15 (root `vitest.config.ts`) | — |
| `gh` CLI / GitHub API | Fetching CORD-02/03 spec text | ✓ | used this session to fetch `02.md`/`03.md` from `concord-protocol/concord@main` | Raw `raw.githubusercontent.com` URL also available as a fallback fetch path |

No missing dependencies; no fallback needed.

## Contradictions Found

None. `05-CONTEXT.md`'s D-01–D-18 are consistent with everything found in this research pass, including the confirmed absence of `Object.freeze`/`seal`/`preventExtensions` anywhere in the monorepo (D-02's premise) and the confirmed absence of `packages/core/src/helpers/__tests__/cache.test.ts` (D-14's premise). `[VERIFIED: grep run 2026-07-15]`

## Sources

### Primary (HIGH confidence)
- `concord-protocol/concord@main` `02.md` (CORD-02: Communities, §4 Addressing, Appendix A.1–A.3/A.6) — fetched via `gh api repos/concord-protocol/concord/contents/02.md`
- `concord-protocol/concord@main` `03.md` (CORD-03: Channels, §1 Keying) — fetched via `gh api repos/concord-protocol/concord/contents/03.md`
- `packages/concord/src/helpers/crypto.ts` — read only to confirm the frozen-formula transcription's function signatures (`controlGroupKey`, `channelGroupKey`, `groupKey`) for test-authoring purposes, not to derive the formula itself
- `grep -rn "Reflect\.set" packages/core/src packages/common/src --include="*.ts" | grep -v "__tests__"` — run directly against the working tree, 2026-07-15
- `.planning/concord-audit.md` (CONCORD-H01 entry) — cited per the phase's canonical-refs requirement

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` Out of Scope table — "crypto/derivation... found faithful" register, underpinning the Gap 1 "why crypto.ts calls count as hand-derived" argument

## Metadata

**Confidence breakdown:**
- Spec formulas (Gap 1): HIGH — fetched directly from the protocol spec repo, cross-checked against `crypto.ts`'s (separately audit-verified) transcription
- Sweep classification (Gap 2): HIGH — every site read in context; classifications follow D-04/D-05/D-07/D-12's stated rules directly
- Validation architecture (Gap 3): HIGH — framework/config/commands confirmed by direct inspection; D-13/D-14/D-15 already fully specified by CONTEXT.md, this section only operationalizes them into a test map

**Research date:** 2026-07-15
**Valid until:** Stable for this milestone (v1.1); re-verify the sweep grep if any core/common source changes land between this research and Phase 5 execution.
