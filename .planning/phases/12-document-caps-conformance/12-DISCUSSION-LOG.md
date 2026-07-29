# Phase 12: Document & Caps Conformance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-29
**Phase:** 12-document-caps-conformance
**Areas discussed:** Cap violation behavior, 50-entry cap semantics, Unknown-field carry shape, WIRE-12 scope

---

## Cap violation behavior

### Write-side behavior on an over-cap value

| Option | Description | Selected |
|--------|-------------|----------|
| Throw | Match `recordJoin`'s per-entry ceiling — Error naming actual vs allowed bytes | ✓ |
| Truncate at UTF-8 boundary | Clip to largest whole-codepoint prefix and publish | |
| Throw + branded type | Throw, plus a validated constructor returning a branded `CappedString` | |

**User's choice:** Throw
**Notes:** Truncation was framed as silently mangling input and making a truncated name indistinguishable downstream from an intended one.

### Read-path (defensive) behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Truncate on read | Channel folds, name clipped to 64 bytes | |
| Reject the edition (`continue`) | Match the existing malformed-edition idiom | |
| Accept verbatim; write-only cap | Read path unchanged; cap is a write-side contract | ✓ |

**User's choice:** Accept verbatim; write-only cap
**Notes:** Chosen with the consequence stated up front — `control.ts`'s only rejection idiom is `continue`, which would turn a caps bug into a channel-availability bug since the fold is the sole source of channel state. Requires an explicit override of WIRE-06's "defensively on read" clause and ROADMAP criterion 1.

### Recording the override

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — record as override | CONTEXT.md states it; verify scores criterion 1 on write side alone | ✓ |
| Add a read-side assertion instead | Log/flag an over-cap name via the debug namespace without changing what folds | |

**User's choice:** Yes — record as override

### Where the check lives

| Option | Description | Selected |
|--------|-------------|----------|
| In the helpers | Covers the exported `createCommunity` helper, not just client methods | ✓ |
| At client methods only | Keeps helpers pure and non-throwing; leaves a bypass | |
| You decide | Lock only that every write path is covered | |

**User's choice:** In the helpers

---

## 50-entry cap semantics

### Premise challenge

**User asked:** why limiting the number of communities in the list is necessary at all.

**Notes:** Answered by tracing the mechanics — the byte cap is the operative constraint, `65535 / 50 ≈ 1310` bytes budgeted per membership, and the existing per-entry ceiling (`LIST_MAX_BYTES / 2` = 32767) is 25× too generous to prevent 50 ordinary entries overflowing. Concluded that the entry cap's only real justification is interop, not local resource protection, and that this could not be settled without reading the spec sentence. The user chose to fetch it.

### Where the cap is enforced

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror the byte-ceiling asymmetry | Refuse local `recordJoin`, tolerate merged overflow | ✓ |
| Also gate the publish | Additionally refuse to publish an over-50 document | |
| Hard cap everywhere | Refuse local joins and merged entries alike | |

**User's choice:** Mirror the byte-ceiling asymmetry
**Notes:** Follows the documented reasoning at `client/client.ts:795-798` — refusing to merge would break liveness convergence and discard a membership this client did not create.

### What the 50 counts

**Not asked — settled by the spec fetch.** CORD-02 §8 reads verbatim: *"The List caps at 50 memberships"*, so it counts live memberships, not raw `entries` length. The same sentence conceded the premise-challenge above: *"The count is not the whole budget — join material carrying private-channel keys can overflow the event well below 50."*

### Resolution method

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch CORD-02 first | Read the actual sentence before deciding | ✓ |
| Enforce it — interop is the point | Take the audit's quotation at face value | |
| Don't enforce; document why | Treat the byte cap as the operative constraint | |

**User's choice:** Fetch CORD-02 first
**Notes:** The fetch also surfaced two things absent from the audit — the 64-byte cap applying to Role names, and CORD-02 §6's "Top-level fields outside `custom` are reserved for the protocol", which reframed WIRE-09 as forward-compatibility rather than cross-client coexistence.

### The 65,535 byte cap, given NIP-44 raised its limit

**User raised mid-discussion:** the encrypted-text size limit was recently increased in the NIP spec and in nostr-tools; ensure we are not putting a limit on something the spec can change in future.

**Verified:** NIP-44 now specifies `max_plaintext_size` = 4294967295, with 65536 demoted to `extended_prefix_threshold`. nostr-tools 2.19.4 (installed) and 2.22.0 still cap at 65535; **2.24.0** is the first release with the raised limit.

| Option | Description | Selected |
|--------|-------------|----------|
| Re-anchor provenance to CORD-02 | Keep enforcing 65,535 but document it as a Concord constant | |
| Re-anchor + note the divergence | As above, plus record that NIP-44 has moved | |
| Stop enforcing the byte cap | Drop our own gate; let the transport be the only authority | ✓ |

**User's choice:** Stop enforcing the byte cap
**Notes:** Chosen with the CORD-02 Appendix B MUST-violation stated in the option text. Recorded as a deliberate override.

### Dep bump placement

| Option | Description | Selected |
|--------|-------------|----------|
| No — leave in backlog 999.8 | Keep Phase 12 scoped to documents and caps | |
| Yes — fold it in | Land the caps work against the library matching current NIP-44 | ✓ |

**User's choice:** Yes — fold it in
**Notes:** Scope confirmed as `packages/core`, `packages/common`, `packages/relay`; concord declares no direct `nostr-tools` dependency.

### Blast radius of "stop enforcing"

| Option | Description | Selected |
|--------|-------------|----------|
| Transport caps only | Drop `LIST_MAX_BYTES` and `INVITE_LIST_MAX_BYTES` | |
| Transport + per-entry ceiling | Also drop `COMMUNITY_LIST_MAX_ENTRY_BYTES` | |
| All byte caps including bundles | Also drop `INVITE_BUNDLE_MAX_TOTAL_BYTES` at both sites | ✓ |

**User's choice:** All byte caps including bundles
**Notes:** An initial framing of this as reopening an attacker-facing bound was **corrected after reading the code**: the validator's byte gate measures the *rebuilt* object, explicitly never the untrusted input, so `rebuildByRules` has already stripped unknown keys before it runs. The real fail-closed bounds are the count limits (`INVITE_BUNDLE_MAX_CHANNELS` 256, `INVITE_BUNDLE_MAX_HELD_ROOTS` 64), which are independent literals and survive. Residual effect is a large local list, not a remote crash.

### Diagnostic retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the diagnostic, drop the refusal | Still measure and log; publish regardless | ✓ |
| Remove it entirely | No measurement, no log | |

**User's choice:** Keep the diagnostic, drop the refusal

---

## Unknown-field carry shape

### Premise challenge

**User asked:** why the parsed types exist at all — parsing bespoke data structures out of nostr events is generally not good.

**Notes:** Traced through: the parsed type is a memoized derivation (idiomatic applesauce via `getOrComputeCachedValue`), but it renames `entries` → `communities`, which is *why* the write path cannot echo what it read and must reconstruct — and that reconstruction is L07 itself. The audit's own wording ("per-entry unknowns survive; only the document root is lossy") shows entries and root were modeled differently within one document. The first set of options offered was withdrawn as wrong-headed: all three were variations on smuggling unknowns alongside a closed struct rather than not closing the root.

### Root modeling

| Option | Description | Selected |
|--------|-------------|----------|
| Open document, typed entries | Index-signature root; entries stay typed arrays | |
| Open document + drop the rename | As above, and stop renaming `entries` so in-memory matches wire | ✓ |
| Keep the closed struct, thread unknowns | Add a third field carried through parse→apply→stringify | |

**User's choice:** Open document + drop the rename
**Notes:** Breaking change to two exported types, covered by the standing no-changeset stance.

### Reach

| Option | Description | Selected |
|--------|-------------|----------|
| Lists + community metadata | Cover `editMetadata`'s fold→edit path per CORD-02 §6's MUST | |
| All three | Also fix `control.ts`'s channel fold, deferred here by Phase 11's D-06 | ✓ |
| Lists only, per WIRE-09 | Stay literal to the requirement text | |

**User's choice:** All three

### Governing principle (stated mid-discussion)

**User stated:** preserving existing fields and avoiding unnecessary parsing and reconstruction of protocol-level data is the priority — fewer parses and fewer reconstructions means fewer bugs.

**Notes:** Captured as CONTEXT.md D-01 and applied as the tiebreaker. It immediately resolved WIRE-10: `ChannelMetadata` no longer carries `key`/`epoch` (removed earlier in the milestone), so the audit's L02 rationale — and ROADMAP criterion 4, which inherits it verbatim — guards against a leak that `tsc` now makes impossible.

### Untrusted-input carve-out

| Option | Description | Selected |
|--------|-------------|----------|
| Carve it out — untrusted input | `rebuildByRules` stays as the fail-closed boundary | ✓ |
| Apply it there too | Preserve unknown fields on incoming bundles as well | |

**User's choice:** Carve it out — untrusted input

---

## WIRE-12 scope

**Validation run during discussion** against the real section registry found 12 invalid citations, not the 10 the audit named: `CORD-06 §94` (10 sites) plus `CORD-03 §44` (2 sites, unnamed by the audit). `CORD-01 §Deletions` (3 sites) was confirmed **valid** — CORD-01 uses named, unnumbered sections.

| Option | Description | Selected |
|--------|-------------|----------|
| Sweep + structural guard | Fix all 12 and add a section-registry test | ✓ |
| Sweep all invalid citations | Fix all 12, no guard | |
| Audit-named sites only | Fix the 10 `CORD-06 §94` occurrences only | |

**User's choice:** Sweep + structural guard
**Notes:** Stated limitation acknowledged — the guard proves a section exists, not that a citation is correct.

### Registry placement and replacement standard

| Option | Description | Selected |
|--------|-------------|----------|
| In `cord-wire-fixtures.ts`, replacements read from spec | Extend the vendored transcription; choose each replacement by reading the CORD text at the site | ✓ |
| In `cord-wire-fixtures.ts`, replacements by nearest topic | Same location, assign from section titles alone | |
| Separate registry module | Dedicated spec-sections module | |

**User's choice:** In `cord-wire-fixtures.ts`, replacements read from spec

---

## Claude's Discretion

- Whether the shared byte-length check is a standalone helper, a module, or folded into existing validation
- The concrete type shape for the open document root and its accessor names
- Whether the citation guard is a Vitest case, a lint rule, or a CI script
- Test-file organization — extending existing suites vs. a new document-conformance suite
- Which specific section each of the 12 citations becomes (method locked, assignments not)

## Deferred Ideas

- The 64-byte cap on Role `name` — CORD-02 §6 says the cap is uniform across Channels and Roles; `createRole` enforces nothing. Surfaced by the spec fetch, covered by no requirement, not discussed.
- Reporting the CORD-02-vs-NIP-44 divergence upstream to the concord-protocol repo.
- A time-windowed `voicePresence$` — inherited from Phase 11, unrelated to this phase.

### Reviewed Todos (not folded)

- `05.1-review-followups.md` — matched 0.6 on generic keywords only; concerns 05.1 symbol-propagation residuals.
- `11-verify-followups.md` — matched 0.6 on generic keywords only; concerns the observed-authors fold, not document caps.
