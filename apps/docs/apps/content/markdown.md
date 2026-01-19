# Markdown

The `applesauce-content` package exports remark transformers for the [unified.js](https://unifiedjs.com/) ecosystem. These transformers work with [remark](https://www.npmjs.com/package/remark) markdown parsers and can be used with any unified-compatible tools like `react-markdown`, `@mdx-js/mdx`, and more.

See the [remark docs](https://remark.js.org/) and [unified docs](https://unifiedjs.com/learn/) to learn how to add additional transformers.

## Nostr Mentions

The [`remarkNostrMentions`](https://applesauce.build/typedoc/functions/applesauce-content.Markdown.remarkNostrMentions.html) is a remark transformer plugin that automatically linkifies [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) `nostr:` URIs and [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) identifiers in markdown content. As a unified.js plugin, it integrates seamlessly with the remark markdown processing pipeline.

## Installation

```bash
npm install applesauce-content react-markdown
```

## Basic Usage

Import the transformer and add it to your ReactMarkdown component:

```tsx
import { remarkNostrMentions } from "applesauce-content/markdown";
import ReactMarkdown from "react-markdown";

<ReactMarkdown remarkPlugins={[remarkNostrMentions]}>{markdownContent}</ReactMarkdown>;
```

## Supported Identifiers

The transformer automatically detects and converts these NIP-19 identifier types:

- **npub** - User public keys (e.g., `npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6`)
- **note** - Event IDs (e.g., `note1abc123...`)
- **nprofile** - User profiles with relay hints
- **nevent** - Events with relay hints
- **naddr** - Addressable events with relay hints

## Prefix Support

Both prefixed and unprefixed identifiers are supported:

```markdown
Check out nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6
Or just npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6
```

## How It Works

The transformer:

1. Scans markdown content for NIP-19 identifiers
2. Validates each identifier using `nostr-tools`
3. Converts valid identifiers to markdown links with `nostr:` URLs
4. Preserves invalid identifiers as plain text

## Custom Link Rendering

Customize how nostr links are rendered by providing custom components:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkNostrMentions]}
  components={{
    a: ({ href, children, ...props }) => {
      if (href?.startsWith("nostr:")) {
        return (
          <NostrLink href={href} {...props}>
            {children}
          </NostrLink>
        );
      }
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  }}
>
  {content}
</ReactMarkdown>
```
