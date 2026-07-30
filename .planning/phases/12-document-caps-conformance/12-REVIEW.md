---
phase: 12-document-caps-conformance
reviewed: 2026-07-30T16:30:00Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - packages/common/package.json
  - packages/concord/src/__tests__/cord-citations.test.ts
  - packages/concord/src/__tests__/cord-wire-fixtures.test.ts
  - packages/concord/src/__tests__/cord-wire-fixtures.ts
  - packages/concord/src/__tests__/document-caps-conformance.test.ts
  - packages/concord/src/casts/__tests__/community-list.test.ts
  - packages/concord/src/casts/__tests__/invite-list.test.ts
  - packages/concord/src/casts/community-list.ts
  - packages/concord/src/casts/invite-list.ts
  - packages/concord/src/client/__tests__/client.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/extra-relays.test.ts
  - packages/concord/src/client/admin.ts
  - packages/concord/src/client/channel-sync.ts
  - packages/concord/src/client/client.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/helpers/__tests__/community-list.test.ts
  - packages/concord/src/helpers/__tests__/community.test.ts
  - packages/concord/src/helpers/__tests__/control.test.ts
  - packages/concord/src/helpers/__tests__/invite-bundle-schema.test.ts
  - packages/concord/src/helpers/__tests__/invite-bundle.test.ts
  - packages/concord/src/helpers/__tests__/invite-list.test.ts
  - packages/concord/src/helpers/caps.ts
  - packages/concord/src/helpers/community-list.ts
  - packages/concord/src/helpers/community.ts
  - packages/concord/src/helpers/control.ts
  - packages/concord/src/helpers/index.ts
  - packages/concord/src/helpers/invite-bundle.ts
  - packages/concord/src/helpers/invite-list.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/operations/community-list.ts
  - packages/concord/src/operations/invite-list.ts
  - packages/concord/src/types.ts
  - packages/core/package.json
  - packages/core/src/helpers/__tests__/encryption.test.ts
  - packages/relay/package.json
findings:
  critical: 2
  warning: 14
  info: 0
  total: 16
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-07-30T16:30:00Z
**Depth:** standard
**Files Reviewed:** 38
**Status:** issues_found

## Summary

The phase's five stated intents are mostly implemented as described: the byte caps are gone from
the list documents, `helpers/caps.ts` exists and is wired into `createCommunity` / `createChannel`
/ `editMetadata` (with `editMetadata` correctly asserting the MERGED result), the 50-membership
cap sits at exactly one enforcement point in `recordJoin` counting derived-live memberships, the
document roots are opened with index signatures, and the citation guard exists and passes.

Two things did NOT survive scrutiny.

First, the D-22 channel-fold refactor is a **net regression, not a net hardening**. Replacing the
explicit field pick with denylist-then-spread removed the type validation that used to guard
`deleted` and `custom`. I proved by execution that a channel edition carrying
`{"deleted":"false","custom":"not-an-object","held":[{"epoch":1,"key":"aa…"}]}` now folds into
`CommunityState.channels` with all three properties intact. `deleted:"false"` is truthy, and three
downstream call sites in `client/community.ts` gate on `!c.deleted` — so an authorized-but-hostile
`MANAGE_CHANNELS` holder (the exact actor the CHAN-04 comment names) can make a channel render in
`channels$` while it is silently never synced, never subscribed, and never given a private
sub-engine. The old code dropped a non-boolean `deleted` on the floor. Separately, the denylist is
already incomplete against its own written contract: `held` is a `ChannelKey` field whose entries
carry `key` hex, and it is not denied — the comment's "a future contributor who adds a new
sensitive field to `ChannelKey` … must extend this denylist" describes a field that exists today.

Second, plan 12-03 deleted `INVITE_BUNDLE_MAX_TOTAL_BYTES` — which was **not** a cap on an
encrypted list document, and therefore not within D-07's stated scope. It was the only aggregate
bound on attacker-crafted invite-bundle input. With it gone, a bundle at exactly the surviving
per-field caps (256 channels × 64 held keys) is ~2.5 MB and is now explicitly asserted to
validate. That material is written into `JoinMaterial`, serialized twice per Community List entry,
and drives one ECDH per held key. Worse, the Direct-Invite path reaches it with no user action.
A new structural test permanently forbids re-adding the symbol, which locks the regression in.

Beyond those, the `documentExtras` carriers behave correctly at every publish site I checked
(spread first, authoritative arrays last, at all four write sites), but their monotonic
existing-first merge makes a deliberately-removed protocol field unremovable, and the client-side
carrier retains left memberships' key material in memory forever, contradicting `pruneDeadEntries`'s
own stated purpose. Test quality is generally strong (spec-anchored fixtures, raw-plaintext
assertions, non-vacuity guards) with three exceptions noted below — including three genuinely
vacuous self-referential assertions of exactly the class this phase exists to eliminate, and zero
coverage of the two fields the fold refactor stopped validating.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Channel fold silently accepts a non-boolean `deleted`, letting an authorized actor make a channel visible-but-dead on every client

**File:** `packages/concord/src/helpers/control.ts:318-323`
**Issue:**
The denylist-then-spread rewrite dropped the type validation the explicit pick used to apply:

```ts
// BEFORE (deleted by this phase)
...(typeof raw.deleted === "boolean" ? { deleted: raw.deleted } : {}),
...(raw.custom !== null && typeof raw.custom === "object" ? { custom: raw.custom } : {}),

// AFTER
const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed as Record<string, unknown>;
if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
```

`deleted` and `custom` now ride through `...rest` at any runtime type. I verified this by
executing `foldControl` against an edition with `{"name":"general","private":false,
"deleted":"false","custom":"not-an-object"}`: the folded object has `deleted === "false"` and
`custom === "not-an-object"`.

The sticky-deletion scan at :292-299 tests `deleted === true`, so a truthy non-`true` value is
NOT treated as a deletion and the channel IS pushed into `state.channels`. But three downstream
gates use loose truthiness:

- `client/community.ts:757` — `publicChannelKeys()` filters `!c.private && !c.deleted`, so no
  stream key is registered and NIP-42 auth never covers the channel.
- `client/community.ts:807` — `reconcileLive()`'s `publicIds` excludes it, so it is never caught up.
- `client/community.ts:830` — `reconcilePrivateChannels()` `continue`s, so no sub-engine spawns.

Meanwhile `channels$` (`client/community.ts:414-424`) applies no `deleted` filter, so the channel
still renders. Net effect: any `MANAGE_CHANNELS` holder — the threat actor the CHAN-04 comment at
:252-267 explicitly models — publishes one edition and makes a channel permanently
visible-but-silent on every client, with no deletion edition and no UI signal. An honest client
that serializes `deleted` as `"true"` trips the same path.

`custom` is also now a type lie: `ChannelMetadata.custom` is declared
`Record<string, unknown> | undefined`, and consumers doing `Object.keys(ch.custom)` on a string
get character indices.

**Fix:** Re-apply the two validations after the destructure, keeping the spread for genuinely
unknown keys:

```ts
const { key: _key, epoch: _epoch, name, private: isPrivate, deleted, custom, ...rest } =
  parsed as Record<string, unknown>;
if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
const meta: ChannelMetadata = {
  ...rest,
  channel_id: eid,
  name,
  private: isPrivate,
  ...(typeof deleted === "boolean" ? { deleted } : {}),
  ...(custom !== null && typeof custom === "object" ? { custom: custom as Record<string, unknown> } : {}),
};
```

This preserves the D-13 round-trip property for unrecognized keys while restoring the declared
type contract for the two fields the package actually reads. Add regression tests for a
non-boolean `deleted` (asserting the channel is NOT excluded from `publicChannelKeys`) and a
non-object `custom` — neither is covered today (see WR-09).

### CR-02: Deleting `INVITE_BUNDLE_MAX_TOTAL_BYTES` leaves attacker-crafted invite bundles with no aggregate bound, reachable with zero user interaction

**File:** `packages/concord/src/helpers/invite-bundle.ts:283-287` and `:659-675`
**Issue:**
D-07's premise is "NIP-44's 65,535-byte plaintext limit was lifted", and the phase intent is
"removed every serialized-byte cap on **encrypted list documents**".
`INVITE_BUNDLE_MAX_TOTAL_BYTES` was neither: it was the aggregate bound on
**attacker-crafted input** to `validateInviteBundle`, and its own doc comment stated the reason
per-field caps could not replace it:

> "Per-field caps ALONE cannot bound the aggregate: up to `INVITE_BUNDLE_MAX_CHANNELS` channels,
> each carrying up to `INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS` held keys, is legal under every
> per-field cap and still assembles into tens of kilobytes."

Both the mint-time throw (`buildInviteBundle`) and the validate-time refusal
(`validateInviteBundle`) were deleted; `validateInviteBundle` now applies exactly one cross-field
check (the owner proof) and returns. The surviving caps admit 256 channels × 64 held keys, each
held entry being `{epoch, key: 64-hex, refounder: 64-hex}` ≈ 150 bytes — roughly **2.5 MB of
accepted, self-certifying, attacker-controlled bundle**, up from an 8 KB ceiling. This is not
hypothetical: `invite-bundle.test.ts:579-604` now asserts that exactly this shape validates.

Three amplifications follow:

1. **Storage/publish amplification.** `client/client.ts:699` writes `bundle.channels` straight
   into `JoinMaterial.channels`, and `recordJoin` (`:840-845`) stores that material TWICE per
   entry (`seed` + `current`). The Community List's only remaining bound is 50 memberships
   (D-06), so the self-encrypted 13302 plaintext this client will `nip44.encrypt`, sign, and
   publish is now bounded at roughly 250 MB rather than ~800 KB.
2. **CPU.** `INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS`'s own comment says each held entry costs one
   X25519 derivation in `deriveChannelKeys`. 256 × 64 = 16,384 derivations per join — the "CPU
   storm on the private-channel spawn path" that comment says the cap prevents, now reachable
   because the aggregate bound that made 64 safe is gone.
3. **No user interaction required.** `client/client.ts:568-576` (`onDirectInvite`) auto-folds
   `bundle.channels` via `receiveChannelKeys` for any community we are already in. The owner
   proof is `community_id == sha256(owner || owner_salt)`, and `owner_salt` is shared with every
   member — so any co-member can craft a maximal bundle, gift-wrap it as a Direct Invite, and
   have it folded into the recipient's material and republished in their 13302. `receiveChannelKeys`
   (`client/community.ts:851-861`) applies no count or size bound of its own.

`invite-bundle-schema.test.ts:284-297` now asserts `Object.keys(InviteBundleModule)` never
contains `INVITE_BUNDLE_MAX_TOTAL_BYTES` again — a structural guard that makes this regression
permanent unless the guard is also revisited.

**Fix:** Restore an aggregate bound on the untrusted path. The measurement belongs on the
REBUILT object (post-`rebuildByRules`), which is where it was:

```ts
// helpers/invite-bundle.ts, end of validateInviteBundle
if (expected !== rebuilt.community_id) return undefined;
// Aggregate bound on attacker-crafted input (NOT a NIP-44 ceiling — D-21). Per-field caps
// cannot bound the product of INVITE_BUNDLE_MAX_CHANNELS x INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS.
if (new TextEncoder().encode(JSON.stringify(rebuilt)).length > INVITE_BUNDLE_MAX_TOTAL_BYTES)
  return undefined;
return rebuilt;
```

Reinstate the symmetric mint-time throw in `buildInviteBundle`, and amend
`invite-bundle-schema.test.ts`'s export guard so it no longer forbids the symbol. If the team
prefers a non-byte bound, an equivalent structural alternative is a product bound
(`sum(channels[i].held.length) <= N`) plus a `material.channels` count cap in
`receiveChannelKeys` — but the current state has neither.

## Warnings

### WR-01: The D-22 denylist omits `held`, a key-material-carrying field that already exists on `ChannelKey`

**File:** `packages/concord/src/helpers/control.ts:263-267, 318`
**Issue:** The comment states "the two key-material field names are destructured out by name" and
"a future contributor who adds a new sensitive field to `ChannelKey` or `JoinMaterial` must
extend this denylist". `ChannelKey` (`types.ts:168-178`) has five fields: `id`, `key`, `epoch`,
`name`, `held` — and `held` is `HeldKeyEntry[]`, each entry carrying a `key` hex. `held` is not
denied. I verified by execution that a channel edition carrying
`held: [{epoch:1, key:"aa".repeat(32)}]` lands on the folded `ChannelMetadata` and would be
spread back out by `deleteChannel`. `JoinMaterial`'s own secret-bearing names (`community_root`,
`owner_salt`, `held_roots`) are likewise undenied.

This is a **latent guardrail gap, not a live leak**: no code path in this package writes our own
key material into a channel edition, so what round-trips is the attacker's own data. But the
denylist's documented contract is that it covers key-material field names on those two types, and
it does not — so the "future contributor" instruction is already unmet at the moment it was
written, and a single future line assigning channel key state onto a `ChannelMetadata` reopens
CHAN-04 with no test or type failing.

**Fix:** Derive the denylist from the type rather than restating it by hand, so it cannot drift:

```ts
// One list, exhaustive over ChannelKey by construction (tsc fails if a field is added).
const CHANNEL_KEY_MATERIAL_FIELDS = ["key", "epoch", "held", "id"] as const satisfies
  readonly (keyof ChannelKey)[];
```

then strip those keys from `parsed` before the spread. Add a test asserting `held` does not
survive the fold, alongside the existing `key`/`epoch` assertions in `control.test.ts` Test B.

### WR-02: Role names are never capped, though `caps.ts` declares the 64-byte cap uniform across communities, channels AND roles

**File:** `packages/concord/src/client/admin.ts:244-269`; `packages/concord/src/helpers/caps.ts:23-24`
**Issue:** `NAME_MAX_BYTES`'s doc comment says "communities, channels, and roles all share it", and
the transcribed spec sentence (`CORD_METADATA_CAP_SENTENCE`) says "The 64-byte name cap is uniform
across the protocol (Channels and Roles carry the same one)." `createRole` and `editRole` publish
`role.name` with no `assertByteCap` call. Every other write site named in the phase intent got the
guard; roles were missed while the constant's own documentation claims otherwise.

**Fix:**
```ts
async createRole(name: string, position: number, permissions: bigint, scope: RoleScope = { kind: "server" }) {
  assertByteCap(name, NAME_MAX_BYTES, "role name");
  ...
}
async editRole(roleId: string, patch: Partial<Omit<Role, "role_id">>) {
  const current = this.opts.state().roles.find((r) => r.role_id === roleId);
  if (!current) throw new Error("role not found");
  const role: Role = { ...current, ...patch, role_id: roleId };
  assertByteCap(role.name, NAME_MAX_BYTES, "role name"); // MERGED, mirroring editMetadata's D-03
  ...
}
```

### WR-03: `documentExtras`'s monotonic merge makes a deliberately-removed top-level key unremovable

**File:** `packages/concord/src/client/client.ts:1001, 1085`; `packages/concord/src/client/invite-manager.ts:316`
**Issue:** Every capture site is `this.documentExtras = { ...this.documentExtras, ...document }`
(existing-first, new-second). A key is therefore only ever ADDED to the carrier; it is never
dropped when a later read of the same replaceable document omits it. If device B removes a
protocol field it no longer wants, device A — which read it earlier this session — republishes
it on its next save; device B then reads it back and its own carrier gains it. The field can
never be retired, and two devices can ping-pong it indefinitely.

CORD-02 §6's MUST is "round-trip fields it doesn't understand", i.e. preserve what the CURRENT
document carries. It does not say resurrect what a peer deleted. The Community List solved the
same problem for memberships with explicit tombstones precisely because a never-deleting union
cannot express removal.

**Fix:** Replace the carrier wholesale on each read rather than merging, so the carrier always
reflects the most recent document actually seen:

```ts
const document = getCommunityList(cast.event);
if (document) this.documentExtras = { ...document };
```

If the "survives an emission that happens not to carry it" property is genuinely wanted, it needs
its own justification and a tombstone mechanism; today it is asserted in a comment and silently
implements resurrection.

### WR-04: `ConcordClient.documentExtras` retains left memberships' key material for the process lifetime and is never cleared by `stop()`

**File:** `packages/concord/src/client/client.ts:293, 488-505, 1001, 1085`
**Issue:** The carrier snapshots the WHOLE parsed document, including `entries` — every
`CommunityListCommunity` with its `seed`/`current` `JoinMaterial` (`community_root`, channel
`key` hex, `held_roots`). `pruneDeadEntries` (:954-960) exists specifically to drop dead
memberships' BYTES from `this.list`, and its doc comment calls that its "surviving purpose". But
the same bytes stay live in `documentExtras` indefinitely: `leave()` does not touch it, and
`stop()` (:488-505) does not clear it either — unlike `ConcordInviteManager.stop()` (:178), whose
doc comment explicitly justifies clearing "so a restart cannot replay a previous session's
snapshot onto a document this session never read". Two carriers documented as mirrors of each
other have opposite lifecycle behavior.

The stale `entries` never reach the wire (the override ordering is correct at all four write
sites — I verified `client.ts:1036`, `client.ts:1268`, `invite-manager.ts:290`, and confirmed
`document-caps-conformance.test.ts` Test C pins it), so this is retention, not disclosure.

**Fix:** Clear it in `stop()` alongside the other per-session state, and — better — stop
snapshotting the arrays at all:

```ts
const { entries: _e, tombstones: _t, ...rest } = document;
this.documentExtras = { ...rest };
```
This also makes the "spread FIRST" invariant unnecessary rather than load-bearing, which is the
structural version of the fix the write-site comments currently argue for procedurally.

### WR-05: `assertByteCap` silently accepts non-string values

**File:** `packages/concord/src/helpers/caps.ts:37-53`
**Issue:** `utf8ByteLength` calls `new TextEncoder().encode(value)`, which coerces. `undefined`
becomes `""` (0 bytes) and passes; a number becomes its decimal string. The helper is exported
from `helpers/index.ts`, so it is public API. Concretely,
`admin.editMetadata({ name: undefined })` merges `name: undefined` into `next`, passes the
0-byte check, and publishes a metadata edition with `name` dropped by `JSON.stringify` — a
document violating `CommunityMetadata`'s required `name`, which the fold's blind
`as CommunityMetadata` cast will then propagate into `state.metadata`.

**Fix:**
```ts
export function assertByteCap(value: string, maxBytes: number, field: string): void {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const bytes = utf8ByteLength(value);
  if (bytes > maxBytes) throw new Error(`${field} is too large (${bytes} bytes > ${maxBytes}-byte cap)`);
}
```

### WR-06: The opened document roots now spread an arbitrary JSON value, so a malformed document emits junk keys onto the wire

**File:** `packages/concord/src/helpers/community-list.ts:251-255`; `packages/concord/src/helpers/invite-list.ts:122-126`
**Issue:** `parseCommunityList` changed from a destructure (`{ communities: doc.entries ?? [] }`)
to `{ ...doc, entries: doc.entries ?? [], tombstones: doc.tombstones ?? [] }`. The old form
discarded anything that was not one of the two known keys; the new one spreads whatever
`JSON.parse` produced. A document whose root is a JSON array (`"[1,2]"` — reachable from a
corrupted mirror or a mis-encrypted list) yields `{ "0": 1, "1": 2, entries: [], tombstones: [] }`,
and `modifyCommunityList` (`operations/community-list.ts:93`) will serialize those numeric keys
straight back onto the wire as "preserved unknown fields". A `"null"` root still throws
(`doc.entries` on null), so the failure mode is inconsistent as well.

**Fix:** Guard the root shape before opening it:

```ts
export function parseCommunityList(json: string | undefined): ParsedCommunityList {
  if (!json) return { entries: [], tombstones: [] };
  const doc = JSON.parse(json) as unknown;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { entries: [], tombstones: [] };
  const d = doc as ParsedCommunityList;
  return { ...d, entries: d.entries ?? [], tombstones: d.tombstones ?? [] };
}
```
Apply the identical guard to `parseInviteList`.

### WR-07: `deleteChannel` republishes an unvalidated `name`, bypassing the write-side cap D-02 establishes

**File:** `packages/concord/src/client/admin.ts:228-233`
**Issue:** `deleteChannel` spreads the folded `ch` (whose `name` came off the read path, which
D-04 deliberately leaves uncapped) into a freshly published edition. So a channel whose name
arrived over-cap from another implementation gets re-published over-cap by THIS client, from a
write path. `caps.ts:10-17` frames the caps as "a WRITE-SIDE contract"; this write site is not
covered by it. The result is that the same client both refuses `createChannel("<65 bytes>")` and
emits `{"name":"<65 bytes>", "deleted":true}`.

**Fix:** Decide and document which it is. Either assert on the echoed name
(`assertByteCap(rest.name as string, NAME_MAX_BYTES, "channel name")`, accepting that a deletion
of a legacy over-cap channel then fails), or amend `caps.ts`'s "write-side contract" wording to
say explicitly that pure echo-through republishes are exempt and why. Silently having one write
path outside the contract is the worst of the three.

### WR-08: Three vacuous, self-referential test assertions

**File:** `packages/concord/src/__tests__/document-caps-conformance.test.ts:291-293`;
`packages/concord/src/helpers/__tests__/community-list.test.ts:243-245`;
`packages/concord/src/helpers/__tests__/invite-list.test.ts:136-138`
**Issue:** Each is an `it()` whose entire body asserts that a test-fixture string constant
contains a substring of itself:

```ts
it("cites CORD-02 §6's round-trip MUST as the authority for this suite's premise", () => {
  expect(CORD_ROUND_TRIP_SENTENCE).toContain("round-trip");
});
```

`CORD_ROUND_TRIP_SENTENCE` is defined in `cord-wire-fixtures.ts` and imported by the same suite.
The assertion touches no implementation symbol and cannot fail for any source change. These are
green test-count padding of exactly the class this phase's premise indicts ("189 tests passed
while nine HIGH bugs were live"). The `cord-wire-fixtures.test.ts` cap-literal round-trips
(`:136-152`) are the correct pattern — they parse a number back out of the verbatim sentence and
compare it to the transcribed constant; these three are not.

**Fix:** Delete the three `it()` blocks. The citation is already carried by the describe-block
comments, and the fixture's own self-test suite already proves the constants are non-empty and
correctly transcribed.

### WR-09: No test covers the two fields the fold refactor stopped validating, nor the `held` denylist gap

**File:** `packages/concord/src/helpers/__tests__/control.test.ts:869-895` (Test D)
**Issue:** Test D is titled "the fold's type validation is unchanged" and exercises only `name`
(non-string) and `private` (non-boolean) — the two fields that ARE still validated. `deleted` and
`custom`, the two whose validation the refactor deleted, are not tested at any type. Test B
asserts `key` and `epoch` are stripped but not `held`. The suite therefore certifies exactly the
properties that did not change and is silent on the ones that did — which is why CR-01 and WR-01
shipped green.

**Fix:** Add to Test D a `{ name: "ok", private: false, deleted: "false" }` case asserting the
folded channel's `deleted` is `undefined` (or that the channel remains in `publicChannelKeys()`),
a `{ custom: "not-an-object" }` case asserting `custom` is absent, and extend Test B's stripped
set with `held`.

### WR-10: `inviteListWithinByteCap` was deleted with no structural export guard, unlike its Community List twin

**File:** `packages/concord/src/helpers/__tests__/invite-list.test.ts` (absent);
compare `packages/concord/src/helpers/__tests__/community-list.test.ts:124-138`
**Issue:** D-10's stated discipline is that a removal "must be permanent, not just a passing test
suite that happens not to call the deleted symbols", and both `community-list.ts` and
`invite-bundle.ts` got `Object.keys(Module)` guards enforcing it. `invite-list.ts` lost
`inviteListWithinByteCap` in the same phase and got no guard, so it can be reintroduced silently.

**Fix:** Add the mirror assertion to `invite-list.test.ts`:
```ts
import * as InviteListModule from "../invite-list.js";
it("the module exports no within-cap predicate (D-07/D-10)", () => {
  expect(Object.keys(InviteListModule)).not.toContain("inviteListWithinByteCap");
});
```

### WR-11: The membership cap counts a live-but-engineless entry, so a corrective re-join at exactly 50 is refused

**File:** `packages/concord/src/client/client.ts:829-849`
**Issue:** `joinFromBundle` short-circuits on `this.communities.has(cid)` (the ENGINE map, :729),
but `recordJoin`'s guard counts `liveCommunities(this.list, …)` (the DOCUMENT). An entry that is
live in the document but has no engine is a state `reconcileCommunities` produces by design — the
`failedConstructionFingerprint` skip path (:1156-1167) leaves an unconstructable membership in
`this.list` with no engine, and the method's own doc comment describes that case. Re-joining that
cid with corrected material passes the engine-map check, reaches `recordJoin`, is counted against
the cap it already occupies, and at exactly 50 live is refused with "would exceed the
50-membership cap" — even though `joinCommunity`'s community_id-keyed merge would not have
increased the count at all.

**Fix:** Exempt an already-live cid from the guard:
```ts
const alreadyLive = isCommunityLive(this.list, this.tombstones, material.community_id);
const liveCount = liveCommunities(this.list, this.tombstones).length;
if (!alreadyLive && liveCount + 1 > COMMUNITY_LIST_MAX_MEMBERSHIPS) throw new Error(...);
```

### WR-12: `LIST_MAX_BYTES` is dead in `src/` and its doc comment describes a use that does not exist

**File:** `packages/concord/src/helpers/community-list.ts:98-110`
**Issue:** The comment says the constant is "retained only as a reference figure in the Community
List size trace". `saveCommunityList`'s trace (`client.ts:1224-1251`) never references it — it
reports `communityListByteSize(...)` and a raw tombstone byte count, with no ceiling comparison.
`grep` confirms the only remaining consumers are three test files. It is a dead export whose
documentation asserts a live use. Two neighbouring comments are stale for the same reason:
`caps.ts:6-8` cites "the derived-constants-carry-a-rationale convention `community-list.ts`
follows for its arithmetic ceilings" (the only derived ceiling,
`COMMUNITY_LIST_MAX_ENTRY_BYTES`, was deleted this phase), and `community-list.ts:88-90` refers to
"`LIST_MAX_BYTES`'s survivors below" (`LIST_MAX_BYTES` is itself a transcribed literal, and its
derived survivor is gone).

**Fix:** Either delete `LIST_MAX_BYTES` and re-point its three test consumers at a fixture
constant, or — if it is genuinely wanted as an operator reference — actually reference it in the
trace (`… (%d bytes; historical CORD-02 §8 reference figure: %d)`) so the comment becomes true.
Correct the two stale cross-references either way.

### WR-13: `nostr-tools` specifier widened from `~` to `^` on a crypto dependency, and one workspace member was left behind

**File:** `packages/core/package.json:106`, `packages/relay/package.json:69`, `packages/common/package.json:107`
**Issue:** Two changes ride in one edit. (a) `~2.19` → `^2.24` widens the accepted range from
patch-only to the whole 2.x minor line for the library that performs all NIP-44 encryption, in a
runtime `dependencies` block; the phase's stated need was only "≥ 2.23.4 for the lifted plaintext
ceiling", which `~2.24` would satisfy with the previous risk profile. (b) `apps/examples/package.json`
still pins `~2.19`, and `pnpm-lock.yaml` now resolves both `nostr-tools@2.19.4` and
`nostr-tools@2.24.1` into the tree. That is benign for `applesauce-core` consumers (core resolves
its own copy), but it means the workspace ships two divergent crypto implementations and the
examples app disagrees with the libraries it demonstrates.

**Fix:** Use `~2.24` unless the minor-range widening is a deliberate, separately-justified policy
change, and bump `apps/examples` to the same specifier so the workspace resolves one copy.

### WR-14: The citation guard's pattern has silent blind spots its header does not disclose

**File:** `packages/concord/src/__tests__/cord-wire-fixtures.ts:337-338, 366-385`
**Issue:** `CITATION_PATTERN` requires `CORD-NN` + exactly one space + `§`. Citations written as
`CORD-06 § 3`, `CORD-06 §§3`, `CORD-06, §3`, or `CORD-06 section 3` are not matched at all and
pass the guard silently — the same "looks like a section token" class the guard exists to close,
just written slightly differently. Separately, `citationsOutsideRegistry`'s range branch keys on
`token.includes("-")` (:376), but the named-section alternative of the pattern permits hyphens
(`[A-Za-z0-9-]*`), so a future named section containing a hyphen would be split on `-` and
reported invalid. The header's stated limitation covers only "proves a section EXISTS, not that a
citation is RIGHT" — neither of these is disclosed.

**Fix:** Loosen the prefix to `CORD-(\d{2})[ ,]*§+\s*` and gate the range branch on the token
being fully numeric (`/^\d+(-\d+)?$/`) rather than on the presence of a hyphen. Add a
`cord-wire-fixtures.test.ts` case for `"CORD-06 § 7"` asserting it is reported.

---

_Reviewed: 2026-07-30T16:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
