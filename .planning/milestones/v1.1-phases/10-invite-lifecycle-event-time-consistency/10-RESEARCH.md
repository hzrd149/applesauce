# Phase 10: Invite Lifecycle & Event Time Consistency - Research

**Researched:** 2026-07-21
**Domain:** Nostr-adjacent protocol conformance (Concord SDK, `packages/concord/`) — invite bundle validation/revocation, clock-read consistency
**Confidence:** HIGH (all file:line references re-read from the current tree this session; all spec quotes pulled from the live upstream raw files, not paraphrase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**INVITE-01 — Revocation survives a lagging relay (H05)**
- **D-01: Resolve the coordinate first, evaluate the tombstone second.** `joinByLink` must collapse the raw multi-relay union to the single newest event at the addressable coordinate **`(33301, link_signer, "")`** (newest `created_at`, ties → lowest `id` per NIP-01 addressable replacement), and only *then* decide join-vs-refuse on that one winner. The current filter-revoked-then-pick-newest inverts the replacement rule (a `vsk 9` tombstone wins only when it is the *sole* returned event).
- **D-02: Scope the request filter to the empty `d`.** Add `"#d": [""]` to the `pool.request` filter (currently `{ kinds, authors }` only) so sibling `d`-tags cannot pollute the union.
- **D-03: `store.replaceable` is the *pattern*, not a literal reuse.** `ConcordInviteList.bundles$` (`casts/invite-list.ts:103`) uses `store.replaceable` correctly, but `joinByLink` runs pre-join with no community store — so replicate the newest-per-coordinate collapse over the raw union rather than importing the store path.
- **D-04: `vsk` fails closed on *malformed*, not on absence.** Revoked iff `vsk === 9`; an **absent** `vsk` stays live (CORD-05 §1's "defaults to live" convention); a **present-but-non-numeric / NaN** `vsk` is treated as revoked and refused. `getInviteBundleVsk` must therefore distinguish "tag absent" (→ live) from "tag present but unparseable" (→ deny) — today `Number("junk") → NaN !== 9 → live` is the hole. (An unknown *clean* numeric like `7` is neither malformed nor `9` and stays joinable under this ruling — acceptable; only `6`/`9` are spec vocabulary.)

**INVITE-04 — `expires_at` unit (M09) — spec ruling**
- **D-05: `expires_at` is unix SECONDS, end-to-end.** Confirmed against CORD-05 §4 this session — the §4 example value `"expires_at": 1722400000` is a 10-digit seconds timestamp (§4 never annotates the unit; the magnitude settles it, matching the adjacent seconds `created_at`). Write `expires_at` in seconds at every site (`invite-manager.ts`, `community.ts`, `types.ts`, `invite-bundle.ts`), and change the join-time check `client/client.ts:454` from `Date.now() > bundle.expires_at` (ms) to a seconds comparison (`unixNow() > bundle.expires_at`) **atomically** — no internal seconds/ms boundary left to drift. This is cross-client interop only (no local symptom today because the write and the local read are currently both ms). **NOTE — see this document's "Critical Finding" in the Summary and Open Question 1: CORD-05 §1's struct comment explicitly annotates `expires_at` as "unix ms", contradicting the magnitude-basis this ruling used. The ruling remains locked for planning purposes; the contradiction is flagged for an UPSTREAM-NOTES.md entry.**

**TIME-01 — One clock read per event (H04)**
- **D-06: Full single-read thread — one `splitTime(Date.now())` per event.** Success criterion 4 ("a single clock read via `splitTime()`") is met by threading one `{ created_at, ms }` pair into **both** the rumor's `created_at` stamp and the `ms` tag. This closes both defects at once: (a) the round-vs-floor skew (`Math.round` created_at vs floor `ms % 1000` → +1000ms when remainder ≥ 500), and (b) the *two separate clock reads* — `includeMs` (`operations/channel.ts:22`) and the template's `unixNow()` can straddle a second boundary even with floor (widens materially under a NIP-46 remote signer). Decomposition-only (just round→floor) was explicitly rejected because it leaves hole (b) open.
- **D-07: The single read chooses `created_at`, not just the tag.** The fix must relocate/override where `created_at` is stamped so it comes from the *same* `splitTime` call that produces the `ms` tag — `includeMs`/`bindToChannel` currently only touch the tag. Exact mechanism (a Concord event-build choke point that reads once, stamps `created_at`, and adds the `ms` tag together, vs. threading the pair from each factory entry) is Claude's discretion, provided the invariant holds: `created_at * 1000 + ms` is one instant with zero skew.

**TIME-02 — One timestamp per snapshot (M10)**
- **D-08: Same mechanism as D-06, applied once per snapshot.** Compute a single `splitTime` pair for the whole Guestbook snapshot and thread it to **every** chunk — so all chunks share one `created_at` *and* one `ms` tag. Today `includeSnapshotChunk`/`snapshotChunk` (`operations/guestbook.ts:41`, `factories/guestbook.ts:73`) default `ms = Date.now()` per chunk and each chunk's `created_at` is its own template read; an explicitly-passed `ms` never reaches `created_at` at all. This depends on the D-06/D-07 threading and lands with it.

**TIME-03 — One definition of a valid `ms` tag (M11)**
- **D-09: Canonical decimal, one shared predicate.** A tag is a valid `ms` iff it is the canonical base-10 string of an integer in `0..999` — i.e. `String(n) === tag` — rejecting `"42abc"`, `"0x10"`, `"007"`, `" 5"`, `"+1"`. Introduce one shared parser/validator (e.g. `parseMs(tag): number | null`) that **both** `rumorMs` (for ordering) and `hasMalformedMs` (for the membership-fold drop decision) consume, so the two can never disagree by construction. This replaces today's split `parseInt`-with-clamp vs `Number`-with-integer-check.

**INVITE-02 — Bundle bounds fail closed (M07) — locked/mechanical**
- **D-10: `Array.isArray` guard before the §1 bounds.** `validateInviteBundle` must reject (return `undefined`) a bundle whose `channels` or `relays` is not an array *before* running `.length`/`.slice` — so `channels: {a:1}` cannot bypass the 256 ceiling and `relays: "wss://evil…"` cannot emerge as a sliced substring typed as `string[]`. Same fail-closed shape as the fixed `refounder` guard.

**INVITE-03 — Resilient refresh (M08) — locked/mechanical**
- **D-11: Per-link try/skip, continue the loop.** `refreshInviteBundles` (`client/community.ts:1133`) must wrap each link's `buildInviteBundle` so a link it cannot rebuild is skipped and the rest still refresh — matching the docstring's "best-effort per link" — instead of an unguarded throw aborting every link after it (leaving a subset serving pre-Refounding keys behind unchanged URLs).

**INVITE-05 — Reject unknown fragment version (L06) — locked/mechanical**
- **D-12: `decodeFragment` rejects any version it does not know.** Change the `version < FRAGMENT_VERSION` guard (`helpers/invite-bundle.ts:81`) so a *higher* version is also rejected rather than decoded against the v4 dictionary — the dictionary is explicitly designed to grow, which is precisely why an unknown version must not be decoded against the wrong one.

**TEST-01 (standing) — spec-derived tests**
- **D-13: Every derivation this phase touches gets a hand-derived spec-value test** — computed from the spec formula, never read back from the implementation under test. Concretely (per success criterion 6): the invite bundle key derivation and the invite coordinate `(33301, link_signer, "")` hand-derived from CORD-05 §2; the time decomposition asserted against hand-computed `{created_at, ms}` pairs at chosen instants — **including the ≥500ms remainder that produced H04's +1000ms skew** (e.g. `1700000000700 → {created_at: 1700000000, ms: 700}`, and the reorder repro where `…000700` must sort *before* `…001400`); a non-vacuity check per fix (the test fails without the guard). Add: a malformed-`vsk` bundle that must refuse (D-04); a non-array `channels`/`relays` that must return `undefined` (D-10); a canonical-`ms` table where `"42abc"`/`"0x10"` both order-as and fold-as malformed identically (D-09).

### Claude's Discretion
- The exact single-clock-read plumbing mechanism (D-07) — a shared Concord event-build choke point vs. per-factory threading — provided the zero-skew invariant holds.
- The shape of the shared `ms` parser (D-09) — return `number | null`, a discriminated result, or a guard-plus-parse pair — provided both `rumorMs` and `hasMalformedMs` route through it.
- Error-message wording for the join refusals (malformed `vsk`, expired, unknown fragment version) and any skip logging in `refreshInviteBundles`.
- Plan/commit sequencing, within the fixed constraint that each behavioral fix lands **with** its spec-derived test (D-13) and a failing test attributes to the fix, not a later refactor.

### Deferred Ideas (OUT OF SCOPE)
None surfaced outside the phase boundary — the discussion stayed within the invite-lifecycle / event-time domain. No scope creep raised.

Reviewed but not folded: `05.1-review-followups.md` (Phase 05.1 code-review follow-ups) — keyword-matched on `phase`, but its content is cache/gift-wrap/symbol-propagation follow-ups unrelated to invites or event time. Reviewed and not folded — belongs to milestone/backlog review.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| INVITE-01 | A revoked invite link is unjoinable even when a lagging relay still serves the old bundle — the coordinate resolves to its newest event first, then the tombstone is evaluated | Architecture Patterns diagram + Code Examples (`newestAtCoordinate` snippet, `#d` filter); verified NIP-01 collapse rule at `event-store.ts:255-267,308-321`; Validation Architecture test row |
| INVITE-02 | `validateInviteBundle` fails closed on a bundle whose `channels`/`relays` are not arrays | D-10 Code Example; `control.ts:210` template confirmed as the reusable pattern; Validation Architecture test row |
| INVITE-03 | `refreshInviteBundles` skips a link it cannot rebuild and continues | D-11 Code Example; confirmed throw site (`helpers/invite-bundle.ts:175`) and confirmed caller (`client.ts:588`); Validation Architecture test row |
| INVITE-04 | The Invite List's `expires_at` is written in the unit CORD-05 §4 specifies | Full verified spec-text quotes from §1/§4/§8 in Open Question 1 (including the §1-vs-§4 contradiction the discuss-phase session did not see); Common Pitfall 2 (all 5 write/read sites enumerated with current file:line) |
| INVITE-05 | `decodeFragment` rejects a fragment version it does not know | D-12 Code Example; exact current guard quoted and corrected |
| TIME-01 | An event's `created_at` and `ms` tag are one clock read | Architecture Patterns diagram (TIME-01 vs TIME-02 mechanism contrast); D-06/D-07 Code Example (`includeMs` choke point); confirmed 7 call sites in `community.ts:849-943`; Common Pitfall 3 |
| TIME-02 | All chunks of one Guestbook snapshot share one timestamp | D-08 Code Example (`buildSnapshotFactories` pair-threading); confirmed current per-chunk independent `created_at` at `factories/guestbook.ts:67-88` |
| TIME-03 | `rumorMs` and `hasMalformedMs` agree on what a valid `ms` tag is | D-09 Code Example (`parseMs` shared predicate); confirmed both consumers (`models/utils.ts:14,21`, `helpers/guestbook.ts:68,104`) |
| TEST-01 (standing) | Every derivation this phase touches has a spec-derived test | Validation Architecture section maps every requirement to a concrete test file + command; Wave 0 Gaps lists all net-new test files needed |
</phase_requirements>

## Summary

This phase is pure verification-and-fix, not discovery: six defects (H05, M07, M08, M09, H04, M10, M11, L06 — INVITE-01..05, TIME-01..03) are already diagnosed in `concord-audit.md` and CONTEXT.md's D-01..D-13. Every cited file:line was re-read this session; **all of them are still accurate** (no material drift beyond a few lines) except two naming corrections below. The `store.replaceable` NIP-01 replacement rule (newest `created_at` wins, tie → lowest `id`) is implemented in `packages/core/src/event-store/event-store.ts:255,264,308,316` and is the literal rule `joinByLink` must replicate over its raw pre-join relay union. `splitTime()` is confirmed dead code (zero call sites outside its own module and tests-to-be-written). The single-clock-read choke point for TIME-01 is `includeMs`/`bindToChannel` in `operations/channel.ts:22-38` — the one function every channel-plane send funnels through — making it the natural site to relocate `created_at` stamping into. TIME-02's Guestbook snapshot case needs a **different** mechanism shape than TIME-01: chunks must share one `splitTime()` pair threaded in by the *caller* (`buildSnapshotFactories`), not each chunk computing its own read.

**Two corrections to CONTEXT.md's canonical_refs (verified this session):**
1. `getInviteBundleLocator` (the function `casts/invite-list.ts:103` calls, and the pattern D-03 must replicate) lives in **`helpers/invite-list.ts:146`**, not `helpers/invite-bundle.ts:260`. `helpers/invite-bundle.ts:261` has a *different*, unrelated function of a similar name (`getInviteBundlePointer`), used only by `casts/invite-bundle.ts`. Do not conflate the two — `getInviteBundleLocator` is the one whose `(kind, pubkey, "")` shape D-01/D-03 must reproduce inline in `joinByLink`.
2. `packages/concord/src/helpers/__tests__/` currently has **no `stream.test.ts` and no `invite-bundle.test.ts`** — both are net-new files this phase creates, not extensions of existing suites (verified via directory listing).

**A material new finding requiring attention before implementing D-05 (INVITE-04):** CORD-05 §1's `CommunityInvite` struct comment explicitly annotates `expires_at` as **"unix ms"** — text the discuss-phase session did not see (it read only §4's unannotated example). This directly contradicts the magnitude-based "seconds" reading D-05 locked in. See "Critical Finding" below — this does not reopen the locked decision, but the planner must handle it explicitly (an UPSTREAM-NOTES.md entry, mirroring the Phase 9 precedent, is the recommended vehicle, not a re-litigation of D-05).

**A same-defect-class finding beyond phase scope:** `operations/rekey.ts:18-39` (`includeRekeyChunk`) and `helpers/rekey.ts:115-125` (`buildRekeyRumors`) have the **identical** TIME-02 defect shape — shared `ms` remainder, independent per-chunk `created_at` — for Rekey chunk sets, not Guestbook snapshots. TIME-02 (M10) is textually scoped to "Guestbook snapshot" only; this is flagged as an Open Question, not folded into this phase's requirements, mirroring how Phase 9 handled AUTH-09/D-14 (a mid-trace finding recorded but not silently absorbed).

**Primary recommendation:** Fix INVITE-02/03/05 (D-10/D-11/D-12) first — they are single-function, no-ruling-needed, mechanical guards with a template already in the codebase (`control.ts:210`'s `Array.isArray(grant.role_ids)` guard for D-10). Then INVITE-01 (D-01..D-04), which needs the `joinByLink` raw-union collapse rewrite. Land TIME-01 (D-06/D-07) — the shared `includeMs` choke point — before TIME-02 (D-08), since TIME-02's snapshot fix reuses the same pair-threading shape at a different call depth. TIME-03 (D-09) is independent and can land any time. INVITE-04 (D-05) is independent but touches the most files (5 sites across 4 modules) — sequence it whenever, but land the whole unit-conversion as one atomic commit per D-05's explicit "no internal seconds/ms boundary left to drift" instruction.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Invite bundle fetch + revocation resolution (INVITE-01) | Client/SDK (pre-join, no store) | Relay (data source, untrusted) | `joinByLink` runs before any `EventStore`/community engine exists; the collapse must be done by hand over the raw `pool.request` union, not via `store.replaceable` |
| Invite bundle shape validation (INVITE-02) | Client/SDK (`validateInviteBundle`) | — | Bundle is attacker-crafted input off an untrusted relay; validation is a pure function, no I/O |
| Invite refresh resilience (INVITE-03) | Client/SDK (`ConcordCommunity.refreshInviteBundles`) | Relay (publish target, best-effort) | Per-link try/skip is local control flow; publish failures are already independently caught per link |
| Invite List `expires_at` unit (INVITE-04) | Client/SDK (wire encode/decode + join-time check) | — | Pure serialization-format correctness; no relay-side behavior change |
| Fragment version rejection (INVITE-05) | Client/SDK (`decodeFragment`) | — | Local parse-time guard, no network involvement |
| Event clock-read consistency (TIME-01/02) | Client/SDK (event-build/factory layer) | — | `created_at`/`ms` are stamped entirely client-side before signing; no server or relay role |
| `ms` tag validity definition (TIME-03) | Client/SDK (shared helper) | — | Consumed identically by the ordering read and the fold-drop decision, both client-local |

## Standard Stack

No new external dependencies. This phase is internal correctness fixes inside an already-vendored package (`packages/concord/`, unreleased, no changesets per project convention). All fixes reuse existing internal primitives:

| Primitive | Location | Purpose | Why reuse, not new |
|-----------|----------|---------|---------------------|
| `splitTime(nowMs)` | `helpers/stream.ts:16-18` | One `Math.floor`/`%` pair from one `Date.now()` read | Already spec-correct (CORD-01 §Encoding + CORD-02 §4), just unused — TIME-01/02 activate it, they don't rewrite it |
| NIP-01 replaceable-collapse rule | `packages/core/src/event-store/event-store.ts:255-267,308-321` | Newest `created_at` wins, tie → lowest `id` | The exact rule INVITE-01 must replicate over the raw pre-join union; do not invent a different tie-break |
| `Array.isArray` guard-before-`.length`/`.every()` pattern | `helpers/control.ts:210` (AUTH-04, Phase 9) | Reject non-array before any array method touches it | The literal template for D-10's `channels`/`relays` guard — same defect class, same fix shape |
| `AddressPointer { kind, pubkey, identifier }` | `applesauce-core/helpers/pointers` | Locate an addressable event | Used identically by `getInviteBundleLocator` (helpers/invite-list.ts:146-159) and the shape D-01 must build inline in `joinByLink` |

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All fixes are internal to `packages/concord/src/` and `packages/core/src/` (read-only reference), using only primitives already present in the workspace.

## Architecture Patterns

### System Architecture Diagram — INVITE-01 (revocation-survives-lag)

```
 client.joinByLink(url)
        |
        v
 parseInviteLink(url) --> { linkSigner, token, bootstrapRelays }
        |
        v
 pool.request(relays, [{ kinds:[33301], authors:[linkSigner], "#d":[""] }])   <-- D-02: add #d scope
        |
        v
 mapEventsToTimeline()  -- raw union across every relay, ALL editions, no dedup
        |
        v
 [NEW] collapse-to-newest-at-coordinate                                       <-- D-01/D-03: replicate
        |    (newest created_at wins; tie -> lowest id -- NIP-01, same rule       store.replaceable's
        |     as packages/core/event-store.ts:255-267)                            logic, no store exists
        v
      ONE winning event
        |
        v
 isInviteBundleRevoked(winner)?  --------- yes --> throw "invite revoked"      <-- D-01: tombstone
        |  no                                                                     evaluated on the
        v                                                                         WINNER, not pre-filtered
 validateInviteBundle(getInviteBundle(winner, token))  <-- D-10: fails closed
        |                                                    on non-array shapes
        v
 joinFromBundle(bundle, relays)  <-- D-05: expires_at compared in matching unit
```

**Current (buggy) shape being replaced:** `events.filter(valid && !revoked).sort(desc)[0]` — this filters the tombstone OUT of consideration *before* picking newest, so a live bundle from a lagging relay always wins over a tombstone from a current relay, even when the tombstone is objectively newer. The fix inverts the order: collapse first (find the ONE newest event at the coordinate, whatever its `vsk`), THEN decide revoked-vs-live on that single winner.

### System Architecture Diagram — TIME-01/02 (single clock read)

```
 TIME-01 (single event, e.g. sendMessage/sendThread/react/editMessage/deleteMessage):

 ChatMessageFactory.create(...) --> template with created_at = unixNow()   <-- stale read #1 (to be overridden)
        |
        v
 bindToChannel(channelId, epoch)(template)
        |
        +-- includeChannelBinding (channel/epoch tags)
        |
        +-- includeMs(ms?)  <-- [FIX SITE] one splitTime(Date.now()) read here;
                                 overrides BOTH draft.created_at AND the "ms" tag,
                                 superseding whatever unixNow() set upstream


 TIME-02 (Guestbook snapshot, N chunks, must share ONE instant):

 buildSnapshotFactories(members, snapshotId, ms? = one splitTime pair)   <-- read ONCE here
        |
        +--> SnapshotFactory.create(chunk1, ..., pair) --> blankEventTemplate() then OVERRIDE created_at+ms from pair
        +--> SnapshotFactory.create(chunk2, ..., pair) --> same pair, same override
        +--> SnapshotFactory.create(chunkN, ..., pair) --> same pair, same override
```

**Why TIME-01 and TIME-02 need different mechanism shapes:** TIME-01 is one event — the fix can read the clock *inside* the last-applied operation (`includeMs`) since there's only one call. TIME-02 is N events that must share one instant *by construction* — reading the clock inside `includeSnapshotChunk` per-chunk would reintroduce the exact bug (each chunk's own fresh read), even if by coincidence they usually land in the same millisecond. The caller (`buildSnapshotFactories`) must compute the pair once and thread it as data into every chunk.

### Recommended Fix Shapes (not a new project structure — this phase edits existing files in place)

**D-01/D-02/D-03 (`client/client.ts`, `joinByLink`):**
```typescript
// Source: pattern mirrored from packages/core/src/event-store/event-store.ts:255-267
// (NIP-01: newer created_at wins; on tie, lexicographically lower id wins).
function newestAtCoordinate(events: NostrEvent[]): NostrEvent | undefined {
  let winner: NostrEvent | undefined;
  for (const e of events) {
    if (!winner || e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id))
      winner = e;
  }
  return winner;
}
// in joinByLink:
const events = await lastValueFrom(
  this.pool
    .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner], "#d": [""] }])
    .pipe(mapEventsToTimeline(), timeout(10000)),
  { defaultValue: [] as NostrEvent[] },
).catch(() => [] as NostrEvent[]);

const winner = newestAtCoordinate(events.filter(isValidInviteBundle));
if (!winner || isInviteBundleRevoked(winner)) throw new Error("invite bundle not found or revoked");
const bundle = validateInviteBundle(getInviteBundle(winner, parsed.token));
```

**D-10 (`helpers/invite-bundle.ts`, `validateInviteBundle`):**
```typescript
// Source: same guard shape as helpers/control.ts:210 (AUTH-04, Phase 9)
if (!Array.isArray(bundle.channels) || !Array.isArray(bundle.relays)) return undefined;
const channels = bundle.channels;
if (channels.length > INVITE_BUNDLE_MAX_CHANNELS) return undefined;
const relays = bundle.relays.slice(0, INVITE_BUNDLE_RELAY_CAP);
```
Place this guard BEFORE the current `channels.length` / `relays.slice` reads at `helpers/invite-bundle.ts:223-225` — same "guard before the array method touches it" ordering AUTH-04 established.

**D-11 (`client/community.ts:1133-1150`, `refreshInviteBundles`):**
```typescript
for (const link of links) {
  try {
    const bundle = buildInviteBundle(this.material, { /* ...unchanged... */ });
    const template = await InviteBundleFactory.create(bundle, hexToBytes(link.token));
    const signed = finalizeEvent(template, hexToBytes(link.signerSk));
    this.eventStore.add(signed);
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("invite bundle refresh publish failed", err));
  } catch (err) {
    console.warn(`invite refresh skipped for link ${link.token}`, err);
  }
}
```
`buildInviteBundle` throws at `helpers/invite-bundle.ts:175` (`not a private channel we hold a key for`) — that's the concrete failure this wraps.

**D-12 (`helpers/invite-bundle.ts:81`, `decodeFragment`):**
```typescript
if (version !== FRAGMENT_VERSION) throw new Error("unsupported invite fragment version");
```
Replaces `if (version < FRAGMENT_VERSION) throw ...` — rejects both lower AND higher versions instead of decoding an unknown-higher version against the current dictionary.

**D-06/D-07 (`operations/channel.ts`, the shared `includeMs` choke point):**
```typescript
import { splitTime } from "../helpers/stream.js";

export function includeMs(ms: number = Date.now()): EventOperation {
  return (draft) => {
    const { created_at, ms: remainder } = splitTime(ms);
    return modifyPublicTags(setSingletonTag(["ms", String(remainder)]))({ ...draft, created_at });
  };
}
```
This single change propagates to every call site: `bindToChannel` (channel.ts:34-38), `JoinLeaveFactory.ms()`, `KickFactory.ms()` (factories/guestbook.ts) — all funnel through `includeMs`. No other file needs editing for the single-event case.

**D-08 (`factories/guestbook.ts`, snapshot chunk sharing):**
```typescript
// operations/guestbook.ts — includeSnapshotChunk takes a PRE-COMPUTED pair, doesn't read the clock itself:
export function includeSnapshotChunk(
  members: string[], snapshotIdHex: string, index: number, count: number,
  time: { created_at: number; ms: number },
): EventOperation {
  assertChunkIndex(index, count);
  const tags = modifyPublicTags(
    addNameValueTag(["snap", snapshotIdHex, String(index), String(count)], false),
    setSingletonTag(["ms", String(time.ms)]),
  );
  return async (draft) => ({ ...(await tags({ ...draft, created_at: time.created_at })), content: JSON.stringify(members) });
}

// factories/guestbook.ts — buildSnapshotFactories reads splitTime() ONCE:
export function buildSnapshotFactories(members: string[], snapshotIdHex: string, nowMs: number = Date.now()): SnapshotFactory[] {
  const time = splitTime(nowMs);
  // ...chunks.map((chunk, i) => SnapshotFactory.create(chunk, snapshotIdHex, i + 1, n, time));
}
```

**D-09 (`helpers/stream.ts`, shared `ms` parser):**
```typescript
/** Canonical decimal 0..999, or null if malformed (CORD-02 §5: "an ms tag outside 0..999 is malformed"). */
export function parseMs(tag: string | undefined): number | null {
  if (tag === undefined) return null;
  const n = Number(tag);
  return Number.isInteger(n) && n >= 0 && n <= 999 && String(n) === tag ? n : null;
}

export function rumorMs(rumor: Rumor): number {
  const tag = rumor.tags.find((t) => t[0] === "ms")?.[1];
  return rumor.created_at * 1000 + (parseMs(tag) ?? 0);
}

export function hasMalformedMs(rumor: Rumor): boolean {
  const tag = rumor.tags.find((t) => t[0] === "ms")?.[1];
  return tag !== undefined && parseMs(tag) === null;
}
```
`String(n) === tag` is what rejects `"007"`, `"0x10"` (→ `Number("0x10")` is 16, but `String(16) !== "0x10"`), `" 5"`, `"+1"` — the canonical-decimal rule D-09 locked in.

### Anti-Patterns to Avoid
- **Filtering out the tombstone before ranking (the current `joinByLink` bug).** Any "collapse to newest, THEN decide" fix that filters by `vsk` before the collapse step reintroduces H05. The collapse must run over ALL editions at the coordinate, tombstone included.
- **Reading `Date.now()` inside a per-chunk operation that's supposed to share one instant.** `includeSnapshotChunk` must never default its own `ms`/`created_at` — always take a pre-computed pair from the caller, or TIME-02 regresses even after TIME-01 is fixed.
- **`Number(tag)` alone as an `ms` validity check.** `Number("0x10")` is `16` (valid-looking) and `Number(" 5")` is `5` — both non-canonical strings a malicious or buggy client could emit that `Number()` alone accepts. The `String(n) === tag` round-trip is required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Newest-event-at-coordinate selection | A custom `.sort()` + `[0]` (the current bug) or a new tie-break rule | The exact NIP-01 rule already implemented at `packages/core/src/event-store/event-store.ts:255-267,308-321` (newest `created_at`, tie → lowest `id`) | A different tie-break here would let a joiner and a store-backed reader (`ConcordInviteList.bundles$`) disagree about which edition is current for the same coordinate |
| Array-shape validation before bounding | A `try/catch` around `.length` (swallows the real error and gives inconsistent behavior on different malformed shapes) | `Array.isArray()` guard, same shape as `helpers/control.ts:210` | Explicit and matches the established project-wide fail-closed idiom from Phase 9 |
| Millisecond-remainder decomposition | Any custom `Math.round`/`Math.floor` pairing | `splitTime()` (`helpers/stream.ts:16-18`) — already correct, already exists | Reinventing this is exactly how H04 (round-vs-floor skew) happened the first time; `splitTime` is dead code purely because nothing calls it, not because it's wrong |

**Key insight:** every fix in this phase is "activate or extend a correct sibling that already exists in the codebase" (splitTime, the store's replacement rule, AUTH-04's array guard) — not new logic. If a plan task proposes inventing new time math, a new tie-break rule, or a new shape-guard idiom, that is a signal the plan has drifted from the phase's actual mechanism.

## Common Pitfalls

### Pitfall 1: Fixing INVITE-01 without scoping the request filter (D-02)
**What goes wrong:** Even with a correct collapse-then-tombstone-check, an unscoped filter (`{kinds, authors}` with no `#d`) could theoretically pull in events at OTHER `d` values if a compromised/buggy relay ever serves them for the same author+kind, polluting the union with irrelevant editions.
**Why it happens:** The invite bundle's `d` is always `""`, but nothing in the current filter enforces that server-side.
**How to avoid:** Add `"#d": [""]` to the `pool.request` filter alongside the collapse-logic fix — D-01 and D-02 are separate line-level changes but should land in the same commit since D-02 without D-01 doesn't fix the ordering bug, and D-01 without D-02 leaves an unscoped filter.
**Warning signs:** A test that includes a decoy event with a non-empty `d` tag and asserts it's ignored — if such a test isn't present, D-02 wasn't actually exercised.

### Pitfall 2: The `expires_at` unit fix (D-05) touching only some sites
**What goes wrong:** `expiresAt`/`expires_at` currently passes through unconverted at 5 distinct sites (`invite-bundle.ts` struct field, `types.ts:163,208`, `invite-manager.ts:277,292`, `community.ts:1096,1118,1142`, and the join-time check at `client.ts:454`). Converting only the write sites but leaving the join-time comparison in the old unit (or vice versa) creates a LOCAL, self-consistent-but-wrong bug that's harder to catch than today's already-consistent (both ms) state.
**Why it happens:** The field threads through 4 different modules and 2 different type names (`ConcordInviteLink.expiresAt` vs `InviteListInvite.expires_at` vs `InviteBundle.expires_at`) with no compiler-enforced unit tag — TypeScript's `number` doesn't distinguish seconds from ms.
**How to avoid:** Grep every occurrence of `expires_at`/`expiresAt` in `packages/concord/src/` in the same commit (verified list this session: `client/invite-manager.ts:47,71,277,292`; `client/community.ts:1096,1118,1142`; `client/client.ts:454`; `helpers/invite-bundle.ts:155,200`; `types.ts:163,208`) and update every doc comment and every read/write site atomically, per D-05's explicit "no internal seconds/ms boundary left to drift" instruction.
**Warning signs:** Any doc comment still saying "unix ms" or "unix milliseconds" after the fix lands.

### Pitfall 3: TIME-01's fix silently not covering all rumor-build paths
**What goes wrong:** `includeMs`/`bindToChannel` is the choke point for the seven `ConcordCommunity` channel-plane sends (`sendEvent`, `sendMessage`, `sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage` — `client/community.ts:849-943`) and for `JoinLeaveFactory`/`KickFactory` (Guestbook single-event rumors). It does NOT cover `SnapshotFactory` (TIME-02's separate mechanism) or `operations/rekey.ts`'s `includeRekeyChunk` (same defect class, out of this phase's stated scope — see Open Questions).
**Why it happens:** Not every `ms`-tagged event type funnels through the same function; `includeMs` is shared by three of the four families but not all four.
**How to avoid:** After fixing `includeMs`, grep `"ms"` tag writers again (`operations/channel.ts:23`, `operations/guestbook.ts:46`, `operations/rekey.ts:33`) and confirm which now read `splitTime` transitively (channel.ts + guestbook.ts's non-snapshot single-events do; guestbook.ts's `includeSnapshotChunk` needs its own D-08 fix; rekey.ts does NOT and is out of scope per current requirements).
**Warning signs:** A spec-derived test for `sendMessage`/`react`/etc. passes, but an equivalent test against `KickFactory` or `JoinLeaveFactory` wasn't written — TIME-01's "every event" claim needs coverage across all four families that use `includeMs`, not just channel messages.

## Code Examples

### The verified current `joinByLink` bug (client/client.ts:410-436)
```typescript
// Source: packages/concord/src/client/client.ts:426-429 (read this session)
const live = events
  .filter((e) => isValidInviteBundle(e) && !isInviteBundleRevoked(e))   // <-- filters tombstone OUT first
  .sort((a, b) => b.created_at - a.created_at)[0];                       // <-- then picks newest survivor
if (!live) throw new Error("invite bundle not found or revoked");
```
This is the exact inversion CORD-05 §2 forbids: "Unlike a relay deletion (best-effort, ignorable), the tombstone is exactly as durable as the bundle it replaced" — meaning a tombstone competes for "newest" on equal footing with a live edition, never gets pre-excluded.

### The NIP-01 replacement rule this phase must replicate
```typescript
// Source: packages/core/src/event-store/event-store.ts:264-267 (read this session)
if (e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id)) winner = e;
// ...
event.created_at > winner.created_at || (event.created_at === winner.created_at && event.id < winner.id);
```

### `mapEventsToTimeline`'s actual guarantee (what `joinByLink` receives)
```typescript
// Source: packages/core/src/observable/map-events-to-timeline.ts:10-19 (read this session)
export function mapEventsToTimeline<T extends NostrEvent | string>(): OperatorFunction<T, NostrEvent[]> {
  return pipe(
    scan((timeline, event) => insertEventIntoDescendingList(timeline, event), [] as NostrEvent[]),
    withImmediateValueOrDefault([] as NostrEvent[]),
  );
}
```
Important: `insertEventIntoDescendingList` (nostr-tools) does NOT do NIP-01 replaceable-collapse or id tie-breaking — it just orders by `created_at` descending with ties resolved by insertion order. `joinByLink`'s raw `events` array is a **timeline**, not a deduplicated replaceable history; the collapse-to-one-winner step is entirely `joinByLink`'s own responsibility (D-01/D-03).

### `getInviteBundleLocator` — the pattern D-01/D-03 replicate (helpers/invite-list.ts:146-159)
```typescript
// Source: packages/concord/src/helpers/invite-list.ts:146-159 (read this session)
export function getInviteBundleLocator(invite: InviteListInvite): AddressPointer {
  let relays: string[] | undefined;
  try { relays = parseInviteLink(invite.url).bootstrapRelays; } catch { relays = undefined; }
  return { kind: INVITE_BUNDLE_KIND, pubkey: getPublicKey(hexToBytes(invite.signer_sk)), identifier: "", relays };
}
```
`ConcordInviteList.bundles$` (`casts/invite-list.ts:103`) feeds this into `store.replaceable(...)`, which internally applies the exact NIP-01 rule above. `joinByLink` cannot call `store.replaceable` (no store exists pre-join — D-03), but must replicate its *outcome* by hand over the raw union.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `getInviteBundleVsk` returning `NaN` for a malformed `vsk` and treating `NaN !== 9` as live | `getInviteBundleVsk` distinguishes "absent" (→ live, spec default) from "present but unparseable" (→ deny) | This phase, D-04 | Closes the `Number("junk") → NaN → live` hole without breaking bundles that legitimately omit `vsk` |
| `decodeFragment` rejecting only lower fragment versions | Reject any version not exactly `FRAGMENT_VERSION` | This phase, D-12 | A future v5 dictionary bump can't be silently misdecoded by an old client against the v4 table |
| Two independent `ms`-tag parsers (`parseInt`+clamp in `rumorMs`, `Number`+integer-check in `hasMalformedMs`) | One shared `parseMs` consumed by both | This phase, D-09 | Ordering and fold-drop decisions can no longer structurally disagree about the same tag |

No externally-facing API/library versions changed — this is 100% internal-package correctness work.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `#d` filter key (`"#d": [""]`) is honored by the relays this SDK targets, per standard NIP-01 tag-filter semantics | Architecture Patterns / D-02 | Low — this is standard Nostr relay behavior (`CoreFilter` in `packages/core/src/helpers/filter.ts` already supports arbitrary `#<tag>` keys); a non-conformant relay would simply serve a superset, which the client-side collapse (D-01) still handles correctly since it doesn't rely on the filter alone |
| A2 | `buildInviteBundle`'s only throw path relevant to D-11 is the "not a private channel we hold a key for" error at `helpers/invite-bundle.ts:175` | Common Pitfalls / D-11 | Low-medium — if `InviteBundleFactory.create` or `finalizeEvent` can also throw (e.g. malformed material), the per-link try/catch should wrap the WHOLE loop body (as shown in Code Examples), not just `buildInviteBundle`, which the recommended fix already does |
| A3 | No other call site besides the 7 listed in Common Pitfall 3 constructs a rumor destined for `includeMs`/`bindToChannel` | Common Pitfalls | Medium — a grep for `bindToChannel`/`includeMs(` this session found exactly these call sites in non-test code; a future addition elsewhere in `client/community.ts` bypassing `bindToChannel` would silently regress TIME-01 |

## Open Questions

1. **CORD-05 §1's explicit "unix ms" annotation on `expires_at` vs. §4's seconds-magnitude example (D-05 basis)**
   - What we know (verified via `curl` of the live upstream `05.md` this session): §1's struct comment literally reads `expires_at, // optional, unix ms: past it, the preview still renders, joining refuses`. §4's example is `"expires_at": 1722400000` — a 10-digit value that only makes sense as seconds (as ms it decodes to Jan 1970). CORD-02 §8's Community List example, by contrast, uses explicit 13-digit ms values (`"added_at": 1719800000000, // ms`) for fields it actually intends as milliseconds — establishing that this spec corpus DOES write full-magnitude examples when a field is genuinely ms. §4's 10-digit `expires_at` matches the magnitude convention of the adjacent, unambiguously-seconds `created_at: 1719800000` in the same object, not the 13-digit ms convention seen elsewhere.
   - What's unclear: whether this is a spec typo in §1's prose annotation, or the two `expires_at` fields (bundle-level §1 vs. Invite-List-entry-level §4) are intentionally different units that happen to share a name — CORD-02 §8 explicitly warns "never the link fields (expiry and attribution belong to the invite, not the membership)" when describing what does NOT copy into Community List join material, implying the Invite List's own copy of `expires_at` (§4) could be a distinct, locally-defined field from the bundle's `expires_at` (§1). The spec text does not resolve this.
   - Recommendation: implement D-05 as locked (seconds, end-to-end, per the discuss-phase ruling) since CONTEXT.md's decision is authoritative for planning — but the plan should (a) file an `UPSTREAM-NOTES.md` entry documenting this exact contradiction (mirroring Phase 9's 09-05 precedent for CORD-04 ambiguity), and (b) have the D-13 spec-derived test for `expires_at` include a code comment citing both the §1 "unix ms" text AND the §4/§8 magnitude-convention argument, so a future reader understands why "seconds" was chosen despite §1's literal wording.

2. **`operations/rekey.ts`'s identical per-chunk `created_at` defect (same shape as TIME-02, different plane)**
   - What we know: `includeRekeyChunk` (`operations/rekey.ts:18-39`) and `buildRekeyRumors` (`helpers/rekey.ts:115-125`) share one `ms` remainder across a rotation's chunks exactly like `buildSnapshotFactories` does, but each chunk's `created_at` is independently read via `blankEventTemplate(REKEY_KIND)` — the identical TIME-02 defect shape, on Rekey chunk sets rather than Guestbook snapshots.
   - What's unclear: whether TIME-02 (M10, scoped textually to "Guestbook snapshot") should be read to also cover this, or whether it's a new finding for a future phase/backlog entry.
   - Recommendation: do NOT silently fold this into TIME-02's scope (CONTEXT.md's decisions are locked to Guestbook only, and REQUIREMENTS.md's TIME-02 wording is explicit). Flag it to the user/planner the same way AUTH-09/D-14 was flagged in Phase 9 — either a new requirement in a future milestone, or an explicit "reviewed and deferred" note if the user judges it out of scope for this milestone.

3. **Whether `getInviteBundleVsk`'s "malformed → deny" reading (D-04) should also cover a numeric-but-out-of-vocabulary `vsk` (e.g. `7`)**
   - What we know: D-04 explicitly rules a clean numeric non-9/non-6 value (e.g. `7`) as "neither malformed nor `9`" and stays joinable.
   - What's unclear: nothing — this is a locked, explicit ruling in CONTEXT.md, restated here only so the D-13 test suite includes a case for `vsk: "7"` asserting it stays joinable (not just the `vsk: "junk"` malformed case), since both are needed to fully pin D-04's boundary.
   - Recommendation: include both cases in the spec-derived test for `getInviteBundleVsk`.

## Environment Availability

Not applicable — this phase has no new external tool, service, or runtime dependency. All fixes are pure TypeScript edits inside `packages/concord/src/` and are exercised by the existing `vitest run` test command (`packages/concord/package.json`'s `"test": "vitest run --passWithNoTests"`), already available in this workspace.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-standard; `packages/concord/package.json` `"test": "vitest run --passWithNoTests"`) |
| Config file | none per-package (inherits workspace root config) |
| Quick run command | `pnpm --filter applesauce-concord test -- <file>` or `pnpm --filter applesauce-concord vitest run <path>` |
| Full suite command | `pnpm --filter applesauce-concord test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INVITE-01 | Lagging relay serving a stale live bundle alongside a fresher tombstone at the same coordinate → join refuses | unit (client, DI pool, mirrors existing `asyncServingPool` pattern at `client/__tests__/client.test.ts:779-804`) | `vitest run src/client/__tests__/client.test.ts` | ❌ Wave 0 (new `describe` block in existing file) |
| INVITE-01 (D-02) | Request filter includes `"#d": [""]` | unit (spy on `pool.request` args, or decoy-event test) | same file | ❌ Wave 0 |
| INVITE-02 | `validateInviteBundle({channels: {a:1}, relays: "wss://evil"})` → `undefined` | unit | `vitest run src/helpers/__tests__/invite-bundle.test.ts` | ❌ Wave 0 (new file) |
| INVITE-03 | One link's `buildInviteBundle` throws (unheld channel) → other links still refresh | unit | `vitest run src/client/__tests__/community.test.ts` | ❌ Wave 0 (new `describe`/`it` in existing file) |
| INVITE-04 | `expires_at` round-trips as seconds at every write/read site; join-time check compares seconds to seconds | unit | `vitest run src/client/__tests__/client.test.ts` + `src/helpers/__tests__/invite-bundle.test.ts` | ❌ Wave 0 |
| INVITE-05 | `decodeFragment` with `version = FRAGMENT_VERSION + 1` throws | unit | `vitest run src/helpers/__tests__/invite-bundle.test.ts` | ❌ Wave 0 (new file) |
| TIME-01 | `{created_at, ms}` from one `Date.now()` value decompose losslessly; a `…000700` ms event sorts before `…001400`; the ≥500ms-remainder case (`1700000000700 → {created_at: 1700000000, ms: 700}`) does NOT skew to `1700000001` | unit | `vitest run src/helpers/__tests__/stream.test.ts` | ❌ Wave 0 (new file) |
| TIME-01 | `sendMessage`/`react`/etc. produce a rumor whose `created_at*1000+ms` equals a single injected clock value | unit (inject `Date.now` via `vi.spyOn` or pass explicit `ms`) | `vitest run src/client/__tests__/community.test.ts` | ❌ Wave 0 |
| TIME-02 | All N chunks of a snapshot share identical `created_at` AND identical `ms` tag | unit | `vitest run src/factories/__tests__/guestbook.test.ts` or `src/helpers/__tests__/keys.test.ts` (buildRefounding path) | ❌ Wave 0 (verify which file owns snapshot-build tests) |
| TIME-03 | A table of `{"42abc"→malformed, "0x10"→malformed, "007"→malformed, " 5"→malformed, "999"→999, "0"→0}` agrees identically between `rumorMs`-derived ordering and `hasMalformedMs` | unit | `vitest run src/helpers/__tests__/stream.test.ts` | ❌ Wave 0 (new file) |
| TEST-01 (standing) | Every derivation above has a non-vacuity check (fails without the guard) | unit, same files | same commands | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-concord vitest run <touched-test-file>`
- **Per wave merge:** `pnpm --filter applesauce-concord test`
- **Phase gate:** Full suite green before `/gsd-verify-work`; also run `pnpm --filter applesauce-concord test` at minimum, and ideally `pnpm -r test` given Phase 5's precedent of a workspace-wide baseline check for cross-package regressions (not required here since no core/common files change, but cheap insurance).

### Wave 0 Gaps
- [ ] `src/helpers/__tests__/stream.test.ts` — new file; covers TIME-01 decomposition/reorder + TIME-03 canonical-`ms` table (D-09, D-13)
- [ ] `src/helpers/__tests__/invite-bundle.test.ts` — new file; covers INVITE-02 (D-10 shape guard), INVITE-05 (D-12 version rejection), D-04's malformed/absent/clean-numeric `vsk` boundary, and the hand-derived `(33301, link_signer, "")` coordinate
- [ ] New `describe` blocks in `src/client/__tests__/client.test.ts` — INVITE-01 lagging-relay repro (extends the existing `asyncServingPool` helper at lines 779-804), INVITE-04 join-time unit check
- [ ] New `describe`/`it` in `src/client/__tests__/community.test.ts` — INVITE-03 per-link skip-and-continue, TIME-01 single-clock-read assertion across the 7 `bindToChannel` call sites
- [ ] New coverage in `src/factories/__tests__/guestbook.test.ts` (or wherever `buildSnapshotFactories`/`buildRefounding` is currently tested — verify via `helpers/keys.test.ts`) — TIME-02 shared-timestamp-across-chunks assertion
- Framework install: none — Vitest is already configured workspace-wide

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase touches no authentication/signer logic |
| V3 Session Management | No | No session state involved |
| V4 Access Control | Yes | INVITE-01's revocation-must-win property IS an access-control invariant (a revoked link must not grant access) — the fix is the collapse-then-tombstone-check ordering, not a new authorization primitive |
| V5 Input Validation | Yes | INVITE-02 (`validateInviteBundle` fail-closed on non-array shapes), INVITE-05 (`decodeFragment` reject-unknown-version), D-04 (`getInviteBundleVsk` malformed-vs-absent), D-09 (canonical-decimal `ms` parser) — all are input-validation hardening on attacker-reachable, relay-served data |
| V6 Cryptography | No | No new key derivation, encryption, or signing logic — the invite bundle's existing `communityId`/`inviteBundleKey` derivations are untouched by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Lagging/malicious relay withholding a tombstone to keep a revoked link "alive" | Tampering / Information Disclosure (stale-state exploitation) | D-01/D-02/D-03: newest-at-coordinate collapse across the FULL multi-relay union before evaluating liveness — a single honest relay serving the tombstone is sufficient to close the link, matching CORD-05 §2's "exactly as durable as the bundle it replaced" durability claim |
| Attacker-crafted invite bundle with non-array `channels`/`relays` to bypass the §1 bounds (e.g. `channels: {a:1}` sneaking past `.length`, or `relays` as a string sliced into a `string[]`-typed substring) | Tampering / Denial of Service (unbounded allocation) | D-10: `Array.isArray` guard before any array method touches the field |
| Future higher fragment version silently mis-decoded against the current (lower) relay dictionary, producing garbage relay URLs | Tampering | D-12: reject any version not exactly equal to the known `FRAGMENT_VERSION` |
| Malformed `ms` tag used to desynchronize ordering (`rumorMs`) from membership-fold validity (`hasMalformedMs`), letting two honest clients disagree about the Complete Memberlist for the same rumor | Tampering (protocol-level state-divergence attack) | D-09: one shared `parseMs` consumed by both, so they cannot structurally diverge |
| `vsk` tag corrupted/fuzzed (`"junk"`) causing `Number("junk") → NaN !== 9 → treated as live` | Tampering (revocation bypass) | D-04: distinguish "absent" (spec default, stays live) from "present but unparseable" (deny) |

## Sources

### Primary (HIGH confidence — read directly this session, either via `Read` on the local repo or `curl`/`Read` on the live upstream spec)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/05.md` — full text, §1 (bundle struct incl. explicit "unix ms" `expires_at` annotation), §2 (coordinate `(kind 33301, link_signer, "")`, tombstone durability), §3 (fragment version rejection rationale), §4 (Invite List example incl. `expires_at: 1722400000`)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/02.md` — full text, §4 (`created_at*1000+ms` ordering basis), §5 (Guestbook coalesce rules, `ms` 0..999, snapshot chunking "one snapshot id and one timestamp"), §8 (Community List, contrasting 13-digit ms-annotated examples)
- `https://raw.githubusercontent.com/concord-protocol/concord/main/01.md` — full text, Encoding section ("`created_at` is unix seconds, untweaked... Concord uses `["ms", <0..999>]`")
- `packages/concord/src/helpers/stream.ts`, `helpers/invite-bundle.ts`, `helpers/invite-list.ts`, `client/client.ts`, `client/community.ts`, `client/invite-manager.ts`, `operations/channel.ts`, `operations/guestbook.ts`, `operations/rekey.ts`, `helpers/rekey.ts`, `helpers/keys.ts`, `helpers/guestbook.ts`, `helpers/control.ts`, `casts/invite-list.ts`, `types.ts` — all read directly this session for current file:line accuracy
- `packages/core/src/event-store/event-store.ts`, `event-memory.ts`, `event-models.ts`, `packages/core/src/observable/map-events-to-timeline.ts`, `packages/core/src/helpers/time.ts`, `packages/core/src/factories/event.ts`, `packages/core/src/helpers/filter.ts` — read directly for the replaceable-collapse rule and clock-read primitives
- `packages/concord/src/client/__tests__/client.test.ts` (esp. lines 779-849, `asyncServingPool` helper and existing `joinByLink` test) — read directly for test-pattern conventions

### Secondary (MEDIUM confidence)
- `.planning/concord-audit.md` findings H04, H05, M07-M11, L06 — the milestone's own diagnosis, cross-checked against the live code this session (all still accurate)

### Tertiary (LOW confidence)
- None used for factual claims — the one ambiguous point (the `expires_at` unit contradiction) is presented as a verified spec-text quote with an open recommendation, not as an unverified assumption

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all reused primitives verified present and correct in the current tree
- Architecture: HIGH — every fix site read directly this session, all mechanisms confirmed by tracing actual call graphs (not inferred)
- Pitfalls: HIGH — each pitfall traced to a concrete, currently-reachable code path
- INVITE-04's spec-basis: MEDIUM — the underlying spec text has a genuine self-contradiction (§1 vs §4); the locked D-05 decision is respected but flagged for an upstream note

**Research date:** 2026-07-21
**Valid until:** 30 days (internal package, no external API drift risk; re-verify file:line refs if Phase 10 planning is delayed past another phase's merge into these same files)
