# Phase 8: Rotation Robustness & Consensus - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 8-Rotation Robustness & Consensus
**Areas discussed:** The two blocking rulings (ROTATE-10, ROTATE-13), Convergence & anti-refork (ROTATE-06/07), Transient-signer retry (ROTATE-05), Publish-gating & vac (ROTATE-09, ROTATE-08)

Upstream CORD-06 was fetched during discussion and reshaped two findings: chunks correlate by `(rotator, newepoch, prevcommit)` — `chunkCount` is NOT a correlation field; and §3 is deliberately silent on the excluded-from-winner case.

---

## ROTATE-10 — chunk-set correlation ruling

| Option | Description | Selected |
|--------|-------------|----------|
| Consistency-guard (fail-closed) | Keep the spec correlation key; disagreeing `n` in a bucket → inconsistent set, never complete, refetch | ✓ |
| No change + defensive test only | Conclude unreachable, add a regression test only | |
| Add chunkCount to the correlation key | The audit's literal fix — diverges from upstream, still lets a stale n-set complete | |

**User's choice:** Consistency-guard (fail-closed).
**Notes:** User asked to understand the issue before ruling ("sounds like the best option since it does not diverge from the spec, although I want to understand the issue more"). Walked through the chunk/complete-set/removal mechanics and the `prevCommit = epochKeyCommitment(oldEpoch,oldRoot)` reachability argument, then locked. Ruled a real fix, not "no change."

## ROTATE-13 — compaction abort ruling

| Option | Description | Selected |
|--------|-------------|----------|
| Bug — add fail-closed abort | Convert silent continue/catch to detect-and-abort; a partial compaction never publishes (CORD-06 §3) | ✓ |
| Correct-by-design — test only | controlHeadsWithSeals restores every seal; no source change | |
| Trace first, then decide | Have researcher trace reachability before ruling | |

**User's choice:** Bug — add fail-closed abort.
**Notes:** Ruled fail-closed regardless of whether "plaintext by construction" holds today; silent-continue-where-spec-says-MUST is the milestone's canonical defect shape.

## Convergence & anti-refork (ROTATE-06/07) — fork policy

| Option | Description | Selected |
|--------|-------------|----------|
| Inclusion-biased (follow fork we're in) | Adopt lowest-key fork that includes us; removed only if no fork includes us; residual split possible | |
| Spec-strict (global winner, evict if excluded) | Adopt globally-lowest-key winner among all authorized candidates; removed if the complete winner excluded us | ✓ |

**User's choice:** Spec-strict (global winner, evict if excluded).
**Notes:** User's opening instinct was "follow the first complete fork we are still included in," with a later multi-fork client to follow both. Corrected "first" → deterministic lowest-key (arrival order IS the M01 split). After seeing the excluded-from-winner tradeoff, user chose spec-strict single-community convergence. Down-only re-heal + per-epoch anti-refork latch (re-read held epochs, never move up) locked alongside. The multi-fork "follow both forks" capability captured as deferred.

## Transient-signer retry (ROTATE-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Passive — return none, ride the re-heal re-read | Decrypt error → `none`, next sync's down-only re-read retries; no bespoke loop | ✓ |
| Active — bounded in-call retry with backoff | Retry the signer N times with backoff inside readRekeyScoped | |

**User's choice:** Passive — return none, ride the re-heal re-read.
**Notes:** "Present-but-undecryptable at our locator ≠ absence" → never removal, retry. Shares the D-04 re-read machinery, so no new retry code; makes fixing the `rekeyHandled`/`"known"` short-circuit a prerequisite.

## Publish confirmation gating (ROTATE-09)

| Option | Description | Selected |
|--------|-------------|----------|
| ≥1 relay OK | At least one relay accept before adopting | |
| All configured relays OK | Every relay must accept | |
| Majority / threshold OK | Strict majority of configured relays accept | ✓ |

**User's choice:** Majority / threshold OK.
**Notes:** Stricter discoverability bar than the minimal one-relay-ack. Await root-roll publish, require majority `ok`, gate compaction/snapshot + adoptRefounding on it, abort otherwise. Majority is a deliberate client-policy choice (spec says "confirmed" without a number).

## vac citation + verification (ROTATE-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed, owner exempt | Non-owner rotations cite vac, receiver verifies against folded Roster, rejects if missing/unverifiable; owner exempt | ✓ |
| Fail-closed, vac required for everyone | Uniform, but forces owner to manufacture a self-Grant citation | |
| Cite only, defer strict receiver rejection | Add citation now, keep verification lenient — leaves the M03 hole open | |

**User's choice:** Fail-closed, owner exempt.
**Notes:** Mirror the existing includeKickTarget pattern; owner acts under inherent ownership, matching refoundAuthority.

---

## Claude's Discretion

- ROTATE-11 (prevepoch consistency across chunks) — rides the ROTATE-10 consistency guard.
- ROTATE-12 (de-inherit tip refounder in buildChain) — fix defensively; latent today.
- Exact retry-signal shape (ROTATE-05), latch storage (in-memory vs persisted), majority arithmetic/timeout handling (ROTATE-09), vac wire-format placement (ROTATE-08), and plan/commit sequencing (each fix + its spec-derived test).

## Deferred Ideas

- Multi-fork community client that preserves all forks and follows both (future "later version").
- Persisted anti-refork latch surviving client restart (only if research requires it).
