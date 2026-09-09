# Phase 11: Messaging Wire Conformance - Pattern Map

**Mapped:** 2026-07-29
**Files analyzed:** 11 modified, 3 created
**Analogs found:** 11 / 11 (all analogs are in-file siblings or directly adjacent files — this phase is almost entirely edits, not new scaffolding)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|

## Pattern Assignments


**Analog:** `sendThread` (lines 1088-1093) and `sendEvent` (lines 1031-1040) in the **same file** — both untouched by this phase, so they show the canonical shape uncontaminated by the bug being fixed.

**The shape every messaging method follows** (verbatim, `sendThread`):
```typescript
async sendThread(channelId: string, title: string, body = ""): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const rumor = await bindToChannel(channelId, epoch)(await ForumThreadFactory.create(title, body));
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```
`requireChannelKey` → `channelEpoch` → factory → `bindToChannel(channelId, epoch)` → `publishToPlane`. D-01's three signature changes must preserve this exact shape; only the factory-argument construction changes.

**Current (buggy) code to replace, lines 1096-1126:**
```typescript
async replyToThread(channelId: string, thread: { id: string; author: string }, body: string): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const pointer = { type: "event" as const, id: thread.id, kind: kinds.ForumThread, pubkey: thread.author };
  const rumor = await bindToChannel(channelId, epoch)(await CommentFactory.create(pointer, body));
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}

async react(channelId: string, target: { id: string; author: string }, reaction: string | Emoji): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const rumor = await bindToChannel(
    channelId,
    epoch,
  )(await ReactionFactory.create({ id: target.id, pubkey: target.author, kind: kinds.ChatMessage }, reaction));
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}

async deleteMessage(channelId: string, targetId: string): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const rumor = await bindToChannel(channelId, epoch)(await DeleteFactory.fromEvents([targetId]));
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```
D-01 changes the middle parameter to `target: Rumor` for all three, then:
- `react`: pass `target` (the full rumor) directly as `ReactionFactory.create`'s parent argument — drop the hand-built `{ id, pubkey, kind: kinds.ChatMessage }` object entirely.
- `replyToThread`: pass `target` (renamed `parent`) directly to `CommentFactory.create` — drop the hand-built pointer with its hardcoded `kind: kinds.ForumThread`.
- `deleteMessage`: see the `ensureKTag` pattern below — do NOT just swap `targetId` for `target` and pass the rumor straight into `DeleteFactory.fromEvents`; a `Rumor` has no `sig` and fails `isEvent`, so `ensureKTag` is never invoked by the factory itself.

### `editMessage()` (same file, ~1114-1119) — reference for what NOT to touch

```typescript
async editMessage(channelId: string, targetId: string, text: string): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const rumor = await bindToChannel(channelId, epoch)(await EditFactory.create(targetId, text));
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```
Explicitly out of scope for this phase (not in WIRE-01…05/11) — do not touch its signature. Also the target for the `MissingChannelKeyError` table test invokes `editMessage(channelId, target.id, "x")`, i.e. it stays on the bare-string form while `react`/`deleteMessage`/`replyToThread` in the same table move to the full-rumor form — the executor must update only three of the five table rows.

### `deleteMessage()` — the `ensureKTag` idiom (WIRE-05's actual fix)

**Analog for "manually apply an `EventOperation` to an awaited factory result":** the existing `bindToChannel(channelId, epoch)(await factory)` idiom used by every method above IS this pattern already — `bindToChannel(...)` returns an `EventOperation`, called directly as a function on the awaited factory's plain `EventTemplate` result, because `EventFactory` only exposes `chain()` as `protected`.

**Root cause, `packages/core/src/operations/delete.ts:7-29` (`setDeleteEvents`):**
```typescript
export function setDeleteEvents(events: (string | NostrEvent)[]): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);
    for (const event of events) {
      if (isEvent(event)) {
        tags = ensureKTag(tags, event.kind);
        tags = ensureEventPointerTag(tags, event);
        ...
      } else {
        // Just an event id
        tags = ensureEventPointerTag(tags, { id: event });
      }
    }
    return { ...draft, tags };
  };
}
```
**`isEvent`, `packages/core/src/helpers/event.ts:93-105`:**
```typescript
export function isEvent(event: any): event is NostrEvent {
  if (event === undefined || event === null) return false;
  return (
    event.id?.length === 64 &&
    typeof event.sig === "string" &&
    typeof event.pubkey === "string" &&
    ...
  );
}
```
```typescript
async deleteMessage(channelId: string, target: Rumor): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const draft = await DeleteFactory.fromEvents([target.id]);
  const withKind = { ...draft, tags: ensureKTag(draft.tags, target.kind) };
  const rumor = await bindToChannel(channelId, epoch)(withKind);
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```
`ensureKTag` is exported from `applesauce-core/helpers/factory` (already re-exported through `helpers/index.ts` in this workspace) — no new export needed.


**Current code (delete line 682, correct the comment at 679-680):**
```typescript
private route(info: PlaneInfo, decoded: DecodedEvent): void {
  if (info.type === "channel") {
    const epoch = info.epoch ?? channelEpochOf(this.keys, info.channelId!);
    // CORD-03 §44: drop any rumor whose channel/epoch binding doesn't match the
    // key that opened the wrap (anti-replay), and voice presence (not chat).
    if (!checkChatBinding(decoded.rumor.tags, info.channelId!, epoch)) return;
    if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;
  }
  Promise.resolve(this.storeFor(planeStoreKey(info)).add(decoded.rumor)).catch((err) => { ... });
  if (info.type === "rekey") this.scheduleRekeyCheck();
}
```
Delete `if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;` and correct the comment to drop "and voice presence (not chat)" — 23313 now flows through exactly like typing (23311), which was never special-cased.

```typescript
private route(info: PlaneInfo, decoded: DecodedEvent): void {
  if (info.type === "channel") {
    // CORD-03 §44: drop any rumor whose channel/epoch binding doesn't match the
    // key that opened it, and voice presence (not chat).
    if (!checkChatBinding(decoded.rumor.tags, this.channelId, info.epoch ?? this.channelKey.epoch)) return;
    if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;
    Promise.resolve(this.opts.store.add(decoded.rumor)).catch((err) => { ... });
  } else if (info.type === "rekey") { ... }
}
```
Same fix, same comment correction, in this file.



**Current:**
```typescript
export type WrapOptions = { ephemeral?: boolean; created_at?: number };

function buildWrap(seal: NostrEvent, streamSk: Uint8Array, convKey: Uint8Array, opts: WrapOptions): NostrEvent {
  const decoyPubkey = getPublicKey(generateSecretKey());
  return finalizeEvent(
    {
      kind: opts.ephemeral ? EPHEMERAL_GIFT_WRAP_KIND : GIFT_WRAP_KIND,
      content: nip44.encrypt(JSON.stringify(seal), convKey),
      tags: [["p", decoyPubkey]],
      created_at: opts.created_at ?? seal.created_at,
    },
    streamSk,
  );
}
```
D-07 change:
```typescript
export type WrapOptions = { ephemeral?: boolean; created_at?: number; ephemeralSk?: Uint8Array };

function buildWrap(seal: NostrEvent, streamSk: Uint8Array, convKey: Uint8Array, opts: WrapOptions): NostrEvent {
  const sk = opts.ephemeralSk ?? generateSecretKey();
  const decoyPubkey = getPublicKey(sk);
  ...
```
`generateSecretKey`/`getPublicKey` are already imported from `applesauce-core/helpers/keys` (line 17) — no new import needed, just an override of the existing call.

### Plumbing chain — `wrapForTarget` → `publishToPlane` → `sendEvent`

```typescript
export async function wrapForTarget(
  target: WrapTarget,
  author: ISigner,
  rumor: RumorTemplate,
  opts: { plaintext?: boolean; ephemeral?: boolean } = {},
): Promise<{ wrap: NostrEvent; rumorId: string }> {
  const key = planeKeyFor(keys, target);
  const { created_at: _publishTime, ...template } = rumor;
  const stamped = await toRumor(author)({ ...template, created_at: unixNow() });
  const seal = await sealRumor(key.convKey, author, { plaintext: opts.plaintext })(stamped);
  const wrap = await wrapSeal(key.sk, key.convKey, { ephemeral: opts.ephemeral })(seal);
  return { wrap, rumorId: stamped.id };
}
```
Widen the `opts` type to `{ plaintext?: boolean; ephemeral?: boolean; ephemeralSk?: Uint8Array }` and forward `ephemeralSk` into the `wrapSeal(...)` call's own opts bag.

**`publishToPlane`, `community.ts:1574-1587`:**
```typescript
async publishToPlane(
  target: WrapTarget,
  rumor: { kind: number; content: string; tags: string[][]; created_at?: number },
  opts: { plaintext?: boolean; ephemeral?: boolean } = {},
): Promise<string> {
  const { wrap, rumorId } = await wrapForTarget(this.keys, target, this.signer, rumor, opts);
  if (!opts.ephemeral) this.onWrap(wrap);
  this.pool.publish(this.transport(), wrap).catch((err) => { ... });
  return rumorId;
}
```
Same widening — `opts` is forwarded unchanged already (`opts` is passed straight into `wrapForTarget`), so widening its type is the only change needed here.

**`sendEvent`, `community.ts:1031-1040`** — the recommended stopping point per RESEARCH.md; already public and generic:
```typescript
async sendEvent(
  channelId: string,
  source: PromiseLike<EventTemplate> | EventTemplate,
  opts: { plaintext?: boolean; ephemeral?: boolean } = {},
): Promise<string> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const rumor = await bindToChannel(channelId, epoch)(await source);
  return this.publishToPlane({ plane: "channel", channelId }, rumor, opts);
}
```
Widen `opts` here too. Do **not** add `ephemeralSk` params to `react`/`replyToThread`/`deleteMessage`/`sendMessage`/`sendThread`/`editMessage` — they all hardcode `{}` today and stay that way.

### `voice` removal sites (WIRE-01, D-06) — four in-package sites, delete only

**`types.ts:114-123`:**
```typescript
export interface ChannelMetadata {
  channel_id: string;
  name: string;
  private: boolean;
  deleted?: boolean;
  /** CORD-07 §1: a voice/video Channel. Folds like any other channel property. */
  voice?: boolean;
  custom?: Record<string, unknown>;
}
```
Delete the `voice?: boolean` line and its doc comment.

**`client/admin.ts:51-57`:**
```typescript
export interface CreateChannelOptions {
  private?: boolean;
  /** Mark the channel as voice. Defaults to `false`. */
  voice?: boolean;
}
```
Delete `voice?: boolean` and its comment.

**`client/admin.ts:188`:**
```typescript
if (options.voice) content.voice = true;
```
Delete this line outright.

**`helpers/control.ts:305-317` (the fold, delete one line):**
```typescript
const meta: ChannelMetadata = {
  channel_id: eid,
  name: raw.name,
  private: raw.private,
  ...(typeof raw.deleted === "boolean" ? { deleted: raw.deleted } : {}),
  ...(typeof raw.voice === "boolean" ? { voice: raw.voice } : {}),
  ...(raw.custom !== null && typeof raw.custom === "object" ? { custom: raw.custom as Record<string, unknown> } : {}),
};
```
Delete the `voice` spread line only — leave `deleted` and `custom` untouched (they are not WIRE-01's concern; `custom` preservation is WIRE-10, a different phase).

### Out-of-package consumers (must land in the same wave — Pitfall 3)

```tsx
const [voice, setVoice] = useState(false);          // line 688 — delete
...
await community.admin.createChannel(name.trim() || "new-channel", { private: isPrivate, voice });  // line 694 — drop `, voice`
...
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    className="checkbox checkbox-sm"
    checked={voice}
    onChange={(e) => setVoice(e.target.checked)}
  />{" "}
  Voice
</label>                                              // lines 733-741 — delete whole block
...
{channel.voice ? " · voice" : ""}                     // line 759 — delete
```
Delete all four sites; the surrounding `isPrivate` checkbox (lines 724-732) and the `deleted` render read (line 760) are the untouched siblings to preserve exactly.

```md
// A voice channel
const voiceId = await community.admin.createChannel("lounge", { voice: true });
```
Delete this comment+line pair; keep the public/private examples above it (lines 7-12) untouched.

### Test target construction — the rumor-vs-signed-event pitfall (Pitfall 1)

**Existing table test to edit, `client/__tests__/community.test.ts:324-374`:**
```typescript
const target = { id: "0".repeat(64), author: pubkey };
const invocations: Array<[string, () => Promise<void>]> = [
  ["react", () => community.react(channelId, target, "+")],
  ["editMessage", () => community.editMessage(channelId, target.id, "x")],
  ["deleteMessage", () => community.deleteMessage(channelId, target.id)],
  ["sendThread", () => community.sendThread(channelId, "t", "b")],
  ["replyToThread", () => community.replyToThread(channelId, target, "b")],
];
```
Once D-01 lands, `react`/`deleteMessage`/`replyToThread` take a full `Rumor`, not `{ id, author }`. This local `target` must become a genuine rumor-shaped object with **no `sig` field** (kind, pubkey, tags, content, created_at, id) — constructing it as a signed `NostrEvent` (with a fake or real `sig`) would make `isEvent()` return `true` and mask the exact WIRE-05 bug this phase closes. `editMessage`/`sendThread` keep their current bare-string / no-target call shape (`editMessage` stays on `target.id`).

**Round-trip analog for the WIRE-11 test, `helpers/__tests__/keys.test.ts:59-81`:**
```typescript
it("wrapForTarget seals a rumor that decodes at the plane's address", async () => {
  const { owner, ownerPub, material } = await genesis();
  const { wrap, rumorId } = await wrapForTarget(
    keys,
    { plane: "control" },
    owner,
    { kind: 3302, content: "hi", tags: [] },
    { plaintext: true },
  );
  expect(wrap.pubkey).toBe(keys.control.pk);
  const info = keys.planes.get(wrap.pubkey)!;
  const dec = decodeWrap(wrap, info.convKey);
  expect(dec).not.toBeNull();
  expect(dec!.author).toBe(ownerPub);
  expect(dec!.rumor.id).toBe(rumorId);
  expect(decodeWrap(wrap, planeKeyFor(keys, { plane: "guestbook" }).convKey)).toBeNull();
});
```
This IS the direct analog for WIRE-11's round-trip proof: supply `ephemeralSk` in the fifth-argument opts bag, decode the returned `wrap`, and additionally assert `wrap.tags.find(t => t[0] === "p")?.[1] === bytesToHex(getPublicKey(suppliedSk))`.

## Shared Patterns

### The four-step messaging shape
**Apply to:** All three D-01 signature changes
```typescript
this.requireChannelKey(channelId);
const epoch = this.channelEpoch(channelId);
const rumor = await bindToChannel(channelId, epoch)(await <factory-call>);
await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
```

### Manually applying an `EventOperation` to an awaited factory result
**Source:** the `bindToChannel(channelId, epoch)(await factory)` call itself, present in every method above
**Apply to:** `deleteMessage`'s `ensureKTag` fix — same idiom, one more operation composed onto the resolved template before it's handed to `bindToChannel`.

### Namespaced `debug` logging (D-11, carried forward from Phase 12.2)
**Source:** `community.ts`'s existing `this.decodeLog(...)`, `this.log(...)`, `this.publishLog(...)`, `this.syncLog` fields (all derived once, e.g. `debug(...)` calls elsewhere in the class constructor) — no new logging is introduced by this phase's edits, but if any new log line is added it must reuse an already-derived `Debugger`, never `.extend()` inline at a call site.
**Apply to:** any log statement touched incidentally while editing `route()` or `publishToPlane`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|

## Metadata

**Files scanned:** 13 read directly, plus 2 greps (`admin.ts` write site, `voice` sweep across `apps/`)
**Pattern extraction date:** 2026-07-29
