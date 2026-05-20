---
description: Parse and transform Nostr event text content into syntax trees with support for hashtags, mentions, emojis, and galleries
---

# Text Content

Text content rendering in applesauce uses a NAST (Nostr Abstract Syntax Tree) architecture, similar to how Markdown parsers work with AST. Event content is parsed into a tree structure, transformed through a pipeline, and then rendered using React components. This approach provides flexibility, extensibility, and type safety for rendering Nostr content.

## Architecture Overview

The content rendering flow:

```
Event Content → Parser → NAST Tree → Transformers → React Components → UI
```

**Key Benefits:**

- Separation of parsing from rendering
- Composable transformers for different content features
- Type-safe node structures
- Caching for performance
- Extensible for custom content types

## Parsing content

The [`getParsedContent`](https://applesauce.build/typedoc/functions/applesauce-content.Text.getParsedContent.html) method parses event content into a NAST tree:

```ts
import { getParsedContent } from "applesauce-content/text";

const root = getParsedContent(event);
// root is a NAST tree with children nodes
```

**Default Transformers:**

The default transformer pipeline (in order) includes:

1. `blossomURIs` - Detect BUD-10 `blossom://` URIs
2. `links` - Detect URLs and create link nodes
3. `nostrMentions` - Parse NIP-19 mentions (npub, nevent, etc.)
4. `galleries` - Group consecutive images into galleries
5. `emojis` - Replace `:emoji_code:` with NIP-30 custom emoji tags
6. `hashtags` - Identify `#hashtags`
7. `eolMetadata` - Attach end-of-line metadata for rendering

See [Optional Transformers](#optional-transformers) below for opt-in transformers like `lightning` and `cashu`.

**Custom Transformers:**

```ts
import { links, nostrMentions, hashtags } from "applesauce-content/text";

const root = getParsedContent(event, undefined, [links, nostrMentions, hashtags]);
```

## Caching

Because parsing and transforming content is an expensive operation `getParsedContent` method will cache the results on the event under a [Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol), by default this is the [`TextNoteContentSymbol`](https://applesauce.build/typedoc/variables/applesauce-content.Text.TextNoteContentSymbol.html)

If your parsing or transforming different event kinds than kind 1, its recommended to create a new `Symbol` to and pass to `getParsedContent` to avoid cache collisions with the default kind 1 processor

```ts
const ArticleContentSymbol = Symbol("article-content");

const content = useRenderedContent(event, components, {
  cacheKey: ArticleContentSymbol,
});
```

**Disable Caching:**

```ts
import { getParsedContent } from "applesauce-content/text";

const content = getParsedContent(event, undefined, undefined, null);
```

## Transformers

### Links

The [`links`](https://applesauce.build/typedoc/functions/applesauce-content.Text.links.html) transformer detects URLs and creates [`Link`](https://applesauce.build/typedoc/interfaces/applesauce-content.Nast.Link.html) nodes.

**Detected patterns:** `https://example.com`, `http://example.com`, `example.com`

**Link node structure:**

```typescript
interface Link {
  type: "link";
  href: string; // Full URL
  value: string; // Original text
}
```

### Mentions

The [`nostrMentions`](https://applesauce.build/typedoc/functions/applesauce-content.Text.nostrMentions.html) transformer detects NIP-19 and NIP-21 mentions and creates [`Mention`](https://applesauce.build/typedoc/interfaces/applesauce-content.Nast.Mention.html) nodes.

**Detected patterns:** `nostr:npub1...`, `npub1...`, `nevent1...`, `naddr1...` (all NIP-19 types)

**Mention node structure:**

```typescript
interface Mention {
  type: "mention";
  encoded: string; // NIP-19 string (npub1..., note1...)
  decoded: DecodeResult; // Decoded pointer object
}
```

### Hashtags

The [`hashtags`](https://applesauce.build/typedoc/functions/applesauce-content.Text.hashtags.html) transformer identifies hashtags and creates [`Hashtag`](https://applesauce.build/typedoc/interfaces/applesauce-content.Nast.Hashtag.html) nodes.

**Important:** Only hashtags with corresponding `t` tags in the event are parsed.

```ts
const event = {
  content: "Check out #nostr and #bitcoin!",
  tags: [
    ["t", "nostr"],
    ["t", "bitcoin"],
  ],
};
// Both #nostr and #bitcoin will be parsed
```

**Hashtag node structure:**

```typescript
interface Hashtag {
  type: "hashtag";
  hashtag: string; // Normalized lowercase
  name: string; // Original case
  tag?: string[]; // The t-tag from event
}
```

### Emojis

The [`emojis`](https://applesauce.build/typedoc/functions/applesauce-content.Text.emojis.html) transformer replaces `:emoji_code:` patterns with custom emoji from the event's emoji tags ([NIP-30](https://github.com/nostr-protocol/nips/blob/master/30.md)).

```ts
const event = {
  content: "Hello :rocket: world!",
  tags: [["emoji", "rocket", "https://example.com/rocket.png"]],
};
// :rocket: is replaced with the emoji image
```

**Emoji node structure:**

```typescript
interface Emoji {
  type: "emoji";
  code: string; // emoji_code
  url: string; // Image URL from tag
  raw: string; // :emoji_code:
  tag: string[]; // The emoji tag
}
```

### Galleries

The [`galleries`](https://applesauce.build/typedoc/functions/applesauce-content.Text.galleries.html) transformer groups consecutive image URLs into [`Gallery`](https://applesauce.build/typedoc/interfaces/applesauce-content.Nast.Gallery.html) nodes.

**Grouping rules:**

- Only consecutive images are grouped
- Minimum 2 images to create a gallery
- Text (except newlines) breaks the group

```ts
const event = {
  content: "https://example.com/1.jpg\nhttps://example.com/2.png",
};
// Creates one gallery with 2 images
```

**Gallery node structure:**

```typescript
interface Gallery {
  type: "gallery";
  links: string[]; // Array of image URLs
}
```

**Customizing image types:**

```ts
import { galleries } from "applesauce-content/text";

const customGalleries = galleries([".jpg", ".png", ".svg"]);
```

**Gallery node structure:**

```typescript
interface Gallery {
  type: "gallery";
  links: string[]; // Array of image URLs
}
```

**Customizing image types:**

```ts
import { galleries } from "applesauce-content/text";

const customGalleries = galleries([".jpg", ".png", ".webp", ".svg"]);

const content = useRenderedContent(event, components, {
  transformers: [links, customGalleries, nostrMentions],
});
```

## Optional Transformers

Some transformers pull in extra dependencies and are kept out of the default pipeline to keep the bundle lean. Importing the module by its subpath registers the transformer in the default pipeline as a side effect — there's no need to pass it to `getParsedContent` manually.

```ts
// Adds bolt11 lightning invoice parsing
import "applesauce-content/text/lightning";

// Adds cashu token parsing
import "applesauce-content/text/cashu";

import { getParsedContent } from "applesauce-content/text";

// `getParsedContent` now produces `lightning` and `cashu` nodes
const root = getParsedContent(event);
```

### Lightning invoices

The [`lightningInvoices`](https://applesauce.build/typedoc/functions/applesauce-content.Text.lightningInvoices.html) transformer detects bolt11 LNBC payment requests. The `light-bolt11-decoder` dependency ships with `applesauce-common`; the transformer itself is only registered when its module is imported.

```ts
import "applesauce-content/text/lightning";
```

```typescript
interface LightningInvoice {
  type: "lightning";
  invoice: string; // Full LNBC string
}
```

### Cashu tokens

The [`cashuTokens`](https://applesauce.build/typedoc/functions/applesauce-content.Text.cashuTokens.html) transformer detects Cashu ecash tokens. `@cashu/cashu-ts` is declared as an optional peer dependency — install it alongside the import to enable parsing.

```ts
import "applesauce-content/text/cashu";
```

```typescript
interface CashuToken {
  type: "cashu";
  raw: string; // Full token string (cashuA...)
}
```

## Extending the Parser

The parser is a [unified](https://unifiedjs.com) pipeline of transformers. Each transformer walks the NAST tree, finds `text` nodes that match a pattern, and replaces them with a richer node type. You can add your own transformer to detect new tokens, swap out a built-in one, or modify nodes after they've been created.

### Adding a New Token

Three steps: declare the node type, write the transformer, render it.

**1. Declare the node type** and augment the `ContentMap` so TypeScript knows about it:

```ts
import { Node } from "applesauce-content/nast";

export interface BitcoinAddress extends Node {
  type: "bitcoin";
  address: string;
}

declare module "applesauce-content/nast" {
  interface ContentMap {
    bitcoin: BitcoinAddress;
  }
}
```

**2. Write the transformer** using `findAndReplace` to swap matching `text` nodes for your new node:

```ts
import { findAndReplace } from "applesauce-content/nast";
import { Transformer } from "unified";

const BITCOIN = /\b(bc1[a-z0-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;

export function bitcoinAddresses(): Transformer<Root> {
  return (tree) => {
    findAndReplace(tree, [[BITCOIN, (match: string) => ({ type: "bitcoin", address: match })]]);
  };
}
```

Return `false` from the replace function to skip a match (e.g. validation failed) and leave the original text in place — see `hashtags` for an example.

**3. Wire it into the pipeline** either by passing it to `getParsedContent` or by appending to `textNoteTransformers` so it runs by default:

```ts
import { textNoteTransformers } from "applesauce-content/text";

if (!textNoteTransformers.includes(bitcoinAddresses)) {
  textNoteTransformers.push(bitcoinAddresses);
}
```

Side-effect registration is how the optional `lightning` and `cashu` modules opt themselves in — consumers enable parsing by importing `your-package/bitcoin`.

**4. Render it** by adding a component for the new node `type`:

```tsx
const components: ComponentMap = {
  bitcoin: ({ node }) => <code className="text-orange-500">{node.address}</code>,
};

const content = useRenderedContent(event, components);
```

### Modifying Existing Nodes

A transformer doesn't have to use `findAndReplace` — it can walk the tree and mutate nodes that earlier transformers produced. Useful for enriching link nodes, attaching metadata, or normalizing values:

```ts
import { visit } from "unist-util-visit";

function annotateLinks(): Transformer<Root> {
  return (tree) => {
    visit(tree, "link", (node) => {
      node.href = node.href.replace(/^http:/, "https:");
    });
  };
}
```

Order matters: list this after `links` in your transformer array so the link nodes exist by the time it runs.

### Replacing a Built-in Transformer

Pass your own array to `getParsedContent` (or `useRenderedContent`) to fully control which transformers run and in what order:

```ts
import { links, nostrMentions, hashtags } from "applesauce-content/text";

const content = useRenderedContent(event, components, {
  transformers: [links, customGalleries, nostrMentions, hashtags],
});
```

Use a custom `cacheKey` (or `null` to disable caching) when overriding transformers — otherwise results may collide with the default kind-1 cache. See [Caching](#caching) above.

## Media Detection

The `applesauce-core/helpers` package provides utilities for detecting media types:

```ts
import { isImageURL, isVideoURL, isAudioURL } from "applesauce-core/helpers";

if (isImageURL(url)) // Images: .svg, .gif, .png, .jpg, .jpeg, .webp, .avif
if (isVideoURL(url)) // Videos: .mp4, .mkv, .webm, .mov
if (isAudioURL(url)) // Audio: .mp3, .wav, .ogg, .aac, .m4a
```

## NAST Node Types

The parser creates different node types based on content:

```typescript
interface Text {
  type: "text";
  value: string;
}
interface Link {
  type: "link";
  href: string;
  value: string;
}
interface Mention {
  type: "mention";
  encoded: string;
  decoded: DecodeResult;
}
interface Hashtag {
  type: "hashtag";
  hashtag: string;
  name: string;
  tag?: ["t", ...string[]];
}
interface Emoji {
  type: "emoji";
  code: string;
  url: string;
  raw: string;
  tag: ["emoji", ...string[]];
}
interface Gallery {
  type: "gallery";
  links: string[];
}
interface BlossomURI {
  type: "blossom";
  raw: string;
  sha256: string;
  ext: string;
  size?: number;
  servers: string[];
  authors: string[];
}
interface LightningInvoice {
  type: "lightning";
  invoice: string;
  parsed: ParsedInvoice;
}
interface CashuToken {
  type: "cashu";
  raw: string;
  token: Token;
}
```

## Using Parsed Content

### Direct Tree Manipulation

```ts
const root = getParsedContent(event);

// Extract specific node types
const links = root.children.filter((node) => node.type === "link");
const mentions = root.children.filter((node) => node.type === "mention");
const hashtags = root.children.filter((node) => node.type === "hashtag").map((node) => node.hashtag);

// Get plain text only
const text = root.children
  .filter((node) => node.type === "text")
  .map((node) => node.value)
  .join("");
```

### Extract Specific Content

```ts
// Get all hashtags
const root = getParsedContent(event);
const hashtags = root.children.filter((node) => node.type === "hashtag").map((node) => node.hashtag);

// Get all URLs
const urls = root.children.filter((node) => node.type === "link").map((node) => node.href);

// Get plain text only
const plainText = root.children
  .filter((node) => node.type === "text")
  .map((node) => node.value)
  .join("");
```

### Check for Truncation

```ts
const root = getParsedContent(event, undefined, undefined, undefined);

if (root.truncated) {
  console.log("Content was truncated");
  console.log("Original length:", root.originalLength);
}
```

### Custom Content Override

Render custom content instead of `event.content`:

```tsx
const content = useRenderedContent(event, components, {
  content: customContent, // Override event.content
});
```

### Link Renderers

Use `buildLinkRenderer` for modular link handling:

```tsx
import { buildLinkRenderer } from "applesauce-react/helpers";
import type { LinkRenderer } from "applesauce-react/helpers";

const imageRenderer: LinkRenderer = (url) => {
  if (isImageURL(url)) {
    return <img src={url.toString()} className="max-h-64" />;
  }
  return null; // Let next renderer handle it
};

const videoRenderer: LinkRenderer = (url) => {
  if (isVideoURL(url)) {
    return <video src={url.toString()} controls />;
  }
  return null;
};

const content = useRenderedContent(event, components, {
  linkRenderers: [imageRenderer, videoRenderer],
});
```

## Best Practices

### Memoize ComponentMap

Always memoize your ComponentMap to avoid recreating components:

```tsx
const components = useMemo<ComponentMap>(
  () => ({
    text: ({ node }) => <span>{node.value}</span>,
    link: LinkRenderer,
    mention: MentionRenderer,
  }),
  [], // Or include dependencies if components use external values
);

const content = useRenderedContent(event, components);
```

### Handle Media Loading

Implement proper loading states and error handling for media:

```tsx
link: ({ node }) => {
  if (isImageURL(node.href)) {
    return (
      <img
        src={node.href}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.src = "/placeholder.png";
        }}
        className="max-h-64 rounded"
      />
    );
  }
  return <a href={node.href}>{node.value}</a>;
},
```

### Security Best Practices

Always use proper link attributes:

```tsx
link: ({ node }) => (
  <a
    href={node.href}
    target="_blank"
    rel="noopener noreferrer"  // Prevent window.opener access
    className="link"
  >
    {node.value}
  </a>
),
```

### Content Length Limits

For preview cards or feed items, truncate content:

```tsx
const content = useRenderedContent(event, components, {
  maxLength: 280,
});

const root = getParsedContent(event);
if (root.truncated) {
  return (
    <>
      <div>{content}</div>
      <button onClick={onShowFull}>Read more</button>
    </>
  );
}
```
