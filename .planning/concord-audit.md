# Concord Protocol Conformance Audit

**Audited:** 2026-07-15
**Scope:** `packages/concord/src/` against the CORD-01..07 specs at https://github.com/concord-protocol/concord (branch `master`), plus `examples.md`.
**Method:** Seven parallel agents, one per spec document, each diffing spec against implementation. Findings marked **VERIFIED** were independently re-confirmed by the orchestrator by reading both sides and/or reproducing at runtime; findings marked **REPORTED** are agent-confirmed but not yet orchestrator-verified.

This document is the authoritative input for milestone **v1.1 first-fixes**.

---

## Why this audit happened

A downstream app showed an incomplete member list after a Refounding. Root cause: `buildInviteBundle` assembled the §1 invite bundle field-by-field from a `JoinMaterial` instead of spreading it, silently dropping the optional `refounder` field. Because `InviteBundle extends JoinMaterial` and `refounder?: string` is optional, TypeScript never complained. Downstream, `foldMembers` gates kind-3312 snapshot processing on `refounder !== undefined`, so invited joiners silently discarded the memberlist snapshot. Nothing threw; no test failed.

**That bug is FIXED** (`helpers/invite-bundle.ts:193` carries `refounder`; `validateInviteBundle:227` type-guards it; two regression tests in `helpers/__tests__/direct-invite.test.ts`). The audit was commissioned on the premise that a defect that nuanced was unlikely to be alone. It was not.

## The recurring defect shape

Nearly every finding below is one of four variants of the same mistake:

1. **A guard that defaults to permit.** `!held.canRemoveSelf || held.canRemoveSelf(r)` — absent guard means allow.
2. **A hand-rolled object literal** that re-enumerates fields instead of spreading, dropping optional ones.
3. **The correct helper exists and is not called.** `splitTime`, `store.replaceable`, `canRemoveSelf`, `grantLocator` all exist and are bypassed at the call site that matters.
4. **A `catch`/`continue` that silently degrades** where the spec says something MUST happen or MUST abort.

**Why 189 tests stayed green:** every test compares the implementation against itself. Nothing asserts against an independently-derived spec value. A four-line probe that derived the expected address from the spec formula and compared caught H01 instantly.

---

## HIGH severity

### CONCORD-H01 — Cached derivations survive object spread: Refoundings and channel Rekeys do not rotate
- **Status:** VERIFIED (both instances reproduced at runtime against production code)
- **Spec:** CORD-02 §4 — "Rotating the epoch rotates the `pk`, keeping a plane's traffic unlinkable across epochs." CORD-03 §1/§9 — a private channel's key is "rekeyed on removal".
- **Code:** Root cause `packages/core/src/helpers/cache.ts:15` (`Reflect.set` → enumerable symbol prop). **Three memo sites, all on objects that are later spread:**
  - `keys.ts:105` `BaseKeysSymbol` on `material` — spread by `rollForward` (`:249-255`) and `buildChain` (`client/sync.ts:239-247`)
  - `keys.ts:106` `ChannelKeysSymbol` on `material` — same two spread sites
  - `keys.ts:109` `ChannelPlaneKeysSymbol` on a `ChannelKey` — spread by `rollForwardChannel` (`:508-515`)
- **What's wrong:** `baseKeysFor` memoizes derived keys onto the `material` object via `getOrComputeCachedValue`, which stores with `Reflect.set` — an **enumerable** own symbol property. Object spread copies enumerable symbol properties. `rollForward` builds new material with `{ ...keys.material, community_root: newRoot, root_epoch: newEpoch }`, carrying the previous epoch's cache forward; `baseKeysFor` then returns the **old** keys instead of re-deriving. The comment at `keys.ts:102` reasons that symbol props are skipped by `JSON.stringify` (true, and why persistence is safe) — spread was never considered, and spread is how both `rollForward` and `buildChain` mint material.
- **Proof:**
  ```
  epoch-4 control pk : 54531e5b816297195fbadf1690dde387c44b2db5399dad51606d5d62e4b99a48
  epoch-5 control pk : 54531e5b816297195fbadf1690dde387c44b2db5399dad51606d5d62e4b99a48  <- rollForward
  epoch-5 EXPECTED   : 69b8b950a2ecc23684fa4fbf43400c834943e1093ff7a0fa2ae86d75d1208b35  <- spec-derived
  symbol carried by spread? [ 'Symbol(concord-base-keys)' ]
  ```
  And the same for a channel Rekey — a rolled-forward channel with a brand-new key at a new epoch:
  ```
  epoch-1 plane pk : e695402fb6a1f1318d86863346c95009a3b62bd71279a66bc65a572ca897f325
  epoch-2 plane pk : e695402fb6a1f1318d86863346c95009a3b62bd71279a66bc65a572ca897f325  <- deriveChannelKeys
  epoch-2 EXPECTED : 78fa2e873e1e0614c01765a9d6be36ac8cc50aa420e444f81e1552f26b9aa8b2  <- spec-derived
  symbols on rolled object: [ 'Symbol(concord-channel-plane-keys)' ]
  ```
- **Symptom:** Three independent catastrophic behaviors. (a) **Refounding is cryptographically a no-op in-session** — `buildRefounding` publishes to correct new-epoch addresses (it calls `controlGroupKey`/`guestbookGroupKey` directly at `keys.ts:343`/`:355`), but the state everyone *adopts* stays on the old root at the old addresses. A removed member still holding the old root keeps reading Control and Guestbook traffic. Self-heals on restart (material re-parsed from JSON drops the symbol), which is why it never surfaced as a bug report. (b) **The epoch walk collapses** — all per-epoch materials resolve to one address, so history is never fetched. (c) **A channel Rekey does not rotate the message plane** — a rolled-forward `ChannelKey` still derives the prior epoch's address, so the rotated-out member's key still opens the traffic.
- **The reasoning error is identical at all three sites.** `keys.ts:100-103` argues the cache is safe because "symbol-keyed props are skipped by `JSON.stringify`" — true, and why persistence is safe and why restart heals it. `keys.ts:543-546` argues `channel` is "replaced only when it rolls forward — so memoize on it". Both assume a *new object means a fresh cache*; both are defeated because the replacement is performed **by spread**, and spread copies enumerable own **symbol** properties. `JSON.stringify` and spread treat symbols in exactly opposite ways, and that asymmetry is the entire bug.
- **Fix (decision pending):** Either make `setCachedValue`/`getOrComputeCachedValue` write with `Object.defineProperty(…, { enumerable: false, writable: true, configurable: true })` in `applesauce-core` (correct; fixes all three sites at once; the *only* behavior change is that spread/`Object.assign` no longer copy the cache — `JSON.stringify`, `Object.keys`, and `Reflect.get` are unaffected either way), or strip symbols locally after every spread in concord (contained; leaves the trap armed for the next caller). Add tests asserting `rollForward(...).control.pk === controlGroupKey(newRoot, cid, newEpoch).pk` and the `rollForwardChannel` analog.
- **Blast-radius note for the central fix:** 101 call sites across 42 files, but ~all cache onto a **`NostrEvent`**, which is signed and immutable — spreading one invalidates its `id`/`sig`, so nobody does. The at-risk pattern is caching onto a *mutable config object that is later spread*, and concord's `material`/`ChannelKey` are the only instances found.
- **Central fix PROVEN SAFE against the encrypted-content carry-forward (2026-07-15).** The obvious hazard: `core/operations/tags.ts:87` does `return { ...draft, content, [EncryptedContentSymbol]: plaintext }` with the comment *"add the plaintext content on the draft so it can be carried forward"* — a **deliberate** reliance on an enumerable symbol surviving every downstream spread through the factory pipe and into the signed event. Making that non-enumerable would break `getEncryptedContent`/`getHiddenTags` on every encrypted event. **It does not, because none of the three plaintext write-sites go through `cache.ts`:** `operations/tags.ts:87` (object literal), `helpers/encrypted-content.ts:117` `setEncryptedContentCache` (own `Reflect.set`), `common/operations/gift-wrap.ts:121` (direct `Reflect.set`). Verified empirically: with the `defineProperty` change applied, a probe proved plaintext survives encrypt-op → 2 spread ops → signing (with `getHiddenTags(signed)` intact) while a `cache.ts` memo is correctly dropped by spread; full monorepo suite **1989 tests, exit 0**.
- **⚠ Two conventions, opposite semantics — must be documented in the fix.** `cache.ts` symbols are **identity memos** (a derivation of the object's own fields; a copy with changed fields MUST recompute ⇒ non-enumerable). `EncryptedContentSymbol` is a **carry-forward payload** (MUST survive derivation ⇒ enumerable). Today the plaintext sites are safe only by *accident* — nothing documents why those `Reflect.set` calls are hand-rolled rather than using the shared helper, and they look exactly like code a future cleanup would "tidy up" onto `setCachedValue`, silently breaking plaintext carry-forward package-wide. **Phase 5 must land a comment on `defineCachedValue` naming this distinction**, and ideally a regression test asserting both halves.
- **Blocks:** H02 is masked by this bug and activates when it is fixed. Must land together.
- **Interacts with H08:** H08 (stale channel key after Rekey) has **two independent root causes** — the `state$.value.channels` threading *and* instance (c) above. Fixing either alone leaves the channel on the old plane. The CORD-06 agent marked `rollForwardChannel` "verified correct" (it checked for *dropped* fields and did not consider what the spread *added*) — a false negative, and a caution that the "verified correct" register below is not infallible.

### CONCORD-H02 — Guestbook and observed authors folded across ALL epochs: a Refounding never removes anyone
- **Status:** REPORTED
- **Spec:** CORD-02 §5 — "the refounder coalesces the old epoch's Guestbook, subtracts the removed, and publishes the survivors into the new epoch as **snapshot** entries." / "A snapshot lists *present members only* (absence means "no seed", never a negative state)."
- **Code:** `client/sync.ts:252-254` (`planeStoreKey`), `helpers/keys.ts:162` (`planes = new Map(prior?.planes)`), `:164` (guestbook `PlaneInfo` carries no `epoch`, unlike channel `:168`/rekey `:166`), `client/community.ts:442`, `models/community.ts:33-40`.
- **What's wrong:** The new epoch's Guestbook must start empty and be re-seeded *only* by the snapshot — that is the sole mechanism that drops removed members. But `deriveConcordKeys` retains every prior epoch's guestbook address in `planes`, and `planeStoreKey` maps all of them to the single `"guestbook"` store key. The guestbook `PlaneInfo` records no epoch, so the epoch is unrecoverable after routing. `observed` is worse: `models/community.ts:37` merges control + guestbook + every channel store, all epoch-merged, so prior-epoch activity marks an author present in the current epoch.
- **Symptom:** A member removed by a Refounding whose only trace is a prior-epoch Join (or chat message via `observed`) is still returned in `members` — the snapshot omitting them "is not a negative state" (`guestbook.ts:99` only sets `present: true`; `:114`'s `!c` admits any observed author with no state). A UI lists ejected members. Worse: an app passing `state.members` as the `keep` list to the next `refound()` **re-admits them with a fresh rekey blob**.
- **Fix:** Key the guestbook (and channel) store per epoch, or stamp `epoch` into the guestbook `PlaneInfo` and have `foldMembers` consider only current-epoch entries and observations.
- **Depends on:** H01 (currently masked by it).

### CONCORD-H03 — Root Refounding honors removal from a rotator who does not outrank the target
- **Status:** VERIFIED (found independently by the CORD-04 and CORD-06 agents)
- **Spec:** CORD-06 §3 — "A single-channel Rekey requires `MANAGE_CHANNELS`, a Refounding requires `BAN`, and **in both the Rotator must strictly outrank every removed target** (CORD-04)." CORD-04 §2 — the owner "is supreme and unremovable".
- **Code:** Receive: `helpers/keys.ts:389-400` (`readRekey` builds `ScopedHeld` with no `canRemoveSelf`), consumed at `:489`, declared optional at `:437`. Send: `client/community.ts:1072`. Authority predicate: `helpers/permissions.ts:75-80`.
- **What's wrong:** Two halves of one hole. (a) `readRekeyScoped` gates removal on `held.canRemoveSelf`, but the **root** path omits it, so `:489`'s `!held.canRemoveSelf ||` short-circuits to `true` — the guard **defaults to permit**. `refoundAuthority` is only `rotator === owner || hasPerm(BAN)`, a bare bit check with **no rank comparison anywhere**. (b) `refound()` checks only `refoundAuthority(this.pubkey)` and never checks that the caller outranks each `opts.exclude` target — while the sibling `rotateChannel()` does exactly that at `community.ts:888-891`. The channel path threads the guard correctly on both sides (`keys.ts:635`, `community.ts:597-598`); the root path does neither. The docstring at `keys.ts:435` states the omission as intent — CORD-06 §3 says "in both", so the intent is itself the defect.
- **Symptom:** Any member holding only `BAN` publishes a Refounding excluding the owner or a higher-ranked admin, and every honest client — including the victim's — honors it: `handleRemoved()` → `phase$ = "removed"` → `dispose()` → community tombstoned out of their list. Subordinate evicts superior. Nothing throws at either end.
- **Fix:** Thread a `canRemoveSelf` predicate into `readRekey`'s `ScopedHeld` requiring the rotator to strictly outrank us; drop the `!held.canRemoveSelf ||` default-allow so an unsupplied guard **denies**. Add the per-target outrank loop to `refound()`, mirroring `rotateChannel`.

### CONCORD-H04 — `created_at` rounds while the `ms` tag floors: ~50% of all events carry +1000ms skew
- **Status:** VERIFIED (reproduced)
- **Spec:** CORD-01 §Encoding — "`created_at` is unix seconds, untweaked. Sub-second ordering rides a tag." CORD-02 §4 — "the true time is `created_at * 1000 + ms`. Every comparison in the protocol — message order, Guestbook recency (§5), Community List tiebreaks (§8) — uses this basis."
- **Code:** `helpers/keys.ts:212` (`created_at: unixNow()`, where `unixNow = Math.round(Date.now()/1000)` in `packages/core/src/helpers/time.ts:2-4`) paired with `operations/channel.ts:23` (`String(ms % 1000)`, a floor remainder). Also `operations/guestbook.ts:46`, `operations/rekey.ts:33`, and every factory via `blankEventTemplate`.
- **What's wrong:** The remainder is counted twice. When the sub-second remainder is ≥500, `Math.round` carries `created_at` up to the next second while the `ms` tag still holds that same remainder, so `rumorMs`'s `created_at * 1000 + ms` lands 1000ms in the future. `splitTime` (`helpers/stream.ts:16`) is the correct coherent pairing (`Math.floor(nowMs/1000)` + `nowMs % 1000` from one clock read) and is **dead code — zero call sites in the monorepo**. Secondary hole on the same line: `includeMs` reads the clock at `community.ts:717` and `wrapForTarget` reads it again at `keys.ts:212`, so even with `Math.floor` the two reads can straddle a second boundary (widens materially with a NIP-46 remote signer).
- **Proof:**
  ```
  sent 1700000000700 -> created_at=1700000001 ms=700 composite=1700000001700 skew=+1000ms
  sent 1700000000400 -> created_at=1700000000 ms=400 composite=1700000000400 skew=0ms
  sent 1700000001400 -> created_at=1700000001 ms=400 composite=1700000001400 skew=0ms
  ```
  Rows 1 and 3: an event sent at `…000700` sorts **after** one sent 700ms later at `…001400`.
- **Symptom:** ~50% of events skewed, ~50% correct — the *inconsistency* is what reorders timelines. Hits every plane (chat, guestbook, kicks, snapshots, rekeys, control editions). Also produces wrong winners in the Guestbook latest-wins coalesce. `foldMembers`' anti-squat guard (`ms > nowMs + ONE_HOUR_MS`) is 3600× too coarse to catch it.
- **Fix:** Call `splitTime()` once per event and thread its `{created_at, ms}` pair into both the rumor stamp and the `ms` tag.

### CONCORD-H05 — Revoked invite links stay joinable
- **Status:** VERIFIED
- **Spec:** CORD-05 §2 — "the coordinate is re-posted as a **revocation tombstone** … so a fetcher finds the grave instead of keys. Unlike a relay deletion (best-effort, ignorable), the tombstone is exactly as durable as the bundle it replaced."
- **Code:** `client/client.ts:419-429`.
- **What's wrong:** The pipeline is `pool.request(...).pipe(mapEventsToTimeline())`. `mapEventsToTimeline` (`packages/core/src/observable/map-events-to-timeline.ts:10-19`) delegates to `insertEventIntoDescendingList`, which dedupes by event `id` only and performs **no addressable-replacement collapse** — so `events` is the raw multi-relay union. The code then *filters tombstones out* (`:427`) and picks the newest of what remains, inverting the replacement rule: a `vsk 9` tombstone can only win when it is the **sole** event returned.
- **Symptom:** Creator revokes a link; relay A has the tombstone, relay B was offline and still serves the old `vsk 6` bundle. The link-holder joins a revoked community with live keys. No attacker, no non-compliant relay — one lagging relay suffices. Strictly weaker than the relay deletion the spec contrasts it against.
- **Fix:** Resolve the coordinate first (newest at `(33301, link_signer, "")`, ties → lowest id per NIP-01), *then* reject if `isInviteBundleRevoked(newest)`. Add `"#d": [""]` to the filter. Note `ConcordInviteList.bundles$` already does this correctly via `store.replaceable(...)` — the right pattern exists and this path doesn't use it.
- **Adjacent hardening (same fix):** `getInviteBundleVsk` (`helpers/invite-bundle.ts:250-253`) defaults a missing `vsk` to live, and `Number("junk") → NaN !== 9 → live`.

### CONCORD-H06 — Control fold trusts edition JSON for channel key material
- **Status:** VERIFIED
- **Spec:** CORD-03 §2 — the edition's content is `{ "name": "general", "private": false }` plus the client-extensible `custom` object; §1 — a Private Channel's key is "an *independent* random secret, delivered on grant".
- **Code:** `helpers/control.ts:224` (`JSON.parse(cand.content) as ChannelMetadata`), key merge at `:227-231`.
- **What's wrong:** The fold blind-casts edition JSON into `ChannelMetadata`, then only **conditionally** overwrites `key`/`epoch` (`if (known)`). `key`/`epoch` are explicitly "client-tracked keying … not part of the edition" (`types.ts:123`), but nothing strips them from the wire. When we hold no key — the exact case for a private channel we weren't granted — the **edition-supplied `key` survives** and `deriveConcordKeys` addresses the channel plane with it. No field allowlist; no type validation on `name`/`private` either.
- **Symptom:** Any `MANAGE_CHANNELS` holder publishes `{"name":"x","private":true,"key":"<hex>","epoch":7}` and every client derives a "private" channel from a key sitting in cleartext on the Control Plane, which every member reads. Renders with a lock icon; key is community-wide. Latent footgun: `custom` is client-extensible, so an app writing `custom.key` is one refactor from the same hole.
- **Fix:** Pick fields explicitly off the parsed edition (`name`, `private`, `deleted`, `custom`), validate their types, and take `key`/`epoch` **only** from `material.channels`.

### CONCORD-H07 — A private channel we hold no key for silently derives the PUBLIC address
- **Status:** VERIFIED + **FIELD-CONFIRMED by an upstream bug report** (Accordian, 2026-07-15). Severity conflict **RESOLVED → HIGH** (the CORD-07 agent's LOW ruling — "bogus address nobody publishes to" — is refuted by field evidence of a live composer).
- **⚠ Has a blocked downstream consumer.** Accordian's dev-only private-channel debug modal observed the exact state: channel private, user has no key in `material.channels`, folded metadata carries no `channel.key`, the invite button correctly disabled (the app checks `material.channels` itself), **but the composer/send path still enabled and able to send**. Their conclusion — "key possession and write capability are inconsistent" — is correct.
- **Upstream repro reproduced verbatim** (`deriveConcordKeys(material_with_no_channels, [{channel_id, name:"secret", private:true}])`):
  ```
  keys.channels entry exists?          true
  derived pk                           869bb661379949dd461b1b8c743c6aaf1a2deebd9fdaab7487e45222459f430f
  community_root/public formula pk     869bb661379949dd461b1b8c743c6aaf1a2deebd9fdaab7487e45222459f430f
  => derived from community_root?      true
  planeKeyFor threw 'unknown channel'? false  | resolved plane pk: 869bb661…
  ```
  Byte-identical to the public formula, and `planeKeyFor` (`keys.ts:188-192`) — the only guard on the send path — does **not** throw, because `deriveConcordKeys` supplied an entry for it to find.
- **Additional detail not in the original finding:** `keys.channelEpochs` records `ch.epoch ?? 1` = `1` for the channel while the key was derived at `root_epoch`, so CORD-03 §3's mandated receiver check (`checkChatBinding`) validates against an epoch that does not match the key that opened the wrap. **The fix must correct `channelEpochs`, not just `channelKeys`.**
- **Acceptance criteria (from the upstream report — adopt verbatim):** for `channel.private === true && !channel.key` the package must (1) not derive a channel `GroupKey`, (2) not add a `keys.channels` entry, (3) not register/subscribe/publish its channel plane, (4) reject sends with a clear error (e.g. `missing private channel key`, distinct from `unknown channel`). Public channels keep deriving from `community_root`; keyed private channels keep deriving from their own key.
- **Required tests (from the upstream report):** (1) `deriveConcordKeys` derives no key for keyless private metadata; (2) still derives public keys from `community_root`; (3) still derives private keys when `channel.key` is present; (4) `sendMessage`/`sendEvent` to a keyless private channel rejects; (5) the direct-invite/private-channel grant flow still works once key material is received and folded.
- **API gap this exposes:** Accordian had to hand-roll a `material.channels` lookup to distinguish *metadata visible* from *key held*, because the package exposes no affordance for it. Consider surfacing that distinction (e.g. an `accessible`/`hasKey` signal on folded channel state) rather than making every consumer reimplement it.
- **Spec:** CORD-03 §1 — "Public `channel_pk = group_key("concord/channel", community_root, channel_id, root_epoch).pk` / Private `channel_pk = group_key("concord/channel", channel_key, channel_id, channel_epoch).pk`".
- **Code:** `helpers/community.ts:33-38` (`if (channel.private && channel.key)` → else falls through to the community_root branch), with `helpers/keys.ts:159`.
- **What's wrong:** The guard requires *both* `private` **and** `key`. A private channel we hold no key for (routine — it is in the folded channel set from vsk 2 regardless of key possession, and `deriveConcordKeys:157-161` iterates all of them) therefore derives the **public** address. The optional `key` being absent silently downgrades the channel's whole security model instead of failing. Compounded at `keys.ts:159`: `channelEpochs` records `ch.epoch ?? 1` while the key was derived at `root_epoch`, so the two disagree and CORD-03 §3's mandated receiver check validates the wrong number.
- **Symptom:** `sendMessage(id, …)` on a private channel you were never granted **succeeds** (`planeKeyFor` finds an entry, so no throw) and publishes to a plane every community member can derive — private content, broadcast. `voiceKeysFor` is exported public API and returns a confident, wrong room name derived from `community_root`.
- **Fix:** Make the private branch total — `if (channel.private) { if (!channel.key) throw …; return {secret: channel.key, epoch: channel.epoch ?? 1}; }` — so a keyless private channel is absent from `keys.channels` rather than aliased onto the public plane.

### CONCORD-H08 — Private-channel key goes stale after a Rekey
- **Status:** VERIFIED
- **Spec:** CORD-03 §1 / §9 — "Its key is an *independent* random secret, delivered on grant and rekeyed on removal (CORD-06)."
- **Code:** `client/community.ts:609` (`persistChannelKey`), also `:577` (`receiveChannelKeys`), `:630` (`dropChannelKey`); reading `helpers/keys.ts:130-139`, `:157-160`; fed by `helpers/control.ts:227-231`.
- **What's wrong:** `deriveConcordKeys` takes the channel secret from the **`ChannelMetadata`** argument (`:157-158` → `channelKeyMemo` → `channelSecret` reads `channel.key`/`channel.epoch`), **not** from `material.channels`. Those metadata objects get their `key`/`epoch` merged in by `foldControl` from the material captured when `ConcordControlModel(material)` was constructed. `persistChannelKey` updates `material.channels` and re-derives — but passes `this.state$.value.channels`, whose `key`/`epoch` are still pre-rekey, and never calls `rewireState()`. So after a channel Rekey, `keys.channels` and `channelEpochOf` stay pinned to the **old key at the old epoch** for the rest of the session.
- **Symptom:** After `rotateChannel(id, {keep, exclude})`, the rotator's own `sendMessage` wraps to the **epoch-1** plane and binds `["epoch","1"]`. Members who adopted epoch 2 never see it; the **excluded member still holds the epoch-1 key and reads it**. The sender sees their own text via the optimistic echo, so the UI looks healthy. Recovers only on reload or a Refounding.
- **Fix:** Derive the channel secret from `material.channels` (the source of truth) rather than the folded `ChannelMetadata`. This **subsumes H06 and H07** — `ChannelMetadata.key`/`.epoch` should not exist. (Breaking change.)
- **⚠ Two root causes — both must be fixed.** The threading above is only half. `deriveChannelKeys` also memoizes plane keys onto the `ChannelKey` object (`keys.ts:547`), and `rollForwardChannel` replaces that object *by spread*, carrying the stale memo — see **H01 instance (c)**, reproduced at runtime. Fixing the threading alone still leaves a rekeyed channel deriving its **old** plane address. Any plan that treats H08 as a pure-threading fix is incomplete.

### CONCORD-H09 — A transient signer error during blob decrypt is treated as removal
- **Status:** REPORTED
- **Spec:** CORD-06 §2 — "Only once you hold **all `n` chunks** and none contains your locator have you been removed. A missing chunk is never a removal — the client refetches until the set is complete before concluding anything."
- **Code:** `helpers/keys.ts:477-489`.
- **What's wrong:** The decrypt is wrapped in `try { … adoptedHere = true } catch { /* treat as absent */ }`, and `:489` then sets `removed = true`. But the spec defines removal as your locator being **absent from a complete set** — positive evidence. A locator that is *present but whose decrypt threw* is not absence. `signer.nip44.decrypt` is a **network call** for a NIP-46 bunker — the exact account type CORD-06 §1 designs the locator scheme for. A bunker timeout, a rejected approval prompt, or a dropped WebSocket is laundered into "removed".
- **Symptom:** A bunker user whose signer blips as a routine Refounding lands is **permanently evicted** from a community they were never removed from. No error, no retry — `rekeyHandled` (`community.ts:670`) has recorded the epoch and the engine is disposed.
- **Fix:** Distinguish decrypt *failure* from locator *absence*: on a caught decrypt error return `{ kind: "none" }` (retry later) rather than falling through to removal.

---

## MEDIUM severity

| ID | Finding | Status | Code |
|----|---------|--------|------|
| **M01** | **No same-epoch down-only heal** — racing rotations permanently fork the community. Convergence happens only *within* one `readRekeyScoped` call; once epoch N+1 is adopted the filter (`newEpoch === heldEpoch + 1n`) makes the lower sibling unmatchable forever, `rekeyHandled` blocks a second outcome, and `syncEpochs` marks non-tip epochs `"known"` and never re-reads their rekey plane. The losing Refounder adopts its own root unconditionally (`community.ts:1107-1108`). Two client groups derive different addresses and silently stop seeing each other. Spec: CORD-06 §3 — "the same-epoch heal is **down-only**". | REPORTED | `keys.ts:463`, `community.ts:670-671,1107-1108`, `sync.ts:208,216` |
| **M02** | **Rotation winner computed only among rotations that included us**, not among all authorized candidates — violating "every client computes the same winner". A member present only in the losing (higher-key) rotation adopts a dead root and is silently orphaned. | REPORTED | `keys.ts:472-492` |
| **M03** | **Rotations carry no `vac` grant citation and none is verified.** Spec: "a rotation cites the Grant it acts under like any authority action (CORD-04's `vac`), so a just-demoted admin's rotation is never honored by a lagging client." The repo knows the pattern (`includeKickTarget` threads a `vac`); the rekey path omits it. Composes with M01 into a stuck rogue root. | REPORTED | `operations/rekey.ts:27-34`, `helpers/rekey.ts:139-184`, `keys.ts:464` |
| **M04** | **Compaction/snapshot publish without confirmed publication of the root roll.** Each rekey publish `.catch()`es into a `console.warn`, so the loop resolves identically whether every relay accepted or rejected; `adoptRefounding` runs unconditionally. Refounder can roll forward alone onto an epoch nobody can discover. Spec: "only after confirmed publication of the root roll." | REPORTED | `community.ts:1098-1108` |
| **M05** | **Grant editions folded without verifying their coordinate.** `grantLocator` exists (`crypto.ts:184`) and is used on the write path (`admin.ts:135,251`) but **never on the read path**. The banlist beside it validates its coordinate and its comment states the exact rationale ("clients would disagree"); grants skip it. Two eids claiming the same `member` both write `grants[X]`, last-arrival wins → delivery-order-dependent roster. | REPORTED | `control.ts:174,194` |
| **M06** | **Unvalidated `role_ids` in the Grant fold throws an uncaught `TypeError`**, killing the entire `foldControl` — not a degraded roster but a hard failure for every member. The `try/catch` covers only `JSON.parse`. | REPORTED | `control.ts:183-193` |
| **M07** | **`validateInviteBundle` never checks `channels`/`relays` are arrays**, so the §1 MUST-bound is skipped on attacker input: `channels: {a:1}` bypasses the 256 ceiling; `relays: "wss://evil…"` emerges as the 5-char string `"wss:/"` typed as `string[]` and reaches `JoinMaterial`. Same class as the fixed `refounder` bug. | REPORTED | `helpers/invite-bundle.ts:223-228` |
| **M08** | **`refreshInviteBundles` aborts the whole loop on one un-refreshable link** (unguarded `buildInviteBundle` throw), so every link *after* it silently keeps serving the pre-Refounding bundle behind an unchanged URL. Docstring claims "best-effort per link". Sole caller fire-and-forgets. | REPORTED | `community.ts:974-989`, `invite-bundle.ts:175`, `client.ts:588` |
| **M09** | **Invite List `expires_at` written in ms where the wire field is seconds** — the adjacent `created_at` in the same object is seconds. Cross-client interop only; no local symptom. *Caveat: CORD-05 §4 never annotates the unit; inferred from the 10-digit example. Verify before acting.* | REPORTED | `invite-manager.ts:47,289`, `types.ts:208`, `community.ts:955-956` |
| **M10** | **Snapshot chunks do not share one timestamp.** The shared `ms` reaches only the tag; each chunk's `created_at` comes from its own `unixNow()` at resolve time. An explicitly-passed `ms` never reaches `created_at` at all. Spec: "all chunks sharing one snapshot id and **one timestamp**." | REPORTED | `factories/guestbook.ts:95-105`, `operations/guestbook.ts:45-48`, core `factories/event.ts:25` |
| **M11** | **`rumorMs` and `hasMalformedMs` parse the same tag with disagreeing parsers** (`parseInt` vs `Number`): `"42abc"` orders as 42 but is dropped by the membership fold; `"0x10"` is accepted by the fold but orders at 0. Two clients can disagree on the member list. Latent — honest clients emit well-formed tags. | REPORTED | `helpers/stream.ts:23` vs `:38` |
| **M12** | **50-membership cap on the Community List not enforced.** The byte cap (the explicit MUST) *is* implemented and called; the "protocol constant, **not client taste**" 50-entry cap is simply absent. | REPORTED | `client.ts:758` |
| **M13** | **`voice?: boolean` channel flag contradicts the spec's central premise.** CORD-07 §1 and CORD-03 §2 both state "Every Channel is callable — there is no separate voice Channel type" / "**so there is no per-Channel voice flag**". The type's doc comment cites, as its authority, the exact sentence that abolishes the concept. Write-only API surface: nothing in `src/` reads it. An app gating its call button on `channel.voice` shows no button on any channel from a compliant client. **Breaking change to remove.** | REPORTED | `types.ts:120-121`, `admin.ts:54-55,187` |
| **M14** | **Kind 23313 voice presence is decrypted, validated, then silently discarded** by an unconditional `return` in the single receive funnel, with no alternative surface — an app cannot implement CORD-07 §4 at all. Contrast kind 23311 (typing), which is *not* dropped. Send direction works, so the SDK can emit presence it can never receive. Recorded as a known deferral in `roundtrip.test.ts:3`. | REPORTED | `community.ts:436`, `private-channel.ts:189`, `helpers/voice.ts` |
| **M15** | **`react()` hardcodes the target kind to 9**, so reacting to a kind-1111 threaded reply emits `["k","9"]`. | REPORTED | `community.ts:785` |
| **M16** | **`replyToThread` pins `K`/`k` to 11 and cannot inherit a thread root** — building the pointer by hand discards the parent's tags, so the verbatim-root-inheritance rule can never fire. Threads are depth-1 only and rooted on the wrong kind; the package cannot express CORD-03 §3's threaded reply off a kind-9 message. | REPORTED | `community.ts:775-776` |
| **M17** | **Channel `name ≤ 64 bytes` cap never enforced** on either the write or read path. Cap is in *bytes*; JS `.length` is UTF-16 units, so a correct fix must use a `TextEncoder`. | REPORTED | `admin.ts:182-190`, `control.ts:224` |

### Suspected (need a spec ruling before acting)

| ID | Finding | Why suspected |
|----|---------|---------------|
| **S01** | **Grant revoke (empty `role_ids`) is gated by no rank comparison** — `[].every(…)` is vacuously `true`, so a junior `MANAGE_ROLES` holder can strip or demote every admin above them (owner excepted). | CORD-04 §2 states the Grant rule as outranking *the roles handed out*, which is what the code implements. Whether §3's general "strictly outrank its target" also binds the Grant's target member is unresolved by the text. Likely needs a spec clarification, not a unilateral change. |
| **S02** | **Kick `vac` never validated and optional on the write path** — the fold authorizes purely against the *current* roster, ignoring the Grant the Kick cites. Nothing restricts `vac` omission to the owner. | CORD-02 §5 defers the rule to CORD-04 §5. Confirm there first. |
| **S03** | **Chunks with mismatched `chunkCount` merge into one rotation set** — `chunkCount` is not in the correlation key, so one `n` wins by arrival order and the other generation's chunks are discarded, potentially completing a *stale* set and concluding a false removal. | Grouping code confirmed to behave this way; could not verify the resume path can actually emit a differing `n` in practice. |
| **S04** | **Channel deletion terminality not enforced** — a later edition setting `"deleted": false` resurrects the channel; nothing latches. | "Deletion is terminal" is followed by a clause about *id reuse*, admitting a narrow reading. Plain reading says latch it. |

---

## LOW severity

| ID | Finding | Code |
|----|---------|------|
| **L01** | `buildChain` stamps the tip's `refounder` onto every historical epoch's material (spread carries it). Spec-wrong on its face — epoch 0 is genesis and has no refounder. **Not exploitable today**: `syncEpoch`'s `members` is computed but never consumed. A live trap the moment any per-epoch fold is surfaced. | `sync.ts:239-247` |
| **L02** | `deleteChannel` hand-rolls its edition content, dropping `custom` (and `voice`). Note the hand-roll is *partly deliberate and correct* — a naive spread would leak `ch.key` into a member-readable edition — so the fix is an explicit destructure, **not** a spread. | `admin.ts:195-199` |
| **L03** | `deleteMessage` emits no `k` tag (a bare string id takes `setDeleteEvents`' else-branch). | `community.ts:797` |
| **L04** | `kick()` and `ban()` publish with no local authority check, unlike `rotateChannel`/`refound`. The read path is the real boundary and enforces correctly, so no authority is gained — but the UI shows a removal that never happened. | `community.ts:861-865`, `admin.ts:257-263` |
| **L05** | `Role.position` not validated as an integer — `"abc"` → `NaN` folds and confers permission bits (though `canActOn` then denies every rank-gated action). Defense-in-depth. | `control.ts:162-163` |
| **L06** | `decodeFragment` accepts a *higher* fragment version and decodes it against the v4 dictionary — precisely the "decode it against the wrong dictionary" outcome the spec's parenthetical exists to prevent. The dictionary is explicitly designed to grow. | `helpers/invite-bundle.ts:81` |
| **L07** | Community List and Invite List **destroy unknown top-level document fields** — both parse to a narrow shape and both write paths hand-roll `JSON.stringify({entries, tombstones})`. Per-*entry* unknowns survive; only the document root is lossy. Spec: "preserve what you don't understand" (CORD-02 §6/§8, CORD-05 §4). | `helpers/community-list.ts:198-202`, `operations/community-list.ts:87`, `client.ts:762`; `helpers/invite-list.ts:116-120`, `operations/invite-list.ts:71-73`, `invite-manager.ts:220` |
| **L08** | `prevepoch` identity across a rotation's chunks never validated (correlation key covers `prevcommit` only). Not exploitable — forging a chunk needs an authorized seal, and the epoch filter makes a divergent `prevepoch` drop the rotation. | `helpers/rekey.ts:207,213-217` |
| **L09** | Community metadata `name` (64B) / `description` (10000B) byte caps not enforced on write or read. | `helpers/community.ts:94-126` |
| **L10** | The wrap's ephemeral `p`-tag secret is generated inline and discarded, foreclosing the CORD-01 §Deletions "delete your own giftwrap by `p` tag" path permanently. | `operations/gift-wrap.ts:67` |
| **L11** | Code comments cite **CORD-06 §94, a section that does not exist** — CORD-06 has 3 sections; "94" is a *line number*. Cosmetic. | `keys.ts:265,296,528`, `community.ts:679,1062` |
| **L12** | No public↔private channel conversion or rename, both of which CORD-03 §2 specifies in detail. Gap, not a violation. **Trap for whoever adds it:** `addChannelKey:229` hardcodes `epoch: 1`, correct only for a *first* privatisation; §2 turns on the epoch being monotonic and never resetting. | `admin.ts:182-200`, `keys.ts:225-232` |
| **L13** | CORD-07 §2 broker (kind 27235), §3 cipher half, §5 rendezvous, §6, §7 unimplemented. Only the key-derivation layer exists. Defensibly out of scope for an events SDK — these are HTTPS/WebRTC concerns. | — |

---

## Findings recorded after the initial audit

Findings surfaced during Phase 9 execution (authority-fold trace), pulled into scope but distinct from the audit's original 43 enumerated findings — recorded here rather than folded silently into the AUTH-03..08 set.

| ID | Finding | Status | Code |
|----|---------|--------|------|
| **D14** | **Read-path banlist fold applies no per-entry rank check, and `foldMembers` deletes a banned member with no owner exemption.** `control.ts`'s banlist fold checks only that the list's author holds `PERM.BAN` — any BAN-holder, regardless of rank, can list an arbitrary pk including the owner or a senior member. `guestbook.ts`'s `foldMembers` then applies `members.delete(banned)` unconditionally against that banlist, with no owner exemption. Same "junior acts on senior" shape as AUTH-07 (S01), applied to bans, plus a missing owner exemption. Same CORD-04 §3/§2 sentences violated: the actor must hold the required bit AND strictly outrank its target. Fixed in Phase 9 (09-02, 09-03): the read-path banlist fold now honors a pk only when `s.isOwner \|\| s.position < standing(pk).position`, additive to the existing author-BAN-bit check (`control.ts`); `foldMembers`' banlist-delete loop gained a defense-in-depth owner-exemption guard (`guestbook.ts`). Tracked as **AUTH-09** in `REQUIREMENTS.md`. | RESOLVED (Phase 9) | `control.ts:288-330` (banlist fold rank gate), `guestbook.ts` (banlist-delete owner exemption) |

---

## Conflicts between agents (unresolved — needs a ruling)

1. **Compaction silently skipping unfoldable heads** (`keys.ts:345-352`). The **CORD-06 agent** rates this HIGH: the guard and the `catch` silently drop heads and `buildRefounding` returns a partial `compactionWraps` with no error, against CORD-06 §3's "If the Refounder cannot reliably fold all Control events, the Refounding must be aborted." The **CORD-02 agent** rates the same code **correct**: `controlHeadsWithSeals` (`community.ts:1046-1056`) deliberately re-decodes control wraps from the wrap-level `eventStore` to restore seals the RumorStore strips, and calls it well-commented. Both read the same lines. **Not yet adjudicated** — must resolve before scoping a fix.
2. ~~**`channelSecret` fallthrough severity** (H07).~~ **RESOLVED → HIGH (2026-07-15).** CORD-03 agent said HIGH (private content broadcast to a member-derivable plane); CORD-07 agent said LOW (bogus address nobody publishes to; empty subscription). The disagreement turned on whether `sendMessage` to an ungranted private channel is reachable in practice. An upstream bug report from **Accordian** observed a live enabled composer in exactly that state, and the repro confirms `planeKeyFor` resolves rather than throwing. The LOW ruling was wrong. **Lesson: an agent's "not reachable in practice" claim is a hypothesis about call sites, not a verified fact — treat it as SUSPECTED until the call path is traced.**

## Process notes

- **Agent cross-contamination occurred.** Agents wrote scratch probe files into the repo; the CORD-06 agent then read *another agent's* leftover probe (`__tests__/audit-repro.test.ts`), mistook it for a pre-existing test, and cited it as evidence of a "known channel-key-staleness issue". No such file or issue exists. That claim is **discarded**. All stray files removed; tree verified clean. Lesson: verify agent findings against the code, never against each other's reports.
- **Severity is the orchestrator's, not the agents'.** Where reports disagreed, both positions are recorded above rather than averaged.

## Verified correct (do not re-audit)

Broad areas each agent checked against both sides and found faithful:

- **Crypto/derivation:** `community_id` (CORD-02 A.4), HKDF `group_key`/`scalar_normalize` info layout (A.1–A.3), the entire A.6 label table, `epochKeyCommitment` (A.5), `recipientLocator`, rekey addresses, channel key derivation (CORD-03 §1), voice key derivation incl. the deliberately-omitted epoch field (CORD-07 §1/§3), `inviteBundleKey`.
- **Envelope (CORD-01):** wrap encryption under the stream conversation key (never the `p`-tagged decoy), NIP-59 reversal, seal kinds 20013/20014/21059, plaintext-seal byte-verbatim re-wrap, seal signature verification, rumor↔seal author binding, three-layer `created_at` propagation, channel/epoch binding checked on **both** receive paths.
- **Rekey wire (CORD-06):** 72-byte blob layout, inner scope/epoch verification before key acceptance, 120 blobs/event, correlation by (rotator, scope, newepoch, prevcommit), rotator identity = seal signer, complete-set gate, continuity math, `lowerKeyWins`, `held_roots` retention, prior-root sealing of bundled channel rekeys. **`rollForward` is a proper spread with no dropped fields** — the suspicion in the brief was unfounded.
- **Roles (CORD-04):** all permission bit values incl. the retired `1<<7`, union-of-bits + min-position rank, strict `<` outranking (no off-by-one), owner unactionable-as-target via position 0, self-promotion bar, position 0 reserved, grant-issuer-outranks-roles, default-deny on every fold branch, deleted roles confer nothing, `vac` tag shape.
- **Guestbook (CORD-02 §5):** tie-break on lower rumor id, one-hour clock guard + malformed-ms drop applied to snapshots too, snapshot authorization gate, present-only seeding, 400/chunk, forward-only observation's strict `>`.
- **Community List (CORD-02 §8):** merge commutativity/idempotence, canonical-bytes tie-break, permanent tombstones, re-join resurrection, byte cap enforced before publish.
- **Invites (CORD-05):** owner self-certification, 256-channel ceiling and 5-relay truncation *on well-formed arrays*, `expires_at` checked at join not validate, relay dictionary + fragment codec both directions, naddr shape, kind 33301 wire shape, Direct Invite as standard NIP-59 with the `k` tag treated as hint-not-authority, join attribution, Invite List merge semantics, NIP-44 byte cap. **`held_roots` omission from bundles is spec-correct.** The `joinFromBundle` `JoinMaterial` literal carries all 10 fields.
- **Kind registry:** all 23 protocol kinds accounted for; wire shapes match `examples.md`; retired kinds correctly absent. Kinds 3310/23311 as constants-only is *correct*, not a gap.

---

*Audit completed: 2026-07-15. One finding (the `refounder` bundle drop) fixed pre-audit; all others open.*
