# React Content Rendering

This guide covers rendering Nostr content in React using `useRenderedContent` for text content and `ReactMarkdown` for markdown articles.

## useRenderedContent Hook

The [`useRenderedContent`](https://applesauce.build/typedoc/functions/applesauce-react.useRenderedContent.html) hook renders NAST content in React components.

### Basic Usage

```tsx
import { useRenderedContent } from "applesauce-react/hooks";

function NoteContent({ event }) {
  const components = {
    text: ({ node }) => <span>{node.value}</span>,
    link: ({ node }) => (
      <a href={node.href} target="_blank">
        {node.value}
      </a>
    ),
  };

  const content = useRenderedContent(event, components);
  return <div className="whitespace-pre-wrap">{content}</div>;
}
```

### ComponentMap

Define how each NAST node type renders. All components are optional:

```tsx
import { isImageURL, isVideoURL } from "applesauce-core/helpers";

const components = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => {
    if (isImageURL(node.href)) return <img src={node.href} loading="lazy" />;
    if (isVideoURL(node.href)) return <video src={node.href} controls />;
    return (
      <a href={node.href} target="_blank" rel="noopener noreferrer">
        {node.value}
      </a>
    );
  },
  mention: ({ node }) => <a href={`https://njump.me/${node.encoded}`}>@{node.encoded.slice(0, 8)}...</a>,
  hashtag: ({ node }) => <span className="text-orange-500">#{node.hashtag}</span>,
  emoji: ({ node }) => <img src={node.url} alt={node.code} className="inline w-6 h-6" />,
  gallery: ({ node }) => (
    <div className="flex gap-2">
      {node.links.map((link, i) => (
        <img key={i} src={link} className="max-h-64" />
      ))}
    </div>
  ),
};
```

### Options

```tsx
// Truncate content
const content = useRenderedContent(event, components, { maxLength: 280 });

// Custom transformers
const content = useRenderedContent(event, components, {
  transformers: [links, nostrMentions, hashtags],
});

// Custom cache key
const content = useRenderedContent(event, components, { cacheKey: Symbol("custom") });

// Disable caching
const content = useRenderedContent(event, components, { cacheKey: null });

// Override content
const content = useRenderedContent(event, components, { content: customContent });
```

### Link Renderers

```tsx
import { LinkRenderer } from "applesauce-react/helpers";

const imageRenderer: LinkRenderer = (url) => (isImageURL(url) ? <img src={url.toString()} /> : null);

const content = useRenderedContent(event, components, {
  linkRenderers: [imageRenderer],
});
```

## ReactMarkdown Integration

For markdown content (kind 30023 articles):

```tsx
import ReactMarkdown from "react-markdown";
import { remarkNostrMentions } from "applesauce-content/markdown";
import remarkGfm from "remark-gfm";

function ArticleContent({ content }) {
  const plugins = useMemo(() => [remarkGfm, remarkNostrMentions], []);
  return <ReactMarkdown remarkPlugins={plugins}>{content}</ReactMarkdown>;
}
```

### Styling Markdown

Define components at module level for static styling:

```tsx
const plugins = [remarkGfm, remarkNostrMentions];
const components = {
  h1: (props) => <h1 className="text-3xl font-bold" {...props} />,
  h2: (props) => <h2 className="text-2xl font-bold" {...props} />,
  a: (props) => <a className="link" target="_blank" rel="noopener noreferrer" {...props} />,
  table: (props) => (
    <div className="overflow-x-auto">
      <table className="table" {...props} />
    </div>
  ),
};

function Article({ content }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components}>
      {content}
    </ReactMarkdown>
  );
}
```

### Custom Nostr Link Rendering

```tsx
function UserMention({ pubkey }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);
  return <span>@{profile?.displayName || "..."}</span>;
}

const components = {
  a: ({ href, children, ...props }) => {
    if (href?.startsWith("nostr:")) {
      const decoded = decodePointer(href.slice(6));
      if (decoded.type === "npub") return <UserMention pubkey={decoded.data.pubkey} />;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};
```

## Integration

### With Cast Events

```tsx
function NoteCard({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);
  const content = useRenderedContent(note.event, components);

  return (
    <div>
      <img src={profile?.picture} />
      <span>{profile?.displayName}</span>
      {content}
    </div>
  );
}
```

### With Event Loaders

```tsx
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

// Mentions now auto-load their targets
const components = {
  mention: ({ node }) => {
    const profile = use$(() => eventStore.profile(node.decoded.data.pubkey), [node.decoded.data.pubkey]);
    return <span>@{profile?.displayName || "..."}</span>;
  },
};
```

### Interactive Components

```tsx
function NoteContent({ event, onHashtagClick }) {
  const components = useMemo(
    () => ({
      hashtag: ({ node }) => <button onClick={() => onHashtagClick(node.hashtag)}>#{node.hashtag}</button>,
    }),
    [onHashtagClick],
  );

  return <div>{useRenderedContent(event, components)}</div>;
}
```

## Best Practices

### Memoize Components

```tsx
// Static: define at module level
const components = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => <a href={node.href}>{node.value}</a>,
};

// Dynamic: use useMemo
const components = useMemo(() => ({ ... }), [dependencies]);
```

### Security

```tsx
// Always use target="_blank" with rel="noopener noreferrer"
link: ({ node }) => <a href={node.href} target="_blank" rel="noopener noreferrer">{node.value}</a>,
```

### Media Handling

```tsx
link: ({ node }) => {
  if (isImageURL(node.href)) {
    return <img src={node.href} loading="lazy" onError={(e) => (e.currentTarget.src = "/placeholder.png")} />;
  }
  return <a href={node.href}>{node.value}</a>;
},
```

### Truncation

```tsx
const content = useRenderedContent(event, components, { maxLength: 280 });
if (getParsedContent(event).truncated) {
  // Show "read more"
}
```

### Content Validation

```tsx
function NoteContent({ event }) {
  if (!event?.content) return <div>No content</div>;
  return <div>{useRenderedContent(event, components)}</div>;
}
```

### Choose Renderer by Kind

```tsx
function EventContent({ event }) {
  if (event.kind === 30023) return <ReactMarkdown remarkPlugins={plugins}>{event.content}</ReactMarkdown>;
  if (event.kind === 1) return <div>{useRenderedContent(event, components)}</div>;
  return <p className="whitespace-pre-wrap">{event.content}</p>;
}
```
