import "applesauce-content/text/cashu";
import "applesauce-content/text/lightning";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers";
import { type ComponentMap, useRenderedContent } from "applesauce-react/hooks";

const contentCache = Symbol("example-note-content");

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a className="link" href={node.href} target="_blank" rel="noopener noreferrer">
      {node.value}
    </a>
  ),
  mention: ({ node }) => (
    <a className="link" href={`https://njump.me/${node.encoded}`} target="_blank" rel="noopener noreferrer">
      nostr:{node.encoded}
    </a>
  ),
  hashtag: ({ node }) => <span>#{node.name}</span>,
  emoji: ({ node }) => (
    <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" loading="lazy" />
  ),
  gallery: ({ node }) => (
    <>
      {node.links.map((url) => (
        <a key={url} className="link block" href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      ))}
    </>
  ),
  blossom: ({ node }) => <span className="break-all">{node.raw}</span>,
  cashu: ({ node }) => <span className="break-all">{node.raw}</span>,
  lightning: ({ node }) => (
    <a className="link break-all" href={`lightning:${node.invoice}`}>
      {node.invoice}
    </a>
  ),
};

/** Renders note text with the shared static Nostr content renderers */
export default function NoteContent({
  event,
  className = "",
  maxLength,
}: {
  event: NostrEvent | EventTemplate | string | undefined;
  className?: string;
  maxLength?: number;
}) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache, maxLength });
  return <div className={`whitespace-pre-wrap break-words ${className}`}>{content}</div>;
}
