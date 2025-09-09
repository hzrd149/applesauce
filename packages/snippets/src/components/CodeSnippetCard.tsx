import { getDisplayName, getProfilePicture, getSeenRelays } from "applesauce-core/helpers";
import { useObservableMemo } from "applesauce-react/hooks";
import { type NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { eventStore } from "../helpers/nostr";
import { CheckIcon, PocketIcon } from "./icons";
import { usePocketContext } from "../contexts/PocketContext";

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
  // Get pocket functionality from context
  const { addToPocket, isInPocket } = usePocketContext();

  // Get profile for the author
  const profile = useObservableMemo(() => {
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
      <div className="card-body p-4 flex flex-col gap-3">
        {/* Header with snippet title and author */}
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <h2 className="card-title text-lg mb-1 truncate" title={title}>
              {title}
            </h2>
            <p className="text-sm opacity-70 truncate" title={filename}>
              {filename}
            </p>
          </div>
          <div className="avatar">
            <div className="w-10 h-10 rounded-full">
              <img
                src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)}
                alt={getDisplayName(profile, "anon")}
                className="rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Description */}
        {description && <p className="text-lg opacity-80">{description}</p>}

        {/* Tags and Dependencies - more visible */}
        <div className="space-y-2">
          {tags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold opacity-70 mb-1">Tags</h4>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag, index) => (
                  <span key={index} className="badge badge-primary badge-sm">
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
                  <span key={index} className="badge badge-secondary badge-sm">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Metadata and Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-base-300">
          <div className="flex items-center gap-2 text-sm opacity-70 flex-wrap">
            <span className="badge badge-outline badge-sm">{language}</span>
            <span className="badge badge-ghost badge-sm">{extension}</span>
            {runtime && <span className="badge badge-ghost badge-sm">{runtime}</span>}
            {license && <span className="badge badge-ghost badge-sm">{license}</span>}
            <span>•</span>
            <span>{createdDate}</span>
            <span>•</span>
            <span className="opacity-60">{getDisplayName(profile, "Anonymous")}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-between items-center">
          <div className="text-xs opacity-60">
            <span>{event.content.length} chars</span>
            <span className="mx-2">•</span>
            <span>{event.content.split("\n").length} lines</span>
          </div>
          <div className="flex gap-2">
            <button
              className={`btn btn-sm ${isEventInPocket ? "btn-success" : "btn-ghost"} btn-square`}
              onClick={handleAddToPocket}
              disabled={isEventInPocket}
              title={isEventInPocket ? "Already in pocket" : "Add to pocket"}
            >
              {isEventInPocket ? <CheckIcon /> : <PocketIcon />}
            </button>
            <button className="btn btn-neutral btn-sm" onClick={copyCode} title="Copy code to clipboard">
              Copy
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleViewFull} title="View full code">
              View Full
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
