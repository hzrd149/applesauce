# Phase 7: Private Channel Keying - Research

**Researched:** 2026-07-17
**Domain:** Concord protocol conformance — channel key single-source-of-truth refactor, client-local access-affordance API, sticky channel deletion, spec-derived test methodology
**Confidence:** HIGH (all six priority questions resolved by direct code inspection + authoritative upstream spec fetch; no library/ecosystem unknowns — this phase touches no new external packages)

## Summary

This phase is a verification-and-refactor phase over `packages/concord/src`, not a new-technology phase. Every open question in the CONTEXT.md was resolved by reading the actual implementation this session. The two headline findings that change the plan's shape:

1. **D-09 (compaction vs. sticky-delete) resolves to a qualified "insufficient as literally stated."** `foldControl`'s channel loop (`control.ts:219-238`) computes `heads.set(eid, cand.source)` from the *same single winning candidate* used to decide `channels.push(meta)` — it does not scan the full candidate list. D-08's "scan all candidates for `deleted:true`" fix, if it only changes what's pushed to `channels` and leaves `heads.set` following ordinary head-selection, will let a later resurrection edition become the new compacted head — silently losing the deletion for any client that bootstraps from compacted heads only (a fresh invite joiner, who per the audit's own "verified correct" register does *not* receive `held_roots`). The fix must also pin `heads.set` to the terminal deleting edition once one is found. This is still fold-time-only (no persisted state), so D-08's rejected tombstone alternative is not needed — but the sticky rule must cover both outputs (`channels` list AND `heads` map), not just the first.

2. **D-10 (ROTATE-03) is confirmed test-only, and a Phase-5-era probe already asserts the exact claim** at `helpers/__tests__/channel-rekey.test.ts:92-118` — the code comment there literally states "Proving the memo half dead here lets Phase 7 focus purely on H08's metadata-threading half." Phase 7's obligation is to confirm this still passes (it does, by inspection of `rollForwardChannel`'s spread and the non-enumerable memo doc block at `keys.ts:558-582`) and, optionally, close the remaining gap: no test currently exercises the full **client-level** path (rotate → send → verify new plane used) — `community.test.ts:144-191` only asserts `material.channels` reflects the new epoch after rotation, not that a subsequent `sendMessage` uses it.

Three further findings reshape task granularity: (a) the memo cache-key fix and the CHAN-01 "derive nothing" signalling are the same code change and should be one task, with a concrete recommended shape below; (b) `voiceKeysFor` and the test-only `deriveKeys`/`CommunityKeys` path share `channelSecret`/`channelKeyFor` and must be updated in the same commit or they break the build; (c) **CHAN-06's `accessible` flag has a reactivity gap that is not mentioned in CONTEXT.md** — `channels$` is a pure slice of `state$` (`community.ts:245`), and none of `receiveChannelKeys`/`persistChannelKey`/`dropChannelKey`/the `mintChannelKey` callback (which all mutate `this.keys.material` independently) re-emit `state$`. Without new plumbing, `accessible` will not update reactively when a key is granted/revoked out-of-band — only when the control-plane edition itself changes. This needs its own task.

**Primary recommendation:** Sequence the phase as (1) CHAN-07 ruling + sticky-delete-with-heads-pinning fix + test, (2) the D-01/D-02/D-03/D-04 channel-key-source-of-truth refactor (community.ts + keys.ts + control.ts + types.ts) as one atomic change with its spec-derived tests, (3) the `channels$` → `ChannelView[]` reactivity fix (new material-change signal) for CHAN-06, (4) the CHAN-02 `MissingChannelKeyError` guard in `sendMessage`, (5) confirm-only ROTATE-03/TEST-01/TEST-02 test additions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Channel key derivation (`channelSecret`/`channelKeyFor`) | Backend logic (`packages/concord/src/helpers`) | — | Pure crypto/derivation function, no I/O; lives in the helpers layer shared by client + tests |
| Channel key source-of-truth (`material.channels`) | Client state (`ConcordCommunity` instance) | Backend logic (`keys.ts`) | `material` is client-local persisted state (JoinMaterial), threaded through the pure derivation helpers — the client owns *what* is held, helpers own *how* it derives |
| Control-plane fold (`foldControl`) | Backend logic (`helpers/control.ts`) | — | Pure fold over `DecodedEvent[]` + `JoinMaterial`, no client dependency |
| `accessible` / access-vs-key-possession view | Client state (`channels$` emission) | — | CONTEXT.md D-05: client-local, not edition data — must NOT touch `ChannelMetadata`/`foldControl` |
| `MissingChannelKeyError` guard | Client (`ConcordCommunity.sendMessage`) | Backend logic (`planeKeyFor` backstop) | The client has both channel state and the `accessible`/key-holding info at guard time; `planeKeyFor` remains a defense-in-depth backstop for truly unknown ids |
| Sticky channel-deletion terminality | Backend logic (`foldControl`) | — | Fold-time-only, no persisted state; a pure function of the candidate list |
| Spec-derived test oracles | Test tier (`helpers/__tests__/*.test.ts`) | — | Must call `crypto.ts` primitives directly, never the implementation under test |

## Package Legitimacy Audit

Not applicable — this phase installs no new external packages. All work is a refactor within the existing `packages/concord/src` tree using already-present dependencies (`@noble/hashes`, `applesauce-core`, `applesauce-signers`).

## Priority Research Findings

### 1. D-09 — Can compaction drop the deleting edition? **Qualified: the sticky rule as literally stated is insufficient; it must also pin `heads`.**

**Code evidence (`packages/concord/src/helpers/control.ts:217-239`):**
```ts
// ---- Channels (MANAGE_CHANNELS) -----------------------------------------
const channels: ChannelMetadata[] = [];
for (const [eid, cands] of groupByEntity(byVsk(VSK.CHANNEL))) {
  for (const cand of cands) {
    const s = standing(cand.author);
    if (!s.isOwner && !hasPerm(s.permissions, PERM.MANAGE_CHANNELS)) continue;
    try {
      const meta = JSON.parse(cand.content) as ChannelMetadata;
      meta.channel_id = eid;
      const known = material.channels.find((c) => c.id === eid);
      if (known) { meta.key = known.key; meta.epoch = known.epoch; }
      heads.set(eid, cand.source); // head retained for compaction even if deleted
      if (!meta.deleted) channels.push(meta);
      break;                        // <-- only the FIRST authorized candidate is ever examined
    } catch { /* skip */ }
  }
}
```
`cands` here is `headCandidates(arr)` from `control.ts:79-104` — the contiguous-chain head first, then remaining per-version winners descending. The loop takes the **first authorized candidate** and `break`s. `heads` and the `channels` push decision are computed from that **single** winning candidate — never from the full edition history for that eid.

**Consequence for D-08's stated fix.** D-08 says: "Scan the entity's authorized candidates for a `deleted:true`... The head is still retained for compaction (`heads.set`)." Read literally, this only changes the criterion for the `channels.push` decision (scan all candidates, exclude if any is `deleted:true`) while leaving `heads.set` to keep following ordinary head-selection (the highest contiguous version). If an admin later publishes a higher-version `deleted:false` edition citing the deleted edition's `prev`, that edition becomes the ordinary "head" — `heads` would then store *that* edition, and `buildRefounding`'s compaction step (`keys.ts:360-371`, `for (const head of opts.heads) { ...rewrapSeal(head.seal, ...) }`) republishes it into the new epoch.

**Why this matters specifically for *new* joiners.** A currently-synced client that fetched every edition version (v1, v2-deleted, v3-undelete) from genesis would still catch the sticky rule on every fold, since all versions are in its local `events` array regardless of compaction. But a **new invite joiner does not fetch prior-epoch history** — the audit's own "Verified correct" register states this is spec-correct by design: *"`held_roots` omission from bundles is spec-correct"* (`concord-audit.md:226`). A new joiner only ever sees what's compacted into the *current* epoch's control plane. If `heads` was pinned to the resurrection edition (v3) at the last compaction, the new joiner's fold never sees v2 at all — no candidate in their `events` has `deleted:true` — and the sticky scan (correctly, given their information) finds nothing, resurrecting the channel for them. **This is not hypothetical: it is the same "later edition wins" defect CHAN-07 exists to close, relocated to the compaction boundary.**

**Verdict: sticky-fold-rule-sufficient, WITH ONE ADDITIONAL FIX** — no persisted `deletedChannelIds` tombstone is required (D-08's rejected option stays rejected), but the fix must do two things in the same fold pass:
1. Scan all authorized candidates for the entity; if any is `deleted:true`, exclude the channel from `channels` (as D-08 already specifies).
2. **Also set `heads.set(eid, <that deleting candidate's source>)`** instead of whatever the ordinary head-selection would pick — so a subsequent compaction always republishes the terminal/dead state, not a later resurrection attempt. If more than one authorized `deleted:true` candidate exists, pick deterministically (e.g., lowest `rumorId`, matching the existing tiebreak convention in `headCandidates` at `control.ts:85`).

**Planner action:** this changes the shape of the CHAN-07 task from "add a scan, leave `heads.set` alone" to "scan all candidates and select the persisted head as the sticky-deleted rule dictates, not the version-chain rule" — the `heads.set` line and the `channels.push` line must derive from the *same* scan result, not two independent computations.

### 2. D-10 — ROTATE-03: test-only, and mostly already covered

**Confirmed test-only.** `rollForwardChannel` (`keys.ts:532-539`):
```ts
export function rollForwardChannel(channel: ChannelKey, newKey: string, newEpoch: number): ChannelKey {
  return {
    ...channel,
    key: newKey,
    epoch: newEpoch,
    held: [{ epoch: channel.epoch, key: channel.key }, ...(channel.held ?? [])],
  };
}
```
This spreads `channel`, which may carry the `ChannelPlaneKeysSymbol` memo written by `getOrComputeCachedValue` (`keys.ts:576`, `Object.defineProperty(..., { enumerable: false, ... })` per `core/helpers/cache.ts:52-54,57-65`). Object spread only copies **enumerable** own properties, so the memo is dropped — `deriveChannelKeys` on the rolled-forward object recomputes fresh at the new key/epoch. The doc comment at `keys.ts:568-575` already states this explicitly as a resolved concern: *"This is safe only because applesauce-core's cache helper writes the memo non-enumerable... so it is dropped, not carried forward stale, when `rollForwardChannel` mints a fresh `ChannelKey`..."*

**Already tested.** `helpers/__tests__/channel-rekey.test.ts:92-118` — `"rollForwardChannel's plane address matches the CORD-03 §1 private formula over the new key/epoch"` — arms the memo via an explicit `deriveChannelKeys(material, channel)` call, then asserts `after.current.pk === expected.pk` where `expected` is computed **only** from `channelGroupKey` (crypto.ts), never from the implementation under test. Its own comment states: *"Proving the memo half dead here lets Phase 7 focus purely on H08's metadata-threading half."* This test already exists and already passes (no source change pending in `rollForwardChannel` itself).

**Remaining gap (recommend, not required by the letter of D-10).** `client/__tests__/community.test.ts:144-191` (`"spawns a sub-engine for a private channel and rotates its key"`) calls `community.rotateChannel(channelId, { keep: [pubkey] })` and asserts only `community.material.channels.find(...).epoch === 2` — it never calls `sendMessage` again post-rotation to prove the **client-level** send path (`sendMessage` → `channelEpoch` → `publishToPlane` → `wrapForTarget` → `planeKeyFor`) actually resolves to the new epoch's plane. Since ROTATE-03/CHAN-05 together are precisely "a channel Rekey takes effect immediately in-session, without reload," recommend adding one assertion to this existing test (send after rotate, assert the message decodes under the NEW plane key / fails under the old one) to close the loop at the level the original H08 symptom manifested — cheap, and it's the exact "spec-derived, not self-referential" pattern already used elsewhere if the expected plane address is computed via `channelGroupKey` directly rather than by re-deriving through the client.

**Traceability note for the planner:** ROTATE-03 in REQUIREMENTS.md is currently `[ ]` Pending. Given the memo-level probe already exists and passes, closing ROTATE-03 in this phase is a **test-confirmation + one gap-closing assertion**, not new production code.

### 3. Memo cache-key basis + keyless-private "derive nothing" signalling shape

**Current state (`keys.ts:143-156`):**
```ts
function channelKeyMemo(material: JoinMaterial, channel: ChannelMetadata): GroupKey {
  const cache = getOrComputeCachedValue(material, ChannelKeysSymbol, () => new Map<string, GroupKey>());
  const sig = channel.private && channel.key
    ? `p|${channel.channel_id}|${channel.key}|${channel.epoch ?? 1}`
    : `c|${channel.channel_id}`;
  let gk = cache.get(sig);
  if (!gk) cache.set(sig, (gk = channelKeyFor(material, channel)));
  return gk;
}
```
D-01 removes `ChannelMetadata.key`/`.epoch` entirely, so `channel.key`/`channel.epoch` in `sig` become permanently `undefined` — the private branch of `sig` degrades to always resolving the public-shaped signature bucket, silently reintroducing collision risk inside the memo layer itself (not the derivation — a subtle, easy-to-miss regression if only `channelSecret`/`channelKeyFor` are updated and this memo is left untouched).

**Recommended shape — key off the `material.channels` held entry, looked up once:**
```ts
function channelKeyMemo(material: JoinMaterial, channel: ChannelMetadata): GroupKey | null {
  const cache = getOrComputeCachedValue(material, ChannelKeysSymbol, () => new Map<string, GroupKey | null>());
  const held = channel.private ? material.channels.find((c) => c.id === channel.channel_id) : undefined;
  const sig = channel.private
    ? held ? `p|${channel.channel_id}|${held.key}|${held.epoch}` : `p0|${channel.channel_id}`
    : `c|${channel.channel_id}`;
  if (cache.has(sig)) return cache.get(sig)!;
  const gk = channelKeyFor(material, channel);
  cache.set(sig, gk);
  return gk;
}
```
This keeps the existing defensive pattern (the code comment at `keys.ts:143-146` explains embedding key+epoch "for safety" in case a caller reuses the same `material` reference across a key change) but sources the private-branch fields from `material.channels`, not from the doomed `ChannelMetadata` fields. The map itself is already memoized ON `material`, so this is belt-and-suspenders against any future caller that mutates a channel's key out of the immutable-update pattern — not strictly load-bearing today, but keep it (matches the milestone's fail-closed-over-convenient stance).

**"Derive nothing" signalling shape — recommend `null` return, not a sentinel object or throw.** Rationale:
- `channelSecret`/`channelKeyFor`/`channelKeyMemo`/`voiceKeysFor` all become `T | null`. This is type-checked, requires no new type, and composes cleanly with the `deriveConcordKeys` loop's `continue`:
```ts
// helpers/community.ts
function channelSecret(material: JoinMaterial, channel: ChannelMetadata): { secret: Uint8Array; epoch: number } | null {
  if (channel.private) {
    const held = material.channels.find((c) => c.id === channel.channel_id);
    if (!held) return null; // CHAN-01: keyless private channel derives nothing
    return { secret: hexToBytes(held.key), epoch: held.epoch };
  }
  return { secret: hexToBytes(material.community_root), epoch: material.root_epoch };
}

export function channelKeyFor(material: JoinMaterial, channel: ChannelMetadata): GroupKey | null {
  const s = channelSecret(material, channel);
  return s ? channelGroupKey(s.secret, hexToBytes(channel.channel_id), s.epoch) : null;
}
```
```ts
// helpers/keys.ts — deriveConcordKeys loop (currently keys.ts:174-177)
for (const ch of channels) {
  const gk = channelKeyMemo(material, ch);
  if (!gk) continue; // CHAN-01: no keys.channels entry, no channelEpochs entry, no plane
  const held = ch.private ? material.channels.find((c) => c.id === ch.channel_id) : undefined;
  channelKeys.set(ch.channel_id, gk);
  channelEpochs.set(ch.channel_id, ch.private ? held!.epoch : material.root_epoch); // CHAN-03: actual held epoch
}
```
- This is a "total-fold-guard" (skip-in-loop) pattern, matching the milestone's established "fail-closed/total branches" convention (Phase 6 D-07/D-08 precedent: guards deny/skip by default, never permit-by-absence).
- A throw was considered and rejected: `deriveConcordKeys` folds ALL channels in one pass for the whole community; a keyless private channel is a **routine, expected** state (every member sees channel metadata before being granted access) — throwing would crash the entire community fold for every member who lacks one channel's key. `null`+`continue` is correct; throwing belongs only at the `sendMessage` guard (CHAN-02), where the caller is specifically asking about ONE channel they're trying to act on.

**Cross-cutting site NOT named in CONTEXT.md's canonical refs — must be updated in the same commit:**
- **`voiceKeysFor`** (`helpers/community.ts:53-59`) shares `channelSecret` and must also become `VoiceKeys | null`. The audit explicitly calls this out as in-scope-for-correctness (though voice *features* are FUT-02): *"ensuring it no longer returns a wrong `community_root`-derived room for keyless private channels."*
- **`deriveKeys`/`CommunityKeys`** (`helpers/community.ts:20-25,62-72`) is a **second, lighter-weight key-derivation path used only by tests** — `client/__tests__/relay-auth.test.ts:40`, `helpers/__tests__/community.test.ts:9`, `__tests__/roundtrip.test.ts:41,78,83,112` — never by the production `ConcordCommunity` engine (which uses `deriveConcordKeys` from `keys.ts`). It shares `channelKeyFor`, so once that returns `GroupKey | null`, `deriveKeys`'s loop (`for (const ch of channels) channelKeys.set(ch.channel_id, channelKeyFor(material, ch));`) will fail to typecheck (`Map<string, GroupKey>` cannot accept `null`) unless it also gets the same skip-on-null guard. **This is easy to miss because it's test-only code with no production caller** — flag it explicitly in the plan so the refactor task's file list includes `community.ts:62-72` and a pass over the three test files that call `deriveKeys` directly.

### 4. Upstream CORD-03 verification (fetched `raw.githubusercontent.com/concord-protocol/concord/main/03.md`, 2026-07-17)

**§1 — formula, both branches (verbatim):**
```
Public  channel_pk = group_key("concord/channel", community_root, channel_id, root_epoch).pk
Private channel_pk = group_key("concord/channel", channel_key, channel_id, channel_epoch).pk
```
And: *"Its key is an independent random secret, delivered on grant and rekeyed on removal (CORD-06)."* [CITED: raw.githubusercontent.com/concord-protocol/concord/main/03.md §1] — this matches CONTEXT.md's D-11 paraphrase exactly; the planner can cite this verbatim for the hand-derived TEST-01 expected values (both `group_key(...)` calls above, computed directly from `crypto.ts`'s `channelGroupKey`, never via `channelKeyFor`/`deriveConcordKeys`).

**§2 — edition shape + deletion terminality (verbatim):**
```jsonc
{ "name": "general", "private": false }
{ "name": "lounge",  "private": false }
```
*"Deletion is terminal: the id is never reused, clients drop the Channel from display and may discard its keys."* [CITED: same source §2] — matches CONTEXT.md's D-07 verbatim quote exactly; confirms the "id never reused" clause narrows rather than widens the reading (a later edition at the same id, whatever its `deleted` value, must be ignored once any authorized deletion exists).

**§3 — receiver binding (verbatim, from this session's fetch):**
*"Clients load a Channel newest-first and paginate backwards, querying every epoch pubkey they hold..., so history spanning a rekey stays continuous."* / *"No member can re-wrap another's message into a different Channel or replay it across an epoch."* [CITED: same source §3] — this is the anti-replay binding `checkChatBinding` implements (`helpers/chat.ts:4`, called at `client/community.ts:470` and `client/private-channel.ts:194`). The binding check itself validates `(channel_id, epoch)` against the tags on the decrypted rumor — CHAN-03's fix (recording `held.epoch`, the epoch the key actually derived at, into `channelEpochs`) is what makes this check validate the *correct* number; the check's own logic (`helpers/chat.ts`) needs no change.

### 5. Error-class placement (D-06)

**Finding: no existing error base class exists anywhere in `packages/concord/src`.** Exhaustive grep for `extends Error` and `export class.*Error` across the package found zero matches; every current throw site is a bare `new Error("...")` (confirmed at `client/community.ts:767,778,922,923,929,949,1057,1058,1111,1119` — includes the two existing "outrank" guards from Phase 6, `:929` and `:1119`, both plain `Error`). **`MissingChannelKeyError` will be the first custom error class in this package.** Recommend a minimal standalone class (no base to extend, since none exists):
```ts
export class MissingChannelKeyError extends Error {
  constructor(public readonly channelId: string) {
    super("missing private channel key");
    this.name = "MissingChannelKeyError";
  }
}
```
Export it from `client/community.ts` (co-located with `sendMessage`, matching this package's convention of defining error-adjacent logic next to its throw site) and re-export from the package's public `index.ts`. No precedent exists for a shared base error class, so introducing one is out of scope for this phase — a single exported class satisfies D-06 without inventing new package-wide conventions the CONTEXT didn't ask for.

### 6. `accessible` naming (D-05 discretion)

**Finding: no prevailing term exists on folded channel state today.** Grep for `accessible`, `hasKey`, `hasChannelKey`, `keyHeld`, `hasKeyFor` across `packages/concord/src` returned zero matches (outside this session's own CONTEXT.md). The closest existing pattern is the inline guard `this.material.channels.find((k) => k.id === c.channel_id)` repeated ad hoc at `client/community.ts:581` (`reconcilePrivateChannels`) and `:657` (`dropChannelKey`) — exactly the "hand-rolled lookup" the Accordian report and CHAN-06 exist to eliminate. `accessible` is free to use as decided; no renaming needed. Recommend factoring the lookup itself into one small helper (e.g., `hasChannelKey(material, channelId)` in `helpers/community.ts`) that both the new `channels$` enrichment and these two existing call sites can share, since they're doing the identical check today with copy-pasted logic.

## `channels$` reactivity gap (new finding, not in CONTEXT.md — planner must address)

**`channels$` currently only reacts to control-plane fold changes, not to key-holding changes.** `channels$` is defined at `client/community.ts:245` as `slice((s) => s.channels)`, a pure `distinctUntilChanged` projection of `state$`. `state$` only re-emits from `rewireState()`'s `combineLatest([state$, dissolved$])` subscription (`community.ts:444-447`), which is (re)wired at construction, on `adoptRefounding` (`:718`), and when a new plane store is created (`storeFor`, `:414`). None of the four methods that mutate `this.keys.material.channels` — `receiveChannelKeys` (`:601-610`), `persistChannelKey` (`:636-640`), `dropChannelKey` (`:651-660`), or the `mintChannelKey` callback wired into `ConcordCommunityAdmin` (`:297-300`) — call `rewireState()` or otherwise push a new `state$` value. They only call `this.onMaterialChange?.(this.keys.material)`, an external callback with no return path into the internal observable graph.

**Consequence:** if `accessible` is implemented as a `map()` inside the existing `channels$` slice (reading `this.material.channels` at map time), it will compute the *correct* value the first time `channels$` emits after a key change coincides with any other `state$` emission — but it will **not** independently emit when a key arrives via `receiveChannelKeys` (a Direct Invite grant) or is dropped via `dropChannelKey` with no simultaneous control-plane change. This directly undermines CHAN-06's stated purpose ("drives composer/invite enable-disable reactively") for the single scenario the Accordian report actually needed: a grant landing without a simultaneous metadata edition change.

**Recommended fix:** add a lightweight internal signal (e.g. `private materialChanged$ = new Subject<void>()`) that those four sites call after mutating `this.keys`, and redefine `channels$` as:
```ts
this.channels$ = combineLatest([
  slice((s) => s.channels),
  this.materialChanged$.pipe(startWith(undefined as void)),
]).pipe(
  map(([channels]) => channels.map((c): ChannelView => ({
    ...c,
    accessible: !c.private || hasChannelKey(this.material, c.channel_id),
  }))),
  distinctUntilChanged(sameChannelViews), // must compare `accessible` per-entry, not just reference
);
```
This is a small, contained addition (one `Subject`, four call sites, one new comparator) but it is a **distinct task** from the D-01/D-02 refactor and from the `ChannelView` type addition — flag it as its own plan step so it isn't silently dropped as "just add a field to the map."

## Standard Stack

No new libraries. This phase is entirely internal to `packages/concord/src`, using the existing `@noble/hashes`, `applesauce-core`, and `applesauce-signers` dependencies already in place. No installation, no version verification needed.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────┐
                    │  Control Plane relay events │
                    │  (kind 3308 editions, VSK.CHANNEL) │
                    └──────────────┬──────────────┘
                                   │ DecodedEvent[]
                                   ▼
                    ┌─────────────────────────────┐
                    │   foldControl (control.ts)  │
                    │  - authority-gated per eid   │
                    │  - sticky-deleted scan (NEW) │──► heads (pinned to
                    │  - explicit field pick (D-04)│    deleting edition
                    └──────────────┬──────────────┘    once triggered)
                                   │ CommunityState.channels
                                   │ (ChannelMetadata[], pure edition data —
                                   │  NO key/epoch after D-01)
                                   ▼
                    ┌─────────────────────────────┐        ┌──────────────────────┐
                    │  ConcordCommunity.state$     │        │ this.keys.material    │
                    │  (BehaviorSubject)           │        │ .channels (ChannelKey[])│
                    └──────────────┬──────────────┘        │ held key material,     │
                                   │                        │ client-local, mutated by│
                                   │                        │ receiveChannelKeys/     │
                                   │                        │ persistChannelKey/      │
                                   │                        │ dropChannelKey/         │
                                   │                        │ mintChannelKey          │
                                   │                        └───────────┬──────────┘
                                   │                                    │
                                   ▼                                    │
                    ┌─────────────────────────────┐                    │
                    │  channels$ (NEEDS combineLatest│◄──── materialChanged$ (NEW)
                    │  with materialChanged$, not a  │
                    │  pure state$ slice)            │
                    │  → ChannelView[] { accessible } │  (CHAN-06)
                    └─────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │  deriveConcordKeys (keys.ts) │
                    │  per channel: channelKeyMemo │──► null (keyless private)
                    │  → skip: no keys.channels,   │    or GroupKey (public /
                    │    no channelEpochs, no plane│    keyed private)
                    └──────────────┬──────────────┘
                                   │ keys.channels (Map<id,GroupKey>)
                                   ▼
                    ┌─────────────────────────────┐
                    │  sendMessage → channelEpoch  │
                    │  → guard: private && !accessible│──► throw MissingChannelKeyError
                    │  → publishToPlane            │      (CHAN-02, guards BEFORE
                    │  → wrapForTarget → planeKeyFor│      planeKeyFor's generic throw)
                    └─────────────────────────────┘
```

### Recommended Task Structure (not a file tree — this is a refactor phase)
```
packages/concord/src/
├── types.ts                    # D-01: remove ChannelMetadata.key/.epoch
├── helpers/
│   ├── control.ts               # CHAN-04/CHAN-07: explicit field pick, sticky-delete + heads pinning
│   ├── keys.ts                  # D-02/D-03: channelKeyMemo null-signalling, deriveConcordKeys skip-loop,
│   │                            #   channelEpochs from held.epoch
│   └── community.ts             # D-01/D-02: channelSecret/channelKeyFor/voiceKeysFor → nullable;
│                                 #   deriveKeys (test-only path) updated in the same commit
└── client/
    └── community.ts              # CHAN-02: MissingChannelKeyError guard in sendMessage;
                                   # CHAN-06: materialChanged$ + ChannelView channels$ redefinition
```

### Pattern 1: Total (never-partial) branches for key derivation
**What:** Every function that used to silently fall through to a public-address default (`channelSecret`, `channelKeyFor`, `voiceKeysFor`) becomes total over its input by returning `null` for the "no key held" case, rather than defaulting or throwing.
**When to use:** Any derivation where "key absent" is a routine, expected state for many callers in one fold pass (a whole-community fold sees many channels at once) — as opposed to a single-target action (`sendMessage`) where the caller IS asking about exactly one channel and a thrown, typed error is more useful.
**Example:**
```ts
// Source: this session's read of helpers/community.ts:33-43 (pre-refactor) + D-02
function channelSecret(material: JoinMaterial, channel: ChannelMetadata): { secret: Uint8Array; epoch: number } | null {
  if (channel.private) {
    const held = material.channels.find((c) => c.id === channel.channel_id);
    return held ? { secret: hexToBytes(held.key), epoch: held.epoch } : null;
  }
  return { secret: hexToBytes(material.community_root), epoch: material.root_epoch };
}
```

### Pattern 2: Client-local enrichment via combineLatest, not folded state
**What:** `accessible` rides an emitted view object (`ChannelView`) constructed by combining `state$`'s folded, edition-derived data with client-local material (key holdings) — never merged back into the fold itself.
**When to use:** Any client-local, non-consensus-relevant flag (things every client computes differently based on its own key possession, not things the protocol folds identically for every member).
**Example:** see the `channels$` reactivity fix code block above.

### Anti-Patterns to Avoid
- **Deciding `heads` and the emitted list from two different scans.** If CHAN-07's sticky-delete scan and the `heads.set` pinning use separate logic (or one is left as the old single-candidate loop), they can disagree about which edition is authoritative — reintroducing the exact "verified correct register wrongly cleared `rollForwardChannel`" class of false confidence this milestone exists to fix.
- **Treating a `null` return as "not yet implemented" and defaulting to the public branch.** The single behavior CHAN-01 exists to kill is exactly this default — every `null` check must skip/deny, never fall through.
- **Updating `channelSecret`/`channelKeyFor` without updating `voiceKeysFor` and `deriveKeys` in the same commit.** Both are compile-time-coupled to the nullable signature change; missing either breaks the build or silently reintroduces the H07 bug in the voice-room-name path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Do I hold a key for this private channel?" | A fresh `material.channels.find(...)` at every call site (composer guard, invite button, `sendMessage` guard, `reconcilePrivateChannels`, `dropChannelKey`) | One shared helper (e.g. `hasChannelKey(material, channelId)` in `helpers/community.ts`) | This exact duplication is what caused CHAN-06 in the first place — the Accordian consumer had to hand-roll the same lookup the SDK does internally in at least two places already (`community.ts:581`, `:657`) |
| Deciding whether an entity is "terminally deleted" | A new persisted tombstone set, ad hoc, per entity type | The generalized "scan authorized candidates, pin `heads` to the terminal edition" fold-time pattern (this phase's CHAN-07 fix) | A persisted tombstone duplicates the exact information already implicit in the fold, and only becomes necessary if the fold-time approach can't represent it — which this phase's fix shows it can |

**Key insight:** Every "don't hand-roll" in this phase reduces to the same root cause as the audit's own diagnosis: the SDK exposes internal lookups implicitly (via a raw `material.channels.find(...)`) instead of as a named, exported affordance, forcing every consumer (including the SDK's own internals) to reimplement the same check with no shared name to grep for.

## Runtime State Inventory

Not applicable — this phase is a type/behavior refactor, not a rename/rebrand/migration. `ChannelMetadata.key`/`.epoch` removal (D-01) changes an in-memory TypeScript type only; nothing is persisted to disk/relay under that shape (the fields were explicitly documented as "client-tracked keying... not part of the edition," `types.ts:123`, so no wire format or stored document changes). No OS-registered state, no secrets/env vars, no build artifacts are affected.

## Common Pitfalls

### Pitfall 1: Fixing `channels.push` without fixing `heads.set` (CHAN-07)
**What goes wrong:** The sticky-delete scan correctly excludes the channel from the emitted `channels` list for the current session, but `heads` (used by `buildRefounding`'s compaction) still follows the ordinary version-chain head — so the NEXT compaction republishes a resurrection edition, and a client that joins fresh after that compaction sees no evidence the channel was ever deleted.
**Why it happens:** `heads.set` and `channels.push` look like two independent lines that happen to be adjacent in the loop (`control.ts:232-233`) — easy to patch one and assume the other is unaffected.
**How to avoid:** Compute the sticky-delete verdict (and, if triggered, which candidate is "the" terminal edition) once per entity, and use that single result for both `heads.set` and the `channels.push` decision.
**Warning signs:** A test that only checks `state.channels` post-fold (not `state.heads`, and not a simulated compaction round-trip) would pass even with this bug present — write the test to simulate: delete → resurrect-attempt → compact (call `buildRefounding` with the resulting `heads`) → fold a FRESH `foldControl` call using only the compacted head as if it were a new joiner's sole input → assert still-deleted.

### Pitfall 2: Nullable-signature ripple missed on `voiceKeysFor`/`deriveKeys`
**What goes wrong:** `channelSecret`/`channelKeyFor` are updated to return `null`, but `voiceKeysFor` (community.ts:53-59) and/or `deriveKeys` (community.ts:62-72, test-only) are left with their old non-nullable signatures, either causing a TypeScript compile error (good — caught immediately) or, worse, a `!`-asserted cast that silences the error and reintroduces the exact H07 bug in the voice-room path.
**Why it happens:** `voiceKeysFor` has no production caller in the repo (voice features are FUT-02), so it's easy to skip when scanning for "who calls `channelSecret`."
**How to avoid:** Grep for `channelSecret(` call sites before considering the D-02 task done — there are exactly two (`channelKeyFor`, `voiceKeysFor`), both in `community.ts:33-59`, plus the two-hop caller `deriveKeys` (community.ts:62-72) that consumes `channelKeyFor`'s output.
**Warning signs:** `tsc` passing with a `!` non-null assertion added near either function during the refactor — that's the tell that a caller was patched around rather than made total.

### Pitfall 3: `channels$` looking "done" because it compiles and the field is present
**What goes wrong:** Adding `accessible` as a computed field inside the existing `channels$` slice's `map()` typechecks fine and passes any test that changes a key AND simultaneously triggers a control-plane fold (which most naive tests will, since test helpers often call `settle()` after every action) — masking that it doesn't independently react to `receiveChannelKeys`/`dropChannelKey` alone.
**Why it happens:** `state$` re-emits often enough in a typical integration test (every `sendMessage`, every fold) that the missing signal is easy to not notice.
**How to avoid:** Write the CHAN-06 test to grant a channel key via `receiveChannelKeys` (or the Direct Invite path) with NO other community activity in between, and assert `channels$` emits a new value with `accessible: true` — without calling any method that would otherwise trigger a `state$` re-emission.
**Warning signs:** A CHAN-06 test that calls `sendMessage` or another state-mutating action between granting the key and reading `channels$` — that ordering would hide the gap.

## Code Examples

### CHAN-02 guard placement in `sendMessage`
```ts
// Source: this session's read of client/community.ts:755-763 (current) + D-06
async sendMessage(channelId: string, text: string, /* … */): Promise<void> {
  const channel = this.state$.value.channels.find((c) => c.channel_id === channelId);
  if (channel?.private && !hasChannelKey(this.material, channelId)) {
    throw new MissingChannelKeyError(channelId);
  }
  const epoch = this.channelEpoch(channelId);
  // … existing body unchanged
}
```
`planeKeyFor`'s existing generic `throw new Error("unknown channel")` (`keys.ts:209`) stays as-is — it remains the backstop for a channel id that isn't even in `state.channels` at all (a truly unknown id), which `sendMessage`'s new guard does not cover (it only guards the "known but keyless private" case).

### Sticky-deleted fold with heads pinning (CHAN-07)
```ts
// Source: this session's synthesis from control.ts:219-239 + D-07/D-08/D-09 findings
for (const [eid, cands] of groupByEntity(byVsk(VSK.CHANNEL))) {
  const authorized = cands.filter((c) => {
    const s = standing(c.author);
    return s.isOwner || hasPerm(s.permissions, PERM.MANAGE_CHANNELS);
  });
  const deletion = authorized.find((c) => {
    try { return (JSON.parse(c.content) as ChannelMetadata).deleted === true; } catch { return false; }
  });
  if (deletion) {
    heads.set(eid, deletion.source); // pin to the terminal edition, not the ordinary head
    continue; // never push to `channels` — permanently dead, id never reused
  }
  for (const cand of authorized) {
    try {
      const meta = JSON.parse(cand.content) as ChannelMetadata;
      meta.channel_id = eid;
      heads.set(eid, cand.source);
      channels.push(meta);
      break;
    } catch { /* skip */ }
  }
}
```

## State of the Art

Not applicable in the usual "library version drift" sense — no external dependency changed. The relevant "old → new" shift is internal:

| Old Approach | Current/New Approach | When Changed | Impact |
|--------------|------------------|-----------|--------|
| Channel key threaded via `ChannelMetadata.key`/`.epoch` (folded, edition-adjacent) | Channel key sourced only from `material.channels` (client-local, immutable-update JoinMaterial) | This phase (D-01) | Breaking type change (concord is unreleased — no changeset needed per project memory); removes the H06/H07/H08 root class outright |
| `channelKeyFor`/`channelSecret` total-in-appearance but silently falls through to public derivation when keyless | Total, returns `null` | This phase (D-02) | Closes CHAN-01/H07 |
| `heads.set` follows ordinary version-chain head selection unconditionally | `heads.set` pinned to the terminal deletion once a sticky-delete triggers | This phase (D-08 + this research's refinement) | Closes CHAN-07 across compaction boundaries, not just within one fold |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The CORD-03 §3 quote fetched this session ("Clients load a Channel newest-first...", "No member can re-wrap...") is the correct §3 content — the fetch tool summarized/extracted rather than returning raw markdown verbatim, so exact section boundaries were not independently re-verified against the raw file byte-for-byte. | Priority Finding 4 | Low — the CHAN-03 fix (recording `held.epoch` correctly) does not depend on the precise §3 wording, only on `checkChatBinding`'s existing implementation (verified directly in code), so this is a citation-completeness risk, not a correctness risk. |
| A2 | Assumed the correct disambiguation for "multiple authorized `deleted:true` candidates for one eid" (Priority Finding 1's `heads` pinning) is "pick the lowest `rumorId`," mirroring `headCandidates`'s existing tiebreak (`control.ts:85`) — CONTEXT.md did not specify this, and no spec text was found addressing simultaneous same-version deletions. | Priority Finding 1 / Code Examples | Low — any deterministic tiebreak works as long as every client picks the same one; using the existing convention is the lowest-risk choice, but the planner should confirm this doesn't need a ruling before implementing. |

## Open Questions (RESOLVED)

1. **RESOLVED — mandatory, as a cheap in-place addition.** Should the ROTATE-03 client-level gap-closing test (Priority Finding 2's "remaining gap") be mandatory in this phase, or deferred?
   - What we know: the derivation-level probe (`channel-rekey.test.ts:92-118`) already proves the memo half of H01(c) is dead. `community.test.ts:144-191` proves rotation updates `material.channels` but not that a subsequent send actually uses the new plane.
   - What's unclear: whether TEST-02/CHAN-05's acceptance bar requires this specific end-to-end assertion, or whether the existing coverage (derivation-level + material-state-level) is judged sufficient.
   - Recommendation: treat as a cheap addition to the existing `community.test.ts:144` test (one more `sendMessage` + one more plane-address assertion) rather than a new test file — low cost, closes the loop at the exact level H08's symptom was originally observed.
   - **Resolution:** Plan 07-03 Task 3 implements this as the recommended client-level rotate→send→verify-new-plane test extending the existing suite (not a new file).

2. **RESOLVED — lowest `rumorId`.** Exact tiebreak for multiple simultaneous `deleted:true` editions at different versions for one eid (see Assumption A2) — likely doesn't need a ruling (any deterministic choice suffices for the sticky-delete fix to be correct), but flag for the planner to confirm during task-writing rather than leave implicit.
   - **Resolution:** Plan 07-01 Task 1 adopts the lowest-`rumorId` tiebreak (mirrors the existing `headCandidates` convention at `control.ts:85`), flagged explicitly as a non-blocking assumption for executor confirmation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-standard; `packages/concord/package.json` `"test": "vitest run --passWithNoTests"`) |
| Config file | Root/workspace vitest config (no package-local override found) |
| Quick run command | `pnpm --filter applesauce-concord test` |
| Full suite command | `vitest run` (per `.planning/config.json` `workflow.test_command`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAN-01 | Keyless private metadata derives no key/entry/plane | unit (spec-derived) | `vitest run helpers/__tests__/keys.test.ts` | ❌ new case needed |
| CHAN-02 | `sendMessage` on keyless private channel throws `MissingChannelKeyError` | unit/integration | `vitest run client/__tests__/community.test.ts` | ❌ new case needed |
| CHAN-03 | `channelEpochs` records the held epoch, not `ch.epoch ?? 1` | unit (spec-derived) | `vitest run helpers/__tests__/keys.test.ts` | ❌ new case needed |
| CHAN-04 | `foldControl` picks edition fields explicitly, type-validated, never reads key from edition | unit | `vitest run helpers/__tests__/community.test.ts` (or a new `control.test.ts` case) | ❌ new case needed — no dedicated `control.test.ts` found; verify location during planning |
| CHAN-05 | Rekey takes effect immediately without reload | integration | `vitest run client/__tests__/community.test.ts` | ✅ partially exists (`:144-191`) — extend, don't replace |
| CHAN-06 | `channels$` emits `accessible` reactively, independent of control-plane folds | integration | `vitest run client/__tests__/community.test.ts` | ❌ new case needed — must NOT co-trigger a state$ emission (see Pitfall 3) |
| CHAN-07 | Sticky deletion survives compaction + resurrection attempts | unit (fold + simulated compaction) | `vitest run helpers/__tests__/community.test.ts` (or `control.test.ts`) | ❌ new case needed |
| ROTATE-03 | Rolled-forward channel derives new epoch's plane (memo level) | unit (spec-derived) | `vitest run helpers/__tests__/channel-rekey.test.ts` | ✅ exists at `:92-118` — confirm still green, optionally extend to client level |
| TEST-01 | Both CORD-03 §1 branches, hand-derived, + keyless-derives-nothing | unit (spec-derived) | `vitest run helpers/__tests__/keys.test.ts` | Partial — public/private branches likely covered pre-existing; keyless-derives-nothing is new |
| TEST-02 | Five Accordian-named cases | unit + integration, mixed | `vitest run` (spans keys.test.ts + community.test.ts) | ❌ cases 1/4 new; 2/3 likely pre-existing; case 5 (direct-invite grant flow) likely exists at `community.test.ts:193+` — confirm it still passes post-refactor |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-concord test` (package-scoped)
- **Per wave merge:** `vitest run` (full monorepo suite, per `.planning/config.json`)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- No dedicated `helpers/__tests__/control.test.ts` was found — CHAN-04/CHAN-07's fold-level tests may need to land in `helpers/__tests__/community.test.ts` (which already imports from `../community.js`, adjacent to `control.ts`) or a new file. Confirm during planning which existing file is the natural home before creating a new one.
- No shared `hasChannelKey(material, channelId)` helper exists yet (Don't-Hand-Roll section) — if the planner adopts this recommendation, it needs a home (likely `helpers/community.ts`, alongside `channelSecret`) and its own unit test.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Out of scope — this phase touches key derivation/authorization fold logic, not authentication |
| V3 Session Management | No | — |
| V4 Access Control | Yes | The entire phase IS an access-control conformance fix: private-channel key material must gate both read (plane subscription) and write (`sendMessage`) access; `foldControl`'s existing `hasPerm`/`standing` authority gates are the standard control and are unchanged by this phase — only the channel-loop's field-picking and deletion-scan logic change |
| V5 Input Validation | Yes | CHAN-04 requires explicit type-checked field extraction from parsed edition JSON (`name`/`private`/`deleted`/`voice`/`custom`), replacing the blind `JSON.parse(...) as ChannelMetadata` cast — this is the standard control (no third-party validation library needed; hand-checked `typeof` guards match the existing codebase convention, e.g. `isHexKey` in `control.ts:20`) |
| V6 Cryptography | Yes | Channel key derivation (`channelGroupKey`) is unchanged — this phase only changes *which object* supplies the secret material, never the derivation itself. No hand-rolled crypto is introduced. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cleartext key smuggled via Control-Plane edition JSON (H06) | Information Disclosure | Never read `key`/`epoch` off edition JSON; source exclusively from `material.channels` (D-01/D-04) |
| Address collision between private (keyless) and public channel formulas (H07) | Information Disclosure / Spoofing | Total branch returning `null` rather than falling through to the public formula (D-02) |
| Deletion resurrection via a later edition at the same eid (CHAN-07/S04) | Tampering | Sticky-deleted fold rule with `heads` pinning (this research's Priority Finding 1) |
| Stale plane key after a rekey, due to spread-carried memo (H01c) | Spoofing (removed member retains read access) | Non-enumerable memo write (already fixed, Phase 5/5.1) — this phase only needs to confirm/test, not re-fix |

## Sources

### Primary (HIGH confidence)
- Direct code inspection this session: `packages/concord/src/helpers/control.ts`, `keys.ts`, `community.ts`; `packages/concord/src/client/community.ts`; `packages/concord/src/types.ts`; `packages/concord/src/models/control.ts`, `models/community.ts`; `packages/concord/src/client/admin.ts`; `packages/core/src/helpers/cache.ts`; existing test files `helpers/__tests__/keys.test.ts`, `helpers/__tests__/channel-rekey.test.ts`, `client/__tests__/community.test.ts`.
- `https://raw.githubusercontent.com/concord-protocol/concord/main/03.md` — CORD-03 §1/§2/§3, fetched and quoted this session (2026-07-17).

### Secondary (MEDIUM confidence)
- `.planning/concord-audit.md` — H06/H07/H08/H01c, S04 (channel deletion), and the "Verified correct" register's `held_roots`-omission note — all cross-checked against the live code this session, not merely trusted as prior.
- `.planning/phases/06-refounding-rotation-authority-correctness/06-CONTEXT.md` — the "cache fix resolved H01 at source ⇒ derivation-level tests only" precedent, confirmed to extend cleanly to the channel plane this session.

### Tertiary (LOW confidence)
- None — every claim in this document was either directly verified in code this session or cited to the upstream spec fetch.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new dependencies
- Architecture (channel-key source-of-truth refactor, sticky-delete, reactivity gap): HIGH — verified against live code, all file:line citations from this session's reads
- Pitfalls: HIGH — each pitfall was derived from tracing an actual code path this session, not from generic best practice
- Upstream spec quotes: MEDIUM-HIGH — fetched and quoted this session, but the fetch tool summarizes rather than returning raw bytes (see Assumption A1)

**Research date:** 2026-07-17
**Valid until:** Should be re-verified if `packages/concord/src` changes before planning begins (this is a fast-moving refactor target, not a stable external API) — treat as valid for the remainder of this planning session and immediate execution, not as a durable 30-day reference.
