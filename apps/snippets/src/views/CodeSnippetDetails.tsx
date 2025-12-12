import type { IEventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, getSeenRelays } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents } from "applesauce-relay";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import "highlight.js/styles/github-dark.css";
import { nip19, type NostrEvent } from "nostr-tools";
import { useEffect, useRef, useState } from "react";
import { map, NEVER } from "rxjs";

import { usePocketContext } from "../contexts/PocketContext";
import { COMMENT_KIND, eventStore, pool } from "../helpers/nostr";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);

// Helper function to get tag value
function getTagValue(event: NostrEvent, tagName: string): string | null {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag ? tag[1] : null;
}

interface CodeSnippetDetailsProps {
  eventId: string;
  relays: string[];
  onBack: () => void;
}

interface Comment {
  event: NostrEvent;
  profile?: NostrEvent;
  replies?: Comment[];
}

export default function CodeSnippetDetails({ eventId, relays, onBack }: CodeSnippetDetailsProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [event, setEvent] = useState<NostrEvent | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);

  // Get pocket functionality from context
  const { addToPocket, isInPocket } = usePocketContext();

  // Get profile for the author
  const profile = use$(() => {
    if (!event) return NEVER;
    const relaysForProfile = Array.from(getSeenRelays(event) || []);
    return eventStore.profile({ pubkey: event.pubkey, relays: relaysForProfile });
  }, [event?.pubkey]);

  // Load the main event
  useEffect(() => {
    const loadEvent = async () => {
      setLoading(true);
      try {
        let actualEventId = eventId;

        // Check if it's an nevent
        if (eventId.startsWith("nevent1")) {
          try {
            const decoded = nip19.decode(eventId);
            if (decoded.type === "nevent") {
              actualEventId = decoded.data.id;
            }
          } catch (err) {
            console.error("Failed to decode nevent:", err);
          }
        }

        // Subscribe to get the event
        const subscription = pool
          .subscription(relays, {
            ids: [actualEventId],
          })
          .pipe(
            onlyEvents(),
            map((event) => event),
          );

        const sub = subscription.subscribe({
          next: (foundEvent) => {
            setEvent(foundEvent);
            setLoading(false);
          },
        });

        // Cleanup after 5 seconds
        setTimeout(() => {
          sub.unsubscribe();
          if (!event) {
            setLoading(false);
          }
        }, 5000);

        return () => sub.unsubscribe();
      } catch (error) {
        console.error("Error loading event:", error);
        setLoading(false);
      }
    };

    loadEvent();
  }, [eventId, pool, relays]);

  // Load comments for the event
  useEffect(() => {
    if (!event) return;

    const loadComments = async () => {
      setCommentsLoading(true);
      try {
        // Subscribe to comments that reference this event
        const subscription = pool
          .subscription(relays, {
            kinds: [COMMENT_KIND],
            "#e": [event.id],
          })
          .pipe(
            onlyEvents(),
            map((commentEvent) => commentEvent),
          );

        const commentEvents: NostrEvent[] = [];
        const sub = subscription.subscribe({
          next: (commentEvent) => {
            commentEvents.push(commentEvent);
          },
        });

        // Process comments after 3 seconds
        setTimeout(() => {
          sub.unsubscribe();

          // Sort comments by creation time
          const sortedComments = commentEvents.sort((a, b) => a.created_at - b.created_at);

          // Convert to comment objects with profiles
          const commentsWithProfiles: Comment[] = sortedComments.map((commentEvent) => ({
            event: commentEvent,
            replies: [], // TODO: Implement nested replies
          }));

          setComments(commentsWithProfiles);
          setCommentsLoading(false);
        }, 3000);

        return () => sub.unsubscribe();
      } catch (error) {
        console.error("Error loading comments:", error);
        setCommentsLoading(false);
      }
    };

    loadComments();
  }, [event, pool, relays]);

  // Apply syntax highlighting when event loads
  useEffect(() => {
    if (codeRef.current && event) {
      // Clear previous highlighting
      codeRef.current.removeAttribute("data-highlighted");
      // Apply highlighting
      hljs.highlightElement(codeRef.current);
    }
  }, [event]);

  const copyCode = async () => {
    if (!event) return;
    try {
      await navigator.clipboard.writeText(event.content);
      // TODO: Add toast notification
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const handleAddToPocket = () => {
    if (event && !isInPocket(event.id)) {
      addToPocket(event);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-lg">Loading code snippet...</p>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Code Snippet Not Found</h2>
          <p className="mb-6">The requested code snippet could not be found.</p>
          <button className="btn btn-primary" onClick={onBack}>
            ← Back to Snippets
          </button>
        </div>
      </div>
    );
  }

  // Extract metadata from tags
  const language = getTagValue(event, "l") || "typescript";
  const name = getTagValue(event, "name") || "unknown.txt";
  const description = getTagValue(event, "description") || "";
  const runtime = getTagValue(event, "runtime") || "";
  const license = getTagValue(event, "license") || "";

  // Format creation date
  const createdDate = new Date(event.created_at * 1000);

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-sm sticky top-0 z-50">
        <div className="navbar-start">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        <div className="navbar-center flex-1 px-4">
          <div className="text-center max-w-md">
            <h1 className="text-lg font-bold truncate mb-1" title={name}>
              {name}
            </h1>
          </div>
        </div>

        <div className="navbar-end">
          <div className="flex gap-2">
            <button
              className={`btn btn-sm ${isInPocket(event.id) ? "btn-success" : "btn-ghost"}`}
              onClick={handleAddToPocket}
              disabled={isInPocket(event.id)}
              title={isInPocket(event.id) ? "Already in pocket" : "Add to pocket"}
            >
              {isInPocket(event.id) ? (
                <>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  In Pocket
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  Add to Pocket
                </>
              )}
            </button>
            <button className="btn btn-primary btn-sm" onClick={copyCode}>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        {/* Author and Description */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="avatar">
              <div className="w-12 h-12 rounded-full">
                <img
                  src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)}
                  alt={getDisplayName(profile, "anon")}
                  className="rounded-full"
                />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold">{getDisplayName(profile, "Anonymous")}</h2>
              <p className="text-sm opacity-70">
                {createdDate.toLocaleDateString()} at {createdDate.toLocaleTimeString()}
              </p>
            </div>
          </div>

          {description && (
            <div className="bg-base-100 rounded-lg p-4 mb-4">
              <p className="text-base">{description}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-2 mb-4">
            {runtime && <span className="badge badge-ghost">{runtime}</span>}
            {license && <span className="badge badge-ghost">{license}</span>}
            <span className="badge badge-ghost">{event.content.length} characters</span>
            <span className="badge badge-ghost">{event.content.split("\n").length} lines</span>
          </div>
        </div>

        {/* Full Code Display */}
        <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden mb-8" style={{ minHeight: "60vh" }}>
          <div className="bg-base-300 px-4 py-2 flex justify-between items-center">
            <span className="text-sm font-mono">{name}</span>
            <span className="text-sm opacity-70">{language}</span>
          </div>
          <div className="p-4 overflow-x-auto" style={{ minHeight: "50vh" }}>
            <pre className="text-xs leading-relaxed">
              <code ref={codeRef} className={`language-${language.toLowerCase()}`}>
                {event.content}
              </code>
            </pre>
          </div>
        </div>

        {/* Comments Section */}
        <div className="bg-base-100 rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-bold mb-6">Comments ({comments.length})</h3>

          {commentsLoading ? (
            <div className="text-center py-8">
              <div className="loading loading-spinner loading-md"></div>
              <p className="mt-2">Loading comments...</p>
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8 opacity-60">
              <p>No comments yet. Be the first to comment!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <CommentItem key={comment.event.id} comment={comment} eventStore={eventStore} />
              ))}
            </div>
          )}

          {/* Comment Form Placeholder */}
          <div className="mt-8 pt-6 border-t border-base-300">
            <div className="bg-base-200 rounded-lg p-4 text-center opacity-60">
              <p>Comment functionality coming soon!</p>
              <p className="text-sm mt-1">Will use NIP-22 comments for decentralized discussions</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Comment Item Component
function CommentItem({ comment, eventStore }: { comment: Comment; eventStore: IEventStore }) {
  // Get profile for the comment author
  const profile = use$(() => {
    const relaysForProfile = Array.from(getSeenRelays(comment.event) || []);
    return eventStore.profile({ pubkey: comment.event.pubkey, relays: relaysForProfile });
  }, [comment.event.pubkey]);

  const createdDate = new Date(comment.event.created_at * 1000);

  return (
    <div className="flex gap-3 p-4 bg-base-50 rounded-lg">
      <div className="avatar">
        <div className="w-8 h-8 rounded-full">
          <img
            src={getProfilePicture(profile, `https://robohash.org/${comment.event.pubkey}`)}
            alt={getDisplayName(profile, "anon")}
            className="rounded-full"
          />
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm">{getDisplayName(profile, "Anonymous")}</span>
          <span className="text-xs opacity-60">
            {createdDate.toLocaleDateString()} at {createdDate.toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm">{comment.event.content}</p>
      </div>
    </div>
  );
}
