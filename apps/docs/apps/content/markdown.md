---
description: Remark transformers for parsing Nostr markdown content with unified.js, react-markdown, and MDX
---

# Markdown

The `applesauce-content` package exports remark transformers for the [unified.js](https://unifiedjs.com/) ecosystem. These transformers work with [remark](https://www.npmjs.com/package/remark) markdown parsers and can be used with any unified-compatible tools like `react-markdown`, `@mdx-js/mdx`, and more.

Markdown rendering is particularly useful for long-form content like articles (kind 30023), where you want to preserve rich formatting while still supporting Nostr-specific features like mentions.

See the [remark docs](https://remark.js.org/) and [unified docs](https://unifiedjs.com/learn/) to learn how to add additional transformers.

## Installation

```bash
npm install applesauce-content react-markdown remark-gfm
```

**Recommended plugins:**

- `react-markdown` - React renderer for markdown
- `remark-gfm` - GitHub Flavored Markdown support (tables, strikethrough, etc.)
- `applesauce-content/markdown` - Nostr mentions support

## Basic Usage

Import the transformer and add it to your remark plugin pipeline:

```tsx
import { remarkNostrMentions } from "applesauce-content/markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";

function Article({ content }) {
  // Memoize plugins array to prevent recreation
  const plugins = useMemo(() => [remarkGfm, remarkNostrMentions], []);

  return <ReactMarkdown remarkPlugins={plugins}>{content}</ReactMarkdown>;
}
```

## Nostr Mentions Transformer

The [`remarkNostrMentions`](https://applesauce.build/typedoc/functions/applesauce-content.Markdown.remarkNostrMentions.html) plugin automatically linkifies [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) `nostr:` URIs and [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) identifiers in markdown content.

### Supported Identifiers

The transformer automatically detects and converts these NIP-19 identifier types:

- **npub** - User public keys (e.g., `npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6`)
- **note** - Event IDs (e.g., `note1abc123...`)
- **nprofile** - User profiles with relay hints
- **nevent** - Events with relay hints
- **naddr** - Addressable events with relay hints

### Prefix Support

Both `nostr:npub1...` and `npub1...` formats are supported and converted to `nostr:` links.

### How It Works

Scans markdown AST for NIP-19 identifiers, validates them, and converts to `nostr:` links. Invalid identifiers are preserved as plain text.

## Using with Unified.js

The `remarkNostrMentions` transformer works with any unified.js pipeline:

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const processor = unified()
  .use(remarkParse) // Parse markdown
  .use(remarkGfm) // GitHub Flavored Markdown
  .use(remarkNostrMentions) // Nostr mentions
  .use(remarkRehype) // Convert to HTML
  .use(rehypeStringify); // Stringify HTML

const html = await processor.process(markdownContent);
```

## Using with MDX

The transformer works with MDX for interactive documentation:

```tsx
import { compile } from "@mdx-js/mdx";
import { remarkNostrMentions } from "applesauce-content/markdown";
import remarkGfm from "remark-gfm";

const compiled = await compile(mdxContent, {
  remarkPlugins: [remarkGfm, remarkNostrMentions],
});
```

## Optional Transformers

### Cashu tokens (opt-in)

Cashu token parsing is exposed under a separate subpath so the default markdown bundle stays free of `@cashu/cashu-ts` (an optional peer dependency). Install `@cashu/cashu-ts` alongside `applesauce-content` and add the plugin to your `remarkPlugins`:

```tsx
import { remarkCashuTokens } from "applesauce-content/markdown/cashu";

const plugins = [remarkGfm, remarkNostrMentions, remarkCashuTokens];
```

The transformer produces a standard `link` node whose `data` field carries the decoded token:

```typescript
interface CashuMdastLink {
  type: "link";
  url: string; // `cashu:<raw>`
  data: { token: Token; raw: string };
}
```

Detect cashu links in your `link` component by checking `node.data.token`:

```tsx
<ReactMarkdown
  remarkPlugins={plugins}
  components={{
    a: ({ node, children, ...props }) => {
      if (node?.data && "token" in node.data) {
        return <CashuTokenView token={node.data.token} />;
      }
      return <a {...props}>{children}</a>;
    },
  }}
>
  {content}
</ReactMarkdown>
```

## Advanced Usage

### Extract Nostr Links from Markdown

```ts
import { visit } from "unist-util-visit";

const processor = unified()
  .use(remarkParse)
  .use(remarkNostrMentions)
  .use(() => (tree) => {
    const nostrLinks = [];
    visit(tree, "link", (node) => {
      if (node.url.startsWith("nostr:")) nostrLinks.push(node.url.slice(6));
    });
    return nostrLinks;
  });
```

### Custom Mention Format

```ts
import { findAndReplace } from "mdast-util-find-and-replace";

function customNostrMentions() {
  return (tree) => {
    findAndReplace(tree, [
      /\bnostr:(\w+1\w+)\b/g,
      (match, id) => ({
        type: "link",
        url: `nostr:${id}`,
        children: [{ type: "text", value: match }],
      }),
    ]);
  };
}
```

## Using with MDX

The transformer works with MDX for interactive documentation:

```tsx
import { compile } from "@mdx-js/mdx";
import { remarkNostrMentions } from "applesauce-content/markdown";
import remarkGfm from "remark-gfm";

const compiled = await compile(mdxContent, {
  remarkPlugins: [remarkGfm, remarkNostrMentions],
});
```

## Custom Nostr Link Rendering

Customize how nostr links are rendered to integrate with your app:

```tsx
import { decodePointer } from "applesauce-core/helpers";

<ReactMarkdown
  remarkPlugins={[remarkNostrMentions]}
  components={{
    a: ({ href, children, ...props }) => {
      // Handle nostr: links
      if (href?.startsWith("nostr:")) {
        const identifier = href.slice(6); // Remove "nostr:" prefix

        try {
          const decoded = decodePointer(identifier);

          if (decoded.type === "npub" || decoded.type === "nprofile") {
            return (
              <UserMention pubkey={decoded.data.pubkey} {...props}>
                {children}
              </UserMention>
            );
          }

          if (decoded.type === "note" || decoded.type === "nevent") {
            return (
              <EventMention eventId={decoded.data.id} {...props}>
                {children}
              </EventMention>
            );
          }
        } catch (err) {
          // Invalid nostr link, render as plain link
        }
      }

      // Regular links
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
  }}
>
  {content}
</ReactMarkdown>;
```

## Best Practices

### Security: Sanitize External Links

Always use `target="_blank"` and `rel="noopener noreferrer"` for external links:

```tsx
components={{
  a: ({ href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
}}
```

### Memoize Components

Prevent recreating component renderers:

```tsx
const markdownComponents = useMemo(
  () => ({
    h1: ({ node, ...props }) => <h1 className="text-3xl font-bold" {...props} />,
    p: ({ node, ...props }) => <p className="my-2" {...props} />,
    // ... other components
  }),
  [],
);

<ReactMarkdown remarkPlugins={[remarkGfm, remarkNostrMentions]} components={markdownComponents}>
  {content}
</ReactMarkdown>;
```
