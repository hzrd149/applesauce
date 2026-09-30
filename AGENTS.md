# Writing Documentation

## Organization Strategy

1. **Avoid standalone "Best Practices" files** - They create redundancy and restate information
2. **Add Integration sections** to existing docs showing how components connect with others
3. **Add Best Practices sections** at the end of relevant docs with focused, actionable tips
4. **Place docs in appropriate folders** - Best practices about actions go in apps/actions/, not a separate best-practices/ folder

## Documentation Structure

Each component documentation should follow this pattern:

1. **What it is** - Brief overview and purpose
2. **How to use it** - API reference and basic usage
3. **Integration** - How it connects with other applesauce components
4. **Best Practices** - Focused tips from real-world examples

## Code Block Guidelines

**Keep code blocks SHORT and FOCUSED (max ~20 lines):**

- ✅ Show only what's being explained
- ✅ Remove unnecessary imports, comments, boilerplate
- ✅ Use concise variable names
- ✅ Collapse multi-line statements when possible
- ❌ Don't show complete applications or full component implementations
- ❌ Don't repeat setup code in every example
- ❌ Don't include verbose error handling unless that's the point

**Examples:**

```tsx
// ❌ Too verbose
import { useRenderedContent } from "applesauce-react/hooks";
import type { ComponentMap } from "applesauce-react/hooks";

function NoteContent({ event }) {
  const components: ComponentMap = {
    text: ({ node }) => <span>{node.value}</span>,
    link: ({ node }) => (
      <a href={node.href} target="_blank" rel="noopener noreferrer">
        {node.value}
      </a>
    ),
  };

  const content = useRenderedContent(event, components);
  return <div className="whitespace-pre-wrap">{content}</div>;
}

// ✅ Focused and concise
const components = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => <a href={node.href}>{node.value}</a>,
};

const content = useRenderedContent(event, components);
```

## Content Organization

**Separate concerns by framework:**

- `text.md` - Framework-agnostic parsing (NAST trees, transformers)
- `markdown.md` - Framework-agnostic remark transformers
- `react.md` - React-specific rendering (hooks, components)

**Avoid duplication:**

- Don't repeat the same pattern multiple times
- Link to other docs instead of re-explaining
- Keep each doc focused on its topic

## Integration Sections

Show how the component connects with others:

- EventStore + EventLoaders
- AccountManager + EventFactory
- ActionRunner + RelayPool
- Components + React hooks

Keep examples minimal - just show the connection point:

```tsx
// ✅ Good - shows the integration clearly
const factory = new EventFactory({ signer: manager.signer });
manager.setActive(account); // Factory automatically uses new account

// ❌ Too much - shows unnecessary detail
import { EventFactory } from "applesauce-core";
import { AccountManager, registerCommonAccountTypes } from "applesauce-accounts";

const manager = new AccountManager();
registerCommonAccountTypes(manager);
const factory = new EventFactory({ signer: manager.signer });

manager.setActive(account1);
await factory.sign(draft); // Uses account1's signer

manager.setActive(account2);
await factory.sign(draft); // Uses account2's signer
```

## Best Practices Sections

**Focus on actionable, specific advice:**

- ✅ "Define components at module level for static styling"
- ✅ "Use useMemo with dependencies for dynamic components"
- ❌ "Always memoize your ComponentMap to avoid recreating components on every render" (too wordy)

**Use comparison examples:**

```tsx
// ✅ Good
const components = { ... };

// ❌ Bad
function Component() {
  const components = { ... }; // Recreated every render
}
```

## Summary Sections

**AVOID summary sections** - They just restate what was already said and make docs longer without adding value.

## Use Parallel Sub-Agents

For comprehensive documentation tasks:

1. Launch multiple explore agents in parallel to analyze different aspects
2. Each agent should focus on specific patterns (event loading, caching, accounts, etc.)
3. Synthesize findings into focused documentation
4. Avoid restating what agents found - distill into best practices

## Verification

Before completing documentation work:

1. Verify code examples compile/work
2. Check that examples in actual codebase are updated to match best practices
3. Ensure navigation is updated in VitePress config
4. Confirm no duplicate or orphaned files remain

# Writing Changesets

Each changeset file in `.changeset/` MUST describe exactly **one** change, and the body MUST be a **single sentence of markdown**. No bullet lists, no code blocks, no multiple paragraphs, no examples — just the sentence.

- ✅ `Make cashu token parsing optional`
- ❌ A body with bullets, code fences, or "this change does X and Y"

If a piece of work introduces multiple distinct changes, create one changeset file per change. Pick the smallest applicable bump (`patch` / `minor` / `major`) per package in the frontmatter.

# Releasing Packages Locally

Releases are prepared, verified, and published locally. GitHub Actions may test release commits, but must not version or publish packages.

## Before Every Release

1. Start from a clean worktree, fetch the target branch and tags, and use the repository's pinned pnpm version.
2. Confirm every included package change has one valid changeset.
3. Run `pnpm install --frozen-lockfile` and the tests and builds appropriate to the release scope.
4. Run `pnpm release-preview` from a clean worktree and inspect the generated versions, changelogs, lockfile, and consumed changesets. It does not commit, publish, or tag; confirm its cleanup prompt to restore the worktree before continuing.
5. Confirm npm authentication with `npm whoami` before changing package versions.

## Patch Releases

1. Create `patch/<package>-<version>-<description>` from the package's latest release tag.
2. Apply only the fix, its tests, and its patch changeset. Bring the current release configuration onto historical branches when needed.
3. Install from the frozen lockfile, then test and build the affected package. Add broader verification when the fix crosses package boundaries.
4. Run `pnpm version-packages`. It consumes the changeset, updates versions and changelogs, refreshes the lockfile, and creates one release commit.
5. Inspect the release commit and require a clean worktree. Verify the package version, changelog, consumed changeset, lockfile, and `git diff --check HEAD^ HEAD`.
6. Re-run the affected tests and builds from the versioned tree. From each released package, use `npm pack --dry-run` to inspect the publish payload when packaging changed.
7. Run `pnpm release`. It builds the workspace, publishes changed packages, and creates local `package@version` tags.
8. Verify each version with `npm view <package>@<version> version` and inspect its tag before running `git push origin <branch> --follow-tags`.
9. Merge the complete release branch into `master` without squashing so the fix, release commit, and tags remain connected.
10. Push `master`, verify the tags are ancestors of it, then delete the patch branch locally and remotely.

## Major Releases

1. Stage and verify the complete release on `next`; close and delete any stale generated Changesets release PR or branch.
2. Merge `next` into a clean local `master` without pushing, then run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm build`.
3. Run `pnpm release-preview` and verify all intended major, linked-package, and internal-dependency bumps, then confirm its cleanup prompt before versioning.
4. Run `pnpm version-packages`, inspect the generated release commit and every changed version, changelog, and lockfile, and require a clean worktree.
5. Re-run `pnpm test` and `pnpm build` against the versioned tree and inspect publish payloads for packages whose packaging changed.
6. Run `pnpm release`, verify every npm version and generated tag, then push `master` and tags with `git push origin master --follow-tags`.
7. Fast-forward `next` to the released `master`, push it, and remove obsolete release branches only after registry and tag verification succeeds.

## Release Safety

- Never publish with uncommitted changes or from an unverified release commit.
- Never recreate, move, delete, or force-push a published version tag.
- Preserve generated release commits; do not squash them when merging release branches.
- `pnpm release` builds all workspace packages and may publish more than one package. If publication partially fails, inspect npm and local tags before retrying.
- Keep ordinary build and test CI, but do not add workflows or secrets that publish packages from GitHub Actions.
- Remove obsolete release branches only after their commits are merged and their tags are reachable from `master`.

# Building examples

Never add drop shadows and avoid using cards, the UI looks better when its simple, clean and uses borders.

# Using DaisyUI

THERE IS NO `.form-control` class.

# Working On Agent Skills

When working in `apps/agent-skills/`, load and follow the `skill-creator` skill recommendations before making changes to skill definitions, generation logic, evaluations, or related documentation.

# Adding Support For A New NIP

Use this checklist whenever we introduce a new NIP-specific feature (e.g., NIP-58 badges) so helpers, casts, operations, and factories ship together and stay consistent.

1. **Helpers**
   - Create guarded helper modules under `packages/common/src/helpers/` that expose type guards (`isValidFooEvent`), pointer extractors, and lightweight parsing caches.
   - Export via `helpers/index.ts` so downstream packages get the new APIs and update helper snapshot tests.
   - Keep helpers framework-agnostic; any UI/state usage belongs elsewhere.

2. **Casts**
   - Mirror the helper functionality with casts under `packages/common/src/casts/` when the new NIP has an event-centric UX (e.g., `BadgeAward` casting recipients and badge pointer).
   - Ensure casts validate events using the helper guard before instantiating and expose observable relationships (e.g., `badge$`, `issuer`).

3. **Operations**
   - Implement tag-level `EventOperation`s inside `packages/common/src/operations/` that mutate drafts in a composable way (no direct mutation, always `modifyPublicTags`).
   - Export the module from `operations/index.ts` and cover it with Vitest suites exercising add/remove/update flows.

4. **Factories**
   - Add event factories in `packages/common/src/factories/` to wrap the operations behind fluent builders (`create()`/`modify()`).
   - Re-export each factory from `factories/index.ts` and add factory tests verifying both creation and modification scenarios.

5. **Tests & Snapshots**
   - Helpers: extend `helpers/__tests__/badges.test.ts`-style suites plus update `helpers/__tests__/exports.test.ts` snapshots.
   - Operations: add targeted unit tests mirroring the exported API, keeping cases short and focused.
   - Factories: ensure new builders round-trip the operations and update export snapshots if necessary.

6. **Verification**
   - Run `pnpm --filter applesauce-common test` after wiring helpers, casts, operations, and factories to keep snapshot coverage in sync.
   - Address any renamed helper paths (e.g., `badge.ts` replacing `badges.ts`) across the repo before final run.
