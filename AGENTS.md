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
