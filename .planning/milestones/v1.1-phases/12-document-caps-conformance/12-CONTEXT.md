# Phase 12: Document & Caps Conformance - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Six requirements — WIRE-06, WIRE-07, WIRE-08, WIRE-09, WIRE-10, WIRE-12 — covering how
`applesauce-concord` **serializes and re-parses documents**: channel editions, community
metadata, and the two self-encrypted lists (Community List 13302, Invite List 13303).
Not derivations, not tag shapes — those closed in Phases 5–11.

**In scope:**

- 64-byte UTF-8 caps on channel `name` and community `name`; 10000-byte cap on community
  `description` (WIRE-06 / WIRE-07, audit M17 / L09)
- The 50-membership Community List cap (WIRE-08 / M12)
- Unknown top-level document fields surviving parse → mutate → serialize (WIRE-09 / L07)
- `deleteChannel` preserving everything but the addressing coordinate (WIRE-10 / L02)
- Every `CORD-NN §N` citation naming a section that exists (WIRE-12 / L11)
- **Folded in:** removal of every serialized-byte cap, and the `nostr-tools` 2.24 bump
  that motivates it (see D-07 through D-11; promoted from backlog 999.8)

**Explicitly out of scope (do not "fix" these here):**

- `validateInviteBundle`'s allowlist rebuild — deliberate carve-out, see **D-17**
- The 64-byte cap on Role `name` that CORD-02 §6 also mandates — real gap, undiscussed,
  see Deferred Ideas
- CORD-07 §2/§3/§5/§6/§7 broker/media/rendezvous transport — FUT-02

</domain>

<decisions>
## Implementation Decisions

### Governing principle

- **D-01:** **Preserve, don't reconstruct.** Stated by the user as the priority for this
  phase and the tiebreaker for any decision not otherwise settled: *the fewer times we
  parse protocol-level data and the fewer times we reconstruct it, the fewer bugs we
  ship.* Every decision below that had a close call was resolved by this rule.

  This is not stylistic. The milestone's root cause was a hand-rolled literal that
  silently dropped an optional field, and L07 is the same shape — the write path cannot
  echo back what it read, so it rebuilds the document from a narrower in-memory view and
  loses whatever that view didn't model. A plan that fixes L07 by *adding a carrier for
  the lost fields* has missed the point; the reconstruction itself is the defect.

### Byte caps on names and descriptions (WIRE-06 / WIRE-07)

- **D-02:** **Throw on write.** An over-cap `name` or `description` raises an Error naming
  actual vs allowed bytes, matching the house precedent at `client/client.ts:808-811`.
  Rejected: truncating at a UTF-8 boundary — a truncated name is indistinguishable
  downstream from an intended one.

- **D-03:** **Enforce in the helpers, not at client methods.** `createCommunity`
  (`helpers/community.ts:114`) is exported public API reachable without a client, so a
  client-only check leaves a bypass. One shared byte-length check, called from every write
  path that can reach a published document — including `editMetadata`
  (`client/admin.ts:153-158`), whose `{...current, ...patch}` merge re-publishes a `name`
  that may predate the cap even when the patch only sets an icon.

- **D-04:** **The read path accepts an over-cap value verbatim.** The cap is a write-side
  contract only.

  **This is a deliberate override of WIRE-06's "and defensively on read" clause and of
  ROADMAP.md Phase 12 success criterion 1.** `verify-phase` must score criterion 1 on
  write-side enforcement alone and must not re-block on the absent read guard. Rationale:
  `helpers/control.ts`'s channel fold has exactly one rejection idiom — `continue` — and
  applying it to an over-cap name turns a caps bug into a channel-availability bug, since
  the fold is the only source of channel state. Truncating on read was also rejected: it
  makes two clients disagree about a channel's name. Same override precedent as Phase 11's
  D-09.

- **D-05:** Cap values are **64 bytes** (`name`) and **10000 bytes** (`description`),
  UTF-8, transcribed from CORD-02 §6: *"The `name` caps at 64 bytes and the `description`
  at 10000 bytes, counted as UTF-8."* Byte length via `TextEncoder`, never `.length`.

### The 50-membership cap (WIRE-08)

- **D-06:** **50 counts live memberships, and is enforced at `recordJoin` only.**

  Counting settled by the spec text, not by preference — CORD-02 §8 reads *"The List caps
  at 50 memberships"*, so tombstoned entries do not consume the budget. Enforcement mirrors
  the documented asymmetry at `client/client.ts:795-798`: refuse a local `recordJoin` at
  50, but **tolerate merged overflow from another device**, because refusing to merge would
  break liveness convergence and silently discard a membership this client did not create.

  Note for the planner: with D-07 removing the byte caps, this becomes the *only* bound on
  the Community List. That strengthens rather than weakens the case for it.

### Removal of every serialized-byte cap (folded scope)

- **D-07:** **Remove all serialized-byte caps in `packages/concord`.** Specifically:
  `LIST_MAX_BYTES` and its gate at `client/client.ts:1168`; `INVITE_LIST_MAX_BYTES` and
  its gate at `client/invite-manager.ts:276`; `COMMUNITY_LIST_MAX_ENTRY_BYTES` and the
  `recordJoin` throw at `client/client.ts:808`; and `INVITE_BUNDLE_MAX_TOTAL_BYTES` at
  **both** its sites — the mint throw (`helpers/invite-bundle.ts:306`) and the validator
  gate (`helpers/invite-bundle.ts:706`).

  **This is a deliberate override of CORD-02 Appendix B**, which reads *"NIP-44 hard-caps
  plaintext at 65,535 bytes: implementations MUST enforce the cap at every layer
  themselves."* `verify-phase` must not block on that MUST.

  Rationale — the premise under that MUST has moved. NIP-44 now specifies
  `max_plaintext_size` = **4294967295** (2³²−1); `65536` was demoted to
  `extended_prefix_threshold`, the point where the length prefix switches from a 2-byte
  u16 to a 6-byte (`[0x00,0x00]` + u32) form, and the NIP ships test vectors at
  65535/65536/65537 exercising that boundary. CORD-02 derives its whole 50-membership
  rationale from a 65,535 ceiling that no longer exists. Per **D-01**, concord should not
  be the thing inventing a ceiling upstream has lifted.

- **D-08:** **Keep the diagnostic, drop the refusal.** `saveCommunityList` still measures
  the serialized size and still emits its existing rich message (bytes, entry count,
  tombstone bytes, largest entry) through the debug namespace — but publishes regardless.
  Debuggability without a ceiling.

- **D-09:** **The count bounds stay and are the real fail-closed boundary.**
  `INVITE_BUNDLE_MAX_CHANNELS` (256) and `INVITE_BUNDLE_MAX_HELD_ROOTS` (64) are
  independent literals with no tie to `LIST_MAX_BYTES`; they do not change. Verified during
  discussion: the byte gate at `invite-bundle.ts:706` measures the **rebuilt** object,
  explicitly *"never on the untrusted input"* — `rebuildByRules` has already stripped
  unknown keys and filtered junk relays before it runs. So the byte cap was never the
  front-line guard against a hostile payload; the rule table and these count bounds are.
  Residual effect of D-07 is "your own Community List can get large", not a remote crash.

- **D-10:** **`INVITE_BUNDLE_MAX_TOTAL_BYTES`'s dependents must be re-justified, not
  silently orphaned.** The prose chain `LIST_MAX_BYTES` → `COMMUNITY_LIST_MAX_ENTRY_BYTES`
  (= half of it) → `INVITE_BUNDLE_MAX_TOTAL_BYTES` ("twice this value MUST stay inside…")
  is documented at `helpers/community-list.ts:196-205` and
  `helpers/invite-bundle.ts:236-243`. Those comments become false when D-07 lands. Delete
  or rewrite them; do not leave a comment citing a deleted constant.

- **D-11:** **Bump `nostr-tools` to `^2.24` in this phase** (promoted from backlog 999.8).
  `packages/core`, `packages/common`, and `packages/relay` pin `~2.19`/`^2.19`;
  `packages/concord` declares no direct dependency and inherits it. Installed 2.19.4 has
  `maxPlaintextSize = 65535` and throws below the new limit, so D-07 is not fully realized
  until this lands. Confirmed: 2.22.0 still caps at 65535; **2.24.0** is the first release
  with `maxPlaintextSize = 4294967295` and `extendedPrefixThreshold = 65536`. Latest is
  2.24.1.

### Unknown-field round-trip (WIRE-09 / WIRE-10)

- **D-12:** **Model the document root as an open document, and drop the key rename.**
  `parseCommunityList` / `parseInviteList` stop returning a closed two-field struct and
  stop renaming `entries` → `communities` / `entries` → `invites`, so the in-memory shape
  matches the wire shape exactly. Mutations become shallow-copy-and-replace; serialization
  becomes `JSON.stringify(doc)`.

  This deletes the reconstruction lines that *cause* L07 —
  `operations/community-list.ts:87` and `operations/invite-list.ts:73`, both
  `JSON.stringify({ entries: …, tombstones: … })`. The rename is precisely why the write
  path cannot echo what it read.

  Per the audit, **per-entry unknowns already survive; only the document root is lossy** —
  because entries are modeled as pass-through data while the root is modeled as a closed
  struct. This makes the root behave like the entries already do.

  Rejected: adding a third `unknown: Record<string, unknown>` field threaded through
  parse → apply → stringify. Smallest diff, no API break — but it keeps the reconstruction
  and relies on every future write site remembering to spread it. Enumerated patch, not a
  structural fix.

  **Breaking:** `ParsedCommunityList` / `ParsedInviteList` are exported and returned by
  `getCommunityList`, `getLiveCommunities`, `unlockCommunityList`, and their invite-list
  mirrors. Acceptable per D-16. `mergeCommunities`, `liveCommunities`,
  `mergeCommunityTombstones`, and `mergeInvites` take arrays rather than the parsed object
  and are unaffected.

- **D-13:** **The round-trip rule applies to all three lossy surfaces**, not just the two
  Lists WIRE-09 names:
  1. Community List and Invite List documents (WIRE-09 proper)
  2. Community metadata — `editMetadata`'s `{...current, ...patch}` where `current` comes
     from a narrow fold. CORD-02 §6's MUST is written about exactly this path: *"an editor
     MUST round-trip fields it doesn't understand (editing the name never wipes another
     client's rules)."*
  3. The channel-edition fold at `helpers/control.ts:305-312`, which keeps only
     `name`/`private`/`deleted`/`custom` and discards every other top-level key. Phase 11's
     D-06 explicitly deferred this question to Phase 12.

  One rule: folds and editors preserve what they don't understand.

  Spec nuance the planner should carry: CORD-02 §6 also says *"Top-level fields outside
  `custom` are reserved for the protocol."* So an unknown **top-level** key is a future
  protocol field this client version doesn't know — forward-compatibility — while another
  client's extension data belongs in `custom`. Both must survive; they survive for
  different reasons.

- **D-14:** **`deleteChannel` destructures out the addressing coordinate and spreads the
  rest.**

  ```ts
  const { channel_id, ...content } = ch;
  JSON.stringify({ ...content, deleted: true })
  ```

  **The audit's L02 rationale is obsolete and ROADMAP criterion 4 inherits it verbatim.**
  Criterion 4 mandates "an explicit destructure … never a naive spread, which would leak
  `ch.key`". `ChannelMetadata` today is `{ channel_id, name, private, deleted?, custom? }`
  — `key` and `epoch` were removed earlier in this milestone as accepted breaking changes,
  so `tsc` rejects `ch.key` and the leak cannot happen. The destructure above still
  satisfies criterion 4's letter (it *is* an explicit destructure, of the coordinate), and
  the `...content` spread is safe **because** the type no longer carries key material —
  `tsc` is the structural guard. `verify-phase` should score criterion 4 on the preserved
  fields and the absence of key material, not on the presence of a spread operator.

  With D-13's fold change, `ch` carries the edition's unknown roots, so this preserves them
  too — with nothing enumerated and nothing to forget when a field is added.

- **D-15:** **`custom` is not special-cased.** CORD-02 §6 permits the same `custom` object
  on `ChannelMetadata` (CORD-03). Once the root is open, `custom` needs no dedicated
  handling — it survives as any other unrecognized key would. Do not add a `custom`-only
  branch.

### Citation correctness (WIRE-12)

- **D-16:** **Sweep every invalid citation and add a structural guard.** Fix all sites,
  then add a test that fails any `CORD-NN §N` naming a section that does not exist. The
  audit named one bad citation; validation against the real spec found two.

  Full validated inventory, current as of 2026-07-29 (audit line numbers have drifted):

  | Citation | Sites | Verdict |
  |---|---|---|
  | `CORD-06 §94` | 10 — `client/private-channel.ts:233`, `client/community.ts:985,1448,1483`, `client/channel-sync.ts:88`, `helpers/keys.ts:308,341,379,643,697` | Invalid; CORD-06 has 3 sections |
  | `CORD-03 §44` | 2 — `client/private-channel.ts:312`, `client/community.ts:680` | Invalid; CORD-03 has 3 sections. **Not named by the audit** |
  | `CORD-01 §Deletions` | 3 — `operations/gift-wrap.ts:45`, `__tests__/cord-wire-fixtures.ts:68`, `helpers/__tests__/keys.test.ts:89` | **Valid** — CORD-01 uses named, unnumbered sections |

  The guard must therefore accept named sections, not only numeric ones.

  **Stated limitation, to be recorded in the guard's own comment:** the check proves a
  section *exists*, not that a citation is *right*. `CORD-06 §94` → `CORD-06 §1` would pass
  while remaining wrong. It closes the line-number-mistaken-for-section class specifically.

- **D-17:** **Registry lives in `packages/concord/src/__tests__/cord-wire-fixtures.ts`, and
  each of the 12 replacements is chosen by reading the actual CORD text at that call site**
  — not by picking an in-range number or matching a section title. The fixture file is
  already the vendored spec transcription with repo/branch provenance (Phase 11 D-10), so a
  reviewer diffs one file against the spec repo. Note the file currently records branch
  `main` while Phase 11's context says `master`; `main` is correct.

  Transcribed section registry (verified 2026-07-29 against the live repo):

  | Doc | Sections |
  |---|---|
  | CORD-01 | *named, unnumbered*: Stream Event, Encoding, Binding, Deletions, Removing Participants |
  | CORD-02 | §1–§9, plus Appendix A (A.1–A.6) and Appendix B |
  | CORD-03 | §1–§3 |
  | CORD-04 | §1–§6 |
  | CORD-05 | §1–§6 |
  | CORD-06 | §1–§3 |
  | CORD-07 | §1–§7 |

### Untrusted-input carve-out

- **D-18:** **`validateInviteBundle` / `rebuildByRules` is exempt from D-01.** The
  exhaustive allowlist rebuild (`helpers/invite-bundle.ts:611-707`, D-17/CR-01 from the
  invite phases) stays exactly as it is. D-01 governs protocol data we already trust —
  folds, our own documents, our own editions. An invite bundle arrives from a stranger's
  URL, and there the allowlist rebuild *is* the fail-closed boundary and the reconstruction
  is the point.

  Recorded explicitly so a later reader does not cite D-01 to "simplify" it.

### Milestone conventions carried forward

- **D-19:** **No changeset.** Carried forward from Phase 12.3's D-15 and Phase 11's D-09;
  concord is unreleased. Covers D-12's breaking change to the two exported `Parsed*` types
  and D-07's removal of five exported constants.

- **D-20:** Namespaced `debug` logging convention (Phase 12.2 D-16): derive the `Debugger`
  once, never `.extend()` at a call site. Relevant to D-08's retained diagnostic.

- **D-21:** **TEST-01 anchoring, standing.** Every cap and document rule this phase touches
  is asserted against a value transcribed from spec text or the vendored fixture, never
  against the implementation's own constant, and byte caps are exercised with a multi-byte
  UTF-8 string whose `.length` and byte length differ.

  **Trap the planner must avoid:** a test anchoring 65,535 to "the NIP-44 spec value" would
  **fail today** — NIP-44's value is now 4294967295. Any byte-related assertion must cite
  CORD-02, not NIP-44.

### Amendments from research (plan-phase, 2026-07-29)

Four corrections surfaced by `12-RESEARCH.md`. D-22 is a user ruling; D-23 through D-25 are
orchestrator rulings on questions the research left open.

- **D-22:** Denylist-then-spread resolves the D-13 / D-14 collision in the channel fold.
  **User ruling, 2026-07-29.** D-13 item 3 requires the channel-edition fold
  (`helpers/control.ts:296-316`) to preserve unknown top-level keys. D-14 accepts a plain
  `{...content}` spread in `deleteChannel` because `tsc` rejects `ch.key`. Those collide —
  `tsc` stops *our code* from reading an undeclared property but does nothing to stop a
  hostile edition's raw JSON from *containing* one, so a blind spread in the fold would let
  a `MANAGE_CHANNELS` holder's `key` field survive at the value level and round-trip back
  out through D-14's spread, reopening the leak CHAN-04 closes today.

  The fold therefore destructures key-material field names out explicitly and spreads the
  rest:

  ```ts
  const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = raw;
  if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
  const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
  ```

  Rejected — keeping explicit field-picking (leaves D-13 item 3 unmet for channel editions,
  so a future protocol field on an edition is still wiped) and per-field allowlist validation
  (strictest, but the most logic in the hot fold path for a threat the denylist already
  covers). The denylist carries a comment citing both D-13 and CHAN-04, because a future
  reader adding a sensitive field to `ChannelKey` / `JoinMaterial` must extend it. A
  hostile-edition-with-`key`-field regression test proves the exclusion holds.

- **D-23:** WIRE-09's in-scope sites include the client publish tier, not only the operations
  files D-12 names. `CommunityListFactory` / `modifyCommunityList` have zero call sites under
  `client/*.ts` (grep-confirmed), so the exercised publish path is `client/client.ts`'s
  `saveCommunityList` (line ~1207) and `client/invite-manager.ts`'s `save()` (line ~281),
  both hand-rolling `JSON.stringify({entries, tombstones})` from reduced in-memory arrays.
  `concord-audit.md`'s L07 already names these sites — D-12's prose under-enumerated them.
  Not new scope. A round-trip test driven through the factory layer alone would pass while
  the shipped client stayed lossy, so the WIRE-09 regression test must drive
  `ConcordClient` end-to-end.

- **D-24:** The community-metadata fold is already correct — prove it, do not fix it.
  D-13 item 2 characterises `editMetadata`'s `current` as coming from a narrow fold, but
  `helpers/control.ts:239-250` is a blind `as CommunityMetadata` cast, and a TypeScript cast
  never strips runtime properties. Unknown top-level keys already survive that path today.
  The phase spends a regression test proving preservation holds (satisfying D-21), with zero
  source change to that fold. Byte-cap enforcement on the metadata path (D-02 / D-03 / D-05)
  is orthogonal and still required.

- **D-25:** `INVITE_BUNDLE_MAX_TOTAL_BYTES` is removed entirely — the constant declaration
  plus both call sites — not just its two enforcement sites. D-08's keep-the-diagnostic
  carve-out is written only for `saveCommunityList`, and D-09 states that only the two count
  bounds survive. `LIST_MAX_BYTES` keeps a diagnostic role per D-08, but its message drops
  the "exceeds the cap" framing, which becomes false once nothing is enforced. Also noted —
  `nostr-tools` shipped the `maxPlaintextSize` change in 2.23.4 rather than 2.24.0; this
  corrects D-11's rationale without moving its locked `^2.24` target. The local
  community-list mirror carrying extras (`saveMirror` / `loadMirror` / `parseMirror`) is a
  lower-priority follow-up task within this phase, not a blocker, since any client able to
  publish has read some copy of the list at least once.

### Claude's Discretion

- Whether the shared byte-length check (D-03) is a standalone helper, a small module, or
  folded into existing validation — only its reachability from every write path is locked.
- The concrete type shape for D-12's open document (index signature, `unknown` record with
  typed accessors, or a generic), and the resulting accessor names.
- Whether the D-16 guard is a Vitest case, a lint rule, or a script in CI.
- Test-file organization: extending existing suites vs. a new document-conformance suite.
- Which specific section each of the 12 citations becomes — governed by D-17's method
  (read the spec text at the site), not pre-assigned here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & audit

- `.planning/REQUIREMENTS.md` — WIRE-06…WIRE-10 and WIRE-12 at lines 80-86; the
  Phase 12 traceability rows at lines 166-171; the TEST-01 standing rationale at lines
  179-184 (TEST-01 closes only when this phase passes)
- `.planning/concord-audit.md` — findings **M12** (line 168, 50-membership cap),
  **M17** (173, channel name cap), **L02** (191, `deleteChannel` custom), **L07** (196,
  top-level unknowns), **L09** (198, community name/description caps), **L11** (200,
  bad citations). Line numbers in the audit's *site* column have drifted; re-locate by
  symbol, not by line.
- `.planning/ROADMAP.md` §"Phase 12: Document & Caps Conformance" — six success criteria.
  **Note D-04's override of criterion 1 and D-14's rationale correction to criterion 4.**

### External specs (repo has no local copy; files are `01.md`…`07.md`, NOT `CORD-02.md`)

- `github.com/concord-protocol/concord` branch **`main`**
  - `02.md` §6 Metadata — the 64B/10000B caps; the `custom` round-trip MUST; "Top-level
    fields outside `custom` are reserved for the protocol"; `custom` also permitted on
    `ChannelMetadata`
  - `02.md` §8 The Community List — "caps at 50 memberships"; the round-trip discipline;
    the (now-stale) 65,535 derivation
  - `02.md` Appendix B — the "MUST enforce the cap at every layer" sentence D-07 overrides
  - `03.md` §2 Metadata — channel edition shape
  - `05.md` §4 The Invite List — invite-list round-trip discipline
  - `examples.md` — fixture source of record
- **NIP-44** (current) — `max_plaintext_size` = 4294967295; `extended_prefix_threshold` =
  65536; extended-length test vectors at 65535/65536/65537. Read this before writing any
  byte-cap test (see D-21's trap).

### Prior phase context

- `.planning/phases/11-messaging-wire-conformance/11-CONTEXT.md` — **D-09** (ROADMAP
  override precedent), **D-10** (vendored fixtures), **D-11** (debug convention); its
  Deferred Ideas already name L02 and L11 as this phase's work
- `.planning/phases/12.3-transport-only-extra-relays-in-applesauce-concord/12.3-CONTEXT.md`
  — D-15 (no changesets)
- `.planning/codebase/TESTING.md`, `.planning/codebase/EVENT_KIND_PATTERNS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Confirmed sites

| Req | Site | Current state |
|---|---|---|
| WIRE-06 | `client/admin.ts:185` | `{ name, private: isPrivate }` — no cap |
| WIRE-06 | `helpers/control.ts:305-312` | fold builds a narrow `ChannelMetadata`; no cap, discards unknown roots |
| WIRE-07 | `helpers/community.ts:114-139` | `createCommunity({ name, description })` — neither capped |
| WIRE-07 | `client/admin.ts:153-158` | `editMetadata` merges `{...current, ...patch}` over a narrow fold |
| WIRE-08 | `client/client.ts:799-815` | `recordJoin` enforces the per-entry byte ceiling only |
| WIRE-09 | `helpers/community-list.ts:231-236` | `parseCommunityList` destructures to a closed struct, renames `entries`→`communities` |
| WIRE-09 | `helpers/invite-list.ts:116-120` | `parseInviteList`, same shape, `entries`→`invites` |
| WIRE-09 | `operations/community-list.ts:87` | `JSON.stringify({ entries: next.communities, tombstones: … })` — the lossy rebuild |
| WIRE-09 | `operations/invite-list.ts:73` | mirror of the above |
| WIRE-10 | `client/admin.ts:190-198` | `deleteChannel` hand-rolls `{ name, private, deleted: true }` |
| WIRE-12 | 6 files, 12 sites | see D-16's table |

### Reusable assets

- `getOrComputeCachedValue(event, Symbol, …)` — the memoization both lists already use
  (`community-list.ts:250`, `invite-list.ts:132`); D-12 changes the memo's value type, not
  the pattern
- `communityListByteSize` / `communityListEntryByteSize` — measurement helpers, distinct
  from the caps D-07 removes; D-08's retained diagnostic still needs a size measurement
- `packages/concord/src/__tests__/cord-wire-fixtures.ts` — the vendored transcription
  D-17 extends, with `CORD_EXAMPLES_SOURCE` / `CORD_EXAMPLES_CAVEAT` already in place
- `TextEncoder().encode(x).length` — the established byte-length idiom, used in 8 places

### Established patterns

- **Constants are exported from helpers, consumed by clients** (`MAX_ROLES`,
  `INVITE_BUNDLE_MAX_CHANNELS`). D-03's shared cap check should follow it.
- **Derived-not-copied constants carry a rationale comment**
  (`community-list.ts:196-205`). That convention applies to *our* invented bounds; the
  64/10000/50 values are spec literals and must be transcribed, not derived (D-21).
- **Spec-derived assertion (TEST-01, standing).** All 189 concord tests passed while 9 HIGH
  bugs were live because every test compared the implementation against itself.

### Integration points

- `helpers/control.ts` — the single fold serving channels *and* community metadata; D-13
  items 2 and 3 both land here
- `operations/community-list.ts` + `operations/invite-list.ts` — near-identical mirrors;
  D-12 changes both identically
- `packages/core`, `packages/common`, `packages/relay` `package.json` — D-11's bump; the
  only files outside `packages/concord` this phase touches

</code_context>

<specifics>
## Specific Ideas

- **The user's stated priority, verbatim in substance:** "preserving existing fields and
  avoiding unnecessary parsing and reconstruction of protocol level data is our priority —
  the less times we have to parse something and the less times we have to reconstruct it,
  the less chance we will have bugs." Captured as D-01 and used as the tiebreaker
  throughout.

- **The user challenged the premise of the parsed types themselves**, on the general
  principle that parsing bespoke data structures out of nostr events is a smell. That
  reframed WIRE-09 from "how do we carry the lost fields" to "why is the root closed when
  the entries aren't" — and produced D-12. A plan that reintroduces a closed root struct
  has regressed this decision.

- **The user twice chose the option that removes a constraint rather than the one that
  re-documents it** (D-07 over re-anchoring the byte cap; D-12's rename removal over the
  minimal open-root change). Treat "delete the mechanism" as the preferred shape when a
  mechanism's justification has expired.

- Preference reconfirmed for making the wrong path unrepresentable over patching
  enumerated instances (D-12, D-16).

</specifics>

<deferred>
## Deferred Ideas

- **The 64-byte cap on Role `name`.** CORD-02 §6 says the cap is *"uniform across the
  protocol (Channels and Roles carry the same one)"*, and `createRole`
  (`client/admin.ts:210-219`) enforces nothing. No requirement covers it and it was not
  discussed. D-03's shared helper makes it a near-free follow-up. Surfaced by the spec
  fetch, not by the audit.

- **A CORD-02-vs-NIP-44 divergence report upstream.** CORD-02 §8 and Appendix B both
  reason from a 65,535 NIP-44 ceiling that no longer exists. Worth reporting to the
  concord-protocol repo; out of scope for an SDK phase.

- **A time-windowed `voicePresence$`** — inherited from Phase 11's deferred list, unrelated
  to this phase.

### Reviewed Todos (not folded)

- `05.1-review-followups.md` — matched at 0.6 by `todo.match-phase`, but the sole match
  reason is generic keywords ("phase", "code", "existing", "source"). It concerns Phase
  05.1 symbol-propagation review residuals with no bearing on document shapes. Left pending.
- `11-verify-followups.md` — matched at 0.6 on the same generic keywords. It concerns
  voice-presence beacons resurrecting kicked members through the observed-authors fold — a
  fold-membership defect, not a document-caps one. Left pending.

</deferred>

---

*Phase: 12-document-caps-conformance*
*Context gathered: 2026-07-29*
