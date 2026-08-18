---
phase: 15-concord-stream-auth-cleanup
reviewed: 2026-08-18T15:43:44Z
depth: standard
round: 2
diff_base: 9b2b302825f0ec366eb78deabe8d3e65a5169f2a
files_reviewed: 17
files_reviewed_list:
  - packages/concord/src/client/auth.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/sync.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/client/__tests__/auth.test.ts
  - packages/concord/src/client/__tests__/client.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/private-channel.test.ts
  - packages/concord/src/client/__tests__/sync.test.ts
  - packages/concord/src/helpers/__tests__/channel-rekey.test.ts
  - packages/concord/src/helpers/__tests__/keys.test.ts
  - packages/concord/src/__tests__/no-ambient-auth.test.ts
  - apps/examples/src/examples/concord/crypto-history.tsx
  - apps/examples/src/examples/concord/direct-invites.tsx
  - apps/examples/src/examples/concord/rumor-stores.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 15: Code Review Report (Round 2 — gap-closure verification)

**Reviewed:** 2026-08-18T15:43:44Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

`npx tsc --noEmit -p packages/concord/tsconfig.json` is clean, `npx vitest run packages/concord/src` passes (55 files / 594 tests), and `npx prettier --check` on all 17 reviewed files reports "All matched files use Prettier code style" — so IN-01 is genuinely closed, not merely re-asserted.

**All nine round-1 findings are closed or substantially closed. No BLOCKER was found in the new code.** Two closures were verified by mutation rather than by reading: reverting `rotateChannel`'s `this.signers.register([plan.rekeyKey])` back to the old `channelRekeyGroupKey(hexToBytes(this.material.community_root), …)` recomputation makes the new WR-01 test fail (`expected [] to deeply equal [ "0109a05d…" ]`), and deleting `publishToPlane`'s `this.signers.register([key])` makes the new CR-01 assertion fail. Both regression tests have real teeth.

The one substantive negative result: **`heldChannelKeys()` — the change presented as *the* CR-01 fix — contributes nothing.** Replacing both of its call sites back with `publicChannelKeys()` leaves all 66 `community.test.ts` tests green, including the named CR-01 assertion; and deleting only `publishToPlane`'s registration (leaving `heldChannelKeys()` intact) makes that same assertion fail. `heldChannelKeys()` cannot close CR-01 because its `openLive()` call site sits behind a churn guard keyed on `currentAuthors()`, which is public-channel-only. Its net effect is to load every held private-channel stream secret into the community's holder for no operation that needs it — a small step away from the D-06 isolation invariant this phase advertises, with a doc comment that will mislead the next reader into thinking it is load-bearing (WR-09).

### Closure verdicts

| Finding | Verdict | Evidence |
|---|---|---|
| CR-01 (private-channel publish unanswerable) | **Closed** | `publishToPlane` registers `wrapForTarget`'s returned `key`; `wrapForTarget` has exactly one non-test call site, so every plane publish is covered. `buildWrap` always `finalizeEvent(..., streamSk)` (`ephemeralSk` is only the decoy `p` tag), so `wrap.pubkey === key.pk` unconditionally. Mutation-verified. |
| WR-01 (post-await rekey-key recomputation) | **Closed** | `buildChannelRekey`/`buildRefounding` now return `rekeyKey`/`channelRekeyKeys`; both call sites register the plan's own value. Mutation-verified. `rekeyKey` is literally the `rekeyAddr` used in `giftWrap(rekeyAddr.sk, …)` (`keys.ts:387-391`, `:767`). |
| WR-02 (post-walk auth failure never surfaces) | **Closed, with residual** | Latched field deleted; `onAuthFailure` now pushes straight to `error$` in both engines. See WR-10 for the missing clear-on-recovery path. |
| WR-03 (total answering failure is silent) | **Closed** | `failNoSigner` + `:auth` trace, guarded on `Array.isArray && length > 0 && answered === 0`. `Relay.missingPubkeysFor` (`packages/relay/src/relay.ts:792`) is per-operation-requirement, so the "can only mean a registration gap" claim in the doc comment checks out — no cross-scope false positive is reachable. |
| WR-04 (invite manager holder has no failure sink) | **Closed as specified, with residual** | Sink added, field moved into the constructor body, reachability proven by `client.test.ts`. See WR-12 for the risk the finding named but the fix does not address. |
| WR-05 (module-level `StreamSigners` in examples) | **Partially closed** | Fixed correctly in `crypto-history.tsx` and `rumor-stores.tsx` (both `Walker`s remount via `key={community_id:root_epoch}` and take `material` from `useState`, so the memo is stable). **Not fixed in `direct-invites.tsx`** — see WR-11. |
| WR-06 (publish oracle too narrow) | **Closed** | Scenario now drives a private-channel send, `refreshInviteBundles`, and `refound({channelRekeys})`; the vacuity floor is a `distinctAuthors.size >= 10` property, not a comment. |
| WR-07 (`as unknown as SyncAuthHandler` cast) | **Closed** | Cast deleted; `SyncContext.onAuthRequired` narrowed to `SyncAuthHandler`; `StreamSigners.onAuthRequired` typed `RelayAuthHandler & SyncAuthHandler` over the supertype `StreamAuthContext`. The `@ts-expect-error` negative in `sync.test.ts` pins the narrowing. `isOkResponse` is a correct consequence of the widened `authenticate(): Promise<unknown>` — `PublishResponse` always carries a boolean `ok`, and `Relay.authenticate`'s synchronous `throw` on a missing challenge lands inside the handler's existing `try`. |
| WR-08 (guard scanned examples for 1 of 4 checks) | **Closed** | `allFiles()` feeds all four checks; `isTestPath`/`AUTH_HANDLER_FILE` exclusions preserved. |
| IN-01 (Prettier) | **Closed** | `prettier --check` clean across all 17 files. |

### On round-1's IN-01 lesson

Every "introduced by this wave" claim below was checked against `git show 9b2b3028:<path>` or against the wave diff. Where a defect predates the wave (WR-12's swallow-and-report-success), it is labelled as such rather than presented as new.

## Warnings

### WR-09: `heldChannelKeys()` is dead weight that widens the community's secret-key holder and mis-documents itself as the CR-01 fix

**File:** `packages/concord/src/client/community.ts:727-748` (definition), `:780` (`openLive`), `:807` (`reconcileLive`)
**Introduced by:** this wave (commit `25b4a3c7`)

**Issue:**

`heldChannelKeys()` drops `publicChannelKeys()`'s `!c.private` filter, so `openLive()` and `reconcileLive()` now push every held **private**-channel message-plane secret into `ConcordCommunity`'s own `StreamSigners`. Its doc comment states this exists "so a private-channel PUBLISH is answerable (CR-01/CAUTH-01)". It does not do that, and cannot.

Two mutations demonstrate it:

1. Replace both call sites with `publicChannelKeys()` → `npx vitest run packages/concord/src/client/__tests__/community.test.ts` → **66/66 pass**, including the new named CR-01 assertion at `:3757-3765`.
2. Keep `heldChannelKeys()` but delete `publishToPlane`'s `this.signers.register([key])` (`:1645`) → the answerability loop at `:3752` **fails** (`expected [] to deeply equal [ "861c2c8c…" ]`).

So the private-channel send is made answerable exclusively by `publishToPlane`'s per-publish registration; `heldChannelKeys()` had not registered that key by the time the send happened.

The structural reason: `openLive()` computes `const authors = this.currentAuthors()` and returns early when `sig === this.liveAuthors && this.liveSub` (`:775`). `currentAuthors()` (`:750-753`) is core planes + `publicChannelKeys()` — **public only**. Creating a private channel changes neither `authors` nor `targets`, so `sig` is unchanged and `openLive()` returns before reaching `this.signers.register([… this.heldChannelKeys()])`. `reconcileLive()`'s copy (`:807`) is inside `if (fresh.length > 0)`, and `fresh` is likewise filtered by `publicIds` (`:801`). Net: for the exact scenario CR-01 described — a private channel revealed after the first live subscription — neither site ever fires.

Failure scenario (not a crash, a posture regression): user is in a community with 5 private channels present at `start()` time. The first `openLive()` (with `this.liveSub` undefined) does run, loading all 5 channel secrets into the community holder. Those five `PrivateKeySigner`s sit there for the process lifetime (D-07: "intentionally never pruned") while no community-scoped operation ever names them in a `waitForAuth` — the community subscribes only to `currentAuthors()`, and every publish already registers its own key one line earlier. The phase's headline invariant is holder isolation; this is the community holder quietly acquiring the sub-engines' keys for nothing.

**Fix:** delete `heldChannelKeys()` and restore `publicChannelKeys()` at both sites; keep `publishToPlane`'s registration, which is both sufficient and race-proof (it registers the key that actually finalized the wrap, which no `openLive()`-time registration can do). Then pin the real mechanism so it cannot be deleted by a future refactor:

```ts
// community.ts
private publicChannelKeys(): GroupKey[] { /* unchanged */ }
// openLive():
this.signers.register([
  this.keys.control, this.keys.guestbook, this.keys.dissolved,
  this.keys.nextBaseRekey.key, ...this.publicChannelKeys(),
]);
// reconcileLive():
this.signers.register(this.publicChannelKeys());
```

If the eager registration is kept deliberately, its doc comment must stop claiming it closes CR-01 and must state that `openLive()`'s churn guard makes it a best-effort warm-up only.

### WR-10: an auth failure latches into `error$` forever — there is no clear-on-recovery path, and this wave routed far more failures into it

**File:** `packages/concord/src/client/community.ts:361`, `:536-539`; `packages/concord/src/client/private-channel.ts:175`, `:242`
**Introduced by:** this wave (partly — see below)

**Issue:**

`onAuthFailure` now writes directly to `error$` (a `BehaviorSubject<string | null>` that feeds `status$`'s `error` leg, `community.ts:447`). The only writer of `null` is `start()` (`:539`) / `walk()` (`private-channel.ts:242`). `ConcordCommunity.start()` opens with `if (this.started || this.disposed) return;` and `this.started` is never reset (grep: `this.started` appears at `:536`, `:537`, `:608`, `:640` — assigned once, never cleared, and `dispose()` does not reset it). So for a community, once any auth failure lands, `error$` can never return to `null` for the lifetime of the instance.

`StreamSigners.fail()` fires **per (relay, pubkey)** — a single relay refusing is enough.

Failure scenario: community configured with `relays: ["wss://good", "wss://gated"]`, where `wss://gated` requires NIP-42 and rejects our stream-key AUTH (it allowlists human pubkeys, not derived stream keys). Sync and live both succeed via `wss://good`; every message sends fine. But every `publishToPlane` also triggers `wss://gated`'s `auth-required:` → `fail()` → `error$.next("auth failed on wss://gated for stream key 3f2a…: relay rejected the AUTH")`. `status$.error` is now permanently non-null and any UI bound to it shows a standing error banner on a fully working community. Before this wave the same `fail()` existed but was latched into a private field and read once at the end of `start()`; the live-subscription, publish, `reconcileLive` and `checkRekey` paths — i.e. the great majority of AUTH traffic — never reached `error$` at all. The wave therefore materially increased how often this false alarm is reachable, without adding a recovery edge.

**Fix:** make recovery representable. Minimal version — clear on a fully successful answer:

```ts
// auth.ts, end of onAuthRequired
if (answered > 0 && failures === 0) this.options.onAuthSuccess?.();
```

with the engines wiring `onAuthSuccess: () => this.error$.next(null)`. Alternatively track failures per relay URL and only surface when **every** transport relay has rejected (which is the condition that actually degrades the community), leaving a single-relay refusal on the `:auth` trace only.

### WR-11: `direct-invites.tsx` still accumulates multiple communities' stream secrets in one holder — WR-05 is not closed here

**File:** `apps/examples/src/examples/concord/direct-invites.tsx:170`, used only at `:263-264`
**Introduced by:** pre-existing pattern, moved (not fixed) by this wave (commit `d9850e91`)

**Issue:**

The holder moved from module scope to `useMemo(() => new StreamSigners(), [])` inside `ConcordDirectInvites`. The dependency array is empty and the component is the long-lived invite **inbox** — it is never remounted per community (unlike `crypto-history`/`rumor-stores`, whose `Walker`s carry `key={material.community_id + ":" + material.root_epoch}`). Its sole consumer is `publishGuestbookJoin`, which is called once per accepted invite:

```ts
const keys = deriveConcordKeys(material, []);   // community A, then later community B
streamSigners.register([keys.guestbook]);       // both land in the same holder
```

Failure scenario: the user accepts a direct invite for community A, then one for community B without reloading. The holder now maps `guestbook_A.pk → signer_A` and `guestbook_B.pk → signer_B`. That is verbatim the state WR-05 described ("walking a second community accumulates both communities' secret keys in one holder"). The added comment ("the honest scope here is the component instance itself, which is why this lives here rather than at module scope") asserts a scope the code does not have — the holder's only consumer is per-community, not per-component.

Not exploitable (`waitForAuth: [wrap.pubkey]` still narrows every AUTH to one key), but this file is package documentation, and the pattern a reader copies is the one that loses the D-06 guarantee.

**Fix:** the holder's real scope is the single join publish — build it there:

```ts
async function publishGuestbookJoin(bundle: InviteBundle, material: JoinMaterial) {
  // …
  const { wrap, key } = await wrapForTarget(keys, { plane: "guestbook" }, signer, rumor, {});
  const signers = new StreamSigners();       // one join, one scope
  signers.register([key]);                   // the key that finalized `wrap`, not a re-resolution
  await pool.publish(relays, wrap, { waitForAuth: [wrap.pubkey], onAuthRequired: signers.onAuthRequired });
}
```

This also demonstrates `wrapForTarget`'s new `key` return, which the in-package fix relies on and no example currently shows.

### WR-12: `revoke()` reports success when the AUTH-gated bundle revocation never lands — WR-04's sink does not address the risk WR-04 named

**File:** `packages/concord/src/client/invite-manager.ts:288-298`; mirrored at `packages/concord/src/client/community.ts:1380-1385`
**Introduced by:** pre-existing (the `.catch` predates `9b2b3028`) — reported because it is the live residual of WR-04, not because this wave created it

**Issue:**

WR-04 was filed on the grounds that "revocation is the one operation whose silent failure has a security consequence (a link the user believes is dead stays live)". The landed fix adds `onAuthFailure: (message) => this.log("invite-link auth failed: %s", message)` — a `debug` namespace that is silent unless `DEBUG=applesauce:concord:invite` is set. The control flow is unchanged:

```ts
await this.pool.publish(this.transport(base), signed, { waitForAuth: [signed.pubkey], onAuthRequired: this.signers.onAuthRequired })
  .catch((err) => { this.log(...); console.warn(...); });
return { ...invite, revoked: true };   // unconditional
```

Failure scenario: the link's bootstrap relay gates writes and refuses our AUTH. `publish` rejects with `AuthTimeoutError` after 30s, `.catch` swallows it, `revokeBundle` returns `revoked: true`, `revoke()` tombstones the invite and `this.get(revoked.token)` reports it revoked. The UI marks the link dead. The kind-33301 bundle is still live on that relay, so the URL still opens and still hands out `community_root`.

**Fix:** distinguish "we published a revocation" from "we forgot about it locally". Return the publish outcome and let `revoke()` decide:

```ts
const acks = await this.pool.publish(...).catch((err) => { this.log(...); return [] as PublishResponse[]; });
const landed = acks.some((r) => r.ok);
if (!landed) throw new Error("could not revoke the invite bundle — the link may still be live");
```

At minimum, surface a non-debug signal (a `revokeFailed$`, or a `console.warn` that names the consequence rather than the transport error) so the caller can tell the user the link may still resolve.

## Info

### IN-05: the examples use `useMemo` for a value whose identity must be stable

**File:** `apps/examples/src/examples/concord/crypto-history.tsx:430`, `apps/examples/src/examples/concord/rumor-stores.tsx:347`

**Issue:** `useMemo` is documented as a performance hint — React reserves the right to discard a cached value and recompute. Here the cached value is the identity of a secret-key registry that a multi-step walk registers into across several `await`s (`loadEpoch` registers core planes at step 1 and channel keys at step 3). A discarded memo mid-walk hands step 3 an empty holder, so a relay that gates the channel-plane fetch would go unanswered and `fetchWraps`' `takeUntil(timer(10_000))` would silently return `[]`. Not observed in React 18/19, but `useRef` is the primitive that actually promises stable identity, and both `Walker`s already remount on community change via `key`, so the memo's dependency array is doing no work.

**Fix:** `const signersRef = useRef<StreamSigners>(); signersRef.current ??= new StreamSigners();` — or keep `useMemo` and drop the now-redundant `[material]` dep in favour of a comment pointing at the `key` prop.

### IN-06: `no-ambient-auth.test.ts` re-walks both source trees six times per run

**File:** `packages/concord/src/__tests__/no-ambient-auth.test.ts:51-54`

**Issue:** `allFiles()` is a function, so each of the four checks re-runs the recursive `readdirSync`/`statSync` walk over `packages/concord/src` (>50 files) and the examples dir; the anti-vacuity check walks both again. Making it a `const` costs nothing and removes five redundant traversals.

**Fix:** `const ALL_FILES = [...collectFiles(SRC_ROOT, [".ts", ".tsx"]), ...collectFiles(EXAMPLES_ROOT, [".ts", ".tsx"])];` at module scope, referenced by all four checks. (IN-04's coupling caveat from round 1 still stands and still needs no action.)

### IN-07: `failNoSigner`'s message is internal jargon on a user-facing surface

**File:** `packages/concord/src/client/auth.ts:149-152`

**Issue:** `"no signer held for any of the 1 pubkey(s) the relay asked about on wss://… — this scope's onAuthRequired answered none of them"` now flows into `ConcordCommunity.error$` and out through `status$.error`, which is the string an app renders. It names an internal method, uses `pubkey(s)`, and is unactionable for an end user. The `:auth` trace line beside it already carries the same information for developers.

**Fix:** keep the diagnostic detail on the `authLog` line and give `onAuthFailure` a short, app-renderable form, e.g. `` `relay ${url} requires authentication for keys this session does not hold` ``.

---

_Reviewed: 2026-08-18T15:43:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Round: 2 (diff base `9b2b3028`) — round 1 report preserved at `15-REVIEW-round1.md`_
