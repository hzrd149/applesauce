# Phase 11: Messaging Wire Conformance - Research

**Researched:** 2026-07-29
**Domain:** Nostr wire-shape conformance inside `packages/concord` (NIP-59 reversed streams, NIP-09 delete, NIP-25 reaction, NIP-22 threaded comment) against the external CORD-01/03/07 specs
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Target-kind API shape (WIRE-03 / WIRE-04 / WIRE-05)**

- **D-01:** `react()`, `replyToThread()`, and `deleteMessage()` **change signature to
  take the full target `Rumor`** instead of `{ id, author }` / a bare id string. The
  caller has already rendered the message it is acting on, so it holds the rumor.
  ```ts
  async react(channelId: string, target: Rumor, reaction: string | Emoji): Promise<void>
  async replyToThread(channelId: string, parent: Rumor, body: string): Promise<void>
  async deleteMessage(channelId: string, target: Rumor): Promise<void>
  ```
  Rejected: an in-engine plane-store lookup by id (adds a "target not yet synced"
  failure mode whose graceful-degrade branch silently reinstates the bug), and a
  `Rumor | { id; author }` union (leaves the wrong path callable forever — the
  enumerated-patch shape this project has repeatedly rejected).

- **D-02:** **No upstream factory changes are required.** All three factories already
  handle a full event/rumor correctly; concord's only defect is passing an identity
  instead. Verified: `DeleteFactory.fromEvents`'s `isEvent(event)` branch calls
  `ensureKTag(tags, event.kind)`; `ReactionFactory`'s `ReactionParent` union includes
  `Rumor`; `CommentFactory`'s `"tags" in parent` branch calls `createCommentTagsForEvent`
  — the verbatim-root-inheritance path.

- **D-03:** The `setParent` else-branch **throws** on a comment-kind pointer:
  `"Comment pointer cannot be a comment kind. please pass the full nip-22 comment
  event"`. `replyToThread` currently escapes that guard only because it hardcodes
  `kind: kinds.ForumThread` — it mislabels the parent. Depth-2 nesting therefore does
  not fail loudly today; it **silently re-roots**. A regression test must cover the
  depth-2 case specifically, not just depth-1.

**Voice presence delivery (WIRE-02)**

- **D-04:** **Delete the drop; route 23313 into the plane store like any other rumor.**
  Two symmetric sites, both go: `packages/concord/src/client/community.ts:682`,
  `packages/concord/src/client/private-channel.ts:316`. Consumers read it via the
  already-public raw store — `channelStore(channelId)` (`client/community.ts:607`)
  with `.timeline([{ kinds: [23313] }])`. Accepted trade-off: 23313 is ephemeral
  presence and a rumor store is durable, so presence accumulates and consumers must
  apply their own freshness window. A dedicated time-windowed `voicePresence$` was
  considered and rejected as out-of-proportion.

- **D-05:** Two comments must be corrected alongside the deletion, or they become
  false: the funnel doc-comment at `client/community.ts:679-680` ("…and voice presence
  (not chat)") and the deferral note at (the actual path is
  `packages/concord/src/__tests__/roundtrip.test.ts:3-4`, not `client/__tests__/` as
  CONTEXT.md states — see Pitfalls) ("§9 voice … deferred with their phases").

**`voice` flag removal (WIRE-01)**

- **D-06:** **Hard removal.** Delete `ChannelMetadata.voice` (`types.ts:120-121`),
  `CreateChannelOptions.voice` (`client/admin.ts:55-56`), the write at
  `client/admin.ts:188`, and the fold line at `helpers/control.ts:311`. Do **not**
  route it into `custom`. Removing the field from the type is itself the structural
  guard — `tsc` fails any reintroduced read. No additional assertion needed.

**Ephemeral wrap key retention (WIRE-11)**

- **D-07:** **Caller-supplied via `WrapOptions`.** Add `ephemeralSk?: Uint8Array`;
  `buildWrap` uses it when given and generates as today when not.
  ```ts
  export type WrapOptions = { ephemeral?: boolean; created_at?: number; ephemeralSk?: Uint8Array };
  const sk = opts.ephemeralSk ?? generateSecretKey();
  const decoyPubkey = getPublicKey(sk);
  ```
  Rejected: attaching the secret via a non-enumerable symbol (puts a secret key on
  the object that gets published).

- **D-08:** **Retention only.** Ship the plumbing plus a test proving the supplied key
  round-trips to the emitted `p` tag. The NIP-09 giftwrap-delete flow is a consumer
  concern and appears in no WIRE requirement.

**Milestone conventions carried forward**

- **D-09:** **No changeset** — concord is unreleased. This is a deliberate override of
  ROADMAP.md Phase 11 success criterion 1 ("breaking change; changeset + migration
  note included"). `verify-phase` must score criterion 1 on the field removal alone.

- **D-10:** **Fixtures are vendored.** Transcribe the relevant `examples.md` tag sets
  into a checked-in fixture file under `packages/concord/src/__tests__/`. Every
  fixture entry must carry its CORD section citation. Note L11: existing comments
  cite `CORD-06 §94`, a section that does not exist — do not copy that citation
  style.

- **D-11:** Namespaced `debug` logging convention from Phase 12.2 applies; derive the
  `Debugger` once and never `.extend()` at a call site.

### Claude's Discretion

- How `ephemeralSk` reaches an app-level caller — open for research and planning (see
  the dedicated section below; recommendation provided).
- Whether `Rumor` or a narrower structural type is the right parameter type for D-01's
  three signatures (recommendation provided).
- Fixture file name, location within `__tests__/`, and internal structure.
- Test file organization — extending existing concord suites vs. a new
  wire-conformance suite.

### Deferred Ideas (OUT OF SCOPE)

- A time-windowed `voicePresence$` observable — rejected for this phase (D-04).
- The NIP-09 giftwrap-delete flow built on D-07's retained key — retention only
  this phase (D-08).
- `deleteChannel` preserving `custom` (L02/WIRE-10) — Phase 12.
- Comment citations of the non-existent `CORD-06 §94` (L11/WIRE-12) — Phase 12.
- `sendMessage`'s `replyTo?: { id; author }` (routes to NIP-C7 `q` tag only, correct
  as written) — not in scope for WIRE-04.
- WIRE-06 through WIRE-10 and WIRE-12 — Phase 12.
- CORD-07 §2/§3/§5/§6/§7 broker/media/rendezvous transport — FUT-02.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-01 | `ChannelMetadata.voice` removed — every channel is callable, no per-channel voice flag | Confirmed 4 in-package sites (D-06) are exhaustive for `packages/concord/src`, **plus two additional out-of-package sites CONTEXT.md's table missed**: `apps/examples/src/examples/concord/admin-management.tsx` (4 usages) and `apps/docs/concord/channels.md` (1 usage) — see Pitfalls/removal-sweep findings below |
| WIRE-02 | Kind 23313 reaches consumers via the receive funnel | D-04 confirmed exhaustive (exactly 2 sites); typing (23311) precedent confirmed by absence of any special-case for it in either routing file |
| WIRE-03 | Reaction `k` tag names the real target kind | `ReactionFactory`/`setReactionParent` verified to already support `Rumor` via the `ReactionParent` union — zero upstream edits needed, confirmed by direct source read |
| WIRE-04 | Threaded reply inherits root verbatim, derives `K`/`k` from real kind | `createCommentTagsForEvent`'s `parent.kind === COMMENT_KIND` branch verified by direct source read to correctly re-derive the deeper root via `getCommentRootPointer` — this is the depth-2 mechanism; exact CORD-03 §3 citation + `examples.md` §2.2 fixture transcribed below |
| WIRE-05 | Delete carries `k` tag naming target's kind | **Critical correction to D-02's stated mechanism** — see "The DeleteFactory/Rumor mismatch" pitfall below; `ensureKTag`-based fix recommended |
| WIRE-11 | Client can retain a wrap's ephemeral key | Full call-chain traced (`WrapOptions` → `wrapForTarget` → `publishToPlane` → `sendEvent`); recommended plumbing path documented below |
</phase_requirements>

## Summary

This phase has no crypto derivations and installs no new external packages — it is a
surgical wire-shape/tag-emission fix confined almost entirely to
`packages/concord/src/client/community.ts`, `helpers/keys.ts`, `operations/gift-wrap.ts`,
`types.ts`, `client/admin.ts`, and `helpers/control.ts`, plus one vendored fixture file.
CONTEXT.md's D-01 through D-11 are well-supported by direct source inspection: every
site it names checked out exactly as stated. Two things sharpen the plan beyond what
CONTEXT.md settled:

First, **D-02's claim for `deleteMessage` needs a mechanism correction, not a reversal.**
`DeleteFactory.fromEvents`'s `isEvent(event)` branch (the one that calls `ensureKTag`)
requires `typeof event.sig === "string"`. A Concord `Rumor` (`UnsignedEvent & { id:
string }`, re-exported from `applesauce-common/helpers`) **has no `sig` field by
design** — NIP-59 rumors are never individually signed. So passing `target: Rumor`
straight into `DeleteFactory.fromEvents([target])` takes the *bare-string* else-branch
regardless of D-01's signature change, and the `k` tag is still never emitted — the
exact bug WIRE-05 exists to close survives silently. The fix stays entirely inside
concord (no core/common edit, so D-02's "no upstream changes" conclusion holds): pass
only `target.id` into `fromEvents`, then explicitly apply `ensureKTag(draft.tags,
target.kind)` to the resolved template before `bindToChannel` — mirroring the exact
"manually apply an `EventOperation` to an awaited factory result" idiom this file
already uses for `bindToChannel` itself. `ensureKTag` is already re-exported publicly
from `applesauce-core/helpers/factory` via `helpers/index.ts`, so nothing new needs
exporting.

Second, **the external CORD-01/03/07 specs and `examples.md` were fetched directly**
(not paraphrased) from `github.com/concord-protocol/concord` — note the actual default
branch is `main`, not `master` as CONTEXT.md's canonical-refs section states (both
resolve to identical content today via `raw.githubusercontent.com`, but `main` is the
verifiable, API-confirmed default branch and should be the citation the vendored
fixture file uses). The exact tag sets for the reaction, threaded reply (including the
depth-2/root-inheritance sentence), delete, and voice-presence rumors are transcribed
verbatim below with their section citations, ready to drop into a vendored fixture file.

**Primary recommendation:** Implement D-01 exactly as specified, but fix `deleteMessage`
via an explicit `ensureKTag` application (not a bare pass-through to `DeleteFactory`);
thread `ephemeralSk` only as far as the already-public, already-generic `sendEvent(...,
opts)` method (which already forwards its `opts` unchanged to `publishToPlane`) — do
not add new parameters to `react`/`replyToThread`/`deleteMessage`/`sendMessage`, which
hardcode `{}` today and have no use case needing key export; and vendor the vendored
fixture directly from the verified `examples.md` §2.1–2.4/2.8 transcription below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reaction/reply/delete tag shape | API/Backend (SDK event-construction layer) | — | Pure event-draft construction inside `packages/concord`'s factories/operations layer; no network or storage concerns |
| Voice presence delivery | API/Backend (SDK receive funnel) | Database/Storage (plane `RumorStore`) | `route()` decides what reaches the store; the store is where a consumer app later reads it — this phase only removes a `return` in the funnel, it does not add a consumer-facing model |
| `voice` flag removal | API/Backend (SDK type + admin write path) | Browser/Client (example app UI) | The type and write/fold sites are all in `packages/concord/src`; the *consuming* UI checkbox lives in `apps/examples` (Browser/Client tier) and must be updated in lockstep or it fails `tsc` |
| Ephemeral wrap key retention | API/Backend (SDK crypto/envelope layer) | — | Key generation/threading happens entirely inside `operations/gift-wrap.ts`/`helpers/keys.ts`; no UI or storage tier is implicated by "retention only" (D-08) |

## Standard Stack

No new external packages are introduced by this phase. All work is internal to the
monorepo's existing `applesauce-core`, `applesauce-common`, and `applesauce-concord`
packages (`nostr-tools`, `@noble/hashes`, `applesauce-signers` are already dependencies
and already imported by the exact files this phase touches). **Package Legitimacy Audit
is not applicable** — no `npm install` is required for this phase.

## Architecture Patterns

### System Architecture Diagram

```
SEND SIDE (react / replyToThread / deleteMessage)
──────────────────────────────────────────────────
  caller holds a Rumor (from channelStore(channelId).timeline([...]))
        │
        ▼
  ReactionFactory.create(target: Rumor, reaction)         ← ReactionParent union already accepts Rumor
  CommentFactory.create(target: Rumor, body)              ← "tags" in parent branch already inherits root verbatim
  DeleteFactory.fromEvents([target.id])                   ← bare-id form (Rumor fails isEvent's `sig` check)
        │  (delete path only: explicit ensureKTag(draft.tags, target.kind) applied here)
        ▼
  bindToChannel(channelId, epoch)(draft)                   ← stamps ["channel", id] + ["epoch", n] + ["ms", n]
        │
        ▼
  publishToPlane({ plane: "channel", channelId }, rumor, opts)
        │
        ├─ wrapForTarget(keys, target, signer, rumor, opts)   ← opts.ephemeralSk threads here (WIRE-11)
        │        │
        │        ├─ toRumor → sealRumor(convKey) → wrapSeal(streamSk, convKey, { ephemeral, ephemeralSk })
        │        │        └─ buildWrap: sk = opts.ephemeralSk ?? generateSecretKey()   ← D-07
        │        ▼
        │  { wrap, rumorId }
        │
        ├─ onWrap(wrap)          (optimistic local echo, skipped when opts.ephemeral)
        └─ pool.publish(transport(), wrap)

RECEIVE SIDE (route() — the single funnel, shared by sync + live subscription)
────────────────────────────────────────────────────────────────────────────────
  onWrap(event) → decodeWrapCached(event, convKey) → route(info, decoded)
        │
        ▼
  if channel: checkChatBinding(tags, channelId, epoch) → drop on mismatch
        │
        ▼  (WIRE-02: this line is DELETED)
  [ if decoded.rumor.kind === VOICE_PRESENCE_KIND) return; ]
        │
        ▼
  storeFor(planeStoreKey(info)).add(decoded.rumor)     ← 23313 now lands here like any other rumor
        │
        ▼
  consumer: channelStore(channelId).timeline([{ kinds: [23313] }])
```

### Recommended Project Structure (files touched, no new directories)

```
packages/concord/src/
├── types.ts                         # ChannelMetadata.voice removed (WIRE-01)
├── client/
│   ├── admin.ts                     # CreateChannelOptions.voice + write site removed (WIRE-01)
│   ├── community.ts                 # react/replyToThread/deleteMessage signatures (D-01);
│   │                                #   VOICE_PRESENCE_KIND drop removed (WIRE-02);
│   │                                #   two stale comments corrected (D-05);
│   │                                #   sendEvent's opts gains ephemeralSk passthrough (WIRE-11)
│   └── private-channel.ts           # symmetric VOICE_PRESENCE_KIND drop removed (WIRE-02)
├── helpers/
│   ├── control.ts                   # fold line for `voice` removed (WIRE-01)
│   ├── keys.ts                      # wrapForTarget's opts gains ephemeralSk (WIRE-11)
│   └── __tests__/roundtrip.test.ts  # stale "§9 voice … deferred" comment corrected (D-05) — NOTE: actual
│                                     #   path is packages/concord/src/__tests__/roundtrip.test.ts, not
│                                     #   client/__tests__/ as CONTEXT.md states
├── operations/
│   └── gift-wrap.ts                 # WrapOptions.ephemeralSk; buildWrap uses it when supplied (D-07)
└── __tests__/
    └── <fixture-file>.ts            # vendored examples.md tag-set transcription (D-10)

apps/examples/src/examples/concord/
└── admin-management.tsx             # voice checkbox/state/render — MUST update alongside WIRE-01 removal
                                      #   (see Pitfalls: removal-sweep gaps)

apps/docs/concord/
└── channels.md                      # doc example `{ voice: true }` — MUST update (removal-sweep gap)
```

### Pattern 1: Manually applying an `EventOperation` to an awaited factory result

**What:** `EventFactory` subclasses expose only `protected chain(...)` — a caller
outside the factory class cannot call `.chain()` on `DeleteFactory.fromEvents(...)`'s
return value. But every factory is "promise-like": `await factory` resolves to a plain
`EventTemplate`, and any `EventOperation` (`(draft) => draft | Promise<draft>`) can be
applied to that plain object as an ordinary function call.
**When to use:** Composing one extra, factory-external transformation onto a resolved
template — exactly `deleteMessage`'s situation, and exactly the pattern
`bindToChannel(channelId, epoch)(await factory)` already uses everywhere else in this
file.
**Example:**
```ts
// Source: packages/concord/src/client/community.ts:1082 (existing precedent) +
// packages/core/src/helpers/factory.ts (ensureKTag, already publicly exported)
import { ensureKTag } from "applesauce-core/helpers/factory";

async deleteMessage(channelId: string, target: Rumor): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  const draft = await DeleteFactory.fromEvents([target.id]);
  const withKind = { ...draft, tags: ensureKTag(draft.tags, target.kind) };
  const rumor = await bindToChannel(channelId, epoch)(withKind);
  await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
}
```

### Pattern 2: The verbatim-root-inheritance mechanism (already correct, D-01/D-02 depend on it)

**What:** `createCommentTagsForEvent(parent)` (`packages/common/src/helpers/comment.ts:233`)
checks `parent.kind === COMMENT_KIND` (1111). If the reply target IS itself a kind-1111
comment, it calls `getCommentRootPointer(parent)` to read that comment's OWN root
tags (`E`/`K`/`P`) and re-emits those — not a pointer to the immediate parent — as the
new root. The immediate-parent `e`/`k`/`p` tags are always derived from `parent`
directly, so `k`/`K` always name the real kind of whatever was passed in.
**When to use:** This is why passing the full `Rumor` into `CommentFactory.create`
(via `setParent`) is sufficient for WIRE-04 with zero upstream edits — it already
handles depth-N nesting correctly, it just was never reachable because
`replyToThread` built a hand-rolled pointer instead of passing the real parent.
**Example — depth-2 nesting (this is the test case D-03 asks for):**
```ts
// thread: kind 11 (ForumThread), id T, author A
// reply1 = replyToThread(channelId, thread /* Rumor */, "first")
//   -> tags: E=T,K=11,P=A (root) + e=T,k=11,p=A (parent==root, same thing)
// reply2 = replyToThread(channelId, reply1 /* Rumor, kind 1111 */, "second")
//   -> tags: E=T,K=11,P=A (root INHERITED from reply1, not re-pointed at reply1)
//         + e=reply1.id,k=1111,p=A (parent tags point at the real immediate parent, real kind)
```

### Anti-Patterns to Avoid

- **Casting a `Rumor` to `NostrEvent` with a fake `sig`** to force `DeleteFactory`'s
  `isEvent` branch to fire. This "works" but lies about signature state on an object
  that later code may treat as verified; use the explicit `ensureKTag` application
  instead (Pattern 1).
- **Widening `react`/`replyToThread`/`deleteMessage` to accept `Rumor | { id; author
  }`.** CONTEXT.md's D-01 already rejects this for the concord-level signature; the
  same logic applies to any narrower union invented at the `ensureKTag`-fix site — do
  not reintroduce an alternate path that can still drop the `k` tag.
- **Adding `ephemeralSk` as a new parameter to `react`/`replyToThread`/`deleteMessage`/
  `sendMessage`/`sendThread`/`editMessage`.** These all hardcode `publishToPlane(...,
  {})` today; none of them are the giftwrap-delete use case WIRE-11 exists for. Adding
  a parameter to each is exactly the kind of signature sprawl this phase's own D-01
  discussion already pushed back against once.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Emitting a `k` tag for a delete/reaction/threaded-reply target | A new tag-construction helper in concord | `ensureKTag` (`packages/core/src/helpers/factory.ts`, publicly exported) | Already the exact function `setDeleteEvents`'s own `isEvent` branch calls; concord should call the identical helper directly rather than inventing an equivalent |
| Root-tag inheritance for nested comment replies | Manual `E`/`K`/`P` tag construction in `replyToThread` | `CommentFactory.create(parent: Rumor, body)` → `setParent` → `createCommentTagsForEvent` | Already implements CORD-03 §3's exact rule (verbatim root inheritance at any depth); a hand-rolled version would have to re-derive `getCommentRootPointer`'s logic and risks silently diverging |
| Ephemeral-key generation for the wrap's decoy `p` tag | A separate keypair-generation utility | `generateSecretKey()`/`getPublicKey()` from `applesauce-core/helpers/keys` (already imported in `operations/gift-wrap.ts`) | Same primitive already used for the non-supplied-key path; D-07 only adds a caller-supplied override, not a new generation mechanism |

**Key insight:** Every requirement in this phase is closable by *removing* a
hand-rolled shortcut (a hardcoded kind, a hand-built pointer, a dropped return, a
discarded key) and routing through machinery that already exists and is already
correct. The only place that needs a genuinely new line of logic is the
`ensureKTag` application for `deleteMessage`, and even that reuses an existing
exported helper.

## Common Pitfalls

### Pitfall 1: `DeleteFactory.fromEvents([target])` will NOT emit `k` for a real `Rumor` (correction to D-02's stated mechanism)

**What goes wrong:** `setDeleteEvents` (`packages/core/src/operations/delete.ts:8`)
branches on `isEvent(event)`, which requires `typeof event.sig === "string"`
(`packages/core/src/helpers/event.ts:93-102`). A Concord `Rumor` (`UnsignedEvent & {
id: string }`) never has a `sig` — that is the entire point of NIP-59 rumors. So
`isEvent(target)` returns `false` for any genuine message rumor, and `setDeleteEvents`
silently takes its bare-string else-branch (`ensureEventPointerTag(tags, { id: event
})`, which is itself malformed if `event` is an object, not a string) — the `k` tag is
never added, reproducing L03/WIRE-05 even after D-01's signature is implemented.
**Why it happens:** CONTEXT.md's D-02 verification table describes the `isEvent`
branch's *behavior* correctly but does not check whether a Concord `Rumor` actually
satisfies `isEvent` at runtime — it doesn't, because `Rumor` deliberately excludes `sig`.
**How to avoid:** Pass only `target.id` (a string) into `DeleteFactory.fromEvents([...])`
so the bare-string branch runs deliberately, then explicitly apply `ensureKTag(draft.tags,
target.kind)` to the resolved template before `bindToChannel` — see Pattern 1 above.
This requires zero core/common edits, so D-02's *conclusion* ("no upstream changes
required") still holds; only the *mechanism* changes.
**Warning signs:** A test that passes a full signed `NostrEvent` (with a real `sig`)
as the delete target would pass `isEvent` and mask this bug entirely — the depth-2-style
non-vacuity discipline this milestone has repeatedly required (TEST-01) means the
delete test MUST construct its target as a genuine `Rumor` (no `sig` field), not a
signed event, or it will falsely green a still-broken path.

### Pitfall 2: Depth-1-only regression tests pass today even though nesting is broken (D-03)

**What goes wrong:** `replyToThread`'s current hand-built pointer hardcodes `kind:
kinds.ForumThread` (11) regardless of what the real parent's kind is. `setParent`'s
guard (`if (parent.kind === COMMENT_KIND) throw`) can never fire because the pointer
is mislabeled — so replying to an actual kind-1111 comment (a depth-2 case) silently
re-roots onto the wrong target instead of throwing or correctly inheriting.
**Why it happens:** A pointer, unlike a full event/rumor, carries no `tags`, so
`setParent` can never distinguish "this pointer represents a comment" from "this
pointer represents a message" except by the (currently hardcoded, currently wrong)
`kind` field the caller supplies.
**How to avoid:** After D-01, `replyToThread(channelId, parent: Rumor, body)` passes
the real `Rumor` (with its real `tags`/`kind`) straight to `CommentFactory.create`,
which takes the `"tags" in parent` branch and correctly walks to the deeper root via
`getCommentRootPointer` when `parent.kind === COMMENT_KIND`. The regression test MUST
build a two-level chain (thread → reply1 → reply2) and assert reply2's `E`/`K`/`P`
inherit from the *thread*, not from reply1 — see Pattern 2's worked example.
**Warning signs:** A test that only exercises "reply to the thread root" (depth-1)
will pass both before and after the fix and gives zero confidence the re-rooting bug
is closed — this is exactly what CONTEXT.md's D-03 flags.

### Pitfall 3: The WIRE-01 removal sweep is not exhaustive at the four sites CONTEXT.md's table lists

**What goes wrong:** CONTEXT.md's "Confirmed sites" table lists four `voice` sites, all
inside `packages/concord/src`. A repo-wide grep for `voice` (excluding voice-key/media
identifiers like `VOICE_PRESENCE_KIND`/`voice_key`/`voice_media_key`, which are
unrelated CORD-07 crypto terms, not the abolished flag) finds two more real
**consumers** of the field that will fail to compile once it's removed:
- `apps/examples/src/examples/concord/admin-management.tsx` — a `voice` state
  variable (line 688), a `{ private: isPrivate, voice }` call into `createChannel`
  (line 694), a checkbox bound to it (line 737), and a render read `channel.voice ? "
  · voice" : ""` (line 759) — four distinct usages in one file.
- `apps/docs/concord/channels.md` — a doc code example: `// A voice channel; const
  voiceId = await community.admin.createChannel("lounge", { voice: true });` (lines 14-15).
**Why it happens:** CONTEXT.md's audit scope was `packages/concord/src` only; it did
not sweep `apps/examples` or `apps/docs`, which import and consume the package.
**How to avoid:** Update `admin-management.tsx` (drop the voice state/checkbox/render
branch) and `channels.md` (drop the `{ voice: true }` example) in the same plan wave
that removes the type field, or a subsequent `tsc -b` on `apps/examples` breaks.
**Warning signs:** `pnpm test`'s root script is `turbo build --filter='./packages/*'
&& vitest run` — it does **not** build `apps/examples` (confirmed via `package.json`/
`turbo.json`), so this gap will NOT surface as a test failure. It surfaces only under
the unfiltered `pnpm build` (which `turbo.json`'s `dependsOn: ["^build"]` graph does
include `apps/examples` for), or a manual `tsc -b` in that app. Do not rely on the
test suite to catch this; verify explicitly.

### Pitfall 4: `private-channel.ts` has no send/publish methods — do not thread `ephemeralSk` there

**What goes wrong:** Assuming symmetry with WIRE-02's two-site fix (community.ts +
private-channel.ts), a plan might also thread `ephemeralSk` through
`ConcordPrivateChannel`.
**Why it happens:** `ConcordPrivateChannel` looks like a peer engine to
`ConcordCommunity`, but it is receive-only — a grep for `async send`/`publish` inside
`private-channel.ts` returns nothing. All sending (public or private channels alike)
goes through `ConcordCommunity`'s methods (`sendMessage`, `sendEvent`, `react`,
`replyToThread`, `deleteMessage`, `sendThread`, `editMessage`), gated by
`requireChannelKey(channelId)`, which itself branches on whether the channel is
private.
**How to avoid:** The entire WIRE-11 plumbing chain (`WrapOptions` → `wrapForTarget` →
`publishToPlane` → `sendEvent`) lives only in `helpers/keys.ts` and
`client/community.ts`. `private-channel.ts` needs no WIRE-11 changes at all.
**Warning signs:** N/A — this is a scoping check, not a runtime symptom.

## Ephemeral Key Plumbing (WIRE-11 / D-07's open discretion item)

**The full call chain, traced from `buildWrap` outward:**

```
buildWrap(seal, streamSk, convKey, opts: WrapOptions)      operations/gift-wrap.ts:66  (D-07 lands here)
  ← wrapSeal(streamSk, convKey, opts)                      operations/gift-wrap.ts:86
    ← wrapForTarget(keys, target, author, rumor, opts)      helpers/keys.ts:232
        opts: { plaintext?, ephemeral?, ephemeralSk? }      ← needs the new field
      ← publishToPlane(target, rumor, opts)                 client/community.ts:1574
          opts: { plaintext?, ephemeral?, ephemeralSk? }    ← needs the new field
        ← sendEvent(channelId, source, opts)                 client/community.ts:1031  ← ALREADY PUBLIC,
            opts: { plaintext?, ephemeral?, ephemeralSk? }   ← needs the new field       ALREADY forwards
                                                                                          opts unchanged
        ← react / replyToThread / deleteMessage / sendMessage / sendThread / editMessage
            ALL hardcode `publishToPlane(..., {})` — opts is NOT exposed to their own callers today
```

**Recommendation: thread `ephemeralSk` through exactly three signatures — `WrapOptions`
(D-07, already decided), `wrapForTarget`'s `opts`, and `publishToPlane`'s `opts` — and
stop there.** Do not add `ephemeralSk` params to the six specialized methods. The one
already-public, already-generic escape hatch (`sendEvent(channelId, source, opts)`) is
the natural and *sufficient* place an app-level caller reaches this option: it already
takes an `opts: { plaintext?; ephemeral? }` bag and forwards it unchanged to
`publishToPlane` — this is precisely the existing "raw plane path" the class's own
doc-comment recommends for anything beyond the common cases (`/** ... this is the raw
plane path used for control/guestbook seeding ...`, though that comment predates this
option, the mechanism is identical for channel sends via `sendEvent`).

**Why not the other two options considered:**
- *Threading it into all six specialized methods* — sprawls six public signatures for
  a feature none of them individually need; contradicts D-01's own stated aversion to
  signature sprawl.
- *Returning the ephemeral key out of `publishToPlane`/`sendEvent`* — unnecessary
  because D-07's shape is caller-*supplies*, not engine-*generates-and-returns*: a
  caller wanting retention already holds the key before calling (it generated it
  itself via the same `generateSecretKey()` concord already imports), so there is
  nothing to hand back.

**D-08's round-trip test** should exercise `wrapForTarget` directly (mirroring the
existing pattern at `helpers/__tests__/keys.test.ts:59-81`, which already builds a
wrap and decodes it): supply a known `ephemeralSk`, decode the returned `wrap`, and
assert `wrap.tags.find(t => t[0] === "p")?.[1] === bytesToHex(getPublicKey(suppliedSk))`.
No `ConcordClient`/`sendEvent` involvement is required for this proof, since the
option is a pure passthrough by the time it reaches `buildWrap`.

## Vendored Fixture Transcription (D-10)

Fetched directly from `github.com/concord-protocol/concord` (confirmed default branch
via `api.github.com/repos/concord-protocol/concord` is **`main`**, not `master` as
CONTEXT.md's canonical-refs section states — `raw.githubusercontent.com/.../master/...`
happens to resolve identically today, but the vendored fixture file and its comments
should cite `main`, the API-verified default branch, in case that legacy alias is ever
retired). File-level disclaimer, quoted directly from the source: **"Non-normative...
if an example here disagrees with a CORD, the CORD wins."** — the vendored fixture
should carry this same caveat forward, and TEST-01's fixture-anchored obligation for
this phase should cite the CORD prose (below) as the primary authority whenever a tag
set and prose could be read to disagree.

### Reaction (kind 7) — `examples.md` §2.3

```jsonc
{
  "kind": 7,
  "pubkey": "<reactor>",
  "content": "🔥",
  "tags": [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "112"],
    ["e", "<message rumor id>"],
    ["p", "<message author>"],
    ["k", "9"]
  ],
  "created_at": 1686840350
}
```
Citation: `examples.md` §2.3 "Kind 7 — Reaction". Note the `["channel", ...]`/
`["epoch", ...]` binding tags precede the NIP-25 `e`/`p`/`k` tags — these are added by
`bindToChannel`, not by `ReactionFactory`, so a fixture test asserting the factory's
own output in isolation should assert only the `e`/`p`/`k`/content shape; a fixture
test asserting the full published rumor (post-`bindToChannel`) should assert all six
tags in this order.

### Threaded reply (kind 1111) — `examples.md` §2.2, CORD-03 §3 ("Messages")

```jsonc
{
  "kind": 1111,
  "pubkey": "<author>",
  "content": "Replying in the thread!",
  "tags": [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "744"],
    ["K", "9"],
    ["E", "<thread root rumor id>", "", "<root author>"],
    ["P", "<root author>"],
    ["k", "9"],
    ["e", "<immediate parent rumor id>", "", "<parent author>"],
    ["p", "<parent author>"]
  ],
  "created_at": 1686840360
}
```
Citation: `examples.md` §2.2 "Kind 1111 — Threaded reply". Verbatim prose directly
above the fixture: *"Uppercase `K`/`E`/`P` pin the immutable thread root; lowercase
`k`/`e`/`p` pin the immediate parent. All ids are rumor ids (never the outer wrap's).
When the parent is itself a reply, its uppercase root tags are inherited verbatim, so
the root stays stable at any nesting depth."* And directly below it: *"Reactions,
edits, and deletes target a threaded reply exactly as they target a kind-9 message (by
its rumor id); the `k` tag they carry names the target's kind (`1111` for a reply, `9`
for a message)."* — this is the exact source for WIRE-03's "reacting to a kind-1111
reply must emit `k=1111`" and WIRE-05's "delete must name the real target kind"
requirements. CORD-03 §3 restates the same rule in prose: *"A reply inherits its
parent's uppercase root tags verbatim, so the root stays stable at any depth... [and]
reactions, edits, and deletes target either by rumor id (their `k` tag naming `9` or
`1111`)."*

### Deletion (kind 5) — `examples.md` §2.4, CORD-01 §Deletions

```jsonc
{
  "kind": 5,
  "pubkey": "<author>",
  "content": "",
  "tags": [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "533"],
    ["e", "<own message rumor id>"],
    ["k", "9"]
  ],
  "created_at": 1686841000
}
```
Citation: `examples.md` §2.4 "Kind 5 — Delete". Verbatim: *"NIP-09 shape: `e` tags name
the author's own rumors to delete, `k` their kind, `content` an optional reason."* The
adjacent giftwrap-deletion sentence (WIRE-11's authority) lives in CORD-01's
"Deletions" section (no numbered §, cited as `CORD-01 §Deletions` per CONTEXT.md's own
style — confirmed correct, this section has no sub-numbering): *"Users delete their
content in a stream by sending giftwrapped kind 5 deletion events to it. They can also
delete their own giftwraps by `p` tag (on NIP-59-supporting relays) if the client saved
the ephemeral key."*

### Voice presence (kind 23313) — `examples.md` §2.8, CORD-07 §4 ("Presence")

```jsonc
// Joined (also the heartbeat, repeats every 30s)
{
  "kind": 23313,
  "pubkey": "<member>",
  "content": "joined",
  "tags": [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["identity", "<SFU identity>"],
    ["broker", "https://broker.example"],
    ["ms", "417"]
  ],
  "created_at": 1686840217
}

// Left (best-effort; a missed one heals by staleness)
{
  "kind": 23313,
  "pubkey": "<member>",
  "content": "left",
  "tags": [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "902"]
  ],
  "created_at": 1686840305
}
```
Citation: `examples.md` §2.8 "Kind 23313 — Voice presence"; identical tag shape given
in CORD-07 §4 "Presence". Verbatim, CORD-07 §1 "Voice Keys" (the WIRE-01 authority,
confirmed alongside CORD-03 §2's identical sentence already cited by CONTEXT.md):
*"Every Channel is callable — there is no separate 'voice Channel' type."*

**Note for the vendored test:** WIRE-02's success criterion is "reaches consumers
through the receive funnel" — the fixture test for this requirement is necessarily
different in shape from the other three (there is no factory emitting this tag set in
concord yet; it's a receive-path test). The correct assertion is: publish a
kind-23313-shaped rumor through the same wrap/seal path the other rumors use, verify
it is NOT dropped by `route()`, and lands in `channelStore(channelId).timeline([{
kinds: [23313] }])` — asserting its tags match this transcribed shape guards against a
future regression that mangles the tags on the way in, even though concord's send side
for voice presence is out of this phase's scope (voice is CORD-07 §2/§3/§5 territory,
deferred as FUT-02).

## Runtime State Inventory

Not applicable — this phase is a wire-shape/tag-emission fix and a type-field removal,
not a rename/refactor/migration of an identifier or string across systems. `voice` as
a *word* is not being renamed; the `ChannelMetadata.voice` *field* is being deleted
outright (D-06, D-09: no migration, concord is unreleased so no persisted community
document anywhere carries this field in a way any real deployment needs to migrate).
No stored data, live service config, OS-registered state, secrets/env vars, or build
artifacts reference this field by name outside the source tree — confirmed by the
repo-wide `voice` grep in the Pitfall 3 finding above, which found only source and
documentation sites, no runtime/config/secret state.

## Assumptions Log

No claims in this research are tagged `[ASSUMED]`. Every factual claim was verified
either by direct source-code inspection (`Read`/`grep` against the actual files) or by
directly fetching the raw CORD spec text (`curl` against `raw.githubusercontent.com`,
cross-checked byte-for-byte against the API-confirmed `main` branch). The one
genuinely open question (how far to thread `ephemeralSk`) is presented as a reasoned
recommendation under Claude's Discretion, not as a factual claim.

**If this table is empty:** All claims in this research were verified or cited — no
user confirmation needed.

## Open Questions

1. **Is fixing `apps/examples`/`apps/docs`'s `voice` usages in-scope for this phase's
   plans, or a follow-up?**
   - What we know: they will fail `tsc -b`/`vite build` once the field is removed;
     they are NOT caught by `pnpm test`'s filtered build.
   - What's unclear: whether the plan should include a small task fixing both files,
     or flag them as a fast-follow outside the phase's roadmap-listed success criteria
     (which only mention "no per-channel voice flag is read, written, or gated on" —
     arguably these ARE gating reads).
   - Recommendation: fix both in this phase — the edits are mechanical (delete four
     lines in the `.tsx`, delete two lines in the `.md`), low-risk, and leaving them
     broken defeats D-09's own "removing the field is itself the structural guard"
     reasoning (the guard is meaningless if the workspace no longer builds clean).

2. **`Rumor` vs. a narrower structural type for D-01's three signatures.**
   - What we know: `Rumor = UnsignedEvent & { id: string }` is already the type
     `channelStore(...).timeline(...)` returns, already imported in `types.ts`
     (re-exported from `applesauce-common/helpers`), and already accepted by
     `ReactionParent`/`CommentParent` unions.
   - What's unclear: whether a narrower type (e.g., `Pick<Rumor, "id" | "pubkey" |
     "kind" | "tags">`) would be more defensive against accidental signed-event
     mix-ups.
   - Recommendation: use `Rumor` as-is. It is the type callers already hold (no
     up-conversion needed at call sites), matches CONTEXT.md's own D-01 code sample
     verbatim, and a narrower structural type would still need `tags` for
     `CommentFactory`'s root-inheritance path — there is no meaningful subset smaller
     than `Rumor` that serves all three call sites (`react` needs `id`/`pubkey`/`kind`;
     `replyToThread`/`deleteMessage` also need `tags` for the comment/kind-check
     paths), so introducing a new type adds a name with no narrowing benefit.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (`vitest run` at root, workspace-aware) |
| Config file | `vitest.config.ts` (root) + `vitest.workspace.ts` |
| Quick run command | `pnpm --filter applesauce-concord test` (or `vitest run` from `packages/concord`) |
| Full suite command | `pnpm test` (root: `turbo build --filter='./packages/*' && vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-01 | `ChannelMetadata`/`CreateChannelOptions` no longer have `voice`; `tsc` fails any reintroduced read | type-level (compile guard) + unit | `pnpm --filter applesauce-concord build` (tsc); existing `community.test.ts`/`control.test.ts` channel-fold tests must not reference `voice` | ✅ existing files, edit in place |
| WIRE-02 | Kind 23313 lands in `channelStore(...).timeline([{kinds:[23313]}])` instead of being dropped | integration (route() through the real wrap/decode path) | `vitest run community.test.ts -t "voice presence"` (new test) | ❌ Wave 0 — new `it(...)` block in `client/__tests__/community.test.ts` (and the symmetric case in `private-channel.test.ts`) |
| WIRE-03 | `react()` on a non-kind-9 target (e.g. a kind-1111 reply) emits `k` naming the real kind | unit, fixture-anchored | `vitest run community.test.ts -t "reaction k tag"` (new test) | ❌ Wave 0 — asserts against the vendored §2.3 fixture tag set |
| WIRE-04 | `replyToThread` at depth 1 (off kind-9) and depth 2 (off a kind-1111 reply) produce correct `K`/`E`/`P` vs `k`/`e`/`p` | unit, fixture-anchored, MUST cover depth-2 | `vitest run community.test.ts -t "threaded reply"` (new test) | ❌ Wave 0 — the depth-2 case per Pitfall 2/D-03 is the critical non-vacuity case |
| WIRE-05 | `deleteMessage` emits `k` naming the real target kind, using a genuine unsigned `Rumor` target (not a signed event) | unit, fixture-anchored | `vitest run community.test.ts -t "delete k tag"` (new test) | ❌ Wave 0 — MUST construct the target without a `sig` field, per Pitfall 1 |
| WIRE-11 | A supplied `ephemeralSk` round-trips to the wrap's `p` tag | unit | `vitest run keys.test.ts -t "ephemeralSk"` (new test, extends existing file) | ❌ Wave 0 — extend `helpers/__tests__/keys.test.ts`, reusing its existing `wrapForTarget` + `decodeWrap` pattern (lines 59-81) |

### Sampling Rate

- **Per task commit:** `pnpm --filter applesauce-concord test` (fast — concord's own suite)
- **Per wave merge:** `pnpm test` (root — full workspace, `turbo build --filter='./packages/*' && vitest run`)
- **Phase gate:** Full suite green before `/gsd-verify-work`, **plus** a manual
  `pnpm --filter applesauce-examples build` (or equivalent `tsc -b` in `apps/examples`)
  to catch the WIRE-01 removal-sweep gap the root test script does not exercise
  (Pitfall 3).

### Wave 0 Gaps

- [ ] A vendored fixture file under `packages/concord/src/__tests__/` transcribing the
      four tag sets above (reaction, threaded reply, delete, voice presence), each
      with its `examples.md`/CORD section citation (D-10) — every other Wave 0 test
      below should import from this file, not hardcode its own copy of the tag set.
- [ ] `client/__tests__/community.test.ts` — new `it()` blocks for WIRE-02 (voice
      presence reaches the store), WIRE-03 (reaction `k` on a non-9 target), WIRE-04
      (depth-1 AND depth-2 threaded reply), WIRE-05 (delete `k`, built from a
      sig-less `Rumor`)
- [ ] `client/__tests__/private-channel.test.ts` — symmetric WIRE-02 case for the
      private-channel receive path
- [ ] `helpers/__tests__/keys.test.ts` — extend with a WIRE-11 `ephemeralSk`
      round-trip case
- [ ] Update (don't add) `community.test.ts:324-361`'s existing "MissingChannelKeyError"
      table-driven test — its `target` local (currently `{ id, author }`) must become
      a genuine `Rumor` shape once D-01 lands, or the file fails to compile against
      the new signatures

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not touched — no auth/session logic in this phase |
| V3 Session Management | no | Not touched |
| V4 Access Control | no | `requireChannelKey`/permission gating is untouched by D-01's signature change (it fires before the factory is ever built) |
| V5 Input Validation | no | This phase constructs outgoing events; it does not add new incoming-data parsing beyond what `route()` already validates via `checkChatBinding` |
| V6 Cryptography | yes | `generateSecretKey()`/`getPublicKey()` from `applesauce-core/helpers/keys` (already in use) — D-07 only makes an existing generation call *overridable* by a caller-supplied key; no new crypto primitive is introduced, and the existing NIP-44 seal/wrap encryption is untouched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A caller supplies a low-entropy or reused `ephemeralSk` | Information Disclosure | Out of scope to enforce in code (D-08 is retention-only, no validation requirement stated) — document that callers should use `generateSecretKey()` themselves; do not accept a raw hex string that could originate from a weak source |
| A future consumer of 23313 (now reaching the store) mistakes stale presence for live presence | Denial of Service (misleading state) | Accepted trade-off already documented in D-04 — consumers must apply their own freshness window (CORD-07 §4's 90-second staleness rule); not this phase's responsibility to enforce |

## Sources

### Primary (HIGH confidence — direct source read or direct spec fetch, cross-verified)

- `github.com/concord-protocol/concord`, `main` branch (API-confirmed default branch;
  content verified byte-identical whether fetched via `.../main/...` or
  `.../master/...`) — `examples.md` (fetched and read in full, 690 lines), `01.md`
  (CORD-01, "Deletions" section), `03.md` (CORD-03, "Messages"/§3), `07.md` (CORD-07,
  "Voice Keys"/§1 and "Presence"/§4)
- `packages/core/src/operations/delete.ts`, `packages/core/src/helpers/event.ts`
  (`isEvent`, `Rumor` type), `packages/common/src/operations/reaction.ts`,
  `packages/common/src/operations/comment.ts`, `packages/common/src/helpers/comment.ts`
  (`createCommentTagsForEvent`, `getCommentRootPointer`) — all read directly
- `packages/concord/src/client/community.ts`, `private-channel.ts`, `helpers/keys.ts`,
  `operations/gift-wrap.ts`, `types.ts`, `client/admin.ts`, `helpers/control.ts` — all
  read directly at the cited line numbers
- `apps/examples/src/examples/concord/admin-management.tsx`, `apps/docs/concord/channels.md`
  — read directly; both confirmed to reference `voice` outside `packages/concord/src`
- `package.json` (root) + `turbo.json` — confirmed `pnpm test`'s build filter excludes
  `apps/examples`

### Secondary (MEDIUM confidence)

- None — no claim in this document rests on an unverified secondary source.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new packages
- Architecture: HIGH — every file/line cited was read directly in this session
- Pitfalls: HIGH — the `DeleteFactory`/`Rumor`/`isEvent` mismatch and the
  removal-sweep gaps were independently discovered and confirmed by direct source
  inspection, not inferred from CONTEXT.md
- Fixture transcription: HIGH — fetched directly via `curl`, cross-verified against
  the API-confirmed default branch

**Research date:** 2026-07-29
**Valid until:** 30 days (stable — internal monorepo refactor with no external
dependency drift; the upstream CORD spec repo could add commits, but `examples.md`'s
own disclaimer says CORD prose wins over its examples regardless)
