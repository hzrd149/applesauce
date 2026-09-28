# Phase 26: Release Coordination — v7.0.0 - Pattern Map

**Mapped:** 2026-09-14
**Files analyzed:** 5 concrete create/modify/delete assignments, plus the conditional 73-file audit set
**Analogs found:** 5 / 5 concrete assignments

## Scope Extraction

The repository changes implied by `26-CONTEXT.md` and `26-RESEARCH.md` are:

1. Create `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` as the single committed evidence artifact.
2. Rewrite `.changeset/hidden-content-unlock-guards.md` so Phase 24's exact `Intl.Segmenter` gate recognizes one sentence.
3. Remove `.changeset/clamp-timer-delays.md` and replace it with two focused package-specific changesets. Recommended restored names from the owning quick-task provenance are `.changeset/clamp-expiration-timer-delay.md` and `.changeset/wait-for-paid-timer-fixes.md`; names remain planner discretion.
4. Conditionally rewrite, split, or remove any other `.changeset/*.md` whose row-by-row semantic audit fails. Do not predeclare edits for files that pass and remain byte-identical.

No product source, package manifest, lockfile, changelog, version, tag, remote ref, or publication file should be changed. `refs/heads/master` is mutable Git state, not a repository file. The research permits the checker to be inline or tracked; prefer an inline dependency-free Node assertion so no unrequired checker file is introduced.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` (new) | documentation / release evidence | batch | `.planning/phases/25.5-repository-extraction-cleanup/25.5-VERIFICATION.md` and `25.5-04-SUMMARY.md` | role-match |
| `.changeset/hidden-content-unlock-guards.md` (modify) | config / release metadata | transform | `.changeset/relay-operation-scoped-auth-callbacks.md` | exact |
| `.changeset/clamp-timer-delays.md` (delete after split) | config / release metadata | transform | `.planning/phases/24-negentropy-sync-re-layer/24-10-PLAN.md` | exact workflow |
| `.changeset/clamp-expiration-timer-delay.md` (new; recommended name) | config / release metadata | transform | `.changeset/relay-operation-scoped-auth-callbacks.md` | exact shape |
| `.changeset/wait-for-paid-timer-fixes.md` (new; recommended name) | config / release metadata | transform | `.changeset/relay-operation-scoped-auth-callbacks.md` | exact shape |
| Other `.changeset/*.md` (conditional only) | config / release metadata | batch transform | `.planning/phases/24-negentropy-sync-re-layer/24-10-PLAN.md` | exact workflow |

All named existing analogs were verified with `git ls-files`; no runtime/install mirror path is used.

## Pattern Assignments

### `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` (documentation/evidence, batch)

**Primary analog:** `.planning/phases/25.5-repository-extraction-cleanup/25.5-VERIFICATION.md`

**Truth/evidence table pattern** (lines 28-37):

```markdown
### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Phase 25.5 verifies the checked-out repository ... | ✓ VERIFIED | `ROADMAP.md` states both boundaries ... |
| 2 | Frozen installation proves ... | ✓ VERIFIED | The focused wallet and common suites passed ... |
```

Copy the explicit row-per-claim style, but adapt it into the two required inventories:

- **Changeset audit:** final path/ID; every package+bump pair; exact final body; one-line, one-sentence, and semantic results; provenance; held-v1.2 flag; disposition.
- **Package result:** all thirteen exact package names; computed `7.0.0`; final direct/downstream classification; status-JSON evidence.

Do not summarize groups of changesets into one row. D-04 requires every final pending note to remain individually traceable, including the two held notes.

**Artifact/link table pattern** (`25.5-VERIFICATION.md`, lines 41-57):

```markdown
| Artifact | Expected | Status | Details |
|---|---|---|---|
| `25.5-04-SUMMARY.md` | Gap-closure execution record | ✓ VERIFIED | Exists and records command-level results ... |

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Pre-install snapshot | Post-cleanup snapshot | status diff and lock hash | ✓ WIRED | Direct status diff was empty ... |
```

Use the same concrete linkage style for changeset → owning summary/verification/source proof and status JSON → package checklist. Prefer exact tracked paths and immutable commit OIDs over prose such as “verified manually.”

**Command evidence pattern:** `.planning/phases/25.5-repository-extraction-cleanup/25.5-04-SUMMARY.md` lines 79-109.

```markdown
## Verification Evidence

All commands returned status 0:

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm build`
- `pnpm --filter applesauce-docs build`
- `pnpm --filter applesauce-examples build`
```

Follow this with compact tables for status/output facts and OIDs. Record the final source commit/tree, base, old master, candidate commit/tree, sole-parent and one-post-base proofs, resulting master, preserved next/remotes, and master-scoped Concord-code absence proof. Raw logs belong under `.git/` or `/tmp`; only distilled immutable evidence belongs in this tracked file.

**No exact history-evidence analog exists.** For that subsection use `26-RESEARCH.md` lines 217-228 and 315-332, not a normal merge summary. The evidence must show candidate verification before compare-and-swap ref mutation.

---

### `.changeset/hidden-content-unlock-guards.md` (config/release metadata, transform)

**Analog:** `.changeset/relay-operation-scoped-auth-callbacks.md`

**Complete file shape** (lines 1-5):

```markdown
---
"applesauce-relay": minor
---

Move operation-scoped authentication callbacks to publish, request, count, and sync.
```

Keep the existing package and `patch` bump. Rewrite only the body punctuation/wording needed to avoid the ``is...Unlocked`` segmentation problem; preserve one nonblank Markdown body line and one semantic change. A suitable shape is:

```markdown
The hidden-content unlock guards now report unlocked only after the hidden values are decrypted, so the matching unlock helpers no longer resolve undefined.
```

The final wording must be checked against implementation provenance and the same `Intl.Segmenter("en", { granularity: "sentence" })` parser used below.

---

### `.changeset/clamp-timer-delays.md` and its two replacements (config/release metadata, transform)

**Split/remove workflow analog:** `.planning/phases/24-negentropy-sync-re-layer/24-10-PLAN.md` lines 12-25.

```markdown
- "Every relevant pending note has explicit retain/revise/remove disposition (D-26)."
- "All twelve remaining notes pass exact package/bump and Intl.Segmenter sentence count one (D-26)."
...
RETAIN ... REVISE ... REMOVE ... CREATE ...
```

Apply an explicit disposition chain in the matrix:

1. `remove` `.changeset/clamp-timer-delays.md` because one body joins independent core and wallet-connect changes.
2. `split/create` one `applesauce-core: patch` note for the far-future NIP-40 timer clamp.
3. `split/create` one `applesauce-wallet-connect: patch` note for `waitForPaid()` timer behavior.
4. Verify each resulting body independently for semantic scope and sentence count.

**Frontmatter/body analog:** `.changeset/relay-operation-scoped-auth-callbacks.md` lines 1-5. Each replacement should have exactly one package entry, a blank line after closing frontmatter, and one body sentence.

**Semantic provenance:** `.planning/quick/260805-ds0-clamp-expirationmanager-settimeout-delay/260805-ds0-SUMMARY.md` lines 22-37 and 45-69.

```yaml
created:
  - .changeset/clamp-expiration-timer-delay.md
  - .changeset/clear-stale-expiration-timer-state.md
  - .changeset/wait-for-paid-timer-fixes.md
```

The same summary maps D1 to the core expiration clamp and D3 to wallet-connect no-expiry plus expiry-timer behavior. Use those rows and current source/tests to settle exact final wording; do not copy the current combined sentence into both files. The audit must also account for the independently shipped stale-bookkeeping change rather than silently merging or duplicating it.

---

### Other `.changeset/*.md` (conditional batch transform)

**Analog:** `.planning/phases/24-negentropy-sync-re-layer/24-10-PLAN.md` lines 25-26.

Copy its deterministic per-file disposition vocabulary (`RETAIN`, `REVISE`, `REMOVE`, `CREATE`) and its fail-closed parser requirements. A file passing semantic, package/bump, one-line, and one-sentence checks remains byte-identical. Only files with a documented failing row are edited.

The two held-v1.2 rows must explicitly identify:

- `.changeset/relay-operation-scoped-auth-callbacks.md`
- `.changeset/sync-loader-auth-hooks.md`

Their matrix provenance should cite the current Phase 18/24 summaries plus current relay/loaders source and tests. Their presence in the final `--since=master` result is an assertion, not an assumption.

## Shared Patterns

### Changeset validation

**Source:** `.planning/phases/24-negentropy-sync-re-layer/24-10-PLAN.md` lines 12-26.

Apply to all 73 physical pending release notes, not only the current 33-file `--since=master` subset:

```javascript
const seg = new Intl.Segmenter("en", { granularity: "sentence" });
const sentences = [...seg.segment(body)]
  .map(({ segment }) => segment.trim())
  .filter(Boolean);
if (sentences.length !== 1) throw Error(`${name}: sentence count`);
```

Also require valid Changesets frontmatter, at least one valid package/bump entry, exactly one nonblank body line, no list/heading/fence, and a resolved matrix row. Semantic one-change review remains human/provenance-backed and cannot be replaced by tokenization.

The stable matrix IDs identify the 73 pre-edit physical inputs. A `SPLIT` row retains the removed input path and names every replacement path, so the final 74-note inventory remains fully accounted for without renumbering the source audit.

### Release graph oracle

**Source:** `.changeset/config.json` lines 5-29.

```json
"fixed": [],
"linked": [[
  "applesauce-accounts",
  "applesauce-actions",
  "applesauce-common",
  "applesauce-content",
  "applesauce-core",
  "applesauce-extra",
  "applesauce-loaders",
  "applesauce-react",
  "applesauce-relay",
  "applesauce-signers",
  "applesauce-sqlite",
  "applesauce-wallet-connect",
  "applesauce-wallet"
]],
"baseBranch": "master",
"updateInternalDependencies": "minor"
```

Generate the final checklist from `pnpm exec changeset status --verbose --since=master --output=/tmp/phase26-status.json`. Assert the exact thirteen-name set and `newVersion === "7.0.0"`; derive direct/downstream from each final Changesets array after corrections. Do not add no-op notes or use JSON `oldVersion` as the manifest inventory.

### Full clean-checkout gate

**Source:** `.planning/phases/25.5-repository-extraction-cleanup/25.5-04-PLAN.md` lines 77-90.

Copy these invariants:

- snapshot sorted porcelain status and `pnpm-lock.yaml` SHA-256 before install;
- run frozen install, full test/build, docs build, and examples build in fail-fast order;
- remove only explicit repository-local generated families proven ignored by `git check-ignore`;
- never use `git clean`, follow symlinks, or remove outside the resolved repository root;
- require empty post-cleanup generated inventory, direct pre/post status equality, and unchanged lock hash.

Use the research-mandated current command set and shell-available Node fallback instead of copying Phase 25.5's unavailable `rg` commands verbatim.

### Git ref safety and error handling

There is no repository script analog; use the fail-closed plumbing pattern from `26-RESEARCH.md`:

```bash
CANDIDATE=$(git commit-tree "$SOURCE_TREE" -p "$BASE" -m "$MSG")
test "$(git rev-parse "$CANDIDATE^{tree}")" = "$SOURCE_TREE"
test "$(git rev-parse "$CANDIDATE^")" = "$BASE"
test "$(git rev-list --count "$BASE..$CANDIDATE")" -eq 1
git update-ref refs/heads/master "$CANDIDATE" "$OLD_MASTER"
```

Resolve immutable OIDs only after the checkout is clean. Construct and verify the candidate before moving a ref; preserve snapshots of `next` and all remote refs; update only local master with expected-old compare-and-swap. Every failed command stops execution and leaves master unmoved where possible.

### Release boundary

**Source:** `package.json` lines 4-15.

The repository defines `version-packages` and `release`, but Phase 26 must use only validation behavior. Do not invoke `changeset version`, `changeset publish`, `pnpm release`, or anything that pushes, tags, versions, or writes changelogs.

## No Analog Found

| Concern | Role | Data Flow | Reason / Fallback |
|---|---|---|---|
| History/OID proof subsection inside `26-RELEASE-AUDIT.md` | release evidence | event-driven Git state mutation | No tracked prior phase performs `commit-tree` plus compare-and-swap branch reconstruction; copy the concrete commands from `26-RESEARCH.md` lines 217-228 and 315-332. |

## Metadata

**Analog search scope:** `.changeset/`, Phase 18 held-note audit, Phase 24 changeset reconciliation, Phase 25.5 clean-checkout evidence, timer quick-task provenance, root release configuration/scripts
**Strong analogs read:** 5 (`relay-operation-scoped-auth-callbacks.md`, `24-10-PLAN.md`, `25.5-04-PLAN.md`, `25.5-04-SUMMARY.md`, `25.5-VERIFICATION.md`), plus tracked semantic provenance
**Tracked-source gate:** passed for every existing analog named above
**Pattern extraction date:** 2026-09-14
