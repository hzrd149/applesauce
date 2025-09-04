import { useEffect, useRef } from "react";
import { getDisplayName, getProfilePicture, getSeenRelays } from "applesauce-core/helpers";
import { useObservableMemo } from "applesauce-react/hooks";
import { type NostrEvent } from "nostr-tools";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/github-dark.css";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);

// Helper function to get tag value
function getTagValue(event: NostrEvent, tagName: string): string | null {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag ? tag[1] : null;
}

// Helper function to get code preview (first few lines)
function getCodePreview(content: string, maxLines: number = 6): string {
  const lines = content.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? preview + "\n..." : preview;
}

interface CodeSnippetCardProps {
  event: NostrEvent;
  eventStore: any;
  onViewFull?: (event: NostrEvent) => void;
}

export default function CodeSnippetCard({ event, eventStore, onViewFull }: CodeSnippetCardProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Get profile for the author
  const profile = useObservableMemo(() => {
    const relays = Array.from(getSeenRelays(event) || []);
    return eventStore.profile({ pubkey: event.pubkey, relays });
  }, [event.pubkey]);

  // Extract metadata from tags
  const language = getTagValue(event, "l") || "typescript";
  const name = getTagValue(event, "name") || "untitled.ts";
  const description = getTagValue(event, "description") || "";
  const extension = getTagValue(event, "extension") || "ts";
  const runtime = getTagValue(event, "runtime") || "";
  const license = getTagValue(event, "license") || "";

  // Get code preview
  const codePreview = getCodePreview(event.content, 6);

  // Format creation date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString();

  // Apply syntax highlighting when component mounts or code changes
  useEffect(() => {
    if (codeRef.current) {
      // Clear previous highlighting
      codeRef.current.removeAttribute("data-highlighted");
      // Apply highlighting
      hljs.highlightElement(codeRef.current);
    }
  }, [codePreview, language]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(event.content);
      // TODO: Add toast notification
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const handleViewFull = () => {
    if (onViewFull) {
      onViewFull(event);
    } else {
      console.log("View full code:", event.id);
    }
  };

  return (
    <div className="card bg-base-100 shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-1">
      <div className="card-body">
        {/* Header with title and author */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <h3 className="card-title text-lg mb-1 truncate" title={name}>
              {name}
            </h3>
            <div className="flex items-center gap-2 text-sm opacity-70">
              <span className="badge badge-outline badge-sm">{language}</span>
              <span className="badge badge-ghost badge-sm">{extension}</span>
              <span className="text-xs">{createdDate}</span>
            </div>
          </div>
          <div className="avatar">
            <div className="w-8 h-8 rounded-full">
              <img
                src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)}
                alt={getDisplayName(profile, "anon")}
                className="rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Author info */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm opacity-60">by</span>
          <span className="text-sm font-medium">{getDisplayName(profile, "Anonymous")}</span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm opacity-80 mb-3 line-clamp-2" title={description}>
            {description}
          </p>
        )}

        {/* Code Preview with Syntax Highlighting */}
        <div className="bg-base-300 rounded-lg p-3 mb-3 overflow-hidden code-preview">
          <pre className="text-xs overflow-x-auto">
            <code ref={codeRef} className={`language-${language.toLowerCase()}`}>
              {codePreview}
            </code>
          </pre>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 text-xs opacity-60 mb-3">
          {runtime && <span className="badge badge-ghost badge-sm">{runtime}</span>}
          {license && <span className="badge badge-ghost badge-sm">{license}</span>}
          <span className="badge badge-ghost badge-sm">{event.content.length} chars</span>
          <span className="badge badge-ghost badge-sm">{event.content.split("\n").length} lines</span>
        </div>

        {/* Actions */}
        <div className="card-actions justify-end">
          <button className="btn btn-primary btn-sm" onClick={copyCode} title="Copy code to clipboard">
            📋 Copy
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleViewFull} title="View full code">
            👁️ View Full
          </button>
        </div>
      </div>
    </div>
  );
}
