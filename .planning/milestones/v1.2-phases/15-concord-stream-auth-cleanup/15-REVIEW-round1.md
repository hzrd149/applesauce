---
phase: 15-concord-stream-auth-cleanup
reviewed: 2026-08-15T11:41:26Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/examples/src/examples/concord/admin-management.tsx
  - apps/examples/src/examples/concord/crypto-history.tsx
  - apps/examples/src/examples/concord/direct-invites.tsx
  - apps/examples/src/examples/concord/rumor-stores.tsx
  - packages/concord/src/client/auth.ts
  - packages/concord/src/client/channel-sync.ts
  - packages/concord/src/client/client.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/index.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/client/invite-watcher.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/sync.ts
  - packages/concord/src/client/__tests__/auth.test.ts
  - packages/concord/src/client/__tests__/channel-sync.test.ts
  - packages/concord/src/client/__tests__/client.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/invite-watcher.test.ts
  - packages/concord/src/client/__tests__/private-channel.test.ts
  - packages/concord/src/client/__tests__/sync-logging.test.ts
  - packages/concord/src/client/__tests__/sync.test.ts
  - packages/concord/src/index.ts
  - packages/concord/src/__tests__/exports.test.ts
  - packages/concord/src/__tests__/no-ambient-auth.test.ts
  - packages/concord/src/types.ts
findings:
  critical: 1
  warning: 8
  info: 4
  total: 13
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-08-15T11:41:26Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The rework itself is structurally sound: `StreamSigners.onAuthRequired` intersects `missingPubkeys` against its own registry and never falls back, `createUserAuthHandler` owns exactly one identity, both engines construct their own holder, and every removed mechanism is genuinely gone (verified by walking the diff, not just the guard test). `pnpm vitest run packages/concord/src/client/__tests__ packages/concord/src/__tests__` passes (222 tests) and `tsc --noEmit` is clean.

The two items flagged for reviewer attention resolve as follows:

- **The `as unknown as SyncAuthHandler` cast in `sync.ts` is benign at runtime**, but it launders a genuine variance hole for external callers (WR-07). `SyncAuthContext` carries `relay`/`url`/`challenge`/`requirement`/`missingPubkeys`/`reason` and omits only `request`; `StreamSigners.onAuthRequired` reads only `missingPubkeys`, `relay.authenticate`, and `url`, all present. The default `createSyncLoader` path also hands the handler a real `RelayAuthContext` from the pool, so `request` is present in practice.
- **The `grantChannelAccess` exception is correct.** `directInvite()` in `operations/direct-invite.ts:52` calls `generateSecretKey()` and `finalizeEvent(...)` with it inside the operation, never returning it — so `waitForAuth: [wrap.pubkey]` would name a key no client can ever hold. `waitForAuth: true` + the user's own handler is the only satisfiable shape. Verified, not an oversight.

However, the same audit that confirms the exception surfaces a **key the community's holder genuinely should own and does not**: the private-channel message plane. That is CR-01, and it is a regression against the pre-phase behavior. Everything else is a robustness, observability, or coverage concern.

## Critical Issues

### CR-01: Every private-channel publish declares a `waitForAuth` the community's `StreamSigners` cannot answer

**File:** `packages/concord/src/client/community.ts:1592-1600` (`streamPublishOptions`), reached from `publishToPlane` (`:1605-1620`) via `sendMessage` (`:1057`), `sendEvent` (`:1012`), `sendThread` (`:1065`), `replyToThread` (`:1073`), `react` (`:1080`), `editMessage` (`:1087`), `deleteMessage` (`:1100`)

**Issue:**

`wrapForTarget(this.keys, { plane: "channel", channelId }, ...)` resolves through `planeKeyFor` (`helpers/keys.ts:219-223`) to `keys.channels.get(channelId)`, which `deriveConcordKeys` (`helpers/keys.ts:181-189`) populates for **every** channel we hold a key for — public *and* private. `buildWrap` finalizes the wrap with that key, so for a private channel `wrap.pubkey` is the private channel's message-plane stream pubkey.

`streamPublishOptions` then emits `{ waitForAuth: [wrap.pubkey], onAuthRequired: this.signers.onAuthRequired }`. But the community's `StreamSigners` is only ever fed:

- `openLive()` — `control`, `guestbook`, `dissolved`, `nextBaseRekey.key`, `...this.publicChannelKeys()` (`:753-759`)
- `reconcileLive()` — `this.publicChannelKeys()` (`:785`)
- `sync.ts:151` / `sync.ts:204` — core planes and `publicKeys`
- `rotateChannel` / `refound` — the channel-**rekey** address only (`:1220`, `:1556`)
- `addSecretKey` — invite-link signer keys only (`:1256`, `:1331`, `:1357`)

`publicChannelKeys()` (`:719-724`) explicitly filters `!c.private`. **No code path ever registers a private channel's message-plane `GroupKey` into the community's holder.** That key lives only in the sub-engine's own `StreamSigners` (`channel-sync.ts:48`, `private-channel.ts:375`), which is deliberately not shared (D-06/T-15-01).

Consequence on an auth-gating relay: the relay refuses the EVENT with `auth-required:`, `authRetry` builds the context with `missingPubkeys: [privateChannelPk]`, the community handler finds no signer, returns having authenticated nothing, and the operation waits out the 30s `authTimeout` before failing. `publishToPlane`'s `.catch` swallows it with a `console.warn`, so the message is silently lost and the optimistic local echo (`:1612`) makes the UI show it as sent.

This is a **regression**. Pre-phase, `pool.publish(this.transport(), wrap)` carried no options, so `waitForAuth` defaulted to `true`, and the deleted client-wide `ConcordRelayAuth` registry *did* hold the private channel's keys (registered through the shared `relayAuth` by `channel-sync.ts`'s `registerStreamKeys`), so its ambient per-relay driver satisfied the requirement.

`streamPublishOptions` already detects this exact state and logs `"publishing wrap=%s with no registered signer for author=%s"` — the diagnostic fires on every private-channel send, framed as benign. `community.test.ts`'s "every publish a community makes declares an author its own holder can answer for" test does create a private channel (`:3564`) but never sends into it, so the assertion loop at `:3587-3597` (which would fail on such a publish) never sees one.

**Fix:** register the held private-channel message-plane keys into the community holder wherever `publicChannelKeys()` is registered. These are keys this same user, in this same community scope, already holds — registering them does not cross a scope boundary, and the per-operation `waitForAuth` narrowing still keeps them unusable by any other operation.

```ts
// community.ts — alongside publicChannelKeys()
/** The stream keys for every channel we hold a key for — public AND the private
 *  ones whose messages this engine still publishes (the sub-engine only READS). */
private heldChannelKeys(): GroupKey[] {
  const live = new Set(
    this.state$.value.channels.filter((c) => !c.deleted).map((c) => c.channel_id),
  );
  return [...this.keys.channels.entries()].filter(([id]) => live.has(id)).map(([, k]) => k);
}
```

then in `openLive()` (`:753`) and `reconcileLive()` (`:785`) register `this.heldChannelKeys()` instead of `this.publicChannelKeys()`. Leave the *subscription* author set (`currentAuthors()`) unchanged — only the signer registry widens, not what the community subscribes to.

Add a regression test: send a message to a private channel in the `community.test.ts` publish-answerability scenario, so the existing `authCalls` assertion covers it.

## Warnings

### WR-01: `refound()` and `rotateChannel()` recompute the channel-rekey auth key from `this.material` re-read after awaits

**File:** `packages/concord/src/client/community.ts:1220`, `:1556-1560`

**Issue:** Both sites derive the channel-rekey address with `channelRekeyGroupKey(hexToBytes(this.material.community_root), ...)`, read *after* `await this.admin.vacFor(...)` and `await buildChannelRekey(...)` / `await buildRefounding(...)` (and, in `refound`, after the whole root-roll `requireMajority` loop). The wraps themselves were built from the `material`/`keys` snapshot captured *before* those awaits.

`checkRekey()` runs on a 200ms timer off the rekey plane and can call `adoptRefounding()` during any of those awaits, reassigning `this.keys` (and therefore `this.material.community_root`) to the new root. The registration then computes the wrong `GroupKey`, and the very publishes it was added to make answerable (`requireMajority` at `:1539`, `waitForAuth: [wrap.pubkey]`) become unanswerable — aborting the whole Refounding on a gating relay with a misleading "not confirmed by a majority of relays" error.

Note the epoch half is already snapshot-correct (`channelRekeys`'s `channel` objects are captured before the awaits); only the root is re-read.

**Fix:** capture the root once, before the first await, and use that local at both the build and the registration:

```ts
const priorRoot = hexToBytes(this.material.community_root); // before any await
...
this.signers.register([channelRekeyGroupKey(priorRoot, hexToBytes(channelId), plan.newEpoch)]);
```

### WR-02: NIP-42 failures after `start()` never reach any surface

**File:** `packages/concord/src/client/community.ts:302`, `:359`, `:560`; `packages/concord/src/client/private-channel.ts:121`, `:173-177`, `:261`

**Issue:** `authFailure` is a mutable field written by the holder's `onAuthFailure` callback at *any* time, but read exactly once — at the end of `start()` / `walk()`. Every auth rejection after that (the live subscription, every publish, `reconcileLive`'s catch-up sync, `checkRekey`) updates the field and is never emitted. With `authenticated$` removed from both engines and `ConcordCommunityStatus` (`types.ts:288-292`), an app now has *no* signal that a relay is rejecting its stream keys during steady-state operation — the exact blind spot D-13 was written to close, just moved past the walk boundary.

**Fix:** make the failure a value stream rather than a latched field — have `StreamSigners` accept the engine's `error$` (or a dedicated `Subject<string>`) and push directly, so a post-walk rejection surfaces without a second walk. Keep `walk()`'s reset so a fresh walk still clears stale state.

### WR-03: `StreamSigners.onAuthRequired` reports nothing when it holds no signer for any missing pubkey

**File:** `packages/concord/src/client/auth.ts:98-117`

**Issue:** The loop `continue`s past every pubkey it has no signer for, with no log line and no `onAuthFailure`. A scope asked to authenticate a key it does not own — CR-01's exact failure, and any future registration gap of the same class — resolves silently, and the caller then waits out the full 30s `authTimeout`. The only trace is the *publish-side* diagnostic in `streamPublishOptions`, which does not cover the request/subscription paths at all.

`auth.test.ts:120-127` pins this as intended behavior ("authenticates nothing ... without throwing or rejecting"), which is right for the *rejection* semantics but makes the observability gap permanent.

**Fix:** track whether any pubkey was answered and emit a distinct trace when none was:

```ts
const unanswered = (ctx.missingPubkeys ?? []).filter((pk) => !this.registry.has(pk));
if (unanswered.length > 0)
  authLog("no signer held for %d of %d missing pubkeys relay=%s", unanswered.length, ctx.missingPubkeys?.length ?? 0, ctx.url);
```

### WR-04: The invite manager's `StreamSigners` is constructed without `onAuthFailure`

**File:** `packages/concord/src/client/invite-manager.ts:121` (`private readonly signers = new StreamSigners();`), used at `:269-281`

**Issue:** Unlike `ConcordCommunity` (`community.ts:359`) and `ConcordPrivateChannel` (`private-channel.ts:173`), this holder passes no options, so a relay rejecting the invite-link key's AUTH during `revokeBundle()` produces no message anywhere — the manager has no `error$` equivalent either. Revocation is the one operation whose silent failure has a security consequence (a link the user believes is dead stays live), so it is the worst place to drop the signal.

**Fix:** thread a failure sink — at minimum log it:

```ts
private readonly signers = new StreamSigners({
  onAuthFailure: (message) => this.log("invite-link auth failed: %s", message),
});
```

(`this.log` is assigned in the constructor, so move the field initializer into the constructor body after `this.log`.)

### WR-05: The examples establish a module-level `StreamSigners` singleton, contradicting the per-scope-holder invariant

**File:** `apps/examples/src/examples/concord/crypto-history.tsx:49`, `apps/examples/src/examples/concord/rumor-stores.tsx:43`, `apps/examples/src/examples/concord/direct-invites.tsx:34`

**Issue:** Each declares `const streamSigners = new StreamSigners();` at module scope, with a comment asserting "this walk covers one community, so this module-level holder is that scope's holder". That is not true of a module-level binding: it outlives the React component, so walking a second community (paste a different invite link / material — the whole point of these walkers) accumulates both communities' secret keys in one holder. The per-operation `missingPubkeys` narrowing still prevents cross-authentication, but the holder split is exactly what the phase advertises as the load-bearing D-06 invariant, and the shipped examples are the package's primary documentation of the new API. A reader copies the singleton pattern into a multi-community app and loses the guarantee.

**Fix:** move the holder into the component (a `useRef(new StreamSigners())` or a per-`material` `useMemo`) so its lifetime matches the scope it represents, and drop the "this is that scope's holder" comment.

### WR-06: The "every publish a community makes" test covers neither `refound()` nor any private-channel send

**File:** `packages/concord/src/client/__tests__/community.test.ts:3537-3615`

**Issue:** The test name and the comment at `:3579-3582` ("a tenth publish added later without options fails this loop automatically") claim universality, but the scenario exercises only `publishToPlane` (control/guestbook), `createInvite`, `revokeInvite`, `grantChannelAccess`, and `rotateChannel`. It omits:

- all four `refound()` publish sites (`requireMajority` root roll, `requireMajority` channel rekey, `compactionWraps`, `snapshotWraps`) — which carry the two most intricate registrations in the file (`:1556-1560`, `:1572`) and the WR-01 race
- `refreshInviteBundles()` (`:1335`)
- any send into the private channel it creates at `:3564` — the CR-01 gap, which this loop would have caught

The loop is a good oracle; the scenario feeding it is too narrow to back the claim.

**Fix:** extend the scenario to drive `refound({ keep: [pubkey], channelRekeys: [{ channelId, keep: [pubkey] }] })`, one `refreshInviteBundles([invite])`, and one `sendMessage(privateChannelId, "hi")`, keeping the existing structural loop unchanged.

### WR-07: The `SyncAuthHandler` cast is safe for in-package callers but unsound for external ones

**File:** `packages/concord/src/client/sync.ts:123`

**Issue:** `SyncContext` and `syncAuthors` are both public (`client/index.ts:10` → `src/index.ts:15`). `SyncContext.onAuthRequired` is typed `RelayAuthHandler`, whose context includes `request: RelayAuthWireRequest`. The `as unknown as SyncAuthHandler` cast tells the compiler that any such handler is safe to hand the loader, but `SyncAuthContext` (`loaders/src/loaders/sync-loader.ts:62-75`) has no `request`. Today every in-package caller passes a `StreamSigners` handler that reads only `missingPubkeys`/`relay`/`url`, and the default loader methods route through the pool so a real `RelayAuthContext` arrives — but nothing enforces either fact, and a downstream consumer passing a handler that branches on `ctx.request.verb` gets a `TypeError` the type system was asked to hide.

**Fix:** narrow `SyncContext.onAuthRequired` to the intersection the code actually needs, so no cast is required and the contract is visible in the type:

```ts
/** Reads only the fields both RelayAuthContext and SyncAuthContext carry. */
onAuthRequired: (ctx: SyncAuthContext) => void | Promise<void>;
```

`StreamSigners.onAuthRequired` (a `RelayAuthHandler`) is not directly assignable to that, so wrap it once at the engine boundary rather than casting at the loader boundary — which puts the one adaptation where the two type systems actually meet.

### WR-08: The no-ambient-auth guard scans the examples root for only one of its four checks

**File:** `packages/concord/src/__tests__/no-ambient-auth.test.ts:93-127`

**Issue:** `EXAMPLES_ROOT` is collected and asserted non-empty (`:76-78`), and is included in the `REMOVED_MECHANISMS` sweep (`:82`). But the three remaining checks — `AMBIENT_AUTH_TRIGGER` (`challenge$`/`authRequiredForRead`/`authRequiredForPublish`), `RETRY_BUDGET_OVERRIDE`, and `MISSING_PUBKEYS_FIELD` — filter to `collectFiles(SRC_ROOT, ...)` only. An example can therefore reintroduce a proactive `challenge$` subscriber, override `authTimeout`, or hand-roll a second `missingPubkeys` handler with the guard green. Since the examples are the code most likely to be copied, they are the *more* important root for the ambient-trigger check, not the less.

**Fix:** hoist the file set once and reuse it:

```ts
const ALL_ROOTS = () => [...collectFiles(SRC_ROOT, [".ts", ".tsx"]), ...collectFiles(EXAMPLES_ROOT, [".ts", ".tsx"])];
```

and use it in all four checks, keeping the existing `isTestPath` / `AUTH_HANDLER_FILE` exclusions.

## Info

### IN-01: Prettier violations introduced by this phase

**File:** `packages/concord/src/client/community.ts:359`, `:1220`; `packages/concord/src/client/private-channel.ts:186-188`

**Issue:** `npx prettier --check` flags all three files. Two of the diffs are pre-existing repo drift, but three are phase-15 lines: the one-line `new StreamSigners({ onAuthFailure: (message) => { ... } })` at `community.ts:359`, the 130-character `signers.register([channelRekeyGroupKey(...)])` at `community.ts:1220` (printWidth is 120), and the unnecessarily wrapped `connected$` assignment at `private-channel.ts:186-188`.

**Fix:** `pnpm format` (no CI gate exists, so this will otherwise ride into the next unrelated commit's diff).

### IN-02: `auth.ts` derives a pubkey through a different primitive than the rest of the client layer

**File:** `packages/concord/src/client/auth.ts:20-21`, `:69`

**Issue:** `addSecretKey` uses `bytesToHex(schnorr.getPublicKey(secretKey))` while every call site that pairs with it uses `getPublicKey` from `applesauce-core/helpers/keys` (`community.ts:1253` computes `linkPub` that way and then calls `addSecretKey(linkSk)`, discarding the return value). The two agree today, but two derivations of the same value in one flow is a silent-divergence surface.

**Fix:** use `getPublicKey` from `applesauce-core/helpers/keys` and drop the `@noble/curves` import from this module.

### IN-03: The direct-invites example documents the user-handler split in a comment instead of demonstrating it

**File:** `apps/examples/src/examples/concord/direct-invites.tsx:247-249`

**Issue:** The added comment says "a user-authored publish would take the user handler instead … see ConcordClient's community-list publish", but the line below it is still `await pool.publish(relays, signed)` with no options. The stream-key publish two functions down *was* updated to the new shape. Showing the correct shape costs one `createUserAuthHandler(signer, () => pubkey)` and removes the need for the pointer-to-elsewhere comment.

**Fix:** build a user handler alongside `streamSigners` and pass `{ waitForAuth: [signed.pubkey], onAuthRequired: userAuth }`.

### IN-04: The structural guard couples the concord package's suite to `apps/examples` contents

**File:** `packages/concord/src/__tests__/no-ambient-auth.test.ts:28`, `:82`

**Issue:** `packages/concord`'s own test suite now fails if an unrelated edit to `apps/examples/src/examples/concord/*` reintroduces a banned identifier — and would fail outright (`statSync` throw) in any context where the package is tested without the examples app present. This is a deliberate trade recorded in the file header; noting it so the coupling is a known cost rather than a surprise the first time it bites.

**Fix:** none required. If the coupling becomes painful, move the examples half of the sweep into an `apps/examples` test that imports the shared regex list.

---

_Reviewed: 2026-08-15T11:41:26Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
