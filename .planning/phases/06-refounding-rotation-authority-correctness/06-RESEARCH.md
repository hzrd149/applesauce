# Phase 6: Refounding Rotation & Authority Correctness - Research

**Researched:** 2026-07-16
**Domain:** Nostr-based encrypted-community protocol (Concord) — epoch-scoped key derivation, memberlist folding, authority/rank enforcement
**Confidence:** HIGH

## Summary

This is a correctness-fix phase against an already-detailed CONTEXT.md (D-01..D-11 locked). The job was to ground those decisions against the upstream Concord spec (`concord-protocol/concord`, `02.md`/`04.md`/`06.md`) rather than the audit's paraphrase, and to re-verify the file:line anchors. **Every anchor CONTEXT.md cites was re-verified against the current tree and is accurate** (see the anchor table below — no drift). **Every spec sentence CONTEXT.md leans on was fetched verbatim from the upstream raw `.md` files and confirms the decision as written — zero Spec Conflicts.** The address-derivation formula for TEST-01 is now pinned precisely enough to hand-write expected values for control, guestbook, and (root) rekey addresses without calling any function under test — see "Pinned Spec Formulas" below.

The two "Claude's Discretion" questions are resolved by reading the plane-routing code end to end: (a) the spec places **no plane restriction** on what counts as "observed" — control, guestbook, and channel (public and private) activity are all spec-legitimate signals of presence — so the only defect is the *epoch* scoping, not the *plane* scoping; the practical fix therefore targets the type-keyed community-plane stores (control/guestbook/dissolved/rekey), not channel stores. (b) Private channels are **provably structurally independent** of `community_root`/`root_epoch` (their message-plane key derives solely from the channel's own `key`/`epoch`), so D-02's per-epoch store-keying change has **zero blast radius** on `private-channel.ts` — confirmed by reading `deriveChannelKeys`/`ConcordPrivateChannel` end to end. Public channels *do* share the root_epoch address-rotation exposure structurally, but touching their store semantics collides with Phase 7's channel-keying territory and would change continuous-chat-history UX; recommend leaving `planeStoreKey`'s `"channel"` branch untouched in Phase 6 and flagging the public-channel/observed edge case as a residual, Phase-7-adjacent gap (not a phase-6 blocker).

**Primary recommendation:** Implement D-01 through D-11 exactly as locked; use the pinned formulas below verbatim as TEST-01 oracles; scope D-02's per-epoch store-keying to `planeStoreKey`'s community-plane branch (`"control"|"guestbook"|"dissolved"|"rekey"`) only, leaving the `"channel"` branch (public and private) untouched this phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Epoch-address derivation (control/guestbook/rekey pk) | Crypto/derivation layer (`helpers/crypto.ts`, `helpers/keys.ts`) | — | Pure functions over `(secret, id, epoch)`; no I/O, no client state |
| Memberlist fold (Complete Memberlist) | Domain/fold layer (`helpers/guestbook.ts`, `models/community.ts`) | Storage (`client/sync.ts` — store keying) | `foldMembers` is pure over decoded rumors + an `observed` map; the *routing* that produces `observed`'s epoch scoping lives one layer up |
| Store retention / epoch-store keying | Storage/sync engine (`client/sync.ts`, `client/community.ts`) | — | `planeStoreKey`, `storeFor`, `rewireState` own which epoch's traffic lands in which store |
| Send-path authority (`refound()` outrank) | API/client engine (`client/community.ts`) | Permission primitives (`helpers/permissions.ts`) | The engine owns the caller-facing guard; `canActOn`/`canDo` are the reusable primitive it calls |
| Receive-path authority (`readRekey`/`readRekeyScoped`) | Domain/fold layer (`helpers/keys.ts`) | API/client engine (supplies the predicate) | The scope-generic fold lives in `keys.ts`; the concrete `canRemoveSelf` predicate is constructed by the caller (community engine or sync walk) from roster state it holds |
| Private-channel lifecycle | Independent sub-engine (`client/private-channel.ts`) | — | Explicitly out of this phase's blast radius (own epoch, own store, own rekey read path) |

## Pinned Spec Formulas (TEST-01 oracles)

All quotes below are verbatim from the upstream raw spec files fetched this session (`https://raw.githubusercontent.com/concord-protocol/concord/main/{02,04,06}.md`). Each formula is followed by the exact local `crypto.ts` call that reproduces it **by hand**, i.e. the call a spec-derived test must use instead of `rollForward`/`deriveConcordKeys`/`readRekey`.

### 1. `group_key` primitive (CORD-02 §4)

> `group_key(label, secret, id, epoch): seed = hkdf(secret, label, id, epoch); sk = scalar_normalize(seed); pk = xonly_pubkey(sk)`

Local: `groupKey(label, secret, id?, epoch?)` in `packages/concord/src/helpers/crypto.ts:86-97`. `[VERIFIED: upstream 02.md via WebFetch, cross-checked against crypto.ts's own doc comment which cites "A.2 group_key"]`

### 2. Control Plane address

> `control_pk = group_key("concord/control", community_root, community_id, epoch).pk`
> "Rotating the epoch rotates the `pk`, keeping a plane's traffic unlinkable across epochs." (CORD-02 §4)

Hand-compute: `controlGroupKey(newRootBytes, communityIdBytes, newEpoch).pk` (`crypto.ts:123-125`, label `"concord/control"`). Already the pattern used at `keys.test.ts:191-213` (H01(a) probe) — extend the SAME pattern to guestbook/rekey below. `[VERIFIED: upstream 02.md]`

### 3. Guestbook Plane address

> `guestbook_pk = group_key("concord/guestbook", community_root, community_id, epoch).pk`

Hand-compute: `guestbookGroupKey(newRootBytes, communityIdBytes, newEpoch).pk` (`crypto.ts:127-130`, label `"concord/guestbook"`). No existing test covers this address — **this is the D-10/D-11 gap to fill.** `[VERIFIED: upstream 02.md]`

### 4. Guestbook epoch-seeding + forward-observation rule (CORD-02 §5) — the ROTATE-04 crux

> "The Guestbook rides the epoch, so a Refounding (CORD-06) would otherwise start it empty. Instead, as a final *non-gating* step, the refounder coalesces the old epoch's Guestbook, subtracts the removed, and publishes the survivors into the new epoch as **snapshot** entries."
> "A snapshot lists *present members only* (absence means 'no seed', never a negative state)."
> "Observation only counts *forward*: an author re-enters the list on activity newer than their latest Leave, Kick, or Ban, so a departed member's old history can never resurrect them."
> "The coalesced Guestbook, merged with observed authors, minus the Banlist, yields the **Complete Memberlist**." — and, on what counts as "observed": "every valid event a client decrypts names its real author, and an author seen publishing is *observably present*, auto-included even if their Join never arrived." **No plane restriction is stated** — this is deliberately generic (confirmed by a second, narrower WebFetch pass specifically hunting for a plane qualifier; none exists).

`[VERIFIED: upstream 02.md, two independent WebFetch passes]` — this is the sentence set D-01 is built on, and it confirms D-01's framing exactly: the fix is structural epoch separation (Guestbook "rides the epoch"), not a timestamp floor, and the snapshot's "present-members-only, absence-is-not-negative" semantics is exactly what makes the `guestbook.ts:109-111` `!c` branch's unconditional-observed-readmit the actual defect surface — see the discretion-question analysis below for exactly what must change vs. stay.

### 5. Base-rekey (root Refounding) listen address — the "rekey" address in D-10

> "group_key(\"concord/base-rekey-pseudonym\", prior_community_root, community_id, root_epoch + 1).pk"

Hand-compute: `baseRekeyGroupKey(priorRootBytes, communityIdBytes, newEpoch).pk` (`crypto.ts:143-145`, label `"concord/base-rekey-pseudonym"`; `newEpoch = oldEpoch + 1`). **Important: this addresses on the PRIOR root, not the new one** (unlike control/guestbook, which address on the NEW root) — a spec-derived test must not accidentally pass the new root here. This is `ConcordKeys.nextBaseRekey.key.pk` in the local type. `[VERIFIED: upstream 06.md]`

### 6. Channel-rekey listen address (context, not this phase's direct target but touched by `refound()`'s bundled channel rekeys)

> "group_key(\"concord/rekey-pseudonym\", community_root, channel_id, channel_epoch + 1).pk"

Hand-compute: `channelRekeyGroupKey(priorRootBytes, channelIdBytes, newEpoch).pk` (`crypto.ts:138-140`). `[VERIFIED: upstream 06.md]`

### 7. Authority requirement — "in both" (AUTH-01/02 crux)

> "A single-channel Rekey requires `MANAGE_CHANNELS`, a Refounding requires `BAN`, and **in both the Rotator must strictly outrank every removed target** (CORD-04)." (CORD-06 §3)
> "A receiver verifies the seal's real npub against its folded Roster before honoring anything." (CORD-06 §3)

`[VERIFIED: upstream 06.md]` — confirms the audit's H03 quote verbatim and confirms D-05/D-06/D-07/D-08's "both send and receive" framing is not an over-read; "in both" is the spec's own word.

### 8. Rank semantics (D-09)

> "the owner... occupies position 0, and is supreme and unremovable." (CORD-04 §2)
> "a member's rank is the lowest position among their Roles. One hard rule binds every action: the actor must hold the required bit **and** *strictly* outrank its target — equal cannot act on equal." (CORD-04 §3)
> "`position` orders authority, lower is higher: the owner is position 0 (never a Role), a roleless member is effectively last." (CORD-04 §3)

`[VERIFIED: upstream 04.md]` — confirms `canActOn`'s `actor.position < target.position` (strict `<`, owner short-circuit) is spec-correct. **One nuance**: the spec states roleless is "effectively last" in prose but does **not** specify the numeric sentinel — the local `ROLELESS_POSITION = 0xffffffff` (`permissions.ts:32`) is an implementation choice consistent with "effectively last," not a spec-mandated literal. Tag any test asserting the literal `0xffffffff` value as `[ASSUMED]`-adjacent-to-spec (spec-consistent by construction, not spec-verbatim); assert the *comparison outcome* (roleless loses to any ranked role) rather than the literal constant where possible.

## Confirmed Anchors

All anchors below were re-read against the current working tree this session (not against CONTEXT.md's memory of them). All were accurate — **zero drift**.

| Symbol | File:Line | Still accurate? | Notes |
|--------|-----------|------------------|-------|
| `foldMembers` | `helpers/guestbook.ts:49-116` | ✅ | Exact match |
| `!c` observed re-admit | `helpers/guestbook.ts:109-111` | ✅ (CONTEXT said 109-112, off by one line, same logical block) | `if (!c \|\| c.present \|\| lastMs > c.ms) members.add(author);` |
| Snapshot seeding gated to refounder | `helpers/guestbook.ts:89` | ✅ | `if (refounder === undefined \|\| d.author !== refounder) continue;` |
| Observed merged across control+guestbook+all stores | `models/community.ts:37-42` | ✅ Exact match | `observedStores = [controlStore, stores.guestbook, ...(stores.observed ?? [])]` |
| Fold wired | `models/community.ts:44-58` | ✅ Exact match | `combineLatest([control$, guestbook$, observed$]).pipe(map(...foldMembers...))` |
| `planeStoreKey` | `client/sync.ts:252-256` (now `:254-256` for the function body) | ✅ | `info.type === "channel" ? \`channel:${info.channelId}\` : info.type` — confirms epoch is NOT in the key for any type |
| `buildChain` | `client/sync.ts:235-250` | ✅ Exact match | Confirms L01 (tip's refounder stamped onto every historical epoch via spread) is real and unexploited today |
| `syncEpochs` | `client/sync.ts:202-228` | ✅ Exact match | |
| `refound()` | `client/community.ts:1055-1106` | ✅ Exact match | Only guard today: `refoundAuthority(state)(this.pubkey)` at line 1069 — no per-target loop |
| `rotateChannel()` outrank loop | `client/community.ts:885-888` | ✅ Exact match | The exact template to mirror in `refound()`, swap `MANAGE_CHANNELS`→`BAN`, `standingOf`+`canDo` already exist |
| `storeFor`/`this.stores` | `client/community.ts:199, 379-388` | ✅ Exact match | |
| `rewireState` | `client/community.ts:393-411` | ✅ Exact match | `observed = [...this.stores.values()]` — confirms ALL stores (incl. every channel) feed observed today |
| Store disposal (community dispose only) | `client/community.ts:355` | ✅ Exact match | No per-epoch trim exists yet — confirms D-03 is net-new |
| `readRekeyScoped` default-permit | `helpers/keys.ts:506` | ✅ Exact match | `if (!adoptedHere && (!held.canRemoveSelf \|\| held.canRemoveSelf(set.rotator))) removed = true;` |
| `ScopedHeld.canRemoveSelf` + docstring | `helpers/keys.ts:454` (field), `447-454` (docstring) | ✅ Exact match | Docstring explicitly states "When omitted (the root path), any authorized complete rotation may remove us" — this is the defect CONTEXT.md says must be rewritten (D-08) |
| `readRekey` root caller (omits `canRemoveSelf`) | `helpers/keys.ts:397-427` | ✅ Exact match | Builds `ScopedHeld` at `406-412` with no `canRemoveSelf` key at all |
| `readChannelRekey` (correct precedent) | `helpers/keys.ts:642-673` | ✅ Exact match | Takes `canRemoveSelf?` as an explicit 6th param and threads it into `ScopedHeld` |
| `rollForward` | `helpers/keys.ts:258-274` | ✅ (CONTEXT cited 265-273, the body; function itself is 258-274) | |
| `deriveConcordKeys` | `helpers/keys.ts:164-189` (CONTEXT cited 179-186, the plane-building section) | ✅ | |
| `resolveStanding` | `helpers/permissions.ts:38-59` | ✅ Exact match | |
| `canActOn` | `helpers/permissions.ts:61-66` | ✅ Exact match | |
| `refoundAuthority` | `helpers/permissions.ts:75-80` | ✅ Exact match | Bare `BAN` bit check confirmed, zero rank comparison — matches H03 |
| Root path `canRemoveSelf` precedent (channel) | `client/community.ts:589-590` | ✅ Exact match | `this.admin.hasPerm(rotator, PERM.MANAGE_CHANNELS, this.standingOf(this.pubkey).position)` — the exact shape D-08 needs, swap `MANAGE_CHANNELS`→`BAN` |
| `keys.test.ts:191` H01(a) probe | `helpers/__tests__/keys.test.ts:191-213` | ✅ Exact match | The pattern to extend per D-11 (see "Test pattern to extend" below) |
| `channel-rekey.test.ts:92` H01(c) probe | `helpers/__tests__/channel-rekey.test.ts:92-118` | ✅ Exact match | Sibling pattern (channel plane, not this phase's direct target) |
| `community.test.ts` refound tests | `client/__tests__/community.test.ts:347, 451, 515` | ✅ Exact match (all three `it(...)` blocks confirmed at those lines) | None currently assert excluding a higher-ranked member or observed-readmission — confirmed gap |
| `admin.hasPerm(member, perm, targetPosition)` | `client/admin.ts:365-366` | ✅ (not in CONTEXT.md's list, found this session) | `canDo`/`hasPerm` both delegate through `standingOf` + `canActOn` semantics — this is the exact primitive `readRekey`'s new `canRemoveSelf` predicate should be built from at the `ConcordCommunity` call site |

## Resolved Discretion Questions

### (a) Which planes feed the current-epoch `observed` set?

**Spec answer: no plane restriction exists.** Two independent WebFetch passes over CORD-02 §5 confirm the spec's language — "every valid event a client decrypts names its real author, and an author seen publishing is observably present" — is deliberately plane-agnostic. Control-plane edits, guestbook entries, and channel chat (public or private) are ALL legitimate "activity" for observation purposes. So the current code's *breadth* (`rewireState`'s `observed = [...this.stores.values()]`, i.e. control + guestbook + dissolved + rekey + every channel store) is **spec-correct as written** — the bug is purely that none of it is epoch-scoped.

**What "current-epoch activity counts, prior-epoch does not" concretely requires:** the community-plane stores whose *address* rotates with `root_epoch` — control, guestbook, dissolved, rekey (all four use `community_root`/`root_epoch` per the CORD-02 §4 formula) — must not merge traffic sent under a superseded epoch's address into the same `observed` computation as the current epoch's. Public channels share this exposure structurally (`channelGroupKey(community_root, channel_id, root_epoch)` for the public branch — same root_epoch dependency), but **private channels do not** (see (b) below) — their key/epoch is independent of `root_epoch` entirely, so a root Refounding does not change their address and their historical activity is not "prior-epoch" in the relevant sense.

**Recommendation for the plan:** implement D-02's epoch-inclusive store key for the `planeStoreKey` branches whose type is `"control"|"guestbook"|"dissolved"|"rekey"` (i.e., the branch that today returns `info.type` verbatim). Leave the `"channel"` branch (`channel:${channelId}`) untouched — this closes the actual H02 exploit path (a removed member's prior-epoch Join/Leave/Kick/Snapshot or control edition resurrecting them) without touching chat-history UX or crossing into Phase 7's channel-keying territory. Public-channel activity remaining un-epoch-scoped in `observed` is a genuine residual gap — a member excluded from the roster who still has an OLD message in a PUBLIC channel from before the Refounding could theoretically still be counted "observed" if that old message's plane address happens to still route into `observed` — but note this requires the *channel* to have also survived a rotation with old messages readable at a still-subscribed old address, which the sync walk's per-epoch `syncEpoch` (`sync.ts:104-194`) already structurally isolates per-epoch during the *walk* (each epoch's `syncEpoch` computes its own `observed` map from only that epoch's synced traffic, at `sync.ts:163-165`); the exposure is narrower than it first appears and is already substantially mitigated by the epoch walk's per-epoch computation. **Flag this as an Open Question for the plan to explicitly scope out with a comment, not silently ignore** — see Open Questions below.

### (b) Does the per-epoch store-key change disturb private-channel routing?

**No — confirmed structurally independent.** Read `deriveChannelKeys` (`helpers/keys.ts:557-592`) and `ConcordPrivateChannel` (`client/private-channel.ts`) end to end:

- A private channel's message-plane key derives **solely** from the channel's own `key`/`epoch` (`channelGroupKey(hexToBytes(channel.key), channelId, channel.epoch)`, `keys.ts:570`) — `community_root`/`root_epoch` never enter this derivation. CORD-03's private formula (confirmed via the local doc comment and crypto.ts's frozen labels) is independent of the community root by design.
- `ConcordPrivateChannel` owns its own store (`channel:<id>`, assigned once via `ConcordCommunity.spawnPrivateChannel` → `this.storeFor(`channel:${channelKey.id}`)`, `community.ts:584`), its own epoch counter (`channelKey.epoch`, bumped only by `rotateChannel`/`readChannelRekey`, never by a root Refounding), and its own rekey read path (`readChannelRekey`, already correctly wired with `canRemoveSelf` per D-08's precedent).
- The only thing a root Refounding does to a private channel is call `refreshForCommunityEpoch()` (`private-channel.ts:131-134`), which re-derives the channel's **rekey listen address** (because `channelRekeyGroupKey` DOES key on a community root — see formula 6 above) — it does not touch the channel's **message plane** or its store.

**Conclusion:** D-02's per-epoch store-keying change should touch `client/sync.ts` (`planeStoreKey`) and `client/community.ts` (`rewireState`, `storeFor` call sites for the four community planes) only. Zero changes needed in `client/private-channel.ts` or `helpers/keys.ts`'s channel-scoped functions. This confirms the CONTEXT.md boundary note ("channels have their own sub-engine lifecycle... defer channel epoch-keying to Phase 7") is not just a scoping preference but a structural fact.

## Spec Conflicts

**None found.** Every spec sentence CONTEXT.md's decisions rest on was fetched verbatim this session from the upstream raw `.md` files (not the local audit paraphrase) and confirms the decision as written:

| Decision | Spec sentence it rests on | Confirmed? |
|----------|---------------------------|------------|
| D-01 (epoch-scoping, not timestamp heuristic) | CORD-02 §5 "The Guestbook rides the epoch..." | ✅ Verbatim match |
| D-02 (per-epoch store keys) | CORD-02 §4 formula (address is a function of `epoch`) | ✅ Verbatim match |
| D-05/D-06 (send-path outrank, atomic abort) | CORD-06 §3 "in both the Rotator must strictly outrank every removed target" | ✅ Verbatim match — "in both" is the spec's own word, not an audit inference |
| D-07/D-08 (receive-path fail-closed, root path supplies `canRemoveSelf`) | Same CORD-06 §3 sentence | ✅ Same as above |
| D-09 (rank semantics, `canActOn` reuse) | CORD-04 §2/§3 (owner position 0 supreme/unremovable; strict `<`; roleless "effectively last") | ✅ Verbatim match; roleless's *numeric* sentinel (`0xffffffff`) is an implementation choice consistent with, but not dictated by, spec prose — noted above, not a conflict |

The audit's paraphrase (`concord-audit.md`) was faithful on every point checked this session — no correction to the audit register is needed for this phase's findings.

## Standard Stack

No new external dependencies. This phase modifies existing `packages/concord/src/{helpers,models,client}` TypeScript against already-vendored primitives (`@noble/hashes`, `@noble/curves`, `applesauce-core`). No `Package Legitimacy Audit` section is required — no packages are being installed.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │            refound() [client/community.ts]   │
  caller ──────────▶│  1. refoundAuthority(state)(pubkey) [BAN?]   │
                    │  2. NEW: per-target outrank loop (D-05)      │──throw──▶ abort, no publish (D-06)
                    │  3. buildRefounding() → rekeyWraps, etc.     │
                    │  4. publish rekeyWraps → adoptRefounding()   │
                    └───────────────┬───────────────────────────────┘
                                    │ rollForward (helpers/keys.ts)
                                    │ mints newRoot/newEpoch, re-derives
                                    │ control/guestbook/rekey pk (CORD-02 §4)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │   syncEpoch / live rekey read path            │
                    │   readRekey → readRekeyScoped                 │
                    │   3. NEW: canRemoveSelf predicate (D-07/D-08)  │──absent/false──▶ deny removal (fail closed)
                    └───────────────┬───────────────────────────────┘
                                    │ adopt / removed / none
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │   Store routing (client/sync.ts, community.ts)│
                    │   planeStoreKey(info) → RumorStore             │
                    │   NEW: epoch included for control/guestbook/   │
                    │   dissolved/rekey (D-02) — channel unchanged   │
                    └───────────────┬───────────────────────────────┘
                                    │ current-epoch-only guestbook + observed
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │   foldMembers (helpers/guestbook.ts)           │
                    │   coalesced Guestbook + observed − Banlist      │
                    │   = Complete Memberlist (ROTATE-04 fixed here) │
                    └─────────────────────────────────────────────┘
```

### Pattern: Mirror the channel path onto the root path

**What:** Both authority halves (send: `rotateChannel`'s outrank loop; receive: `readChannelRekey`'s `canRemoveSelf` param) already exist correctly for channels. The fix for `refound()`/`readRekey` is structural copy-and-adapt, not new design.

**When to use:** Any time a root-scoped operation in this codebase has a channel-scoped sibling — check the sibling first.

**Example (send-path outrank loop to add to `refound()`, mirroring `community.ts:885-888`):**
```typescript
// Source: local precedent, community.ts:885-888 (rotateChannel), adapted for refound()
for (const target of opts.exclude ?? []) {
  if (!this.canDo(PERM.BAN, this.standingOf(target).position))
    throw new Error(`cannot exclude ${target} — you do not outrank them`);
}
```

**Example (receive-path `canRemoveSelf`, mirroring `community.ts:589-590`):**
```typescript
// Source: local precedent, community.ts:589-590 (spawnPrivateChannel's canRemoveSelf)
canRemoveSelf: (rotator: string) =>
  this.admin.hasPerm(rotator, PERM.BAN, this.standingOf(this.pubkey).position),
```
This predicate must be threaded into BOTH call sites of `readRekey`: `client/community.ts`'s `checkRekey()` (has `this.admin` available) and `client/sync.ts`'s `syncEpoch()` (does NOT have an admin instance — must build the equivalent from `resolveStanding`/`canActOn` directly, already imported there):
```typescript
// Source: local precedent, permissions.ts's exported canActOn + resolveStanding
const rolesMap = new Map<string, Role>(state0.roles.map((r) => [r.role_id, r]));
const canRemoveSelf = (rotator: string) =>
  canActOn(
    resolveStanding(rotator, epochMaterial.owner, rolesMap, state0.grants),
    resolveStanding(ctx.self, epochMaterial.owner, rolesMap, state0.grants),
    PERM.BAN,
  );
```

### Test pattern to extend (D-11, anti-regression spread guard)

The exact 4-line probe shape at `keys.test.ts:191-213` (H01(a)) — reproduce for guestbook and (base) rekey:

```typescript
// Source: local precedent, keys.test.ts:191-213, adapted for guestbook
it("rollForward's guestbook address matches the CORD-02 §5 formula over the new root", async () => {
  const { material, ownerPub } = await genesis();
  const keys = deriveConcordKeys(material, []); // ARM THE MEMO — see keys.test.ts:194 comment
  const newRoot = generateSecretKey();
  const newEpoch = material.root_epoch + 1;
  const expected = guestbookGroupKey(newRoot, hexToBytes(material.community_id), newEpoch);
  const rolled = rollForward(keys, newRoot, newEpoch, ownerPub, []);
  expect(rolled.guestbook.pk).toBe(expected.pk);
  expect(rolled.guestbook.pk).not.toBe(keys.guestbook.pk);
});

// Rekey analog: assert against baseRekeyGroupKey(newRootBytes, cidBytes, newEpoch+1).pk
// on rolled.nextBaseRekey.key.pk — note nextBaseRekey addresses newEpoch+1, not newEpoch;
// confirm against ConcordKeys.nextBaseRekey's own doc comment (keys.ts:67-68) before writing.
```

### Anti-Patterns to Avoid

- **Timestamp-floor heuristics for epoch scoping:** D-01 explicitly rejects this — it reproduces the observed-correct *output* without the spec's structural model, and silently breaks the moment two Refoundings happen within the same clock-skew window. Use epoch-keyed stores instead.
- **A guard that defaults to permit:** the entire milestone's recurring defect class (`!held.canRemoveSelf || ...`). Any new optional predicate parameter added in this phase must fail closed when absent, not default-allow.
- **Extending `planeStoreKey`'s epoch-inclusion to the `"channel"` branch this phase:** touches Phase 7's territory and continuous chat-history UX; the private-channel research above proves it isn't required for ROTATE-04/H02 correctness.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Rank comparison | A new "does X outrank Y" check | `canActOn(standingOf(actor), standingOf(target), requiredBit)` (`permissions.ts:61-66`) | Already spec-verified (owner short-circuit, strict `<`), reused by both channel guards today |
| Outrank-on-removal predicate shape | A bespoke boolean flag | The `canRemoveSelf?: (rotator: string) => boolean` pattern already defined on `ScopedHeld` (`keys.ts:454`) and threaded by `readChannelRekey` (`keys.ts:648`) | The scope-generic `readRekeyScoped` already accepts this exact shape — `readRekey`'s root caller just needs to supply it, not invent a new mechanism |

**Key insight:** Every fix this phase needs already has a working, spec-compliant sibling implementation in the same file. The work is threading the existing primitive through the one caller that omits it, not designing anything new.

## Common Pitfalls

### Pitfall 1: Testing the rekey/base address at the wrong epoch offset
**What goes wrong:** `nextBaseRekey.key` addresses `oldEpoch + 1` under the OLD (prior) root, while `control`/`guestbook` address the SAME NEW epoch under the NEW root. A spec-derived test that reuses one epoch/root pairing for all three will silently pass for two and be vacuous for the third.
**Why it happens:** The base-rekey address is deliberately asymmetric (CORD-06 §2: delivered under the prior root so current holders converge) — it's the one address in the trio that does NOT use the new root.
**How to avoid:** Always re-derive each expected address from its OWN formula (control/guestbook: `newRoot`+`newEpoch`; rekey: `priorRoot` (=`oldRoot`)+`newEpoch`), never copy-paste one expected-value computation for all three.
**Warning signs:** A test asserting `rolled.nextBaseRekey.key.pk === baseRekeyGroupKey(newRoot, cid, newEpoch).pk` (wrong root) will fail loudly — good, that's a real bug; but a test that never asserts the address at all (only checks types) would miss it silently.

### Pitfall 2: Forgetting to "arm the memo" before asserting a spread-survival regression
**What goes wrong:** `keys.test.ts:194`'s own comment names this exactly — if the test doesn't call `deriveConcordKeys(material, [])` (or equivalent) BEFORE `rollForward`, there's no memo on `material` for the spread to (correctly, post-05.1) drop, and the assertion trivially passes even against a reintroduced H01-class bug.
**Why it happens:** The memo is lazily computed on first access; a fresh `material` object has no `Symbol.for("concord-base-keys")` on it yet.
**How to avoid:** Always derive keys once from the pre-roll material first, exactly as `keys.test.ts:194`'s comment instructs.
**Warning signs:** A "spread guard" test that passes both before AND after reverting the Phase-5.1 `defineCachedValue` fix is vacuous — sanity-check by temporarily reverting the enumerable/non-enumerable write and confirming the new test goes RED (the plan's non-vacuity discipline, per PROJECT.md's D-13 note).

### Pitfall 3: The `!c` observed-readmit branch is spec-correct in isolation — don't "fix" it directly
**What goes wrong:** It's tempting to patch `guestbook.ts:109-111`'s `if (!c || ...)` directly (e.g., gate it on `refounder !== undefined`). But that branch's behavior — "an author with no coalesced state is still counted present if observed" — is explicitly the spec's intended behavior for a never-Joined-but-active member ("auto-included even if their Join never arrived").
**Why it happens:** The actual bug is one layer up — the `observed` map itself illegitimately contains prior-epoch activity because stores aren't epoch-scoped. Fixing `foldMembers` itself would either break the legitimate never-Joined case or require threading an epoch parameter into a currently pure, epoch-agnostic function.
**How to avoid:** Fix `observed`'s epoch scope at the routing/storage layer (D-02), leave `foldMembers`/`guestbook.ts` untouched. This matches D-01's explicit framing.
**Warning signs:** A diff that touches `guestbook.ts`'s fold logic for this phase is very likely fixing the wrong layer.

## Code Examples

See "Architecture Patterns" above for the two outrank-loop/canRemoveSelf snippets and the guestbook spec-derived test extension — all sourced from local precedent already in the tree, cross-checked against the spec quotes in "Pinned Spec Formulas."

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `Reflect.set` (enumerable) cache writes in `applesauce-core`'s `cache.ts` | `Object.defineProperty(..., { enumerable: false })` | Phase 5 (already shipped) | Unblocks this phase — `rollForward`/`rollForwardChannel` now correctly drop stale memos on spread, so ROTATE-01/02 are test-only obligations, not source fixes |
| Root Refounding as a cryptographic no-op in-session | (this phase) actual address rotation adopted via `adoptRefounding` | This phase | The remaining work — memberlist scoping + authority guards — assumes the Phase-5 fix is already in place |

**Deprecated/outdated:** none within this phase's scope — no protocol version bump, no removed APIs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | The numeric sentinel `0xffffffff` for a roleless member's rank is an implementation choice consistent with "effectively last," not a literal the spec mandates | Pinned Spec Formulas §8 | Low — if a future spec revision publishes an explicit sentinel and it differs, only tests asserting the literal constant (rather than comparison outcomes) would need updating; recommend asserting outcomes, not the literal, to route around this entirely |
| A2 | The public-channel/observed epoch-scoping residual gap (discretion question (a)) is adequately mitigated by the per-epoch `syncEpoch` walk's own per-epoch `observed` computation (`sync.ts:163-165`) and therefore safe to defer rather than block Phase 6 | Resolved Discretion Questions (a) | Medium — if the LIVE (post-tip) `rewireState` path's un-epoch-scoped `observed` (as opposed to the walk's per-epoch one) is actually reachable with a stale public-channel message resurrecting a removed member, this would be a live gap; recommend the plan add an explicit Open Question / follow-up test rather than silently closing it |

## Open Questions

1. **Does the LIVE (post-walk) `rewireState`'s un-epoch-scoped `observed` (community.ts:398, `[...this.stores.values()]`) admit a public-channel resurrection path the per-epoch sync walk (`sync.ts:163-165`) does not?**
   - What we know: the sync WALK computes `observed` freshly per epoch during initial sync (structurally correct, scoped by construction since it's built from that epoch's own `syncAuthors` results). The LIVE path (`rewireState`, used after the walk completes and for ongoing operation) merges `[...this.stores.values()]` with no epoch filter at all, and channel stores are never epoch-partitioned (by design, for continuous chat history).
   - What's unclear: whether a member excluded by a Refounding who has an OLD (pre-exclusion) message sitting in a PUBLIC channel's un-partitioned store could, post-Refounding, still register as "observed" via the LIVE path's merge — and whether `lastMs > c.ms` (the forward-only guard) is sufficient protection given the excluded member has `!c` (no coalesced state at all, since the snapshot excludes them).
   - Recommendation: the plan should add an explicit regression test exercising this exact scenario (member with old public-channel activity, excluded via Refounding, assert NOT in post-Refounding `members`) as part of TEST-01's coverage for this phase, even though the code fix may end up being "no change needed because D-02's control/guestbook epoch-scoping already suffices" (worth proving with a test either way, not asserting from research alone).

2. **Should `nextBaseRekey`'s address ever be included in the community-plane epoch-store-keying (D-02)?**
   - What we know: `rekey` (base) IS one of the four types the D-02 store-key change targets per this research's recommendation, and its address does rotate with epoch (though the ROOT half is the PRIOR root, not the new one — see Pitfall 1).
   - What's unclear: whether a stale rekey-plane wrap from an old epoch could pollute the CURRENT epoch's `observed` set in a way relevant to ROTATE-04 (rekey blobs are rotation traffic, not member "activity" in the conversational sense — arguably should never have fed `observed` at all).
   - Recommendation: confirm during planning whether rekey-plane traffic should be **excluded from `observed` entirely** (it's not "publishing" in the CORD-02 §5 conversational sense — it's protocol control traffic) rather than merely epoch-scoped. This is a scope-narrowing option the plan should consider explicitly rather than default to "same treatment as guestbook."

## Environment Availability

Skipped — this phase is pure TypeScript source changes against packages already in the workspace (`applesauce-concord`, `applesauce-core`); no new external tool/service dependency.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`, workspace-wide) |
| Config file | `/home/robert/Projects/applesauce/vitest.config.ts` |
| Quick run command | `pnpm --filter applesauce-concord test -- helpers/__tests__/keys.test.ts helpers/__tests__/guestbook.test.ts client/__tests__/community.test.ts` |
| Full suite command | `pnpm --filter applesauce-concord test` (per PROJECT.md's stated verification minimum for this package) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ROTATE-01 | `rollForward(...).control.pk` / `.guestbook.pk` match CORD-02 §4/§5 formula over the new root | unit, spec-derived | `pnpm --filter applesauce-concord test -- keys.test.ts -t "guestbook address"` | ❌ guestbook probe — Wave 0 gap; control probe (H01(a)) already exists at `keys.test.ts:191` |
| ROTATE-02 | The epoch walk addresses each held epoch distinctly (base-rekey address hand-derived) | unit, spec-derived | `pnpm --filter applesauce-concord test -- keys.test.ts -t "rekey address"` | ❌ base-rekey probe — Wave 0 gap |
| ROTATE-04 | A Refounding removes excluded members from the Complete Memberlist; prior-epoch entries/observations do not resurrect them | integration | `pnpm --filter applesauce-concord test -- guestbook.test.ts community.test.ts -t "observed"` | ❌ observed-re-admission-across-refounding test is the H02 gap named in CONTEXT.md's `<canonical_refs>` — Wave 0 gap |
| AUTH-01 | `readRekey`'s root path denies removal when `canRemoveSelf` is absent/false | unit | `pnpm --filter applesauce-concord test -- keys.test.ts -t "outrank"` | ❌ root-path outrank-removal test — Wave 0 gap (channel analog exists at `channel-rekey.test.ts:206`) |
| AUTH-02 | `refound()` rejects excluding a target the caller does not outrank | integration | `pnpm --filter applesauce-concord test -- community.test.ts -t "outrank"` | ❌ Wave 0 gap — no current `community.test.ts` case covers excluding a higher-ranked member |
| TEST-01 (standing, this phase's slice) | Every new/extended derivation asserts against an independently-derived spec value (D-10/D-11) | unit, spec-derived | Same as ROTATE-01/02 above | Partial — the pattern exists (control, channel-plane); guestbook + base-rekey extensions are the gap |

### Sampling Rate

- **Per task commit:** the quick-run command scoped to the touched test files
- **Per wave merge:** `pnpm --filter applesauce-concord test`
- **Phase gate:** full `applesauce-concord` suite green (plus `applesauce-core` if any shared helper is touched, though this phase should not need to) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `helpers/__tests__/keys.test.ts` — add the guestbook + base-rekey spec-derived probes (D-10/D-11), following the exact `keys.test.ts:191-213` pattern
- [ ] `helpers/__tests__/guestbook.test.ts` — add the observed-re-admission-across-refounding test (the H02 gap explicitly named in CONTEXT.md)
- [ ] `client/__tests__/community.test.ts` — add (1) a root-path outrank-on-removal test (AUTH-01, mirroring `channel-rekey.test.ts:206-237`'s shape) and (2) a `refound()` send-path outrank-rejection test (AUTH-02, mirroring `rotateChannel`'s existing coverage if any — confirm during planning whether `rotateChannel`'s outrank test exists as a template; the changeset referenced in CONTEXT.md ("the already-shipped `concord-channel-rekey-outrank` changeset") implies one does)
- [ ] Open Question 1's regression test (public-channel-observed-post-exclusion) — decide during planning whether this is in-scope for Phase 6 or explicitly deferred with a comment

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|---------------------|
| V2 Authentication | No | Out of scope — Nostr signer identity is assumed authenticated upstream of this package |
| V4 Access Control | Yes | `canActOn`/`canDo`/`hasPerm` (`permissions.ts`) — reuse, do not hand-roll (this phase's core AUTH-01/02 work) |
| V6 Cryptography | Yes (frozen, do-not-modify) | `crypto.ts`'s `group_key`/HKDF derivations are spec-frozen per its own header comment ("Everything Concord addresses on the wire derives from... changing any labeled byte would re-address every prior event") — this phase must call these primitives, never alter them |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Guard defaults to permit (the milestone's recurring defect class) | Elevation of Privilege | Fail-closed: an absent/undefined authority predicate must deny, never default-allow (D-07 is exactly this fix) |
| Subordinate evicts superior (unranked authority check) | Elevation of Privilege | Rank comparison via `canActOn` (strict `<`, owner short-circuit) on every removal-adjacent action, both send and receive (D-05/D-08) |
| Removed member's stale key material still opens traffic | Information Disclosure | Address rotation on every Refounding (already fixed at the crypto layer in Phase 5; this phase closes the memberlist-visibility half) |
| Prior-epoch activity resurrecting an excluded member | Elevation of Privilege / Tampering (roster integrity) | Epoch-scoped store keying (D-02) so `observed`/`foldMembers` cannot see traffic from before the exclusion |

## Sources

### Primary (HIGH confidence)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/02.md` — CORD-02 §4 (address formula), §5 (Guestbook epoch-riding, snapshot semantics, forward observation, Complete Memberlist definition) — fetched twice this session (broad pass + narrow "plane restriction?" pass)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/06.md` — CORD-06 §2 (rekey wire format, blob layout, locator formula, scopes), §3 ("in both the Rotator must strictly outrank every removed target"), base-rekey/channel-rekey address formulas, prior-root sealing rationale
- `https://raw.githubusercontent.com/concord-protocol/concord/main/04.md` — CORD-04 §2 (owner position 0, supreme/unremovable, Grant/Role definitions), §3 (rank comparison, strict outrank, position ordering, effective permissions)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/examples.md` — checked for worked test vectors; confirmed none exist (explicit disclaimer: "Examples are illustrative, not verifiable test vectors")
- Local source, read in full this session: `packages/concord/src/helpers/crypto.ts`, `helpers/keys.ts`, `helpers/guestbook.ts`, `helpers/permissions.ts`, `models/community.ts`, `client/sync.ts`, `client/community.ts`, `client/private-channel.ts`
- Local tests, read this session: `helpers/__tests__/keys.test.ts` (lines 150-249), `helpers/__tests__/channel-rekey.test.ts` (lines 60-239), `client/__tests__/community.test.ts` (relevant `refound` blocks)

### Secondary (MEDIUM confidence)
- `.planning/concord-audit.md` — CONCORD-H01/H02/H03 findings, cross-checked against upstream spec this session and found faithful on every point checked

### Tertiary (LOW confidence)
- None — every claim in this document is either `[VERIFIED]` against the upstream spec + local code, or explicitly flagged `[ASSUMED]` in the Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new dependencies
- Architecture / spec-formula grounding: HIGH — every formula fetched verbatim from upstream this session, cross-checked against local `crypto.ts`
- Anchors: HIGH — every file:line re-read against the current tree this session, zero drift found
- Pitfalls / discretion resolutions: HIGH — derived from reading the actual routing code (`sync.ts`, `community.ts`, `private-channel.ts`) end to end, not inferred

**Research date:** 2026-07-16
**Valid until:** Stable — this is a fixed protocol spec (frozen crypto labels) and a phase-scoped codebase snapshot; re-verify anchors only if Phase 5.1/6 commits land between this research and planning execution
