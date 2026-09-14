# Phase 26: Release Coordination — v7.0.0 - Research

**Researched:** 2026-09-14
**Domain:** Changesets release audit, pnpm monorepo validation, and Git history reconstruction
**Confidence:** HIGH for repository state and executable gates; MEDIUM for upstream tool semantics

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Changeset Truth Audit
- **D-01:** Audit every pending `.changeset/*.md` file for semantic accuracy, one-change scope, and a single-sentence Markdown body.
- **D-02:** Use the owning phase summaries and verification records as the semantic provenance for each changeset.
- **D-03:** Rewrite inaccurate or stale wording, split files that describe genuinely distinct changes, and remove duplicate or no-longer-shipped notes.
- **D-04:** Retain one committed Phase 26 audit matrix mapping every pending changeset to its package, compliance result, summary provenance, and final disposition.
- **D-05:** The held v1.2 `applesauce-relay` and `applesauce-loaders` changesets must be explicitly identified in the matrix and confirmed to describe behavior present in the final release tree.

### Release Stopping Point
- **D-06:** Stop at a release-ready local commit. Do not run `changeset version`, mutate package versions or changelogs, run `changeset publish`, publish npm packages, push branches, create tags, or create a hosted release.
- **D-07:** Do not add a post-phase publication runbook. Phase 26 ends with its release evidence and the release-ready local history.
- **D-08:** Define release readiness with a full clean-checkout gate: frozen-lockfile installation, all package tests and builds, documentation and examples builds, Changesets audits, repository cleanup, unchanged `pnpm-lock.yaml`, and exact restoration of the recorded non-generated checkout baseline.

### Thirteen-Package Version Result
- **D-09:** A publishable package does not need its own changeset when the current internal dependency graph legitimately propagates the coordinated major bump.
- **D-10:** The final `changeset status --verbose --since=master` output is the source of truth and must show all thirteen publishable packages resolving to `7.0.0`.
- **D-11:** Keep an explicit package checklist recording each package name, computed `7.0.0` version, and whether its bump is direct or downstream from `applesauce-core` through the current release graph.
- **D-12:** If a package disappears from the final computed release, diagnose the release graph discrepancy. Do not invent a no-op changeset merely to force inclusion.

### Squash and Reachable History
- **D-13:** Pin the final reviewed `next` commit only after all changeset corrections and release gates pass, and require the checkout to be clean before constructing the squash.
- **D-14:** Rewrite local `master` from the last pre-Concord base, replacing all later history with one squash commit whose tree is byte-identical to the pinned `next` tree. A normal squash merge onto current `master` is insufficient because current `master` already has reachable Concord commits. — **Reversibility:** costly — changing the selected base or tree requires reconstructing and re-verifying the rewritten branch.
- **D-15:** Update local `master` with the verified squash commit while leaving `next` and all remote refs untouched.
- **D-16:** Record the pinned source commit, source tree, pre-Concord base, resulting squash commit, resulting tree, tree-equality proof, and a case-insensitive reachable-history absence check for Concord code.

### the agent's Discretion
- Choose the audit matrix filename and exact table layout as long as every pending changeset and all thirteen packages are explicit and traceable.
- Choose safe temporary refs or backup refs used while constructing and verifying the local rewrite, provided the final local branch and remote boundaries above are preserved.
- Choose exact full-gate commands by reusing the strongest existing Phase 25.5 release checks and current package scripts.

### Deferred Ideas (OUT OF SCOPE)

None - discussion stayed within Phase 26 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | Every remaining publishable package intended for v7 reaches `7.0.0`, with an explicit thirteen-package dry-run checklist | Current Changesets JSON proves the thirteen-package result and exposes direct versus dependency-cascade entries |
| REL-03 | v1.2's held relay and loaders changesets ship | Git history identifies the two held files; current source and tests prove their revised behavior |
| REL-04 | Every release changeset describes exactly one change in one sentence | The complete 73-file inventory was opened; a parser probe found one sentence-tokenization failure and one clear two-change body |
</phase_requirements>

## Summary

This is a release-control phase, not a versioning or publishing phase. The plan should have three ordered gates: (1) reconcile all release notes into one committed audit matrix, (2) run and restore the complete clean-checkout gate, then (3) pin the reviewed `next` commit and construct a new local `master` commit from that exact tree with the last pre-Concord commit as its sole parent. [VERIFIED: 26-CONTEXT.md:7-38]

The most important discovery is that there are **73** release changeset files in the checkout, but `pnpm exec changeset status --verbose --since=master` currently considers only **33** of them because 40 are already present unchanged on `master`. The future `changeset version` command does not accept the same `--since` filter and consumes pending changesets, so D-01/D-04 must audit all 73 even though D-10's final oracle displays the 33 changed-since-master set (plus any older files Phase 26 edits or replaces). [VERIFIED: live `changeset status` JSON at `/tmp/phase26-all-status.json` and `/tmp/phase26-status.json`] [CITED: https://github.com/changesets/changesets/blob/main/docs/command-line-options.md]

Current dry-run output already resolves all thirteen publishable packages to `7.0.0`; six entries currently carry direct since-master changesets and seven are dependency cascades. Do not freeze that direct/downstream classification before the audit: rewriting or splitting an older changeset makes it newly visible to `--since=master` and can legitimately change a package from downstream to direct. [VERIFIED: /tmp/phase26-status.json:334-471]

**Primary recommendation:** Commit a 73-row changeset audit and final 13-row package checklist before the final clean gate, then use `git commit-tree` plus compare-and-swap `git update-ref` to create and install the replacement local `master` only after OID-, parent-, tree-, and history-based proofs pass. [CITED: https://git-scm.com/docs/git-commit-tree] [CITED: https://git-scm.com/docs/git-update-ref]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Changeset truth audit | Release metadata | Shipped source/tests | The note is public metadata, but source and phase evidence determine whether it is true [VERIFIED: 26-CONTEXT.md:16-21] |
| Coordinated version computation | Changesets CLI | Package manifests | `.changeset/config.json` and internal dependency edges compute the release set [VERIFIED: .changeset/config.json:5-29] |
| Clean-checkout gate | Workspace tooling | Package/docs/example projects | Root Turbo/Vitest scripts fan out to all build and test targets [VERIFIED: package.json:4-15; turbo.json:4-11] |
| Squash construction | Git object database | Local refs | The tree and parent define the new commit; only local `master` is moved [CITED: https://git-scm.com/docs/git-commit-tree] |
| Reachable-history proof | Git ancestry | Product source paths | The proof must inspect commits reachable from the resulting `master`, not all refs that are intentionally preserved [CITED: https://git-scm.com/docs/git-rev-list] |

## Project Constraints (from AGENTS.md)

- Every changeset body must describe exactly one change in one Markdown sentence; distinct changes require distinct files and the smallest applicable bump. [VERIFIED: AGENTS.md:189-196]
- Documentation should be integrated into existing relevant docs, avoid standalone best-practices files and duplicate explanations, and omit recap-style summary sections. [VERIFIED: AGENTS.md:3-17,61-73,126-128]
- Code blocks must stay focused and about 20 lines or fewer. [VERIFIED: AGENTS.md:19-29]
- Exported package APIs require concise JSDoc, but this phase should not change product APIs. [VERIFIED: AGENTS.md:148-187] [VERIFIED: 26-CONTEXT.md:7-9]
- Documentation verification normally checks examples, navigation, and duplicate/orphaned files; for this release phase the relevant mandated checks are docs/examples builds and changeset orphan detection. [VERIFIED: AGENTS.md:139-146; 26-CONTEXT.md:26]

## Standard Stack

### Core

| Tool | Verified Version | Purpose | Why Standard Here |
|------|------------------|---------|-------------------|
| Node.js | `v26.4.0` available; repository requires `>=20.19.0` | Execute Changesets, Vitest, Turbo, and audit scripts | Existing repository runtime [VERIFIED: live `node --version`; package.json:35-36] |
| pnpm | `11.10.0` | Frozen workspace install and filtered commands | Root pins `"packageManager": "pnpm@11.10.0"` [VERIFIED: package.json:43] |
| `@changesets/cli` | installed CLI `2.31.1`; manifest range `^2.31.0` | Release graph/status JSON | Existing release mechanism [VERIFIED: live `pnpm exec changeset --version`; package.json:17-19] |
| Git | `2.34.1` | Commit/tree identity, ancestry, and local ref update | Existing VCS; required plumbing is present in this version [VERIFIED: live `git --version`] |
| Turbo | `^2.9.14` | Workspace build graph | Root build script is `"build": "turbo build"` [VERIFIED: package.json:6,30] |
| Vitest | root `^4.1.6` | Full behavioral suite | Root test script builds packages then runs Vitest [VERIFIED: package.json:7,32] |

### Supporting

| Tool | Purpose | Availability |
|------|---------|--------------|
| `sha256sum`, `sort`, `diff`, `xargs` | Baseline hashes and exact pre/post comparisons | Available in `/usr/bin` [VERIFIED: live `command -v` probe] |
| `git grep` plus a small Node filesystem scanner | Tracked and ignored/generated absence checks | Available; use as the fallback because shell `rg` is currently absent [VERIFIED: live `command -v rg` returned no path] |

**Installation:** No new package is required. Use the locked workspace only:

```bash
pnpm install --frozen-lockfile
```

No Package Legitimacy Audit is required because this phase adds no dependency and must not mutate the lockfile. [VERIFIED: 26-CONTEXT.md:23-27]

## Repository Release Inventory

### Publishable package set

The live linked set is exactly the following thirteen names. DATA_Q7M4K2LP_START `"applesauce-accounts", "applesauce-actions", "applesauce-common", "applesauce-content", "applesauce-core", "applesauce-extra", "applesauce-loaders", "applesauce-react", "applesauce-relay", "applesauce-signers", "applesauce-sqlite", "applesauce-wallet-connect", "applesauce-wallet"` DATA_Q7M4K2LP_END. [VERIFIED: .changeset/config.json:6-21]

The same config states DATA_F8N3R6TZ_START `"fixed": []`, `"baseBranch": "master"`, `"updateInternalDependencies": "minor"` DATA_F8N3R6TZ_END and ignores DATA_P2V9C5HX_START `"applesauce-docs", "applesauce-examples", "applesauce-llms", "applesauce-agent-skills"` DATA_P2V9C5HX_END. [VERIFIED: .changeset/config.json:5-29]

### Current D-10 baseline

| Package | Current `--since=master` result | Current classification | Why it appears |
|---------|---------------------------------|------------------------|----------------|
| `applesauce-relay` | `7.0.0` | direct | 24 since-master changesets |
| `applesauce-common` | `7.0.0` | direct | 2 since-master changesets |
| `applesauce-core` | `7.0.0` | direct | 3 since-master changesets |
| `applesauce-loaders` | `7.0.0` | direct | 2 since-master changesets |
| `applesauce-sqlite` | `7.0.0` | direct | 1 since-master changeset |
| `applesauce-wallet` | `7.0.0` | direct | 1 since-master changeset |
| `applesauce-extra` | `7.0.0` | downstream | regular dependency on core |
| `applesauce-actions` | `7.0.0` | downstream | dependencies on common/core |
| `applesauce-content` | `7.0.0` | downstream | dependencies on common/core |
| `applesauce-wallet-connect` | `7.0.0` | downstream | dependencies on common/core |
| `applesauce-accounts` | `7.0.0` | downstream | dependencies on core/signers |
| `applesauce-react` | `7.0.0` | downstream | optional dependency on core and sibling packages |
| `applesauce-signers` | `7.0.0` | downstream | dependency on core |

All names, versions, and empty/nonempty Changesets arrays above are verbatim in the generated status JSON. DATA_J6S1W8BD_START `"newVersion": "7.0.0"` DATA_J6S1W8BD_END appears for every publishable row, while DATA_C4Y7L9RN_START `"name": "applesauce-examples", "type": "none"` DATA_C4Y7L9RN_END is the ignored private application row. [VERIFIED: /tmp/phase26-status.json:334-471]

**Do not use the JSON `oldVersion` as the manifest inventory.** Linked-package calculation normalizes its release baseline to `6.2.2`, while checked-in manifests actually include `6.2.1` for relay, `6.0.0` for React/SQLite, `6.2.2` for signers, and `6.2.0` for the others. [VERIFIED: packages/relay/package.json:1-4; packages/react/package.json:1-4; packages/sqlite/package.json:1-4; packages/signers/package.json:1-4; packages/core/package.json:1-4 and the remaining opened `packages/*/package.json` files]

### Changeset population and known audit findings

- The directory contains 73 release-note Markdown files plus `.changeset/README.md`; all 73 release files were opened in this session. [VERIFIED: `.changeset/` directory listing and individual file reads]
- `status --since=master` currently includes 33 files; unfiltered `status` includes all 73. [VERIFIED: live JSON status probes]
- Every body is currently one nonblank Markdown line. [VERIFIED: individual `.changeset/*.md` reads and live parser probe]
- `.changeset/hidden-content-unlock-guards.md` is semantically one sentence, but `Intl.Segmenter` counts the code token ``is...Unlocked`` as sentence boundaries; rewrite the token wording so the same exact parser used by Phase 24 returns one sentence. DATA_R5K8T1QP_START `The hidden content \`is...Unlocked\` guards now only report unlocked once the hidden values have actually been decrypted, so the matching \`unlock...\` helpers no longer resolve undefined.` DATA_R5K8T1QP_END [VERIFIED: .changeset/hidden-content-unlock-guards.md:1-5 and live `Intl.Segmenter` probe]
- `.changeset/clamp-timer-delays.md` clearly combines two independent fixes across two packages and must be split. DATA_U3D7A9MF_START `Clamp \`setTimeout\` delays to Node's 32-bit limit so far-future NIP-40 expirations no longer trigger a \`TimeoutOverflowWarning\` hot loop, and fix \`waitForPaid()\` rejecting immediately on invoices with no expiry` DATA_U3D7A9MF_END [VERIFIED: .changeset/clamp-timer-delays.md:1-6; AGENTS.md:189-196]
- The three re-layering notes flagged by a simple “and + verb” heuristic were each deliberately validated by their owning phases as one architectural change; they need semantic review, not automatic splitting. [VERIFIED: .planning/phases/18-event-family-re-layer/18-05-SUMMARY.md:38-50; .planning/phases/20-auth-family-re-layer/20-04-SUMMARY.md:13-15,54-60; .planning/phases/22-req-family-re-layer/22-07-SUMMARY.md:8-15]

### Exact tracked changeset paths

**Currently visible to `--since=master` (33):**

`auth-retry-error-channel.md`, `brave-ids-batch.md`, `common-falsy-app-data.md`, `core-stamp-comment.md`, `group-pointer-lossless-roundtrip.md`, `loaders-sync-fallback-auth.md`, `logger-colors.md`, `logger-sink-record.md`, `lucky-pans-shave.md`, `relay-auth-family-re-layer.md`, `relay-auth-lifecycle-debug-logging.md`, `relay-auth-log-namespace-order.md`, `relay-auth-wire-request-context.md`, `relay-closed-prefix-safety.md`, `relay-count-nip45.md`, `relay-event-publish-layering.md`, `relay-group-count-progressive.md`, `relay-group-error-surface.md`, `relay-group-sync-per-relay-isolation.md`, `relay-negentropy-rounds.md`, `relay-operation-scoped-auth-callbacks.md`, `relay-publish-response-error-field.md`, `relay-publish-timeout-marks-itself.md`, `relay-quiet-empty-auth-invalidation.md`, `relay-req-family-re-layer.md`, `relay-sync-outcomes.md`, `shaggy-clowns-smile.md`, `sqlite-optional-backends.md`, `sync-loader-auth-hooks.md`, `tall-months-invite.md`, `wait-for-auth-pubkeys.md`, `wallet-lock-relays.md`, `wide-donkeys-smile.md`. [VERIFIED: /tmp/phase26-status.json:2-332]

**Pending in the checkout but currently excluded by `--since=master` (40):**

`add-is-valid-seal.md`, `android-native-account-restore-fields.md`, `android-native-signer-seed-pubkey.md`, `cache-write-frozen-throws.md`, `cache-writes-hidden-from-spread.md`, `chat-message-factory.md`, `clamp-timer-delays.md`, `comment-parent-rumor.md`, `copy-symbols-guards.md`, `forum-thread-nip7d.md`, `generic-common-helpers.md`, `generic-event-stores.md`, `gift-wrap-symbols-to-core.md`, `hidden-content-unlock-guards.md`, `hidden-tags-undefined-not-throw.md`, `lock-app-data-clears-plaintext.md`, `multi-user-authentication.md`, `pubkey-casts-store-cache.md`, `reaction-parent.md`, `relay-auth-handler-sync-throw-mapped.md`, `relay-auth-resend-req-count-observed.md`, `relay-auth-retry-bound-not-reset-by-req-open.md`, `relay-auth-timeout-bounded-wait.md`, `relay-group-logger-routing.md`, `relay-group-request-error-not-progress.md`, `relay-group-request-timeout-suspended.md`, `relay-request-timeout-can-fire.md`, `remove-event-factory-kind.md`, `rumor-stores.md`, `rumor-type-and-helpers.md`, `seal-parse-failures-return-undefined.md`, `stamp-no-caller-mutation.md`, `sync-loader-auth-phase-timer-leak-fixed.md`, `sync-loader-handlerless-stall-suspension.md`, `sync-loader-wait-for-auth.md`, `tricky-pots-teach.md`, `verify-event-undefined-fix.md`, `verify-gift-wrap-seal-signatures.md`, `wallet-getters-return-undefined.md`, `wallet-notification-safe-parse.md`. [VERIFIED: difference of `/tmp/phase26-all-status.json` and `/tmp/phase26-status.json`]

## Held v1.2 Changesets

The two required held notes are:

1. `.changeset/relay-operation-scoped-auth-callbacks.md`, originally added by commit `54d840006cf037aade0b17748ade8297fe331416` on 2026-08-06 and most recently corrected by Phase 18 commit `d2cb1faa2854a20792d467ef8f2f98882261f889`. Its current body is DATA_H9W2E6KC_START `Move operation-scoped authentication callbacks to publish, request, count, and sync.` DATA_H9W2E6KC_END [VERIFIED: .changeset/relay-operation-scoped-auth-callbacks.md:1-5 and live Git history]
2. `.changeset/sync-loader-auth-hooks.md`, originally added by commit `55e3f830d2b8b36924cfd070439766ac09c8399f` on 2026-08-06 and most recently corrected by Phase 24 commit `e904c48fc4310513260179c149dfc2d6b6be28c1`. Its current body is DATA_B1F7N4VX_START `Make high-level sync own authentication hooks while the sync loader preserves them across its paginated fallback.` DATA_B1F7N4VX_END [VERIFIED: .changeset/sync-loader-auth-hooks.md:1-5 and live Git history]

Both are in the current `--since=master` Changesets set. [VERIFIED: /tmp/phase26-status.json:203-211,283-291]

The final tree supports the relay note: the shared `RelayAuthOptions` declares DATA_M6Q3S8ZA_START `waitForAuth`, `onAuthRequired`, `authTimeout`, `authRetries` DATA_M6Q3S8ZA_END, and `request`, `publish`, `count`, and `sync` own or receive those high-level policies. [VERIFIED: packages/relay/src/types.ts:105-125; packages/relay/src/relay.ts:1149-1174,1612-1664,1667-1703]

The final tree supports the loaders note: one `methodOptions` object carries those four fields, the loader passes its per-relay derivative to both `sync(...)` and `paginatedRequest(...)`, and a non-auth sync failure falls back to that request path. [VERIFIED: packages/loaders/src/loaders/sync-loader.ts:353-370,507-511,635-678] Tests independently assert both direct paths and exact option reuse across fallback. [VERIFIED: packages/loaders/src/loaders/__tests__/sync-loader.test.ts:153-289]

## Architecture Patterns

### System Architecture Diagram

```text
73 changeset files + phase evidence + package manifests
        │
        ▼
truth/scope/sentence audit ──fail──► rewrite, split, or remove
        │ pass
        ▼
Changesets status JSON ──missing package──► diagnose dependency graph
        │ 13 × 7.0.0
        ▼
clean checkout gate ──failure──► restore baseline and stop
        │ pass
        ▼
pin next commit/tree → create candidate commit(tree, pre-Concord parent)
        │
        ├─ tree/parent/history proof fails ──► do not move refs
        ▼
compare-and-swap update of local master only
```

### Recommended Evidence Artifact

Use one committed Phase 26 file with two tables:

```text
.planning/phases/26-release-coordination-v7-0-0/
└── 26-RELEASE-AUDIT.md
    ├── Changeset audit (73 final rows)
    ├── Package result (13 final rows)
    ├── Clean-gate evidence
    └── Squash OIDs and proofs
```

The path is a prescriptive planner choice under D-04's discretion; it is not an existing repository fact.

### Pattern 1: Audit all pending notes, then derive the D-10 subset

The changeset table should have: final path/ID, all targeted package+bump pairs, exact final body, one-line result, one-sentence result, semantic result, owning summary/verification or historical evidence, held-v1.2 flag, and disposition (`retain`, `rewrite`, `split`, `remove`). The package table should be regenerated after all note edits from final status JSON; never maintain versions by hand. [VERIFIED: 26-CONTEXT.md:16-32]

### Pattern 2: Bind destructive work to immutable OIDs

Resolve and record `SOURCE`, `SOURCE_TREE`, `BASE`, and current `OLD_MASTER` only after the checkout is clean. Build the candidate without moving any ref, verify it, then update `refs/heads/master` only if it still equals `OLD_MASTER`. [CITED: https://git-scm.com/docs/git-commit-tree] [CITED: https://git-scm.com/docs/git-update-ref]

```bash
SOURCE=$(git rev-parse next)
SOURCE_TREE=$(git rev-parse "$SOURCE^{tree}")
OLD_MASTER=$(git rev-parse refs/heads/master)
CANDIDATE=$(git commit-tree "$SOURCE_TREE" -p "$BASE" -m "$MSG")
test "$(git rev-parse "$CANDIDATE^{tree}")" = "$SOURCE_TREE"
git update-ref -m "$MSG" refs/heads/master "$CANDIDATE" "$OLD_MASTER"
```

### Pattern 3: Run the final gate against the exact tree to be pinned

Prepare all tracked audit/evidence content first, commit it, run the full gate, clean ignored outputs, prove exact pre/post status and lock hash, then pin that unchanged commit. Keep raw transient logs under `.git/` or `/tmp`, because adding evidence after the run changes the candidate tree. [VERIFIED: 25.5-04-PLAN.md:77-90]

### Anti-Patterns to Avoid

- **Normal squash merge onto current `master`:** its old reachable ancestry already includes the code being removed. [VERIFIED: 26-CONTEXT.md:34-38]
- **Auditing only the 33 `--since=master` notes:** a later unfiltered `changeset version` would still consume all pending notes. [CITED: https://github.com/changesets/changesets/blob/main/docs/command-line-options.md]
- **Grepping all refs for historical absence:** `next`, both remote `concord` refs, and multiple preserved remote branches intentionally still contain commit `452dc444...`; D-15 forbids moving remote refs and preserves `next`. Scope the proof to resulting local `master`. [VERIFIED: live `git for-each-ref --contains=452dc444...`]
- **Moving `master` before candidate verification:** construct an unreachable candidate object or temporary non-branch ref first. [CITED: https://git-scm.com/docs/git-commit-tree]
- **Writing release evidence after pinning without re-gating/re-pinning:** it makes `next` move away from the tree recorded in the squash.
- **Using `git reset --hard`, `git clean`, or checkout-wide deletion for cleanup:** reuse Phase 25.5's explicit ignored-path cleanup and exact baseline comparison. [VERIFIED: 25.5-04-PLAN.md:81-88]
- **Checking only commit subjects for the word “Concord”:** D-16 concerns reachable code; later cleanup/evidence commits legitimately discuss the retired code in planning records.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Release graph calculation | Custom semver/dependency traversal | `pnpm exec changeset status --verbose --since=master --output=...` | This exact installed CLI is the locked source of truth [VERIFIED: 26-CONTEXT.md:28-32] |
| Sentence tokenization | Period-count regex | `Intl.Segmenter("en", { granularity: "sentence" })` plus one-line checks | Code punctuation such as `is...Unlocked` defeats punctuation heuristics [VERIFIED: live parser probe] |
| New squash tree | Re-stage/copy every file into an index | `git commit-tree "$SOURCE_TREE" -p "$BASE"` | Reusing the source tree makes byte identity structural [CITED: https://git-scm.com/docs/git-commit-tree] |
| Ref concurrency safety | Blind `git branch -f` | `git update-ref <ref> <new> <expected-old>` | Expected-old turns the move into compare-and-swap [CITED: https://git-scm.com/docs/git-update-ref] |
| Release validation | New test framework | Existing Turbo, Vitest, package scripts, docs/examples builds | Phase 25.5 already proved this gate shape [VERIFIED: 25.5-04-SUMMARY.md:79-97] |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | No application datastore migration is part of this phase; the only persistent data being rewritten is Git commit/ref state | No product data migration; record Git OIDs as release evidence [VERIFIED: 26-CONTEXT.md:7-9,34-38] |
| Live service config | Two configured remotes (`origin`, `gh`) and their remote-tracking refs remain inputs only | Snapshot remote ref OIDs before/after and require equality; do not fetch/push during the final operation [VERIFIED: live `git remote -v`; 26-CONTEXT.md:37] |
| OS-registered state | Local Git refs `refs/heads/next` and `refs/heads/master`; HEAD currently points to `refs/heads/next` | Leave `next` and HEAD untouched; compare-and-swap only local `master` [VERIFIED: live `git symbolic-ref HEAD` and `git for-each-ref`; 26-CONTEXT.md:37] |
| Secrets/env vars | No signing, npm token, OTP, or publication credential is required because publishing/tagging/pushing is forbidden | Do not invoke commands that request release credentials [VERIFIED: 26-CONTEXT.md:23-25] |
| Build artifacts | Frozen install/build recreates ignored `node_modules`, `dist`, `.turbo`, docs build output, and related generated families | Reuse the explicit Phase 25.5 inventory and delete only paths proven ignored beneath the repository root [VERIFIED: 25.5-04-PLAN.md:81-88] |

**Important reachability boundary:** local `master`, local `next`, and many remote-tracking refs currently contain the first code commit `452dc444df7e3f48a8099f3917de705e4389d264`; after the phase only resulting local `master` is required to exclude it. [VERIFIED: live `git branch/for-each-ref --contains` probes; 26-CONTEXT.md:37-38]

## Current Git Boundary

- Current local `next` is `641ec81355fc4ddb853943930cf3387c897ce92c`; current local `master` is `ec51f7d4ecfd3db6099e786e8eec0062255588d4`. These are research-time observations and must be re-resolved at execution. [VERIFIED: live `git show-ref`]
- The candidate base is `5d0260e296a15b85bc4e58abc34cde3fb055179c`; its current subject is DATA_L2C8V5QJ_START `Remove tests on node 20` DATA_L2C8V5QJ_END. [VERIFIED: live `git show -s`; 26-CONTEXT.md:101]
- Its child `452dc444df7e3f48a8099f3917de705e4389d264` has parent exactly `5d0260e...` and subject DATA_Z4R1M7YW_START `Add Concord extraction Phase 0 foundation to applesauce-extra` DATA_Z4R1M7YW_END. [VERIFIED: live `git show -s`]
- The candidate base is an ancestor of both current branches. There are currently 1,537 commits in `base..next` and 886 in `base..master`, confirming that a normal merge onto current master cannot produce the required one-commit post-base history. [VERIFIED: live `git merge-base --is-ancestor` and `git rev-list --count`]
- Re-verify the boundary against source history, not only subjects: the first case-insensitive commit touching `packages/extra/src` with a Concord subject is currently `452dc444...`. [VERIFIED: live path-limited `git log --all --reverse` probe]

## Common Pitfalls

### Pitfall 1: `--since=master` hides older pending notes
**What goes wrong:** REL-04 passes for 33 notes while 40 pending notes evade the audit.  
**How to avoid:** Drive D-01 from the physical 73-file inventory/unfiltered status, and use `--since=master` only for D-10's version oracle. [VERIFIED: live status comparison]

### Pitfall 2: The package classification changes during correction
**What goes wrong:** Splitting `clamp-timer-delays.md` introduces direct core and wallet-connect notes into the since-master set, so a pre-audit checklist becomes stale.  
**How to avoid:** Keep a baseline column if useful, but generate the final direct/downstream result after all note dispositions. [VERIFIED: .changeset/clamp-timer-delays.md:1-6]

### Pitfall 3: Sentence parsers disagree with human reading
**What goes wrong:** `Intl.Segmenter` sees two sentences in `is...Unlocked` even though the Markdown body is one semantic sentence.  
**How to avoid:** Use Phase 24's parser as the mechanical gate and revise punctuation-heavy code shorthand. [VERIFIED: 24-10-SUMMARY.md:56-63 and live parser probe]

### Pitfall 4: Final evidence changes the pinned tree
**What goes wrong:** The executor runs all tests, writes/commits the audit results afterward, and squashes the ungated parent or moves `next` after recording it.  
**How to avoid:** Make all release-tree artifacts final, commit, run the gate, preserve raw logs outside the tree, and only then pin. Any later GSD state/summary bookkeeping is permitted only as planning-only commits outside the pinned release tree, with no non-planning diff from SOURCE; local `next` must never move after pinning.

### Pitfall 5: History check has the wrong universe
**What goes wrong:** `--all` fails forever because preserved `next` and remote refs retain the old history, or a commit-message grep fails on legitimate planning prose.  
**How to avoid:** traverse resulting local `master`; inspect the post-base commit count, sole parent, and code-tree/diff surfaces separately. [CITED: https://git-scm.com/docs/git-rev-list]

### Pitfall 6: Ref move races or affects the checked-out branch
**What goes wrong:** a blind force move overwrites an unexpected master update, or checking out master changes the worktree unnecessarily.  
**How to avoid:** stay on `next`, preserve the old master OID, and use `git update-ref refs/heads/master NEW OLD`. [CITED: https://git-scm.com/docs/git-update-ref]

### Pitfall 7: Cleanup destroys user state
**What goes wrong:** broad `git clean` or recursive deletion removes unrelated ignored files.  
**How to avoid:** use Phase 25.5's explicit generated families, root containment, no-symlink-following, and `git check-ignore` guard. [VERIFIED: 25.5-04-PLAN.md:81-88]

## Code Examples

### Changesets oracle and machine-readable checklist

```bash
pnpm exec changeset status --verbose --since=master \
  --output=/tmp/phase26-status.json
```

Parse that JSON with a dependency-free Node assertion in the plan; do not add a runtime dependency or refer to a checker path that the plan does not create.

### Candidate identity proof before ref mutation

```bash
test "$(git rev-parse "$CANDIDATE^{tree}")" = "$SOURCE_TREE"
test "$(git rev-parse "$CANDIDATE^")" = "$BASE"
test "$(git rev-list --count "$BASE..$CANDIDATE")" -eq 1
git diff --quiet "$SOURCE_TREE" "$CANDIDATE^{tree}"
```

### Ref-boundary proof

```bash
NEXT_BEFORE=$(git rev-parse refs/heads/next)
REMOTES_BEFORE=$(git for-each-ref --format='%(refname) %(objectname)' refs/remotes)
git update-ref refs/heads/master "$CANDIDATE" "$OLD_MASTER"
test "$(git rev-parse refs/heads/next)" = "$NEXT_BEFORE"
test "$(git for-each-ref --format='%(refname) %(objectname)' refs/remotes)" = "$REMOTES_BEFORE"
```

## State of the Art

| Old/unsafe approach | Required approach | Impact |
|---------------------|-------------------|--------|
| Assume linked means every package always publishes | Trust final Changesets status and real dependency cascades | Matches D-09/D-12 and official linked behavior [CITED: https://changesets.dev/guide/linked-packages] |
| Human-read release notes only | Human semantic provenance plus one-line/`Intl.Segmenter` mechanical gate | Catches both meaning and formatting defects [VERIFIED: 24-10-SUMMARY.md:56-63] |
| `git merge --squash` onto current master | New commit from source tree with pre-Concord parent | Removes post-base history from local master while preserving exact tree [VERIFIED: 26-CONTEXT.md:34-38] |
| Force-update a branch without an expected old value | Compare-and-swap `git update-ref` | Fails closed on a concurrent/unexpected ref change [CITED: https://git-scm.com/docs/git-update-ref] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None; recommendations are either locked decisions, live repository observations, or cited tool behavior | — | — |

## Open Questions (RESOLVED)

1. **RESOLVED — post-pin GSD summary/bookkeeping boundary.** D-13's SOURCE and SOURCE_TREE remain the immutable reviewed release tree. GSD planning, state, validation, requirements, roadmap, and summary bookkeeping created afterward may exist only as planning-only commits outside that pinned release tree, and each such state must be proven to have no non-planning diff from SOURCE. The executor must detach closeout work from SOURCE so local `next` never moves after pinning; local `master` remains the verified candidate and is never rebuilt from a bookkeeping descendant. [VERIFIED: 26-CONTEXT.md:34-38]

2. **RESOLVED — provenance for removed historical phase artifacts.** Use current owning summaries/verifications when present. When extraction cleanup removed an active phase artifact, immutable `git show COMMIT:path` evidence from the introducing or owning commit, together with current source and tests, is authoritative provenance for the changeset row. Any row lacking recoverable evidence remains UNRESOLVED and blocks the release rather than being inferred or approved by wording alone. [VERIFIED: `.planning/phases/` directory read and live Git history]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Changesets/audit scripts/tests | ✓ | 26.4.0 | — |
| pnpm | frozen install/workspace commands | ✓ | 11.10.0 | — |
| Git | squash construction/ref proofs | ✓ | 2.34.1 | — |
| Changesets CLI | release graph oracle | ✓ | 2.31.1 | — |
| `sha256sum`, `sort`, `diff`, `xargs` | clean-checkout baseline | ✓ | system tools | — |
| `rg` | prior Phase 25.5 absence commands | ✗ | — | `git grep` for tracked files plus Node filesystem scan for ignored/hidden paths |

**Missing dependencies with no fallback:** none.  
**Missing dependencies with fallback:** shell `rg`; do not add a package solely for this phase. [VERIFIED: live command availability probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Changesets CLI 2.31.1 + Vitest 4.1.x + Turbo 2.9.x + Git plumbing assertions |
| Config file | `.changeset/config.json`, `vitest.config.ts`, `turbo.json` |
| Quick run command | `pnpm exec changeset status --verbose --since=master --output=/tmp/phase26-status.json` plus the sentence/audit checker |
| Full suite command | `pnpm test && pnpm build && pnpm --filter applesauce-docs build && pnpm --filter applesauce-examples build` after frozen install |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | exactly the thirteen linked publishable packages resolve to `7.0.0`; ignored apps do not | integration/static | status JSON assertion against names from `.changeset/config.json` | ❌ Wave 0 checker/audit artifact |
| REL-03 | both held IDs are present and current source/tests implement their prose | static + focused regression | status JSON ID assertion; `pnpm --filter applesauce-relay test`; `pnpm --filter applesauce-loaders test` | ✅ package tests; ❌ matrix assertion |
| REL-04 | every final pending note is one line, one `Intl.Segmenter` sentence, and one semantic change | static + human review | 73-file parser plus completed matrix with no unresolved rows | ❌ Wave 0 checker/audit artifact |
| D-08 gate | frozen install, complete builds/tests, cleanup, unchanged lock/status | integration | Phase 25.5 command sequence and exact pre/post assertions | ✅ established command architecture |
| D-14/D-16 | candidate has source tree, sole base parent, one post-base commit, and no reachable post-base Concord code | Git integration | OID, `rev-list`, `diff`, path/content, and expected-old ref assertions | ❌ Wave 0 evidence script/commands |

### Sampling Rate

- **Per changeset-audit task commit:** sentence parser + unfiltered status + `--since=master` status JSON.
- **Per package/release-graph task:** focused relay/loaders tests and builds, then status JSON checklist.
- **Before source pin:** frozen install, full workspace test/build, docs build, examples build, cleanup, exact baseline/lock comparison.
- **Before moving `master`:** candidate parent/tree/history checks and snapshots of `next` plus every remote ref.
- **Phase gate:** resulting `master` equals recorded candidate; candidate tree equals pinned source tree; `next` and remote-ref snapshots are unchanged.

### Wave 0 Gaps

- [ ] Create the committed 73-row/13-row audit artifact selected under D-04.
- [ ] Add a dependency-free Node checker (inline in the plan or tracked under the Phase 26 directory) that parses all release notes, rejects multiline or multi-sentence bodies, and validates the final status JSON package set/version.
- [ ] Encode the history proof commands with fail-closed exit handling; do not rely on visual `git log` inspection.
- [x] Closeout/pinning order resolved: detach closeout bookkeeping from pinned SOURCE, permit only `.planning/**` diffs, and never move `next` after pinning.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No service authentication or publication occurs [VERIFIED: 26-CONTEXT.md:23-25] |
| V3 Session Management | no | No application session exists |
| V4 Access Control | yes | Restrict mutation to `refs/heads/master`; preserve `next` and all remote refs |
| V5 Input Validation | yes | Parse Changesets JSON/YAML and validate exact package names, versions, OIDs, parents, paths, and command statuses |
| V6 Cryptography | no | SHA-256 is used for equality evidence, not a new security protocol; use system `sha256sum` |

### Known Threat Patterns for release coordination

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unexpected ref moved between validation and update | Tampering | `git update-ref` with expected old OID |
| Branch name moves after validation | Spoofing/Tampering | Pin immutable source commit and tree OIDs |
| Partial or unauditable release evidence | Repudiation | Committed matrix plus exact command/status/OID records |
| Cleanup removes unrelated ignored files | Tampering/DoS | root containment, explicit families, `git check-ignore`, no symlink following |
| Wrong reachability universe (`--all`) | Denial of service/false failure | Scope absence proof to resulting local `master` and separately prove preserved refs unchanged |
| Malformed changeset/frontmatter changes release set | Tampering | CLI JSON parse plus exact expected set and no unresolved matrix rows |

## Sources

### Primary (HIGH confidence)

- `.changeset/config.json`, `.changeset/changelog.mjs`, all 73 `.changeset/*.md` release files — live release configuration and note inventory.
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `vitest.config.ts`, all thirteen `packages/*/package.json` files, and application manifests — commands, versions, scripts, and dependency graph.
- `/tmp/phase26-status.json` and `/tmp/phase26-all-status.json` — generated in this session by installed Changesets 2.31.1.
- Phase 18/20/21/22/24/25/25.5 summaries and Phase 25.5 verification — semantic and release-gate provenance.
- `packages/relay/src/types.ts`, `packages/relay/src/relay.ts`, `packages/loaders/src/loaders/sync-loader.ts`, and sync-loader tests — held-note behavior proof.
- Live Git ref, ancestry, path-history, OID, and command-availability probes on 2026-09-14.

### Secondary (MEDIUM confidence)

- [Changesets linked packages](https://changesets.dev/guide/linked-packages) — linked versus fixed mechanics.
- [Changesets CLI](https://changesets.dev/guide/cli) — `status`, `--since`, `--output`, and version/publish behavior.
- [Git commit-tree](https://git-scm.com/docs/git-commit-tree) — existing-tree and explicit-parent commit construction.
- [Git update-ref](https://git-scm.com/docs/git-update-ref) — expected-old compare-and-swap update.
- [Git rev-list](https://git-scm.com/docs/git-rev-list) and [git diff-tree](https://git-scm.com/docs/git-diff-tree) — ancestry and tree comparison.

### Tertiary (LOW confidence)

- None used as authority.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read from current manifests and executable version probes.
- Release graph: HIGH — generated by the installed CLI against the current repository.
- Changeset semantic audit: MEDIUM — all files were opened and mechanical issues identified, but D-02 requires a row-by-row execution review against many historical phase artifacts.
- Git reconstruction: HIGH for current topology/OIDs; execution ordering is resolved by detached planning-only closeout commits that preserve pinned SOURCE and local `next`.
- Pitfalls: HIGH — derived from observed status/ref behavior and locked phase constraints.

**Research date:** 2026-09-14  
**Valid until:** 2026-09-21, or immediately invalidated by any change to `.changeset/`, package manifests, `next`, or `master`.
