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

The default transformer pipeline includes:

1. `links` - Detect URLs and create link nodes
2. `nostrMentions` - Parse NIP-19 mentions (npub, nevent, etc.)
3. `galleries` - Group consecutive images into galleries
4. `emojis` - Replace :emoji_code: with custom emoji tags
5. `hashtags` - Identify #hashtags
6. `lightningInvoices` - Detect LNBC invoices
7. `cashuTokens` - Find cashu tokens

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

### Lightning invoices

The [`lightningInvoices`](https://applesauce.build/typedoc/functions/applesauce-content.Text.lightningInvoices.html) transformer detects LNBC payment requests.

```typescript
interface LightningInvoice {
  type: "lightning";
  invoice: string; // Full LNBC string
}
```

### Cashu tokens

The [`cashuTokens`](https://applesauce.build/typedoc/functions/applesauce-content.Text.cashuTokens.html) transformer detects Cashu ecash tokens.

```typescript
interface CashuToken {
  type: "cashu";
  raw: string; // Full token string (cashuA...)
}
```

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
  tag?: string[];
}
interface Emoji {
  type: "emoji";
  code: string;
  url: string;
  raw: string;
  tag: string[];
}
interface Gallery {
  type: "gallery";
  links: string[];
}
interface LightningInvoice {
  type: "lightning";
  invoice: string;
}
interface CashuToken {
  type: "cashu";
  raw: string;
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

## Integration

### With EventStore

Content rendering integrates with EventStore for loading referenced events:

```tsx
import { use$ } from "applesauce-react/hooks";

function NoteWithReplies({ eventId }) {
  // Load the event
  const note = use$(() => eventStore.event(eventId).pipe(castEventStream(Note, eventStore)), [eventId]);

  // Render its content
  const content = useRenderedContent(note?.event, components);

  // Load and render replies
  const replies = use$(note?.replies$);

  return (
    <div>
      <div>{content}</div>
      {replies?.map((reply) => (
        <div key={reply.id}>{useRenderedContent(reply.event, components)}</div>
      ))}
    </div>
  );
}
```

### With Cast Events

Cast event classes provide convenient access to author profiles:

```tsx
import { Note } from "applesauce-common/casts";

function NoteCard({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);
  const content = useRenderedContent(note.event, components);

  return (
    <div>
      <div className="flex items-center gap-2">
        <img src={profile?.picture} className="w-10 h-10 rounded-full" />
        <span>{profile?.displayName || note.author.npub}</span>
      </div>
      <div>{content}</div>
    </div>
  );
}
```

### With Event Loaders

Set up event loaders to automatically fetch mentioned events:

```tsx
import { createEventLoaderForStore } from "applesauce-loaders/loaders";

// Setup loader for automatic loading
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

// Now mentions will auto-load their target events
const components: ComponentMap = {
  mention: ({ node }) => {
    if (node.decoded.type === "npub") {
      // Profile will load automatically
      const profile = use$(() => eventStore.profile(node.decoded.data.pubkey), [node.decoded.data.pubkey]);
      return <span>@{profile?.displayName || "loading..."}</span>;
    }
    return <span>@{node.encoded.slice(0, 8)}...</span>;
  },
};
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

### Preserve Whitespace

Use CSS to preserve line breaks:

```tsx
<div className="whitespace-pre-wrap overflow-hidden break-words">{content}</div>
```

### Interactive Components

Create interactive components with click handlers:

```tsx
function NoteContent({ event, onHashtagClick }) {
  const components = useMemo<ComponentMap>(
    () => ({
      text: ({ node }) => <span>{node.value}</span>,
      hashtag: ({ node }) => (
        <button onClick={() => onHashtagClick(node.hashtag)} className="text-orange-500 hover:underline cursor-pointer">
          #{node.hashtag}
        </button>
      ),
    }),
    [onHashtagClick],
  );

  return <div>{useRenderedContent(event, components)}</div>;
}
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

### Validate Event Structure

Check for required data before rendering:

```tsx
function NoteContent({ event }) {
  if (!event || !event.content) {
    return <div className="text-base-content/50">No content</div>;
  }

  const content = useRenderedContent(event, components);
  return <div>{content}</div>;
}
```
