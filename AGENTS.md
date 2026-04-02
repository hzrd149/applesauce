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

# Building examples

Never add drop shadows and avoid using cards, the UI looks better when its simple, clean and uses borders.

# Using DaisyUI

THERE IS NO `.form-control` class.

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
