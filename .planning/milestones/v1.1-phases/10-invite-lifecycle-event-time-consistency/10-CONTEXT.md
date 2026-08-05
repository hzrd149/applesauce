# Phase 10: Invite Lifecycle & Event Time Consistency - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Invite bundles fail closed at the validation boundary and stay unjoinable under a lagging relay, and every durable event's `created_at`/`ms` pair is one true decomposition of a single clock read — so timeline ordering and membership folds can never silently disagree about the same rumor.

**Requirements:** INVITE-01, INVITE-02, INVITE-03, INVITE-04, INVITE-05, TIME-01, TIME-02, TIME-03, plus TEST-01 (standing).

**Scouted state (2026-07-20): all eight findings are still open** and audit line numbers have drifted through Phases 6–9 — verify current lines when planning. Concretely observed:
- `joinByLink` (`client/client.ts:428-431`) still filters revoked bundles *out* then picks the newest of the remainder — the exact inversion CORD-05 §2 forbids; fetches via raw `pool.request`, no `#d` scope, no coordinate collapse.
- `validateInviteBundle` (`helpers/invite-bundle.ts:223-225`) reads `channels.length` / `relays.slice()` with no `Array.isArray` guard.
- `decodeFragment` (`helpers/invite-bundle.ts:81`) rejects *lower* versions but lets a *higher* one decode against the v4 dictionary.
- `rumorMs` (parseInt) and `hasMalformedMs` (Number) in `helpers/stream.ts:19-42` still use **different parsers** — 0..999 clamps were added but the parsers were never unified, so `"42abc"`/`"0x10"` still order and fold inconsistently.
- `splitTime` (`helpers/stream.ts:16`) remains dead code (zero call sites); `includeMs` (`operations/channel.ts:22`) reads its own `Date.now()` for the `ms` tag while the rumor's `created_at` is a *separate* `Math.round(Date.now()/1000)` read.

**In scope:** the six invite/time behavioral fixes above + their spec-derived tests (TEST-01).

**Out of scope (own phases / not this slice):** messaging wire conformance (Phase 11); document/caps conformance (Phase 12). No new invite or time *capabilities* — only correctness of the paths already specified. `expires_at` is a join-time refusal only (not a fold input) and its enforcement semantics beyond the unit fix are unchanged.

**No back-compat cost:** `packages/concord/` is unreleased (no changesets); every fix goes straight to the spec-correct behavior with no migration or wire-shim.
</domain>

<decisions>
## Implementation Decisions

### INVITE-01 — Revocation survives a lagging relay (H05)
- **D-01: Resolve the coordinate first, evaluate the tombstone second.** `joinByLink` must collapse the raw multi-relay union to the single newest event at the addressable coordinate **`(33301, link_signer, "")`** (newest `created_at`, ties → lowest `id` per NIP-01 addressable replacement), and only *then* decide join-vs-refuse on that one winner. The current filter-revoked-then-pick-newest inverts the replacement rule (a `vsk 9` tombstone wins only when it is the *sole* returned event).
- **D-02: Scope the request filter to the empty `d`.** Add `"#d": [""]` to the `pool.request` filter (currently `{ kinds, authors }` only) so sibling `d`-tags cannot pollute the union.
- **D-03: `store.replaceable` is the *pattern*, not a literal reuse.** `ConcordInviteList.bundles$` (`casts/invite-list.ts:103`) uses `store.replaceable` correctly, but `joinByLink` runs pre-join with no community store — so replicate the newest-per-coordinate collapse over the raw union rather than importing the store path.
- **D-04: `vsk` fails closed on *malformed*, not on absence.** Revoked iff `vsk === 9`; an **absent** `vsk` stays live (CORD-05 §1's "defaults to live" convention); a **present-but-non-numeric / NaN** `vsk` is treated as revoked and refused. `getInviteBundleVsk` must therefore distinguish "tag absent" (→ live) from "tag present but unparseable" (→ deny) — today `Number("junk") → NaN !== 9 → live` is the hole. (An unknown *clean* numeric like `7` is neither malformed nor `9` and stays joinable under this ruling — acceptable; only `6`/`9` are spec vocabulary.)

### INVITE-04 — `expires_at` unit (M09) — spec ruling
- **D-05: `expires_at` is unix SECONDS, end-to-end.** Confirmed against CORD-05 §4 this session — the §4 example value `"expires_at": 1722400000` is a 10-digit seconds timestamp (§4 never annotates the unit; the magnitude settles it, matching the adjacent seconds `created_at`). Write `expires_at` in seconds at every site (`invite-manager.ts`, `community.ts`, `types.ts`, `invite-bundle.ts`), and change the join-time check `client/client.ts:454` from `Date.now() > bundle.expires_at` (ms) to a seconds comparison (`unixNow() > bundle.expires_at`) **atomically** — no internal seconds/ms boundary left to drift. This is cross-client interop only (no local symptom today because the write and the local read are currently both ms).

### TIME-01 — One clock read per event (H04)
- **D-06: Full single-read thread — one `splitTime(Date.now())` per event.** Success criterion 4 ("a single clock read via `splitTime()`") is met by threading one `{ created_at, ms }` pair into **both** the rumor's `created_at` stamp and the `ms` tag. This closes both defects at once: (a) the round-vs-floor skew (`Math.round` created_at vs floor `ms % 1000` → +1000ms when remainder ≥ 500), and (b) the *two separate clock reads* — `includeMs` (`operations/channel.ts:22`) and the template's `unixNow()` can straddle a second boundary even with floor (widens materially under a NIP-46 remote signer). Decomposition-only (just round→floor) was explicitly rejected because it leaves hole (b) open.
- **D-07: The single read chooses `created_at`, not just the tag.** The fix must relocate/override where `created_at` is stamped so it comes from the *same* `splitTime` call that produces the `ms` tag — `includeMs`/`bindToChannel` currently only touch the tag. Exact mechanism (a Concord event-build choke point that reads once, stamps `created_at`, and adds the `ms` tag together, vs. threading the pair from each factory entry) is Claude's discretion, provided the invariant holds: `created_at * 1000 + ms` is one instant with zero skew.

### TIME-02 — One timestamp per snapshot (M10)
- **D-08: Same mechanism as D-06, applied once per snapshot.** Compute a single `splitTime` pair for the whole Guestbook snapshot and thread it to **every** chunk — so all chunks share one `created_at` *and* one `ms` tag. Today `includeSnapshotChunk`/`snapshotChunk` (`operations/guestbook.ts:41`, `factories/guestbook.ts:73`) default `ms = Date.now()` per chunk and each chunk's `created_at` is its own template read; an explicitly-passed `ms` never reaches `created_at` at all. This depends on the D-06/D-07 threading and lands with it.

### TIME-03 — One definition of a valid `ms` tag (M11)
- **D-09: Canonical decimal, one shared predicate.** A tag is a valid `ms` iff it is the canonical base-10 string of an integer in `0..999` — i.e. `String(n) === tag` — rejecting `"42abc"`, `"0x10"`, `"007"`, `" 5"`, `"+1"`. Introduce one shared parser/validator (e.g. `parseMs(tag): number | null`) that **both** `rumorMs` (for ordering) and `hasMalformedMs` (for the membership-fold drop decision) consume, so the two can never disagree by construction. This replaces today's split `parseInt`-with-clamp vs `Number`-with-integer-check.

### INVITE-02 — Bundle bounds fail closed (M07) — locked/mechanical
- **D-10: `Array.isArray` guard before the §1 bounds.** `validateInviteBundle` must reject (return `undefined`) a bundle whose `channels` or `relays` is not an array *before* running `.length`/`.slice` — so `channels: {a:1}` cannot bypass the 256 ceiling and `relays: "wss://evil…"` cannot emerge as a sliced substring typed as `string[]`. Same fail-closed shape as the fixed `refounder` guard.

### INVITE-03 — Resilient refresh (M08) — locked/mechanical
- **D-11: Per-link try/skip, continue the loop.** `refreshInviteBundles` (`client/community.ts:1133`) must wrap each link's `buildInviteBundle` so a link it cannot rebuild is skipped and the rest still refresh — matching the docstring's "best-effort per link" — instead of an unguarded throw aborting every link after it (leaving a subset serving pre-Refounding keys behind unchanged URLs).

### INVITE-05 — Reject unknown fragment version (L06) — locked/mechanical
- **D-12: `decodeFragment` rejects any version it does not know.** Change the `version < FRAGMENT_VERSION` guard (`helpers/invite-bundle.ts:81`) so a *higher* version is also rejected rather than decoded against the v4 dictionary — the dictionary is explicitly designed to grow, which is precisely why an unknown version must not be decoded against the wrong one.

### TEST-01 (standing) — spec-derived tests
- **D-13: Every derivation this phase touches gets a hand-derived spec-value test** — computed from the spec formula, never read back from the implementation under test. Concretely (per success criterion 6): the invite bundle key derivation and the invite coordinate `(33301, link_signer, "")` hand-derived from CORD-05 §2; the time decomposition asserted against hand-computed `{created_at, ms}` pairs at chosen instants — **including the ≥500ms remainder that produced H04's +1000ms skew** (e.g. `1700000000700 → {created_at: 1700000000, ms: 700}`, and the reorder repro where `…000700` must sort *before* `…001400`); a non-vacuity check per fix (the test fails without the guard). Add: a malformed-`vsk` bundle that must refuse (D-04); a non-array `channels`/`relays` that must return `undefined` (D-10); a canonical-`ms` table where `"42abc"`/`"0x10"` both order-as and fold-as malformed identically (D-09).

### Claude's Discretion
- The exact single-clock-read plumbing mechanism (D-07) — a shared Concord event-build choke point vs. per-factory threading — provided the zero-skew invariant holds.
- The shape of the shared `ms` parser (D-09) — return `number | null`, a discriminated result, or a guard-plus-parse pair — provided both `rumorMs` and `hasMalformedMs` route through it.
- Error-message wording for the join refusals (malformed `vsk`, expired, unknown fragment version) and any skip logging in `refreshInviteBundles`.
- Plan/commit sequencing, within the fixed constraint that each behavioral fix lands **with** its spec-derived test (D-13) and a failing test attributes to the fix, not a later refactor.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative protocol spec (verify fixes against this, not only the audit paraphrase)
- Upstream Concord spec — `https://github.com/concord-protocol/concord` (raw: `https://raw.githubusercontent.com/concord-protocol/concord/main/<NN>.md`). For this phase:
  - **CORD-05** (`05.md`) — §1 bundle validation (reject > 256 channels, truncate relays to the Community's cap; `vsk 6` = active); §2 revocation tombstone re-posts the coordinate `(kind 33301, empty d)` with `vsk 9`, "exactly as durable as the bundle it replaced" (unlike an ignorable relay deletion); §4 Invite List (kind `13303`), `expires_at` example `1722400000` = **seconds** (D-05 ruling taken against this text, 2026-07-20).
  - **CORD-02** (`02.md`) — §4 "the true time is `created_at * 1000 + ms`" is the ordering basis for message order, Guestbook recency (§5), Community List tiebreaks (§8); §5 the `ms` tag valid range `0..999` and the malformed-drop rule (TIME-01/03 basis).
  - **CORD-01** (`01.md`) — §Encoding "`created_at` is unix seconds, untweaked; sub-second ordering rides a tag" (TIME-01 basis).

### Milestone authority
- `.planning/concord-audit.md` — **H04** (round-vs-floor + double clock read; `splitTime` is the correct dead-code pairing), **H05** (revoked links stay joinable; the `mapEventsToTimeline` union does no addressable collapse; `getInviteBundleVsk` defaults NaN→live), **M07** (`validateInviteBundle` array-shape hole), **M08** (`refreshInviteBundles` aborts the whole loop), **M09** (`expires_at` ms-vs-seconds — "verify before acting"), **M10** (snapshot chunks don't share a timestamp), **M11** (`rumorMs`/`hasMalformedMs` parser disagreement), **L06** (`decodeFragment` accepts higher versions). Each carries file:line, the violated spec sentence, symptom, and fix.
- `.planning/REQUIREMENTS.md` — INVITE-01..05, TIME-01..03 (+ the standing TEST-01 rule; TEST-01 does NOT close at this phase).
- `.planning/ROADMAP.md` — Phase 10 detail: goal, success criteria 1–6 (criterion 6 spells out the required spec-derived tests, incl. the ≥500ms remainder case).
- `.planning/PROJECT.md` — v1.1 constraints: spec-derived-test standard (assert against independently-derived spec values, never implementation output); fail-closed guard discipline; concord is unreleased (no changesets).
- `.planning/phases/09-authority-permission-fold-correctness/09-CONTEXT.md` — the fail-closed + "bring the omitted path up to the correct sibling path" precedents this phase reuses (the `store.replaceable`/coordinate-fold pattern for INVITE-01; the array-shape guard class for INVITE-02).

### Primary source files (verify current line numbers this session — audit lines have drifted)
- `packages/concord/src/helpers/stream.ts` — `splitTime` (`:16`, dead code to activate, D-06); `rumorMs` (`:19`, parseInt+clamp) and `hasMalformedMs` (`:35`, Number+integer-check) to unify (D-09).
- `packages/concord/src/helpers/invite-bundle.ts` — `decodeFragment` (`:77-81`, D-12); `validateInviteBundle` (`:212-228`, D-10); `getInviteBundleVsk`/`isInviteBundleRevoked` (`:249-258`, D-04); `getInviteBundleLocator`/coordinate (`:260`, D-01); `FRAGMENT_VERSION` (`:34`), `INVITE_BUNDLE_VSK_LIVE`/`_REVOKED` (`:30-32`).
- `packages/concord/src/client/client.ts` — `joinByLink` (`:419-431` union + revoked-filter inversion, D-01/02/03; `:454` `expires_at` join check, D-05).
- `packages/concord/src/client/community.ts` — `refreshInviteBundles` (`:1133`, D-11); `buildInviteBundle` call sites (`:1091,1137,1184`); `expires_at` write sites (`:1096,1118,1142`, D-05).
- `packages/concord/src/client/invite-manager.ts` — `expiresAt`/`expires_at` mapping (`:47,71,277,292`, D-05).
- `packages/concord/src/operations/channel.ts` — `includeMs` (`:22`, the second clock read + floor tag, D-06/07).
- `packages/concord/src/operations/guestbook.ts` / `packages/concord/src/factories/guestbook.ts` — `includeSnapshotChunk` (`ops :35-46`) / `SnapshotChunkFactory` (`fac :66-86`), snapshot timestamp sharing (D-08).
- `packages/concord/src/casts/invite-list.ts` — `store.replaceable(getInviteBundleLocator(...))` (`:103`), the correct coordinate-collapse pattern D-03 mirrors.
- `packages/concord/src/types.ts` — `expires_at` fields (`:163,208`, D-05).

### Existing tests (extend / add alongside)
- `packages/concord/src/helpers/__tests__/` — stream/time tests (D-13 decomposition + reorder repro incl. ≥500ms; canonical-`ms` table); invite-bundle tests (malformed `vsk` refusal, non-array bounds return `undefined`, higher fragment version rejected, hand-derived coordinate).
- `packages/concord/src/client/__tests__/` — `joinByLink` newest-at-coordinate-then-tombstone (lagging-relay repro: relay A tombstone + relay B stale live bundle → refuse); `refreshInviteBundles` skip-and-continue.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`splitTime(nowMs)`** (`helpers/stream.ts:16`) — already the correct coherent pairing (`Math.floor(nowMs/1000)` + `nowMs % 1000` from one read). Zero call sites; TIME-01/02 activate and thread it. No new time math.
- **`store.replaceable(getInviteBundleLocator(...))`** (`casts/invite-list.ts:103`) — the already-correct newest-per-coordinate collapse; INVITE-01 replicates its *logic* over the raw pre-join relay union.
- **`getInviteBundleVsk`/`isInviteBundleRevoked`/`INVITE_BUNDLE_VSK_*`** (`helpers/invite-bundle.ts:29-32,249-258`) — the tombstone primitives; D-04 hardens the parse (absent→live vs malformed→deny).
- **The fixed `refounder` array-shape guard** — the template for INVITE-02's `Array.isArray` bounds check (same defect class).

### Established Patterns
- **The recurring defect class is "a guard that defaults to permit / a shape unvalidated after read."** INVITE-02 (`.length` on a non-array), INVITE-04 (unit inferred, not enforced), INVITE-05 (unknown version decoded anyway), TIME-03 (two parsers), and `getInviteBundleVsk`'s NaN→live are all instances. Every fix defaults to deny / drop / one canonical read.
- **"Bring the omitted path up to the correct sibling path."** The Invite List cast collapses the coordinate correctly; `joinByLink` doesn't (INVITE-01). `splitTime` is the correct time pairing; the event-build path doesn't use it (TIME-01). The correct sibling already exists in every case.
- **Spec-derived tests only** (milestone standard, D-13) — expected coordinates and `{created_at, ms}` pairs computed by hand from CORD-01/02/05, never by calling the implementation under test.

### Integration Points
- `joinByLink` (`client/client.ts`) is the pre-join fetch entry point — INVITE-01/04 land here, before any community store exists (so no `store.replaceable`; raw-union collapse instead).
- The rumor event-build path (core `blankEventTemplate`/`unixNow()` → concord `includeMs`/wrap) is where `created_at` and the `ms` tag are stamped in *different layers* — TIME-01/02 must make one `splitTime` read feed both; keep the wrap/seal/rumor envelope shape (`helpers/stream.ts` header) intact.
- `foldMembers` / timeline ordering both consume `ms` — TIME-03's shared parser must serve both the ordering read (`rumorMs`) and the fold-drop decision (`hasMalformedMs`) so they never diverge.
</code_context>

<specifics>
## Specific Ideas

- **INVITE-04 resolved this session by reading the spec, not the paraphrase** (mirroring Phase 9's S01/S02 handling). CORD-05 §4's `expires_at` example `1722400000` is unambiguously seconds by magnitude; the fix is seconds end-to-end including the local join check — the audit's "verify before acting" caveat is discharged.
- **TIME-01 was deliberately taken past decomposition-only.** The +1000ms skew is the loud half; the quiet half is two clock reads straddling a second — the user chose the full single-read thread so success criterion 4 ("a single clock read") is met literally, not just the round-vs-floor symptom. This is worse under NIP-46 remote signers, so it matters for real bunker users.
- **`vsk` fail-closed is scoped to malformed, not absence.** The author kept CORD-05 §1's "absent = live" convention (so a legit bundle omitting the tag still joins) while closing the actual `Number("junk")→NaN→live` hole — the minimal-surprise reading of fail-closed here.
- **TIME-03's canonical-decimal rule is stricter than either current parser.** `String(n) === tag` rejects non-canonical encodings (`"007"`, `"0x10"`, whitespace) that honest clients never emit, guaranteeing `rumorMs` and `hasMalformedMs` agree by construction rather than by coincidence.
</specifics>

<deferred>
## Deferred Ideas

None surfaced outside the phase boundary — the discussion stayed within the invite-lifecycle / event-time domain. No scope creep raised.

### Reviewed Todos (not folded)
- **`05.1-review-followups.md`** ("Phase 05.1 code-review follow-ups") — keyword-matched on `phase` (score 0.6), but its content is cache / gift-wrap / symbol-propagation follow-ups (CR-01 seal author-spoofing, WR-01 replaceable version symbol copy, etc.), unrelated to invites or event time. **Reviewed and not folded** — same call Phase 9 made; belongs to milestone/backlog review. The security-relevant CR-01 (gift-wrap `getGiftWrapSeal` discarding `verifyWrappedEvent`) remains worth prioritizing there.
- **`operations/rekey.ts` per-chunk `created_at` defect (TIME-02 shape, Rekey plane)** — Phase 10 research (`10-RESEARCH.md` Open Question 2) found `includeRekeyChunk` (`operations/rekey.ts:18-39`) and `buildRekeyRumors` (`helpers/rekey.ts:115-125`) share one `ms` remainder across a rotation's chunks while each chunk's `created_at` is an independent `blankEventTemplate` read — the *identical* TIME-02 defect, but on Rekey chunk sets rather than Guestbook snapshots. **Reviewed and deferred (2026-07-21 user ruling):** TIME-02 (M10) is textually scoped to "Guestbook snapshot" and this phase's scope stays locked to that; the Rekey occurrence is recorded here for a future milestone/backlog entry, mirroring the Phase 9 AUTH-09/D-14 handling. Phase 10 plans MUST NOT modify `operations/rekey.ts` / `helpers/rekey.ts`.

### D-05 spec-contradiction ruling (2026-07-21)
- **`expires_at` stays SECONDS end-to-end as D-05 locked, despite CORD-05 §1's literal `// unix ms` annotation** (see `10-RESEARCH.md` Open Question 1). §4's Invite-List example `1722400000` (10 digits = seconds, the field INVITE-04's success criterion targets) governs; §1's bundle-struct comment contradicts it but §1/§4 are different kinds (33301 vs 13303) and CORD-02 §8 hints they may be distinct fields. **User ruling: keep D-05 locked (seconds at every site) AND record the contradiction durably** — the plan must add an `UPSTREAM-NOTES.md` entry (mirroring the Phase 9 09-05 CORD-04 precedent) and a code comment in the `expires_at` D-13 spec-derived test citing both the §1 "unix ms" text and the §4/§8 magnitude argument, so the "seconds despite §1" choice is self-documenting.
</deferred>

---

*Phase: 10-Invite Lifecycle & Event Time Consistency*
*Context gathered: 2026-07-20*
