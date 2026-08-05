# Phase 8: Rotation Robustness & Consensus - Research

**Researched:** 2026-07-19
**Domain:** Concord protocol (CORD-06) rekey/Refounding convergence, authority citation, and publish-confirmation gating in `packages/concord/src`
**Confidence:** HIGH (all code positions read directly this session; CORD-06 fetched verbatim from upstream via `curl`)

## Summary

Phase 8 hardens the rekey/Refounding machinery that Phase 6 made cryptographically correct in the single-rotation case. Every fix in scope is a **restructuring of the existing scope-generic core** (`readRekeyScoped` in `helpers/keys.ts`, `groupRotations`/`checkContinuity`/`lowerKeyWins` in `helpers/rekey.ts`) that both the root Refounding path and the channel-Rekey path already share — so every change here lands once and benefits both scopes. No new external packages are introduced; this is 100% internal correctness work.

The two "blocked on ruling" requirements were already ruled in CONTEXT.md (D-01: ROTATE-13 compaction abort = bug, fail-closed; D-02: ROTATE-10 chunk correlation = consistency-guard, not a key change) — this research does not re-litigate them, only grounds their implementation against current line positions.

The hardest, load-bearing piece is **D-04's down-only re-read spine**: today, `syncEpochs` (`client/sync.ts`) never re-invokes `readRekey` for a historical ("known") epoch at all — it only calls it for the tip. This means a member who already committed to a fork (correctly or via a transient bug) can **never** have that decision revisited by any code path, live or on restart. Fixing this is a prerequisite for ROTATE-05 (passive retry has nothing to retry against) and ROTATE-06 (down-only heal has no re-read to heal from). Research below gives the exact call sites, the exact current short-circuit, and a concrete (not yet locked) design for the anti-refork latch and the re-read loop, for the planner to finalize.

A second genuinely hard finding, surfaced by tracing the crypto rather than assumed from the audit: **a client structurally cannot decrypt a rekey blob it holds no locator for** — so "compute the winner among ALL authorized candidates" (D-03/D-05, ROTATE-07) cannot mean "numerically compare every fork's actual key" when a client is excluded from one of the racing forks. Research documents the exact mechanics and a recommended (fail-closed, not-yet-locked) resolution for the planner: `readRekeyScoped` must detect when an authorized+complete+continuity-matched competing fork exists that it **cannot decrypt at all**, and in that case return `none` (defer) rather than either adopting its own candidate or concluding removal — since it cannot prove its candidate is the true global-lowest winner. This is flagged prominently below and is the single most important open design question in this phase.

**Primary recommendation:** Restructure `readRekeyScoped` around three passes over the authorized+continuity-matched candidate sets (decrypt what we can → determine ambiguity → decide), thread a `vac` field through `ParsedRekey`/`RekeyRotationSet` mirroring `includeKickTarget`'s existing wire pattern, replace `rekeyHandled: Set<number>` with a per-epoch lowest-key latch, and make `syncEpochs` re-invoke the rekey read for every epoch it walks (not just the tip) — landing the latch/re-read spine first, since ROTATE-05/06/07 all depend on it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rekey blob wire codec (chunking, continuity, correlation) | Protocol/crypto helpers (`helpers/rekey.ts`) | — | Pure functions over parsed wire data; no I/O, no store access — this is the layer both scopes share |
| Convergence decision (adopt/removed/none) | Protocol/crypto helpers (`helpers/keys.ts` `readRekeyScoped`) | — | Pure function over `(keys, signer, events)`; must stay side-effect-free so it's independently testable against hand-derived oracles (TEST-01) |
| Anti-refork latch / down-only re-read scheduling | Client engine (`client/sync.ts`, `client/community.ts`, `client/private-channel.ts`) | — | Requires mutable per-engine state (which epoch/key is latched) and orchestrates *when* to call the pure convergence function — not itself part of the protocol math |
| `vac` citation emission | Operations (`operations/rekey.ts`) | Factories (implicitly, via `buildRekeyRumors`) | Mirrors `includeKickTarget`'s existing tag-injection pattern — operations own tag shape |
| `vac` verification (receive) | Protocol/crypto helpers (`helpers/keys.ts`, extended `isAuthorized`-adjacent predicate) | Client engine (constructs the predicate from folded `CommunityState`) | The verification LOGIC is pure over folded state; the engine supplies the folded state (grants/roles/owner), mirroring how `canRemoveSelf` is already built |
| Publish-confirmation majority gate | Client engine (`client/community.ts` `refound()`) | Relay tier (`packages/relay` `PublishResponse[]`) | Majority arithmetic is a client policy decision over relay ack responses — belongs where the publish loop already lives |
| Compaction abort-on-unfoldable | Protocol/crypto helpers (`helpers/keys.ts` `buildRefounding`) | — | Pure computation over `DecodedEvent[]` heads; throwing before any publish keeps the abort atomic |
| Historical-epoch `refounder` de-inheritance | Client engine (`client/sync.ts` `buildChain`) | Protocol data model (`types.ts` `JoinMaterial`/`held_roots`) | `buildChain` is client-side chain synthesis; the missing per-epoch attribution is a data-model gap in `held_roots`, not a protocol-wire gap |

## Project Constraints (from CLAUDE.md)

- **Concord is unreleased — no changesets required** for any change in this phase (per user's standing memory note; `packages/concord` has never shipped, so breaking internal shape changes carry no migration burden).
- **No drop shadows / no cards** — irrelevant to this phase (no UI work).
- **No `.form-control` DaisyUI class** — irrelevant to this phase (no UI work).
- **Status-observable style** (user memory): granular single-value `$` fields + a derived composite `status$`, mirroring the `Relay` class. `ConcordCommunity`/`ConcordPrivateChannel` already follow this (`phase$`, `epoch$`, `error$`, `connected$`, `authenticated$`, `status$` combining them) — no new observable surface is anticipated for this phase's fixes, but if the planner adds one (e.g., surfacing "removed pending confirmation" or a fork-detected signal), follow the existing granular-field pattern rather than a single opaque status blob.
- **"Discuss: explain before ruling"** (user memory) — not applicable to research; this phase's spec rulings (D-01/D-02) were already made in `/gsd-discuss-phase` with the mechanics explained there.
- **PROJECT.md v1.1 constraints** (binding on this phase): smallest-change-that-makes-the-spec-sentence-true; the fail-closed standard (four canonical defect shapes — guard defaults to permit, hand-rolled literal drops an optional field, existing helper bypassed, `catch`/`continue` degrades where spec says MUST); every fix carries a regression test asserting against an **independently-derived** spec value, never against implementation output; default `EventStore` consumers see no behavior change (irrelevant here — this phase touches only `applesauce-concord`).

## Standard Stack

No new external packages are introduced by this phase. All work is internal restructuring of existing `packages/concord/src` modules plus test additions in `packages/concord/src/helpers/__tests__/` and `packages/concord/src/client/__tests__/`.

### Reused internal primitives (no version concerns — same package)

| Module | Export | Role in this phase |
|--------|--------|---------------------|
| `helpers/rekey.ts` | `groupRotations`, `checkContinuity`, `lowerKeyWins`, `findBlob`, `parseRekey` | The wire-codec layer every fix restructures around |
| `helpers/keys.ts` | `readRekeyScoped`, `readRekey`, `readChannelRekey`, `buildRefounding`, `rollForward` | The convergence/compaction core |
| `helpers/permissions.ts` | `canActOn`, `resolveStanding`, `refoundAuthority` | Rank/authority primitives — `vac` verification composes with these, does not replace them |
| `helpers/crypto.ts` | `grantLocator`, `epochKeyCommitment` | `grantLocator` is the coordinate a `vac` citation must resolve to; `epochKeyCommitment` is the continuity primitive already in use |
| `packages/relay` `pool.ts`/`relay.ts` | `PublishResponse` (`{ ok: boolean; message?: string; from: string }`) | D-09's majority gate reads this array instead of discarding it |
| `client/admin.ts` | `vacFor(actor)` | The **emit-side** `vac` pattern already exists (returns `[eid, version, hash]` or `undefined` for the owner) — mirror its shape, there is no receive-side precedent to mirror (this phase writes the first one) |

## Package Legitimacy Audit

**Not applicable** — this phase installs no new packages. No `npm view`/`package-legitimacy check` gate is required; every module touched already exists in `packages/concord/src`.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │   Rekey wire (kind 3303, chunked)        │
                         │   helpers/rekey.ts: parseRekey           │
                         └───────────────────┬───────────────────-─┘
                                             │ ParsedRekey[]
                                             ▼
                         ┌───────────────────────────────────────-──┐
                         │ groupRotations(parsed)                   │
                         │  key = (rotator, scopeIdHex, newEpoch,   │
                         │         prevCommit)  [D-02: unchanged]   │
                         │  BUG: first-arrival chunkCount wins,     │
                         │  disagreeing n silently dropped (S03)    │
                         └───────────────────┬───────────────────-─┘
                                             │ RekeyRotationSet[]
                                             ▼
        ┌────────────────────────────────────────────────────────────────┐
        │ readRekeyScoped(held, events, isAuthorized, self, signer)      │
        │  filter: scope + newEpoch==heldEpoch+1 + isAuthorized +        │
        │          checkContinuity  (structural, no decryption needed)  │
        │  for each COMPLETE set:                                       │
        │    findBlob(set, myLocator) → decrypt → candidate key         │
        │    [D-06: catch ≠ absence — must not imply "removed"]         │
        │  compare decrypted candidates → lowerKeyWins → adopt          │
        │  no blob anywhere in a complete authorized set → removed      │
        │  [D-03/D-05: must also detect "opaque" competing forks this   │
        │   client CANNOT decrypt at all — see Common Pitfalls]         │
        └───────────────────────┬────────────────────────────────────-─┘
                                 │ ScopedRekeyOutcome (adopt|removed|none)
                    ┌────────────┴─────────────┐
                    ▼                          ▼
        readRekey (root scope)        readChannelRekey (channel scope)
        client/sync.ts syncEpoch      client/channel-sync.ts syncRekeyAndAdvance
        client/community.ts checkRekey  client/private-channel.ts checkRekey
                    │                          │
                    ▼                          ▼
        ┌─────────────────────────┐  ┌──────────────────────────┐
        │ rekeyHandled: Set<epoch>│  │ rekeyHandled: Set<epoch> │
        │ [D-04: must become a    │  │ [same fix, channel scope]│
        │  per-epoch LOWEST-KEY   │  │                          │
        │  latch, not a boolean]  │  │                          │
        └─────────────────────────┘  └──────────────────────────┘
                    │
                    ▼
        adoptRefounding(next) → rewireState → openLive → trimStaleGuestbookStores
                    ▲
                    │ next comes from buildRefounding()
        ┌───────────┴──────────────────────────────────────────────┐
        │ buildRefounding (helpers/keys.ts)                        │
        │  1. root-roll rekey blobs  (must publish + CONFIRM first)│
        │  2. channel rekey blobs    (bundled, prior-root sealed)  │
        │  3. compaction (re-wrap Control heads into new epoch)    │
        │     [D-01: unfoldable head → THROW before any publish]   │
        │  4. guestbook snapshot (best-effort)                     │
        └───────────────────────────────────────────────────────-──┘
                    ▲
                    │ recipients/heads/channelRekeys
        ┌───────────┴──────────────────────────────────────────────┐
        │ refound() (client/community.ts)                          │
        │  outrank loop (unchanged, Phase 6)                        │
        │  await rekeyWraps publish → [D-09: require MAJORITY ok]  │
        │  await channelRekeyWraps publish                          │
        │  ONLY THEN: compactionWraps / snapshotWraps / adopt       │
        │  [today: fire-and-forget .catch(()=>{}), unconditional]  │
        └────────────────────────────────────────────────────────-─┘
```

### Recommended Project Structure

No new files/folders — every fix lands inside the existing module boundaries:

```
packages/concord/src/
├── helpers/
│   ├── keys.ts          # readRekeyScoped restructure (D-03/D-05/D-06), buildRefounding abort (D-01), vac verify predicate
│   ├── rekey.ts          # groupRotations n-disagreement guard (D-02), prevepoch guard (ROTATE-11), ParsedRekey.vac field
│   └── __tests__/
│       ├── keys.test.ts       # extend: transient-decrypt (D-06), lowerKeyWins tie-break (D-03), down-only latch (D-04)
│       └── rekey.test.ts      # extend: n-disagreement (D-02), prevepoch disagreement (ROTATE-11)
├── operations/
│   └── rekey.ts          # includeRekeyChunk gains an optional vac param, mirroring includeKickTarget (D-08)
├── client/
│   ├── sync.ts            # syncEpoch/syncEpochs re-read spine (D-04), buildChain refounder de-inheritance (ROTATE-12)
│   ├── channel-sync.ts    # syncChannelEpochs re-read spine, channel scope (D-04)
│   ├── community.ts       # refound() majority-confirmed publish gate (D-09), rekeyHandled → latch (D-04)
│   ├── private-channel.ts # rekeyHandled → latch, channel scope (D-04)
│   └── __tests__/
│       └── community.test.ts  # extend: majority-gated publish (D-09), racing Refoundings converge (D-03/D-04)
└── types.ts               # JoinMaterial.held_roots entries gain optional `refounder` (ROTATE-12 data-model fix)
```

### Pattern 1: Scope-generic convergence core

**What:** `readRekeyScoped` takes an abstract `ScopedHeld` (scope id, held epoch, held key, `canRemoveSelf` predicate) so the SAME function serves both the root Refounding (`ROOT_SCOPE_HEX`, all-zero scope id) and a channel Rekey (the channel id as scope). Both `readRekey` and `readChannelRekey` are thin wrappers that supply scope-specific values and re-wrap the generic `ScopedRekeyOutcome` into their own public `RekeyOutcome`/`ChannelRekeyOutcome` types.

**When to use:** Every fix in this phase that touches convergence math (D-02/D-03/D-04/D-06) belongs in `readRekeyScoped`/`groupRotations`, never duplicated per-scope — landing it once fixes both the root and channel paths.

**Example (current code, `helpers/keys.ts:486-531`):**
```typescript
async function readRekeyScoped(
  held: ScopedHeld,
  rekeyEvents: Iterable<DecodedEvent>,
  isAuthorized: (rotator: string) => boolean,
  self: string,
  signer: ISigner,
): Promise<ScopedRekeyOutcome> {
  const heldEpoch = BigInt(held.heldEpoch);
  const parsed = [...rekeyEvents].map((d) => parseRekey(d)).filter((p): p is NonNullable<typeof p> => p !== null);
  const rotations = groupRotations(parsed).filter(
    (set) =>
      set.scopeIdHex === held.scopeIdHex &&
      set.newEpoch === heldEpoch + 1n &&
      isAuthorized(set.rotator) &&
      checkContinuity(set, heldEpoch, held.heldKey).ok,
  );
  if (rotations.length === 0) return { kind: "none" };
  // ... per-set loop, see Common Pitfalls for the exact bug lines
}
```

### Pattern 2: The `vac` citation pattern (emit-side precedent, `includeKickTarget`)

**What:** `operations/guestbook.ts:28-33`'s `includeKickTarget` already threads an optional `vac?: [string, string, string]` (grant `eid`, `version`, `edition hash`) as a `["vac", ...vac]` tag via `addNameValueTag(...)`. `client/admin.ts:130-139`'s `vacFor(actor)` computes it: returns `undefined` for the owner (exempt), otherwise `[grantLocator(cid, actor), String(latest.version), latest.hash]` from the actor's own current Grant edition. **Nothing in the codebase verifies a `vac` on receive today** — the doc comment at `admin.ts:130` explicitly says "Advisory: the fold re-derives standing from the roster and never reads this tag." Phase 8 (ROTATE-08) is the FIRST receive-side verifier in the codebase for this tag shape.

**When to use:** D-08's fix mirrors this exact emit shape onto `operations/rekey.ts`'s `includeRekeyChunk` (currently: `scope`/`newepoch`/`prevepoch`/`prevcommit`/`chunk`/`ms` tags, no `vac`). Owner exempt (matches `vacFor`'s existing owner exemption).

**Example (existing pattern to mirror, `operations/guestbook.ts:28-33`):**
```typescript
export function includeKickTarget(member: string, vac?: [string, string, string]): EventOperation {
  return modifyPublicTags(
    addProfilePointerTag(member, undefined, false),
    vac ? addNameValueTag(["vac", ...vac], false) : undefined,
  );
}
```

### Anti-Patterns to Avoid

- **Comparing a fork's key you cannot decrypt.** A recipient with no locator in a rotation set has no way to learn that set's proposed new key — the wrapped plaintext is pairwise-encrypted per recipient (`signer.nip44.encrypt(pk, plain)` in `buildRefounding`, one ciphertext per recipient). Any implementation that tries to "rank" an undecryptable fork numerically is unimplementable; see Common Pitfalls below for the fail-closed alternative.
- **A boolean "handled" set where a graded latch is needed.** `rekeyHandled: Set<number>` (community.ts:265, private-channel.ts:86) currently means "don't re-decide this epoch" — D-04 needs "don't move UP, but DO move down" — a boolean can't express that; it must become a `Map<epoch, key>`.
- **Treating `groupRotations`'s per-chunk `chunkCount` field as a correlation key.** D-02 explicitly rules this out — upstream correlates by `(rotator, scope, newepoch, prevcommit)` only; `chunkCount` is a consistency signal within one bucket, not a bucketing key.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Majority-of-relays confirmation | A custom quorum/retry library | `PublishResponse[]` already returned by `pool.publish` (`packages/relay/src/pool.ts:181`, `group.ts:230`) — just stop discarding it | The `{ok, from, message}` shape and the `"Timeout"` `ok:false` case (`relay.ts:986`) already exist; D-09 only needs arithmetic over an array already in hand |
| Grant-citation verification | A new authority/ACL sub-system | `grantLocator` (`helpers/crypto.ts:184`) + the already-folded `CommunityState.grants`/`roles` — the SAME primitives `resolveStanding`/`canActOn` already use | `vac` verification is a receive-side sibling of the existing outrank check, not a new authority model |
| Per-epoch history addressing | A separate "epoch ledger" data structure | Extend `JoinMaterial.held_roots` (already `{epoch, key}[]`) with an optional `refounder` field | Minimal additive field reuses the exact structure `rollForward`/`buildChain` already thread |

**Key insight:** every fix in this phase is a restructuring of code that already exists and already almost does the right thing (the recurring defect shape is "a guard that silently downgrades" or "a helper that isn't consulted") — there is no green-field subsystem to build.

## Confirmed Current Line Positions (verified 2026-07-19, post-Phase-7)

CONTEXT.md flags that its line numbers predate Phase 7's edits. Verified current positions:

| Symbol | File | Current lines | Context.md's estimate |
|--------|------|---------------|------------------------|
| `readRekeyScoped` (whole function) | `helpers/keys.ts` | 486–531 | ~486-527 (close) |
| — decrypt try/catch (`treat as absent`) | `helpers/keys.ts` | 511–519 (catch at 517-519) | ~508-517 |
| — `removed = true` assignment | `helpers/keys.ts` | 525 | ~525 (exact) |
| `ScopedHeld`/`ScopedRekeyOutcome` types | `helpers/keys.ts` | 454–473 / 475–478 | matches |
| `buildRefounding` compaction loop | `helpers/keys.ts` | 372–383 (guard at 377, try/catch 378-382) | :376-382 (exact) |
| `rollForward` | `helpers/keys.ts` | 272–288 | :265-273 (drifted +7) |
| `RekeyOutcome` type | `helpers/keys.ts` | 398–401 | n/a |
| `groupRotations` | `helpers/rekey.ts` | 204–228 (n-disagreement drop at 224) | :204-225 (matches) |
| `checkContinuity` | `helpers/rekey.ts` | 236–246 | matches |
| `lowerKeyWins` | `helpers/rekey.ts` | 261–263 | n/a |
| `ParsedRekey.prevEpoch`/`RekeyRotationSet.prevEpoch` | `helpers/rekey.ts` | field at 129 (interface), first-chunk-wins set at 216 | :207,213-217 (close — same first-arrival bug as chunkCount) |
| `includeRekeyChunk` (vac lands here) | `operations/rekey.ts` | 18–36 | :27-34 (drifted -9 to +2, same function) |
| `includeKickTarget` (vac pattern to mirror) | `operations/guestbook.ts` | 28–33 | n/a |
| `vacFor` (emit-side vac, existing) | `client/admin.ts` | 133–139 | n/a |
| `syncEpoch` | `client/sync.ts` | 105–212 | :195-245 (function range wider than noted) |
| — `"known"` short-circuit | `client/sync.ts` | 181 (`if (chainHasNext) { transition = "known"; }`) | :208 (drifted) |
| — `readRekey` call (tip only) | `client/sync.ts` | 194–202 | n/a |
| `syncEpochs` | `client/sync.ts` | 220–246 | matches range |
| — `"known"` continue | `client/sync.ts` | 237 (`if (result.transition === "known") continue;`) | :216 (drifted) |
| `buildChain` (refounder spread bug) | `client/sync.ts` | 253–268 | :239-247 (function starts earlier than noted) |
| `planeStoreKey` | `client/sync.ts` | 279–283 | matches |
| `syncRekeyAndAdvance`/`syncChannelEpochs` | `client/channel-sync.ts` | 61–85 / 92–105 | not in Context.md (channel-scope equivalent, same bug class) |
| `rekeyHandled` (root) | `client/community.ts` | declared 265; used 777, 1247 | ~670-671 (drifted; Phase 7 added ~500 lines above) |
| `checkRekey` (root, live) | `client/community.ts` | 759–781 | n/a |
| `controlHeadsWithSeals` | `client/community.ts` | 1177–1187 | Context.md already updated this one correctly (:1177) |
| `refound()` | `client/community.ts` | 1189–1249 | 1055-1106 in H03/H04 finding text (stale); Context.md's own :1189-1246 estimate close |
| — outrank loop | `client/community.ts` | 1209–1212 | n/a |
| — publish sequence | `client/community.ts` | 1237–1246 | :1239-1246 close |
| — `rekeyHandled.add` + `adoptRefounding` | `client/community.ts` | 1247–1248 | matches |
| `adoptRefounding` | `client/community.ts` | 787–801 | n/a |
| `rekeyHandled` (channel) | `client/private-channel.ts` | declared 86; used in `checkRekey` 260-282 | n/a |
| `JoinMaterial.held_roots` (no `refounder` field) | `types.ts` | 152 | n/a |
| `JoinMaterial.refounder` (single, tip-only) | `types.ts` | 154 | n/a |

## Common Pitfalls

### Pitfall 1 (THE MOST IMPORTANT FINDING): "compute the winner among ALL candidates" is cryptographically unimplementable as literal key comparison across forks you cannot decrypt

**What goes wrong:** D-03/D-05 (ROTATE-06/07) call for computing the lowest-key winner "among all authorized+continuity-checked candidates, not just those carrying our blob." But a rekey blob's plaintext (`scope_id[32] || epoch_be[8] || new_key[32]`) is NIP-44-encrypted **per-recipient** — `buildRefounding` calls `signer.nip44.encrypt(pk, plain)` once per recipient in `opts.recipients` (`helpers/keys.ts:347-350`). A client excluded from a fork's recipient list has **no ciphertext to decrypt at all** for that fork — there is no cryptographic mechanism by which they can learn that fork's actual key value, only that the fork *exists* (the outer envelope is decryptable by anyone still holding the prior root, since `rekeyAddr = baseRekeyGroupKey(oldRoot, cidBytes, newEpoch)` derives from public inputs any current holder can compute — so the OUTER rumor tags — `scope`/`newepoch`/`prevepoch`/`prevcommit`/`chunk` — and the locator list are visible to every current member, just not the wrapped key values for locators that aren't theirs).

**Why it happens:** The audit's M02 language ("A member present only in the losing (higher-key) rotation adopts a dead root and is silently orphaned") describes a real bug in the CURRENT code (traced below), but the FULL spec-strict fix ("removed even if a higher fork retained us") requires knowing which fork is the true lowest — which is undecidable for a fork you hold no blob in.

**Current bug, traced exactly:** In the existing loop (`helpers/keys.ts:507-526`), `adopted` is computed by comparing ONLY the sets we successfully decrypt (this part is already correct — `lowerKeyWins` picks the true lowest among what we hold). The bug is that `removed = true` can be set by ANY set we don't have a blob in (line 525), independent of whether we ALSO adopted a DIFFERENT set — but since the function returns `adopted` in preference to `removed` (`if (adopted) return {kind:"adopt", ...}` comes first), a member excluded from a lower fork but included in a higher one **currently adopts the higher (wrong) fork silently** — they never even check whether a lower authorized+complete+continuity candidate exists. This part IS fixable without solving the decryption-across-forks problem: **structurally detect** (via `set.complete`/`isAuthorized`/`checkContinuity` — all computable without decrypting any blob) whether more than one authorized+complete+continuity-matched set exists for the target epoch, and if some of those we CANNOT decrypt at all, do not blindly adopt our own candidate.

**How to avoid — recommended (not locked) design for the planner:**
1. Partition `rotations` (after the existing structural filter) into `complete` sets only.
2. For each complete set, attempt `findBlob` + decrypt. Collect **decryptable candidates** (key/rotator we successfully learned) separately from **opaque candidates** (complete+authorized+continuity-matched sets we hold no blob for, or whose blob decrypt threw — see Pitfall 2 for why decrypt-failure must NOT collapse into "opaque = excluded").
3. If `decryptable.length > 0`: pick the lowest among decryptable via `lowerKeyWins` (already-correct logic).
4. **If any `opaque` sets also exist** (a competing fork we cannot rank): do **not** return `adopt` even though we have a decryptable candidate — we cannot prove it's the true global-lowest winner. Return `none` (defer, matches the passive-retry philosophy already established for D-06/D-07 — never conclude prematurely). This is a genuinely conservative choice: a client in this exact position could remain at `none` indefinitely if the opaque fork truly is lower AND never grants them access by another route. This is judged the correct fail-closed behavior (never silently adopt a dead fork, never silently self-evict on ambiguous information) but **should be confirmed with the user/upstream spec author before locking**, since CORD-06 §3's text ("every client computes the same winner") may assume near-universal recipient-list overlap in practice rather than true cryptographic determinism for excluded members.
5. If `decryptable.length === 0` and `opaque.length === 0`: return `none` (no candidates at all — matches today).
6. If `decryptable.length === 0` and `opaque.length > 0` (we're excluded from every candidate that exists): return `removed`, gated by `canRemoveSelf` against any of the opaque sets' rotators (fail-closed as today — an absent/false `canRemoveSelf` denies the removal).

**Warning signs:** any implementation that tries to have recipients "vote" on or infer another fork's key value, or that treats "opaque fork exists" as equivalent to "removed" (that would self-evict a client who is genuinely the true winner, purely because a losing higher fork happened to also exist and exclude them — over-aggressive, not what D-03 intends).

### Pitfall 2: Decrypt failure must be distinguished from BOTH "absent" and "opaque-fork ambiguity"

**What goes wrong:** ROTATE-05/D-06 requires a caught decrypt error at OUR OWN locator (blob found, `signer.nip44.decrypt` throws — e.g., a NIP-46 bunker timeout) to be treated as **positive evidence of inclusion, outcome undetermined** — never as absence, never folded into "removed."

**Why it happens:** `helpers/keys.ts:511-519`'s current catch block comment literally says "undecryptable blob at our locator — treat as absent" and falls through to the same `!adoptedHere` branch as genuine absence (line 525), which can set `removed = true`.

**How to avoid — signalling shape (resolves the "Claude's Discretion" item):** Do **not** add a new externally-visible `ScopedRekeyOutcome` variant (`retry`/`decryptFailed`). The external contract already has exactly the right shape for this: `{kind: "none"}` already means "conclude nothing, keep current key, try again later" — which is precisely the desired behavior for a transient decrypt failure. The fix is entirely **internal to the loop body**: track a per-call boolean (or, given Pitfall 1's restructuring, simply the fact that a decrypt attempt threw) and ensure that outcome **never contributes to `removed = true`**, while also never contributing to `adopted`. Concretely: when a blob is found but decrypt throws, that set should be excluded from BOTH `decryptable` and the "can conclude removal from this set" logic — it is neither a successfully-adopted candidate nor an authorization for removal; the safest classification is to treat it identically to an **opaque candidate for the ambiguity check** (Pitfall 1, step 4) if other sets are meanwhile fully decryptable, or simply `none` if it's the only set in play. Either resolution keeps the external `RekeyOutcome`/`ChannelRekeyOutcome` types **unchanged** — no new "retry" kind needs to leak past `readRekeyScoped`.

**Warning signs:** any exposed `kind: "retry"` on `RekeyOutcome`/`ChannelRekeyOutcome` that leaks past `readRekeyScoped` is very likely unnecessary complexity — the existing `"none"` outcome plus D-04's re-read spine (below) already gives the passive-retry semantics D-07 asks for, with zero new call-site branching required in `syncEpoch`/`checkRekey`/`syncRekeyAndAdvance`.

### Pitfall 3: The down-only re-read spine touches THREE distinct places, not one

**What goes wrong:** Planners may assume "make `syncEpochs` re-read known epochs" is a single localized change. It is not — the mechanism must change in three places, and the CHANNEL scope has a structurally different gap than the ROOT scope.

**Root scope (`client/sync.ts`):** `syncEpoch` (105-212) only calls `readRekey` when `!chainHasNext` (the tip; see the `else` branch starting at line 184). For every OTHER (historical/"known") epoch in the chain, `chainHasNext` is true, so line 181's `transition = "known"` fires and `readRekey` (194-202) is **never invoked at all** for that epoch — even though step 2 of `syncEpoch` (lines 122-137) DOES fully fetch/decode/route that historical epoch's rekey-plane events into `rekey: DecodedEvent[]`, which is then simply discarded (never passed anywhere) once `transition = "known"` is decided. `syncEpochs`'s loop (227-243) then just `continue`s past it (line 237) without ever considering whether a lower sibling exists. **Fix must call `readRekey`-equivalent for every "known" epoch too**, and if a STRICTLY LOWER winner is found than what `chain[i+1]` currently records, the walk must discard `chain[i+1..]` and rebuild the continuation from the newly-discovered lower root (this can cascade if further epochs were built on the abandoned branch — flag as an open question below regarding how deep this needs to go and how `held_roots`/persisted `material` gets corrected).

**Channel scope (`client/channel-sync.ts`):** `syncChannelEpochs` (92-105) has NO pre-known chain at all — it's a forward-only loop (`for (;;)`) that starts at whatever `channelKey.epoch` is CURRENTLY PERSISTED and walks forward via `syncRekeyAndAdvance` until "none" (tip) or "removed". A fresh call to `syncChannelEpochs` (e.g. `refreshForCommunityEpoch()` after a community Refounding) starts from the ALREADY-ADVANCED epoch and never re-examines the transition INTO that epoch. The re-read mechanism therefore needs a DIFFERENT entry point for the channel scope: walk backward through `channel.held` (the retained prior-epoch keys, `{epoch, key}[]`, already present in the `ChannelKey` type) to re-derive each held epoch's `keys` and re-invoke `syncRekeyAndAdvance`-equivalent logic against it, mirroring how the root scope would use `held_roots`.

**Live check paths (`community.ts:checkRekey`, `private-channel.ts:checkRekey`):** These are structurally unable to reconsider a PAST epoch at all — they hold only ONE current `this.keys`/`this.channelKey`, and `readRekeyScoped`'s filter (`newEpoch === heldEpoch + 1n`) automatically excludes any rotation targeting an epoch we've already moved past. The re-read spine can therefore ONLY be realized by a **fresh full walk** (`syncEpochs`/`syncChannelEpochs`, i.e. reconnect/restart/explicit re-sync), not by anything in the live-subscription path. This matches D-07's own text ("the next sync re-attempts the decrypt") — "sync" here means a full walk, not the live check.

**How to avoid:** Plan this as ONE prerequisite task ("the re-read spine") touching `sync.ts` + `channel-sync.ts` together, landed BEFORE the tasks that depend on it (D-06's passive retry, D-03/D-04's down-only heal) — exactly as CONTEXT.md's "Specific Ideas" section already flags ("the keyless of this phase is the re-read").

### Pitfall 4: `rekeyHandled: Set<number>` cannot express "down-only"

**What goes wrong:** A boolean per-epoch "handled" flag can only express "decided once, never revisit" — it cannot express "revisit, but only accept a strictly lower key."

**Current shape:** `community.ts:265` (`private rekeyHandled = new Set<number>();`), checked/set at `checkRekey` (777) and `refound()` (1247); `private-channel.ts:86`, same pattern in its own `checkRekey` (260-282).

**How to avoid:** Replace with `Map<number, Uint8Array>` (epoch → lowest key adopted so far). On a new outcome for a given epoch: if no entry exists, adopt and record. If an entry exists, only adopt (and update the record) when `lowerKeyWins(existing, candidate) === candidate && !bytesEqual(existing, candidate)` (strictly lower) — otherwise treat as already-converged (`none`). This is the concrete mechanism behind D-04's "per-epoch latch."

**Storage (resolves the "Claude's Discretion" item on persistence):** **In-memory per-engine is sufficient — do not persist.** Reasoning: the latch's entire job is to prevent re-adopting a HIGHER key once a LOWER one has been seen in THIS process's lifetime. On restart, `syncEpochs`/`syncChannelEpochs` re-walks from the PERSISTED `material` (which already encodes whichever root/key the previous session settled on via `held_roots`/`root_epoch`/`channel.epoch`), and the re-read spine (Pitfall 3) re-examines each epoch's rekey plane fresh — if a genuinely lower sibling exists, it will be re-discovered on the fresh walk regardless of any in-memory latch, because the walk starts from `material`'s already-recorded (possibly-wrong) root and the re-read step recomputes the comparison from the wire data every time. A persisted latch would only matter if the PERSISTED material itself needs to remember "we've already ruled out lower forks below X" as an optimization to avoid re-checking every session forever — that's a performance concern, not a correctness one, and can be deferred. Persist only if a future performance pass finds the full re-check too expensive on every reconnect.

### Pitfall 5: `groupRotations`'s first-arrival-wins bug affects BOTH `chunkCount` (S03/ROTATE-10) and `prevEpoch` (L08/ROTATE-11) identically

**What goes wrong:** `helpers/rekey.ts:204-228`. When a bucket (keyed by `rotator:scopeIdHex:newEpoch:prevCommit`) is first created, `chunkCount` (line 218) and `prevEpoch` (line 216) are both captured from the FIRST chunk parsed into that bucket and never re-validated against subsequent chunks. Only line 224's `if (p.chunkCount === set.chunkCount) set.chunks.set(p.chunkIndex, p);` filters on `chunkCount` — a later chunk with a DIFFERENT `chunkCount` is silently dropped (never added to `set.chunks`, never contributing to `set.complete`), which can let a STALE generation's chunk count reach `complete` using only the first-arriving generation's chunks. `prevEpoch` has NO validation at all — a chunk with a different `prevEpoch` is silently accepted into `set.chunks` (line 224's guard doesn't check it), meaning `set.prevEpoch` (used nowhere in continuity math itself — `checkContinuity` takes `prevEpoch`/`prevCommit` from the SET, not per-chunk) could be internally inconsistent without any signal.

**How to avoid:** Both ride the SAME fix (D-02 + ROTATE-11 are one consistency-guard mechanism): track the full multiset of `chunkCount` and `prevEpoch` values seen per bucket; if MORE THAN ONE distinct value of EITHER appears within one bucket, mark the set inconsistent (`complete` forced `false`, and ideally an explicit `consistent: false` flag so the caller can distinguish "still fetching" from "will never be complete, refetch/investigate") rather than silently completing on the first-arriving generation.

**Warning signs:** Any fix that adds `chunkCount` to the bucket's correlation KEY (the audit's literal suggestion, explicitly rejected by D-02) — this diverges from upstream's `(rotator, scope, newepoch, prevcommit)` correlation and still lets a stale n-set complete on its own, just partitioned differently.

### Pitfall 6: `refound()`'s publish loop already has the right SEQUENCE, just the wrong GATING

**What goes wrong:** `community.ts:1237-1246` already publishes `rekeyWraps` and `channelRekeyWraps` FIRST (awaited, sequentially, matching CORD-06 §3's "land them first"), THEN `compactionWraps`/`snapshotWraps` — the sequencing is correct. The bug is that EVERY publish (including the root-roll rekey blobs) uses `.catch((err) => console.warn(...))` or bare `.catch(() => {})`, discarding the `PublishResponse[]` array entirely — `Promise.all`/`.catch()` on a resolved (not rejected) promise never even fires, so `pool.publish`'s per-relay `{ok: false}` responses are silently ignored; only a network-level REJECT would trigger the catch. `rekeyHandled.add(plan.newEpoch)` and `adoptRefounding(plan.next)` (1247-1248) run UNCONDITIONALLY regardless of how many relays actually accepted the root roll.

**How to avoid:** After the root-roll `rekeyWraps` publish loop, aggregate `PublishResponse[]` (one array per wrap, or flatten across all wraps — needs a design call, see Open Questions) and require **strict majority** `ok:true` responses (`⌈(n+1)/2⌉` of `this.relays()` — i.e. more than half of the relay COUNT, not of responses received, since a relay that never responds should count as not-ok). Use `PublishResponse.ok === false` (including the `"Timeout"` `message`, `relay.ts:986`) as not-ok. If the majority threshold isn't met: **throw** rather than proceeding to compaction/snapshot publish or `adoptRefounding` — matching D-01's abort-before-any-further-publish shape used for compaction. Only after the majority gate passes should compaction/snapshot publish and `rekeyHandled.add`/`adoptRefounding` run.

## Code Examples

### Existing `vac` emit pattern to mirror (D-08) — `operations/guestbook.ts:28-33`
```typescript
export function includeKickTarget(member: string, vac?: [string, string, string]): EventOperation {
  return modifyPublicTags(
    addProfilePointerTag(member, undefined, false),
    vac ? addNameValueTag(["vac", ...vac], false) : undefined,
  );
}
```

### Existing emit-side `vac` computation (D-08) — `client/admin.ts:130-139`
```typescript
/** The `vac` citation of `actor`'s own Grant edition (CORD-04) — omitted for the
 *  owner, whose authority is proven by the community_id itself. Advisory: the
 *  fold re-derives standing from the roster and never reads this tag. */
async vacFor(actor: string): Promise<[string, string, string] | undefined> {
  if (actor === this.material.owner) return undefined;
  const eid = grantLocator(this.communityIdBytes, actor);
  const latest = await this.latestEdition(eid);
  if (!latest) return undefined;
  return [eid, String(latest.version), latest.hash];
}
```
Note: `refound()` (`community.ts`) currently calls no `vacFor`-equivalent for the ROTATOR's own rotation — D-08 needs `refound()`/`rotateChannel()` to compute their own `vac` (mirroring `kick()`'s `const vac = await this.admin.vacFor(this.pubkey);` at `community.ts:994`) and thread it into `buildRefounding`/`buildChannelRekey` → `includeRekeyChunk`.

### `PublishResponse` shape (D-09) — `packages/relay/src/types.ts:78`
```typescript
export type PublishResponse = { ok: boolean; message?: string; from: string };
```
Timeout case (`packages/relay/src/relay.ts:986`):
```typescript
with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
```

### `groupRotations`'s first-arrival bug (D-02/ROTATE-11) — `helpers/rekey.ts:204-228`
```typescript
export function groupRotations(parsed: ParsedRekey[]): RekeyRotationSet[] {
  const byKey = new Map<string, RekeyRotationSet>();
  for (const p of parsed) {
    const key = `${p.rotator}:${p.scopeIdHex}:${p.newEpoch}:${p.prevCommit}`;
    let set = byKey.get(key);
    if (!set) {
      byKey.set(
        key,
        (set = {
          rotator: p.rotator,
          scopeIdHex: p.scopeIdHex,
          newEpoch: p.newEpoch,
          prevEpoch: p.prevEpoch,       // <- captured from FIRST chunk only
          prevCommit: p.prevCommit,
          chunkCount: p.chunkCount,      // <- captured from FIRST chunk only
          chunks: new Map(),
          complete: false,
        }),
      );
    }
    if (p.chunkCount === set.chunkCount) set.chunks.set(p.chunkIndex, p); // <- silent drop on disagreement, no prevEpoch check at all
  }
  for (const set of byKey.values()) set.complete = set.chunks.size >= set.chunkCount;
  return [...byKey.values()];
}
```

### `buildChain`'s refounder over-inheritance (ROTATE-12/L01) — `client/sync.ts:253-268`
```typescript
export function buildChain(material: JoinMaterial): JoinMaterial[] {
  const roots = [...(material.held_roots ?? []), { epoch: material.root_epoch, key: material.community_root }].sort(
    (a, b) => a.epoch - b.epoch,
  );
  const seen = new Set<number>();
  const uniq = roots.filter((r) => (seen.has(r.epoch) ? false : (seen.add(r.epoch), true)));
  return uniq.map((r) => ({
    ...material,        // <- spreads material.refounder (the TIP's refounder) onto EVERY historical entry
    community_root: r.key,
    root_epoch: r.epoch,
    held_roots: uniq
      .filter((o) => o.epoch < r.epoch)
      .map((o) => ({ epoch: o.epoch, key: o.key }))
      .reverse(),
  }));
}
```
`held_roots` entries (`types.ts:152`) are currently `{ epoch: number; key: string }` — **no `refounder` field**, so there is no data to correctly attribute a historical epoch's refounder even if `buildChain` stopped spreading the tip's value. Recommended minimal fix: extend the type to `{ epoch: number; key: string; refounder?: string }`, have `rollForward` (`helpers/keys.ts:272-288`) populate it when pushing the OLD epoch's entry (`{ epoch: keys.material.root_epoch, key: keys.material.community_root, refounder: keys.material.refounder }`), and have `buildChain` look up each entry's OWN `refounder` (falling back to `undefined` for epoch 0 / entries predating this field) instead of spreading the tip's value uniformly. This is consumed by `foldMembers`'s snapshot-authorization gate (`helpers/guestbook.ts:89`: `if (refounder === undefined || d.author !== refounder) continue;`), fed from `syncEpoch`'s `epochMaterial.refounder` (`sync.ts:174`).

## State of the Art

| Old Approach (current code) | New Approach (this phase) | When Changed | Impact |
|--------------------------|---------------------------|---------------|--------|
| Decrypt failure at own locator → `removed = true` | Decrypt failure → excluded from both adopt/remove logic, resolves to `none` (retry via re-read spine) | ROTATE-05 (D-06/D-07) | A bunker blip during a Refounding no longer permanently evicts the user |
| `rekeyHandled: Set<epoch>` (boolean, blocks all re-decision) | `Map<epoch, key>` latch (blocks moving up, allows moving down) | ROTATE-06 (D-04) | A held epoch can heal to a strictly lower sibling; a settled epoch can never re-fork |
| Winner computed only among sets carrying our blob | Winner computed among all authorized+complete+continuity candidates; opaque (undecryptable) competitors force deferral rather than blind adoption | ROTATE-07 (D-03/D-05) | No more silent adoption of a dead (non-winning) root |
| `syncEpochs`: historical ("known") epochs never re-invoke `readRekey` | Every walked epoch re-invokes the rekey read; a strictly lower winner discards and rebuilds the continuation | ROTATE-05/06 (D-04, the "spine") | Prerequisite for both passive retry and down-only heal — without this, neither fix has anything to act on |
| No `vac` on the rekey wire; nothing verifies authority beyond the CURRENT roster bit-check | `vac` citation added to `operations/rekey.ts`; receiver verifies it structurally resolves to the rotator's own Grant coordinate before honoring | ROTATE-08 (D-08) | First receive-side `vac` verification in the codebase (the existing `includeKickTarget`/Kick `vac` remains advisory-only — S02 is Phase 9 scope) |
| `refound()` publishes root-roll, discards `PublishResponse[]`, adopts unconditionally | Root-roll publish awaited; strict majority `ok:true` required before compaction/snapshot publish or adoption; throw otherwise | ROTATE-09 (D-09) | No more rolling forward alone onto an epoch nobody else can discover |
| `groupRotations`: first-arriving chunk's `chunkCount`/`prevEpoch` silently wins, disagreeing chunks dropped | Disagreement on either field marks the set inconsistent (never completes), forcing a refetch | ROTATE-10/11 (D-02) | A resumed rotation with a changed keep-list can no longer complete a stale generation |
| `buildRefounding`'s compaction loop: unfoldable head silently `continue`s/`catch`es, ships a partial `compactionWraps` | Unfoldable head → throw before any publish; Refounding aborts atomically | ROTATE-13 (D-01) | No more partial compactions shipped silently |
| `buildChain` spreads the tip's `refounder` onto every historical epoch | Per-epoch `refounder` attribution (via extended `held_roots` entries); genesis explicitly `undefined` | ROTATE-12 | Closes a forged-roster vector the moment any per-epoch fold (currently unused) is surfaced |

**Deprecated/outdated:** none — no external API or dependency deprecations; this is entirely internal correctness hardening.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The recommended `readRekeyScoped` restructuring (decryptable vs. opaque candidate partitioning, deferring via `none` when an opaque competitor exists) is the correct interpretation of D-03/D-05's "compute the winner among ALL authorized candidates" — this is **not** locked in CONTEXT.md, only the policy outcome (spec-strict removal-if-excluded) is locked. `[ASSUMED]` | Pitfall 1, Common Pitfalls | If wrong, the planner may need a genuinely different mechanism (or a return to `/gsd-discuss-phase` to re-scope ROTATE-07's mechanics) — this is flagged as the single most important open question in the phase |
| A2 | `vac` verification for D-08 should check that the cited `eid` structurally resolves to `grantLocator(communityId, rotator)` (self-consistency) plus the CURRENT folded roster still granting the rotator the relevant permission bit — rather than re-fetching and comparing the cited edition's exact `version`/`hash` against a live control-plane store lookup. `[ASSUMED]` — no existing receive-side precedent to confirm this shape against; `vacFor` (emit-side) is the only precedent, and its own doc comment says the fold "never reads this tag" today | Common Pitfalls / Pattern 2 | If the spec intends a stronger check (exact edition version/hash match against a live store), the verifier would need access to the control-plane store (not just folded `CommunityState`), requiring the pure `readRekeyScoped` function to take a richer predicate or the caller to do more work before invoking it |
| A3 | The anti-refork latch (D-04) does not need to be persisted — full re-derivation from `material.held_roots`/re-read spine on every fresh walk is sufficient for correctness, with persistence only a possible future performance optimization. `[ASSUMED]` — reasoned from the mechanics of `syncEpochs`/`syncChannelEpochs`, not verified against a stated upstream requirement | Pitfall 4 | If wrong (e.g., re-checking every epoch on every reconnect proves too slow at scale, or a correctness gap exists that persistence would close), the planner needs a follow-up persisted-latch task — CONTEXT.md already anticipates this as a possible deferred item |
| A4 | `refound()`'s majority gate (D-09) should compute majority over `this.relays()` (the configured relay list) rather than over however many `PublishResponse`s happen to arrive — i.e., a relay that never responds counts as not-ok, not as excluded from the denominator. `[ASSUMED]` — inferred from CONTEXT.md's phrasing ("`⌈(n+1)/2⌉` of `this.relays()`") but the exact aggregation across MULTIPLE rekey wraps (one Refounding can emit several chunked wraps) per-wrap vs. across-the-whole-rotation is not specified | Pitfall 6 | If majority should instead be computed per-wrap (all wraps must individually clear majority) vs. in aggregate (e.g. any majority-confirmed wrap suffices), the gating logic differs materially |

## Open Questions

1. **How should `readRekeyScoped` resolve an "opaque competing fork" (Pitfall 1)?**
   - What we know: the cryptography makes numeric key comparison across a fork you hold no blob in impossible; CORD-06 §3 says "every client computes the same winner" without addressing this case explicitly (confirmed by fetching the verbatim upstream text this session).
   - What's unclear: whether deferring to `none` (this research's recommendation) matches the spec author's intent, or whether the spec assumes near-universal recipient-list overlap in practice (making this an edge case not worth engineering around) versus wanting a stronger fail-closed default (e.g., always `removed` when any complete authorized fork excludes you, regardless of whether you also hold a candidate elsewhere).
   - Recommendation: surface this explicitly to the user during `/gsd-plan-phase` or a follow-up discuss-phase round before locking the exact `readRekeyScoped` restructuring — this is a genuine protocol-design ambiguity, not an implementation detail.

2. **How deep does the re-read spine's "discard and rebuild" cascade go (Pitfall 3)?**
   - What we know: if a re-read of a "known" historical epoch discovers a strictly lower winner than what `chain[i+1]` currently records, that lower root must be adopted and the walk's continuation from `i+1` onward is invalid (built on the wrong branch).
   - What's unclear: whether `chain[i+2..]` (epochs built ON TOP of the abandoned `chain[i+1]`) can simply be regenerated by continuing the normal walk from the corrected `chain[i+1]` (likely yes, since `buildChain`/the walk loop already regenerates forward from whatever material it's given), or whether persisted `material.held_roots` itself needs retroactive correction (since it was built assuming the now-abandoned branch was final).
   - Recommendation: plan-phase should scope this as its own task with an explicit test asserting a 3-epoch scenario (adopt wrong branch at epoch N+1, discover correction on re-read, epoch N+2 rebuilds correctly from the corrected N+1).

3. **Per-wrap or per-rotation majority aggregation for D-09 (Pitfall 6, A4)?**
   - What we know: a Refounding's root-roll can be chunked into MULTIPLE kind-3303 events (`buildRekeyRumors` chunks at 120 blobs/event) if there are many recipients.
   - What's unclear: whether "majority-confirmed root roll" means EVERY chunk individually clears majority, or the RESULT is confirmed once ANY chunk (or all chunks in aggregate, counted once per relay-response regardless of which chunk) clears majority — since a complete rotation set requires ALL chunks to reach recipients, arguably every chunk needs its own majority.
   - Recommendation: default to "every published wrap (root-roll + channel-rekey) must individually clear majority" as the strictest, most conservative reading, unless the planner finds this materially complicates the flow.

## Environment Availability

Skipped — this phase has no external dependencies beyond the existing `packages/relay`/`packages/concord` code already present in the monorepo. No new tools, services, or runtimes are introduced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (`packages/concord/package.json`: `"test": "vitest run --passWithNoTests"`) |
| Config file | Workspace root `vitest` config (monorepo-wide); no per-package override found |
| Quick run command | `pnpm --filter applesauce-concord test` |
| Full suite command | `pnpm run build && pnpm exec vitest run` (root `pnpm test` script: `turbo build --filter='./packages/*' && vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROTATE-05 | Decrypt failure at own locator ≠ removal; retried on re-read | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend existing `keys.test.ts` |
| ROTATE-06 | Racing rotations converge down-only; settled epoch never re-forks | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend; needs new latch-specific assertions |
| ROTATE-07 | Winner computed among ALL authorized+complete+continuity candidates | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend; needs the opaque-fork scenario (Open Question 1 resolved first) |
| ROTATE-08 | `vac` cited, receiver verifies against folded Roster, fail-closed | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` / `keys.test.ts` | ❌ Wave 0 — no existing `vac`-on-rekey test |
| ROTATE-09 | Compaction/snapshot publish gated on majority-confirmed root roll | unit/integration | `pnpm --filter applesauce-concord test -- community.test.ts` | ❌ Wave 0 — existing `refound` tests don't mock partial relay failure |
| ROTATE-10 | Chunk sets correlate on `(rotator,scope,newepoch,prevcommit)`; `n`-disagreement marks inconsistent | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` | ✅ extend existing `rekey.test.ts` (`groupRotations` tests already present) |
| ROTATE-11 | `prevepoch` identity validated across chunks | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` | ✅ extend alongside ROTATE-10 |
| ROTATE-12 | Historical epoch material does not inherit tip `refounder` | unit | `pnpm --filter applesauce-concord test -- sync.test.ts` (create if absent) | ❌ Wave 0 — no `client/__tests__/sync.test.ts` found for `buildChain` directly (only exercised indirectly via `community.test.ts`) |
| ROTATE-13 | Unfoldable compaction head aborts before any publish | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ❌ Wave 0 — no existing test constructs an unfoldable head scenario |
| TEST-01 (standing) | Every derivation/fold this phase touches has a hand-derived oracle | unit | (covered by the above) | Partial — `rekey.test.ts`/`keys.test.ts` already establish the pattern; extend, don't replace |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-concord test -- <changed-test-file>`
- **Per wave merge:** `pnpm --filter applesauce-concord test`
- **Phase gate:** `pnpm run build && pnpm exec vitest run` (full monorepo) green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `helpers/__tests__/rekey.test.ts` — add `vac`-tag round-trip test (once `ParsedRekey`/`includeRekeyChunk` gain the field) and `n`/`prevepoch`-disagreement consistency-guard tests (ROTATE-10/11)
- [ ] `helpers/__tests__/keys.test.ts` — add: transient-decrypt-≠-removal (ROTATE-05), down-only-latch (ROTATE-06), opaque-fork-deferral (ROTATE-07, pending Open Question 1 resolution), `vac`-verification-reject (ROTATE-08), abort-on-unfoldable-head (ROTATE-13)
- [ ] `client/__tests__/community.test.ts` — add majority-gated-publish tests (ROTATE-09): mock `pool.publish` to return `PublishResponse[]` with a minority `ok:true` and assert `refound()` throws and does NOT call `adoptRefounding`/publish compaction
- [ ] A new or extended `client/__tests__/sync.test.ts`-equivalent — `buildChain`'s per-epoch `refounder` attribution (ROTATE-12) needs a direct unit test, not just an indirect `community.test.ts` exercise
- [ ] `client/channel-sync.ts` needs its own test coverage for the re-read spine (currently no dedicated test file found for `syncChannelEpochs`/`syncRekeyAndAdvance` — verify during planning whether channel-scope convergence tests already live inside `channel-rekey.test.ts` and extend there)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Out of scope — signer/NIP-46 auth is `applesauce-signers`' concern, not this phase |
| V3 Session Management | No | N/A — no session tokens in this protocol layer |
| V4 Access Control | Yes | `canActOn`/`resolveStanding` (existing, `helpers/permissions.ts`) — D-08 adds a receive-side `vac` check as a SECOND, independent access-control gate alongside the existing roster bit-check, not a replacement |
| V5 Input Validation | Yes | `parseRekey` (existing, `helpers/rekey.ts`) already validates tag shapes defensively (hex/decimal regexes, chunk index bounds) — ROTATE-10/11's consistency guard extends this validation discipline to cross-chunk agreement |
| V6 Cryptography | Yes | All key derivation (`helpers/crypto.ts`, frozen A.1-A.6 formulas) is out of scope for modification — this phase only changes WHEN/WHETHER a derived key is adopted, never HOW it's derived. `signer.nip44.decrypt`/`.encrypt` (existing NIP-44) is the only crypto primitive touched, and only via existing call sites |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Denial of service via a bunker/remote-signer decrypt failure being misread as a removal | Denial of Service | ROTATE-05/D-06: distinguish decrypt-failure from locator-absence; never conclude removal from a caught exception |
| Split-brain / permanent community fork from racing authorized rotations | Tampering (of shared state consistency) | ROTATE-06/07/D-03/D-04: deterministic lowest-key winner + down-only re-heal + anti-refork latch |
| Stale-authority replay — a demoted admin's rotation honored by a lagging client | Elevation of Privilege | ROTATE-08/D-08: `vac` citation + receive-side verification against the folded Roster, independent of (and in addition to) the existing roster bit-check |
| Unilateral rollforward onto an undiscoverable epoch (self-isolation / silent community split) | Denial of Service / Tampering | ROTATE-09/D-09: majority-confirmed publish gate before adoption |
| Stale-generation chunk-set completion (false removal via resumed-rotation `n` mismatch) | Tampering | ROTATE-10/11/D-02: cross-chunk `chunkCount`/`prevepoch` consistency guard, never silently first-arrival-wins |
| Forged historical-epoch snapshot via tip-refounder over-inheritance | Spoofing | ROTATE-12: per-epoch `refounder` attribution, no tip-wide inheritance |
| Partial/silent compaction shipping an incomplete Control Plane snapshot | Tampering / Repudiation | ROTATE-13/D-01: abort-before-publish on any unfoldable head |

## Sources

### Primary (HIGH confidence)
- Upstream CORD-06 spec, fetched verbatim via `curl https://raw.githubusercontent.com/concord-protocol/concord/main/06.md` this session (2026-07-19) — §1 (rekey blob wire shape), §2 (receiving/removal rule, locator derivation, continuity check), §3 (Refounding, authority/`vac`, failure/races/convergence). All quotes in this document and in CONTEXT.md's canonical_refs are confirmed verbatim against this fetch.
- Direct reads of `packages/concord/src/helpers/keys.ts`, `helpers/rekey.ts`, `operations/rekey.ts`, `operations/guestbook.ts`, `client/sync.ts`, `client/channel-sync.ts`, `client/community.ts`, `client/private-channel.ts`, `client/admin.ts`, `helpers/permissions.ts`, `helpers/crypto.ts`, `helpers/guestbook.ts`, `types.ts` — all line numbers in this document read directly this session (2026-07-19), not inherited from the audit or CONTEXT.md.
- `packages/relay/src/types.ts`, `group.ts`, `relay.ts`, `pool.ts` — `PublishResponse` shape and the `"Timeout"` `ok:false` case, confirmed by direct grep + read.
- Existing test files read directly: `helpers/__tests__/keys.test.ts`, `helpers/__tests__/rekey.test.ts`, `helpers/__tests__/channel-rekey.test.ts`.

### Secondary (MEDIUM confidence)
- `.planning/concord-audit.md` — H09, M01-M04, S03, L01, L08, and the unresolved conflict #1, cross-checked against the direct code reads above (all confirmed still accurate at current line positions except where the file/line drift is noted in the Confirmed Current Line Positions table).

### Tertiary (LOW confidence)
- None — every claim in this document is either directly read from source this session or explicitly tagged `[ASSUMED]` in the Assumptions Log above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external packages, every module read directly
- Architecture: HIGH — every line position verified by direct read this session; the scope-generic core structure confirmed by reading both `readRekey`/`readChannelRekey` call sites
- Pitfalls: MEDIUM-HIGH — the mechanics (Pitfalls 2-6) are HIGH confidence (directly traced code + verbatim spec text); Pitfall 1 (the opaque-fork ambiguity) is a genuine open design question, not a confidence gap in the research itself — flagged accordingly in Open Questions and the Assumptions Log

**Research date:** 2026-07-19
**Valid until:** Should be re-verified if Phase 8 planning is delayed past a few days, since this is a fast-moving internal refactor sequence (Phases 6/7 already show line-number drift of 500+ lines from Phase 7's edits alone) — re-run the line-position confirmation step if planning starts more than ~1 week after this research.
