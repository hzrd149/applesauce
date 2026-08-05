---
phase: 11-messaging-wire-conformance
reviewed: 2026-07-29T11:40:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - apps/docs/concord/channels.md
  - apps/examples/src/examples/concord/admin-management.tsx
  - packages/concord/src/__tests__/cord-wire-fixtures.test.ts
  - packages/concord/src/__tests__/cord-wire-fixtures.ts
  - packages/concord/src/__tests__/roundtrip.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/private-channel.test.ts
  - packages/concord/src/client/admin.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/sync.ts
  - packages/concord/src/helpers/__tests__/keys.test.ts
  - packages/concord/src/helpers/control.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/operations/gift-wrap.ts
  - packages/concord/src/types.ts
findings:
  critical: 1
  warning: 9
  info: 6
  total: 16
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-29T11:40:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the six-plan Phase 11 diff (`73ce1952..HEAD`) at standard depth, plus the
called code the diff depends on (`applesauce-core`'s `ensureKTag` /
`setDeleteEvents` / `DeleteManager`, `applesauce-common`'s `setParent` /
`setReactionParent`, `helpers/chat.ts`, `helpers/guestbook.ts`,
`models/observed.ts`, `helpers/community.ts`). `pnpm --filter applesauce-concord test`
passes (495/495) and `tsc --noEmit` is clean, so nothing below is a build break.

Three of the four areas the brief flagged came back clean on the specific
question asked:

- **ephemeral secret key (11-03)** — `ephemeralSk` is used only to derive
  `getPublicKey(decoySk)` inside `buildWrap`; it is never attached to the event,
  never spread into a template, never logged, never persisted, and
  `GiftWrapOptions` correctly excludes it. No leak path found. The *policy*
  around the option is still a problem (WR-03), and the test that claims to
  prove non-leakage cannot actually fail (WR-08).
- **`checkChatBinding` coverage (11-06)** — there are exactly two paths that add
  a rumor to a channel store (`community.ts:688`, `private-channel.ts:317`) and
  both still run the binding guard ahead of the add. Coverage is intact.
- **23313 authorization bypass (11-06)** — no decrypt/authority gate was
  bypassed. But the drop was load-bearing for two *other* subsystems that no
  plan accounted for: the observed-authors roster fold (WR-04) and store
  retention (WR-05).

The largest real defects are elsewhere: the phase performed a breaking signature
change on three public methods without updating the documentation that calls
them (CR-01) and without any runtime validation of the new parameter (WR-01),
and it fixed three of the four verbs named by the target-kind rule it vendored,
leaving `editMessage` behind (WR-02).

## Critical Issues

### CR-01: Published docs still call the pre-phase signatures — the documented calls now emit malformed wire events

**File:** `apps/docs/concord/community.md:95`, `apps/docs/concord/community.md:97`, `apps/docs/concord/community.md:106`
**Issue:** 11-04 changed `react`, `replyToThread` and `deleteMessage` to take a
full `Rumor` (`community.ts:1096`, `:1103`, `:1117`). The phase updated
`apps/docs/concord/channels.md` (the voice removal) but not
`apps/docs/concord/community.md`, which still documents the old shapes:

```ts
await community.react(channelId, { id, author }, "🔥");     // :95
await community.deleteMessage(channelId, messageId);        // :97
await community.replyToThread(channelId, { id: threadId, author }, "..."); // :106
```

VitePress here has no twoslash, so nothing typechecks these blocks. Tracing each
documented call through the new code path:

- `react(channelId, { id, author }, …)` → `setReactionParent` reads
  `event.pubkey` (undefined) and `event.kind` (undefined) →
  `ensureProfilePointerTag` emits `["p", undefined]` and
  `ensureKTag(tags, undefined)` emits `["k", "undefined"]`
  (`packages/core/src/helpers/factory.ts:148` does `String(kind)` with no guard).
- `deleteMessage(channelId, messageId)` with a **string** → `target.id` is
  `undefined` → `["e", undefined]`, and `ensureKTag(tags, undefined)` →
  `["k", "undefined"]`. The delete points at nothing and deletes nothing.

Neither throws. The rumor is hashed, sealed, wrapped and published with
`undefined` array members (serialized as `null`), i.e. the exact class of
wire-nonconformance this phase exists to eliminate. Shipping wire-conformance
work while the docs instruct readers to produce malformed events is a blocker.

**Fix:**
```md
### Reactions, edits, and deletes

`react` and `deleteMessage` take the full target **rumor** (read it back from the
channel store) — a Concord rumor has no `sig`, so the id alone is not enough to
build the NIP-25/NIP-09 `k` tag:

```ts
const [message] = community.channelStore(channelId).getTimeline([{ kinds: [9] }]);

await community.react(channelId, message, "🔥");
await community.editMessage(channelId, message.id, "fixed typo");
await community.deleteMessage(channelId, message);
```

### Threads

```ts
await community.sendThread(channelId, "Feature ideas", "Drop your suggestions here");
const [thread] = community.channelStore(channelId).getTimeline([{ kinds: [11] }]);
await community.replyToThread(channelId, thread, "How about dark mode?");
```
```
Also grep the rest of `apps/docs/concord/` and `apps/examples/` for the old
shapes as part of the fix (only `community.md` hits today).

## Warnings

### WR-01: The new `Rumor` parameters are accepted with zero runtime validation

**File:** `packages/concord/src/client/community.ts:1096`, `:1103`, `:1117`
**Issue:** `react(channelId, target: Rumor, …)`, `replyToThread(channelId, parent: Rumor, …)`
and `deleteMessage(channelId, target: Rumor)` are `public`, are the migration
target of a same-arity breaking change, and validate nothing. A caller who
passes the old `{ id, author }` pointer, a bare id string, or a rumor whose
`kind` is `0` gets a silently malformed published event (see CR-01 for the
trace). Concord is unreleased so the break itself is fine — the absence of a
fail-fast guard on a same-arity break is not. `requireChannelKey` already
establishes the "throw a precise error before the factory runs" convention two
lines above each of these.
**Fix:** add one shared guard and call it first in all three methods:
```ts
/** The three rumor-taking chat verbs are a same-arity break from `{id, author}`
 *  pointers — fail loudly instead of publishing `["k","undefined"]`. */
private requireRumor(target: Rumor, method: string): void {
  if (!target || typeof target.id !== "string" || target.id.length !== 64)
    throw new TypeError(`${method}: pass the full target rumor, not an id or pointer`);
  if (typeof target.kind !== "number" || typeof target.pubkey !== "string")
    throw new TypeError(`${method}: target rumor is missing kind/pubkey`);
}
```

### WR-02: `editMessage` was left out of the target-kind fix and cannot comply

**File:** `packages/concord/src/client/community.ts:1110`, `packages/concord/src/factories/edit.ts:12`, `packages/concord/src/operations/edit.ts:13`
**Issue:** The phase vendored `CORD_TARGET_KIND_RULE`
(`cord-wire-fixtures.ts:112`): *"Reactions, **edits**, and deletes target a
threaded reply exactly as they target a kind-9 message (by its rumor id); the k
tag they carry names the target's kind"*. 11-04 fixed reactions
(`ReactionFactory` now gets the rumor), replies, and deletes (explicit
`ensureKTag`) — and left edits. `editMessage(channelId, targetId: string, text)`
still takes an id, so the kind-3302 edit it emits carries only
`["e", targetId]` and **no `k` tag at all**, and the method structurally cannot
add one because it never sees the target. The new `wire conformance` describe
block has no edit case, so nothing detects this. (The vendored file is
explicitly non-normative, so confirm against CORD-03 §3 before choosing the tag
shape — but the API asymmetry, three verbs taking a `Rumor` and one taking an
id, is a defect regardless.)
**Fix:**
```ts
async editMessage(channelId: string, target: Rumor, text: string): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const template = await EditFactory.create(target.id, text);
  const withKTag = { ...template, tags: ensureKTag(template.tags, target.kind) };
  const rumor = await bindToChannel(channelId, epoch)(withKTag);
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```
and add a WIRE case asserting `tagValues(edit.tags, "k")` is `["1111"]` for a
reply target.

### WR-03: `ephemeralSk` documents key REUSE as its purpose, with no single-use or blast-radius warning

**File:** `packages/concord/src/operations/gift-wrap.ts:39-51`, `:79`
**Issue:** The option's whole documented purpose is that the caller *retains*
the value ("Letting a caller retain this value lets it predict the wrap's decoy
`p` tag so it can later delete its own giftwrap by that tag"). Nothing in the
docstring, the type, or `buildWrap` says the key must be used for exactly one
wrap, and two properties break the moment it is not:

1. **Cross-plane correlation.** The module header states the outer `p` tag is a
   *decoy*. Per-plane stream keys already partition wraps by author pubkey, so
   reusing one `ephemeralSk` across a control-plane wrap and a channel-plane
   wrap publishes a shared, relay-visible `p` value that links two planes the
   key derivation deliberately separates — a correlation a passive relay cannot
   otherwise make.
2. **Delete blast radius.** On the NIP-59-supporting relays the docstring
   targets, holding the decoy secret is what authorizes deleting the wrap. With
   a fresh key per wrap that capability is destroyed at wrap time and nobody can
   delete anything. A retained, reused key turns an ephemeral non-credential
   into a durable one whose compromise deletes *every* wrap ever published under
   it.

The name compounds it: `ephemeralSk` sits next to `ephemeral` (which means the
kind-21059 wrap kind, an unrelated concept) and reads, to anyone who knows
NIP-59, like the key that *signs* the wrap — which here is `streamSk`.
There is also no production consumer: `grep` finds `ephemeralSk` only in the
option plumbing (`keys.ts:237`, `community.ts:1034`, `:1579`) and tests. The
feature is unused API surface threaded through three layers.
**Fix:** rename to `decoySk`, and state the constraints in the docstring:
```ts
/**
 * Supply the wrap's decoy `p` tag secret key instead of generating a fresh one.
 * NOT the wrap's signing key (that is always the plane's `streamSk`) and
 * unrelated to `ephemeral` (the 21059 wrap kind).
 *
 * MUST be single-use. Reusing one key across wraps publishes a shared decoy
 * `p` value that correlates those wraps — including ACROSS planes, which the
 * per-plane stream keys otherwise prevent — and, on NIP-59-supporting relays,
 * makes the retained secret a delete credential for every wrap that shares it.
 * Retain it only for the wrap you intend to delete (CORD-01 §Deletions).
 */
decoySk?: Uint8Array;
```

### WR-04: Removing the 23313 drop lets a voice-presence beacon resurrect a departed or kicked member

**File:** `packages/concord/src/client/community.ts:677-693`, `packages/concord/src/client/community.ts:640`, `packages/concord/src/models/observed.ts:9`, `packages/concord/src/helpers/guestbook.ts:123-126`
**Issue:** 11-06 removed `if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;`
from `route()`. `rewireState()` (`:640`) feeds every `channel:*` store into
`ConcordCommunityStateModel`'s `observed` set, and `ConcordObservedAuthorsModel`
reads `store.timeline([{}])` — **every kind, unfiltered**. `foldMembers` then
does:

```ts
for (const [author, lastMs] of observed) {
  const c = state.get(author);
  if (!c || c.present || lastMs > c.ms) members.add(author);  // guestbook.ts:123-126
}
```

So a kind-23313 presence beacon newer than a member's Leave or authorized Kick
now re-adds that member to `members$`. Before this phase, 23313 was dropped
before it reached the store, so presence could never contribute to observation.
A presence heartbeat is a transport beacon, not "publishing" in the CORD-02 §5
observed-authors sense, and unlike a chat message it is emitted automatically
and repeatedly by a client the user may have left running. Nothing in the phase
plan mentions this and no test covers it.
**Fix:** exclude ephemeral/presence kinds from observation rather than from
delivery — keep 23313 in the store (the phase goal) but keep it out of the
roster fold:
```ts
// models/observed.ts — presence beacons are transport, not publishing (CORD-02 §5)
export function ConcordObservedAuthorsModel(): Model<Map<string, number>, Rumor> {
  return (store) =>
    store.timeline([{}]).pipe(map((rumors) => observedAuthors(rumors.filter((r) => r.kind !== VOICE_PRESENCE_KIND))));
}
```
Add a regression test: kick a member, deliver a later 23313 beacon authored by
them, assert they stay out of `members$`.

### WR-05: 23313 presence rumors now accumulate forever in every channel store, including persistent caches

**File:** `packages/concord/src/client/community.ts:688`, `packages/concord/src/client/private-channel.ts:317`
**Issue:** 23313 is in the ephemeral kind range, but neither `EventStore` nor
`RumorStore` filters ephemeral kinds (`packages/core/src/event-store/event-store.ts`
evicts only on an `expiration` tag, and the vendored CORD-07 §4 fixture carries
none). Every presence beacon is therefore written permanently into
`channel:<id>` — and `storeFactory` is explicitly a persistence hook
(`ConcordCommunityOptions.storeFactory`, "persistent cache"), so a real app
grows an unbounded on-disk log of presence heartbeats. There is also no
joined/left reconciliation anywhere in the package, so a consumer rendering
`channelStore(id).timeline([{ kinds: [23313] }])` (the only affordance the phase
provides) shows every member who has *ever* joined as currently present. The
"Reading channel messages" section of `apps/docs/concord/channels.md:25-36` was
not updated to tell consumers that non-chat kinds now land in the same store.
**Fix:** either drop presence at the store boundary while still surfacing it
(e.g. route 23313 to a dedicated `presence$` subject instead of the durable
store), or give the presence rumor an `expiration` tag at send time so
`ExpirationManager` evicts it. At minimum, document in `channels.md` that the
channel store is now multi-kind and that presence must be reconciled by the
consumer.

### WR-06: `voice` is dropped from the fold and clobbered on republish, losing another client's channel state

**File:** `packages/concord/src/helpers/control.ts:306-312`, `packages/concord/src/client/admin.ts:190-198`
**Issue:** 11-02 removed the `...(typeof raw.voice === "boolean" ? { voice: raw.voice } : {})`
branch from `foldControl`, and `voice` is *not* captured by the `custom`
passthrough (only a literal `custom` key is). So a CORD-07 channel edition
published by another client with `{"name":…,"private":…,"voice":true}` is folded
with the flag silently discarded. `deleteChannel` then re-serializes the edition
from the folded value:

```ts
JSON.stringify({ name: ch.name, private: ch.private, deleted: true })  // admin.ts:196
```

which permanently erases `voice` from the shared control plane for every client.
The same line also erases `custom`, which *is* a live folded field — that half
is pre-existing, but it is a strictly larger instance of the same bug in a file
this phase touched.
**Fix:** make the republish non-lossy by patching the folded head rather than
rebuilding it from three fields:
```ts
async deleteChannel(channelId: string): Promise<void> {
  const ch = this.opts.state().channels.find((c) => c.channel_id === channelId);
  if (!ch) return;
  const { channel_id: _id, ...rest } = ch;
  await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify({ ...rest, deleted: true }));
}
```
and decide explicitly whether unknown wire fields (`voice`) should survive the
fold via `custom` or be dropped — the current state does neither cleanly.

### WR-07: `deleteMessage` has no author or permission check, so moderating another member's message is silently inert

**File:** `packages/concord/src/client/community.ts:1117-1128`
**Issue:** `deleteMessage` publishes a kind-5 for any rumor handed to it.
`DeleteManager.check` (`packages/core/src/event-store/delete-manager.ts:97-116`)
only honors a deletion when `deleteEvent.pubkey === target.pubkey`, so a
moderator deleting someone else's message publishes an event that every
conformant client ignores — with no error, no return value, and no logging. The
UI shows success; nothing is deleted anywhere. `PERM.MANAGE_MESSAGES`
(`types.ts:33`) is defined, granted in `apps/docs/concord/moderation.md:70` and
preselected in `admin-management.tsx:561`, and is enforced **nowhere** in the
package. 11-04 put `target.pubkey` in scope for the first time, which makes the
check a one-liner.
**Fix:**
```ts
async deleteMessage(channelId: string, target: Rumor): Promise<void> {
  this.requireChannelKey(channelId);
  // NIP-09 deletions are author-scoped (DeleteManager.check), so a delete of
  // someone else's rumor is inert — fail loudly instead of pretending.
  if (target.pubkey !== this.pubkey)
    throw new Error("cannot delete another member's message — publish a moderation action instead");
  ...
}
```
If cross-author moderation is intended, it needs its own verb gated on
`PERM.MANAGE_MESSAGES` plus a receive-side fold, and `MANAGE_MESSAGES` should
not be advertised in the docs/examples until it exists.

### WR-08: The WIRE-11 "never leaks" assertion cannot fail for the leak path it claims to cover

**File:** `packages/concord/src/helpers/__tests__/keys.test.ts:101-103`
**Issue:**
```ts
const secretHex = bytesToHex(sk);
expect(JSON.stringify(wrap)).not.toContain(secretHex);
```
`buildWrap` **always** NIP-44-encrypts the seal into `wrap.content`
(`gift-wrap.ts:84`), even with `plaintext: true` (which affects only the seal
kind). So the only plaintext fields in the serialized wrap are `kind`,
`created_at`, `tags`, `pubkey`, `id`, `sig` — a leak into the rumor tags, the
seal, or any inner field is ciphertext by the time this assertion runs and can
never be detected. The one leak this can catch (sk written into the outer `p`
tag) is already covered by `expect(pTag).toBe(expectedPk)` two lines above, so
the assertion adds no coverage while carrying the strongest claim in the phase
("never leaks", the brief's headline concern). `decodeWrap` is already imported
in this file, so the real assertion is one line away.
**Fix:**
```ts
const secretHex = bytesToHex(sk);
expect(JSON.stringify(wrap)).not.toContain(secretHex);
// The outer content is always ciphertext — decode through the envelope so an
// sk leaked into the seal or the rumor is actually observable.
const decoded = decodeWrap(wrap, planeKeyFor(keys, { plane: "control" }).convKey)!;
expect(decoded).not.toBeNull();
expect(JSON.stringify(decoded.rumor)).not.toContain(secretHex);
expect(JSON.stringify(decoded.seal)).not.toContain(secretHex);
```

### WR-09: The voice key API is now unreachable dead public surface

**File:** `packages/concord/src/helpers/voice.ts:4`, `packages/concord/src/helpers/community.ts:62-70`, `packages/concord/src/helpers/index.ts:22`
**Issue:** 11-02 removed `ChannelMetadata.voice` and `CreateChannelOptions.voice`
and the `foldControl` branch that read it, but left the whole downstream API
exported: `VOICE_PRESENCE_KIND`, `voiceKeysFor(material, channel)`,
`voiceGroupKey`, `voiceMediaKey`, `voiceSenderKey`. `voiceKeysFor` takes a
`ChannelMetadata` that can no longer carry `voice`, so **no consumer can
determine which channel to call it for** — the SFU room/media derivation is
reachable only by guessing. `VOICE_PRESENCE_KIND` has no remaining reference in
`src/` at all after both `route()` funnels dropped it. Half-removing a feature
leaves a public surface that compiles, exports, and cannot be used correctly.
**Fix:** either finish the removal (delete `helpers/voice.ts`, `voiceKeysFor`,
and the three `crypto.ts` voice derivations, dropping the `helpers/index.ts`
re-export), or keep them and restore a way to identify a voice channel —
e.g. read it back off `ChannelMetadata.custom.voice` and say so in the
`voiceKeysFor` docstring. Record whichever is chosen in the phase notes, since
`roundtrip.test.ts:4` now advertises CORD-07 transport as "deferred as FUT-02".

## Info

### IN-01: The wrap-options shape is hand-duplicated in four places

**File:** `packages/concord/src/operations/gift-wrap.ts:39`, `packages/concord/src/helpers/keys.ts:237`, `packages/concord/src/client/community.ts:1034`, `packages/concord/src/client/community.ts:1579`
**Issue:** `{ plaintext?: boolean; ephemeral?: boolean; ephemeralSk?: Uint8Array }`
is written out inline three times on top of the exported `WrapOptions`/`SealOptions`.
11-03 had to edit all four in lockstep; the next option will too, and a missed
site fails open (the option is silently dropped, not a type error).
**Fix:** export `export type PublishOptions = SealOptions & Omit<WrapOptions, "created_at">;`
from `operations/gift-wrap.ts` and use it at all three call sites.

### IN-02: The presence fixture binds a placeholder to itself, making that tag assertion trivially true

**File:** `packages/concord/src/client/__tests__/community.test.ts:1581-1585`, `packages/concord/src/client/__tests__/private-channel.test.ts:214-218`
**Issue:** `substituteFixtureTags(..., { "<SFU identity>": "<SFU identity>" })`
asserts the literal placeholder text round-trips, since the same literal was put
into the outgoing template. The comment acknowledges it, but the effect is that
the `identity` and `broker` entries of the §2.8 fixture are compared against
themselves — only `channel_id` is a genuine runtime binding.
**Fix:** bind `"<SFU identity>"` to a real distinct value (e.g. `pubkey`) so the
assertion pins transit of a value the test did not also hardcode on both sides.

### IN-03: `tagValues` returns `undefined` behind a non-null assertion

**File:** `packages/concord/src/__tests__/cord-wire-fixtures.ts:163-165`
**Issue:** `.map((tag) => tag[1]!)` is declared `string[]` but yields `undefined`
for a one-element tag (`["ms"]`). An assertion like
`expect(tagValues(tags, "k")).toEqual(["9"])` would then fail with a confusing
`[undefined]` rather than a clear message.
**Fix:** `return tags.filter((t) => t[0] === name && t[1] !== undefined).map((t) => t[1] as string);`

### IN-04: The "vendored fixture shape" block asserts only tautologies

**File:** `packages/concord/src/__tests__/cord-wire-fixtures.test.ts:95-117`
**Issue:** These cases assert that string literals in the same module are
non-empty strings and that `section` matches `examples.md §\d`. They cannot fail
for any edit that keeps the constants well-formed, and in particular cannot
detect drift from upstream `examples.md` — which the module header names as the
whole point of vendoring. They pad the count without adding coverage.
**Fix:** replace with something falsifiable — e.g. pin a `sourceSha` of the
upstream section, or drop the block and rely on the header's documented manual
diff step.

### IN-05: Both new files fail the repo's prettier config

**File:** `packages/concord/src/__tests__/cord-wire-fixtures.ts:31`, `packages/concord/src/__tests__/cord-wire-fixtures.test.ts:23`
**Issue:** `pnpm exec prettier --check` flags both new files (over-wrapped
`CORD_EXAMPLES_CAVEAT`, over-wrapped `toThrow(...)`, un-expanded nested array).
Prettier is not CI-gated and several pre-existing concord files already fail, so
this is cosmetic — but the next `pnpm format` will reformat these files and
muddy the phase's blame.
**Fix:** `pnpm exec prettier --write packages/concord/src/__tests__/cord-wire-fixtures*.ts`

### IN-06: `deleteMessage` cannot emit an `a` tag for an addressable target

**File:** `packages/concord/src/client/community.ts:1124`
**Issue:** Passing only `[target.id]` takes `setDeleteEvents`' bare-string branch
(`packages/core/src/operations/delete.ts:21-24`), which skips the
`isAddressableKind || isReplaceableKind` branch that would add the `a`
coordinate. Harmless for kind 9/1111 chat, but `deleteMessage` accepts any
`Rumor`, so deleting an addressable rumor riding a channel would produce an
incomplete NIP-09 deletion.
**Fix:** after `ensureKTag`, add the address pointer when the target kind
warrants it, or narrow the accepted target kinds and say so in the docstring.

---

_Reviewed: 2026-07-29T11:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
