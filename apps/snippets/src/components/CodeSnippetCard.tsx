import { useEffect, useRef } from "react";
import { getDisplayName, getProfilePicture, getSeenRelays } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { type NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/github-dark.css";
import { eventStore } from "../helpers/nostr";
import { CheckIcon, CloseIcon, PocketIcon } from "./icons";
import { usePocketContext } from "../contexts/PocketContext";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);

// Helper function to get tag value
function getTagValue(event: NostrEvent, tagName: string): string | null {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag ? tag[1] : null;
}

// Helper function to get all tags of a specific type
function getAllTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((t) => t[0] === tagName)
    .map((t) => t[1])
    .filter(Boolean);
}

interface CodeSnippetCardProps {
  event: NostrEvent;
  onViewFull?: (nevent: string) => void;
}

export default function CodeSnippetCard({ event, onViewFull }: CodeSnippetCardProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Get pocket functionality from context
  const { addToPocket, isInPocket } = usePocketContext();

  // Get profile for the author
  const profile = use$(() => {
    const relays = Array.from(getSeenRelays(event) || []);
    return eventStore.profile({ pubkey: event.pubkey, relays });
  }, [event.pubkey]);

  // Extract metadata from tags
  const language = getTagValue(event, "l") || "typescript";
  const title = getTagValue(event, "title") || getTagValue(event, "name") || "Untitled Snippet";
  const filename = getTagValue(event, "name") || "unknown.txt";
  const description = getTagValue(event, "description") || "";
  const extension = getTagValue(event, "extension") || "ts";
  const runtime = getTagValue(event, "runtime") || "";
  const license = getTagValue(event, "license") || "";
  const tags = getAllTagValues(event, "t");
  const dependencies = getAllTagValues(event, "dep");

  // Format creation date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString();

  // Generate unique modal ID for this card
  const modalId = `code_preview_${event.id}`;

  // Apply syntax highlighting when modal is opened
  useEffect(() => {
    if (codeRef.current) {
      // Clear previous highlighting
      codeRef.current.removeAttribute("data-highlighted");
      // Apply highlighting
      hljs.highlightElement(codeRef.current);
    }
  }, [event.content, language]);

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
      // Create nevent with relay hints
      const relayHints = Array.from(getSeenRelays(event) || []).slice(0, 3); // Limit to 3 relays
      const nevent = nip19.neventEncode({
        id: event.id,
        relays: relayHints,
        author: event.pubkey,
      });
      onViewFull(nevent);
    } else {
      console.log("View full code:", event.id);
    }
  };

  const handleAddToPocket = () => {
    if (!isInPocket(event.id)) {
      addToPocket(event);
    }
  };

  const isEventInPocket = isInPocket(event.id);

  return (
    <div className="card bg-base-100 shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-1">
      <div className="card-body p-3 sm:p-4 flex flex-col gap-2 sm:gap-3">
        {/* Header with snippet title and author */}
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="card-title text-base sm:text-lg mb-1 truncate" title={title}>
              {title}
            </h2>
            <p className="text-xs sm:text-sm opacity-70 truncate" title={filename}>
              {filename}
            </p>
          </div>
          <div className="avatar flex-shrink-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full">
              <img
                src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)}
                alt={getDisplayName(profile, "anon")}
                className="rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Description */}
        {description && <p className="text-sm sm:text-base opacity-80 leading-relaxed">{description}</p>}

        {/* Tags and Dependencies - mobile optimized */}
        <div className="space-y-1.5 sm:space-y-2">
          {tags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold opacity-70 mb-1">Tags</h4>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag, index) => (
                  <span key={index} className="badge badge-primary badge-xs sm:badge-sm text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dependencies.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold opacity-70 mb-1">Dependencies</h4>
              <div className="flex flex-wrap gap-1">
                {dependencies.map((dep, index) => (
                  <span key={index} className="badge badge-secondary badge-xs sm:badge-sm text-xs">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="pt-2 border-t border-base-300 space-y-1.5 sm:space-y-2">
          {/* Language and file info badges */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="badge badge-outline badge-xs sm:badge-sm text-xs">{language}</span>
            <span className="badge badge-ghost badge-xs sm:badge-sm text-xs">{extension}</span>
            {runtime && <span className="badge badge-ghost badge-xs sm:badge-sm text-xs">{runtime}</span>}
            {license && <span className="badge badge-ghost badge-xs sm:badge-sm text-xs">{license}</span>}
          </div>

          {/* Date and author info */}
          <div className="flex items-center gap-2 text-xs sm:text-sm opacity-70 flex-wrap">
            <span>{createdDate}</span>
            <span>•</span>
            <span className="opacity-60">{getDisplayName(profile, "Anonymous")}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          {/* Code stats */}
          <div className="text-xs opacity-60 text-center sm:text-left order-2 sm:order-1">
            <span>{event.content.length} chars</span>
            <span className="mx-2">•</span>
            <span>{event.content.split("\n").length} lines</span>
          </div>

          {/* Buttons: Stacked on mobile, single row on desktop */}
          <div className="flex flex-col sm:flex-row gap-2 order-1 sm:order-2">
            <div className="flex gap-2 justify-center sm:justify-end">
              <button
                className={`btn btn-sm ${isEventInPocket ? "btn-success" : "btn-ghost"} btn-square flex-shrink-0`}
                onClick={handleAddToPocket}
                disabled={isEventInPocket}
                title={isEventInPocket ? "Already in pocket" : "Add to pocket"}
              >
                {isEventInPocket ? <CheckIcon /> : <PocketIcon />}
              </button>
              <button
                className="btn btn-secondary btn-soft btn-sm flex-1 sm:flex-none"
                onClick={() => (document.getElementById(modalId) as HTMLDialogElement)?.showModal()}
                title="Preview code"
              >
                Preview
              </button>
            </div>
            <div className="flex gap-2 justify-center sm:justify-end">
              <button
                className="btn btn-neutral btn-sm flex-1 sm:flex-none"
                onClick={copyCode}
                title="Copy code to clipboard"
              >
                Copy
              </button>
              <button
                className="btn btn-primary btn-sm flex-1 sm:flex-none"
                onClick={handleViewFull}
                title="View full code"
              >
                View Full
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Code Preview Dialog */}
      <dialog id={modalId} className="modal">
        <div className="modal-box w-11/12 max-w-7xl max-h-[80vh]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-bold text-lg">{title}</h3>
              <p className="text-sm opacity-70">{filename}</p>
            </div>
            <form method="dialog">
              <button className="btn btn-sm btn-circle btn-ghost">
                <CloseIcon />
              </button>
            </form>
          </div>

          <div className="bg-base-200 rounded-lg p-4 overflow-auto max-h-[60vh]">
            <pre className="text-sm overflow-x-auto">
              <code ref={codeRef} className={`language-${language.toLowerCase()}`}>
                {event.content}
              </code>
            </pre>
          </div>

          <div className="modal-action">
            <button className="btn btn-neutral" onClick={copyCode}>
              Copy Code
            </button>
            <form method="dialog">
              <button className="btn">Close</button>
            </form>
          </div>
        </div>

        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
