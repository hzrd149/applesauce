import { castEvent, CodeSnippet } from "applesauce-common/casts";
import { blueprint, EventFactory } from "applesauce-core";
import { normalizeToEventPointer } from "applesauce-core/helpers/pointers";
import { relaySet } from "applesauce-core/helpers/relays";
import { setContent } from "applesauce-core/operations/content";
import { setDeleteEvents } from "applesauce-core/operations/delete";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents } from "applesauce-relay";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import type { NostrEvent } from "nostr-tools";
import { useEffect, useMemo, useRef, useState } from "react";
import { map } from "rxjs";
import { AccountDisplay, UserAvatar, UserName } from "../components";
import { usePocketContext } from "../contexts/PocketContext";
import { COMMENT_KIND } from "../helpers/nostr";
import { accounts } from "../services/accounts";
import { eventStore } from "../services/event-store";
import { pool } from "../services/pool";

import "highlight.js/styles/github-dark.css";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);

// Factory will be created with active account's signer in the component

// Blueprint for creating deletion events following NIP-09
function DeleteBlueprint(events: (string | NostrEvent)[], reason?: string) {
  return blueprint(5, reason ? setContent(reason) : undefined, setDeleteEvents(events));
}

interface CodeSnippetDetailsProps {
  eventId: string;
  relays: string[];
  onBack: () => void;
  onNavigateToSignin: () => void;
}

interface Comment {
  event: NostrEvent;
  profile?: NostrEvent;
  replies?: Comment[];
}

export default function CodeSnippetDetails({ eventId, relays, onBack, onNavigateToSignin }: CodeSnippetDetailsProps) {
  const codeRef = useRef<HTMLElement>(null);
  const deleteModalRef = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<NostrEvent | null>(null);
  const [snippet, setSnippet] = useState<CodeSnippet | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);

  // Delete state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // Get pocket functionality from context
  const { addToPocket, isInPocket } = usePocketContext();

  // Get active account from accounts service
  const activeAccount = use$(() => accounts.active$, []);

  // Derive current user pubkey from active account
  const currentUserPubkey = activeAccount?.pubkey || null;

  // Create factory with active account's signer
  const factory = useMemo(() => {
    if (!activeAccount) return null;
    return new EventFactory({ signer: activeAccount });
  }, [activeAccount]);

  // Load the main event
  useEffect(() => {
    const loadEvent = async () => {
      setLoading(true);
      try {
        // Normalize the eventId to an EventPointer
        const pointer = normalizeToEventPointer(eventId);
        if (!pointer) {
          setLoading(false);
          return;
        }

        // Merge relays from the pointer with provided relays
        const mergedRelays = relaySet(pointer.relays, relays);

        // Subscribe to get the event
        const subscription = pool
          .subscription(mergedRelays, {
            ids: [pointer.id],
          })
          .pipe(
            onlyEvents(),
            map((event) => event),
          );

        const sub = subscription.subscribe({
          next: (foundEvent) => {
            setEvent(foundEvent);
            // Cast event to CodeSnippet - only set snippet if casting succeeds
            try {
              const casted = castEvent(foundEvent, CodeSnippet, eventStore);
              setSnippet(casted);
            } catch (err) {
              console.error("Failed to cast event:", err);
              // Don't set snippet if casting fails
            }
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
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.event.content);
      // TODO: Add toast notification
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const handleAddToPocket = () => {
    if (snippet && !isInPocket(snippet.id)) {
      addToPocket(snippet.event);
    }
  };

  const openDeleteModal = () => {
    setDeleteError(null);
    setDeleteReason("");
    deleteModalRef.current?.showModal();
  };

  const handleDelete = async () => {
    if (!snippet || !activeAccount || !factory) return;

    try {
      setIsDeleting(true);
      setDeleteError(null);

      // Verify ownership
      if (activeAccount.pubkey !== snippet.author.pubkey) {
        throw new Error("You can only delete your own snippets");
      }

      // Create & sign deletion event
      const draft = await factory.create(DeleteBlueprint, [snippet.event], deleteReason.trim() || undefined);
      const signed = await factory.sign(draft);

      // Publish to all relays
      await pool.publish(relays, signed);

      // Remove from local store
      eventStore.remove(snippet.id);

      // Close modal and navigate back
      deleteModalRef.current?.close();
      onBack();
    } catch (error) {
      console.error("Failed to delete:", error);
      setDeleteError(error instanceof Error ? error.message : "Failed to delete snippet");
    } finally {
      setIsDeleting(false);
    }
  };

  const isUserAuthor = currentUserPubkey && snippet && currentUserPubkey === snippet.author.pubkey;

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

  if (!snippet) {
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

  // Extract metadata from cast
  const language = snippet.language;
  const name = snippet.name;
  const description = snippet.description || "";
  const runtime = snippet.runtime || "";
  const license = snippet.license || "";

  // Format creation date
  const createdDate = snippet.createdAt;

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 sticky top-0 z-50">
        <div className="navbar-start">
          <button className="btn btn-ghost" onClick={onBack}>
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
              className={`btn ${isInPocket(snippet.id) ? "btn-success" : "btn-ghost"}`}
              onClick={handleAddToPocket}
              disabled={isInPocket(snippet.id)}
              title={isInPocket(snippet.id) ? "Already in pocket" : "Add to pocket"}
            >
              {isInPocket(snippet.id) ? (
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
            <button className="btn btn-primary" onClick={copyCode}>
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

            {/* Three-dot menu dropdown */}
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-circle">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                </svg>
              </div>
              <ul tabIndex={0} className="dropdown-content z-1 menu p-2 bg-base-100 rounded-box w-52">
                {isUserAuthor && (
                  <li>
                    <a onClick={openDeleteModal} className="text-error">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      Delete Snippet
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <AccountDisplay onNavigateToSignin={onNavigateToSignin} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        {/* Author and Description */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <UserAvatar user={snippet.author} size="lg" />
            <div>
              <h2 className="text-lg font-semibold">
                <UserName user={snippet.author} fallback="Anonymous" />
              </h2>
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
            <span className="badge badge-ghost">{snippet.event.content.length} characters</span>
            <span className="badge badge-ghost">{snippet.event.content.split("\n").length} lines</span>
          </div>
        </div>

        {/* Full Code Display */}
        <div className="bg-base-100 rounded-lg overflow-hidden mb-8" style={{ minHeight: "60vh" }}>
          <div className="bg-base-300 px-4 py-2 flex justify-between items-center">
            <span className="text-sm font-mono">{name}</span>
            <span className="text-sm opacity-70">{language}</span>
          </div>
          <div className="p-4 overflow-x-auto" style={{ minHeight: "50vh" }}>
            <pre className="text-xs leading-relaxed">
              <code ref={codeRef} className={`language-${language.toLowerCase()}`}>
                {snippet.event.content}
              </code>
            </pre>
          </div>
        </div>

        {/* Comments Section */}
        <div className="bg-base-100 rounded-lg p-6">
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
                <CommentItem key={comment.event.id} comment={comment} />
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

      {/* Delete Confirmation Modal */}
      <dialog ref={deleteModalRef} className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg mb-4">Delete Code Snippet</h3>

          <div className="mb-4">
            <p className="mb-2">Are you sure you want to delete this snippet?</p>
            <div className="bg-base-200 p-3 rounded-lg">
              <p className="font-semibold text-sm">{snippet.name}</p>
            </div>
          </div>

          <div className="mb-4">
            <label className="label">
              <span className="label-text">Reason for deletion (optional)</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              placeholder="e.g., outdated, contains error, etc."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
              disabled={isDeleting}
            />
          </div>

          {deleteError && (
            <div className="alert alert-error mb-4">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{deleteError}</span>
            </div>
          )}

          <div className="modal-action">
            <button className="btn btn-ghost" onClick={() => deleteModalRef.current?.close()} disabled={isDeleting}>
              Cancel
            </button>
            <button
              className={`btn btn-error ${isDeleting ? "loading" : ""}`}
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Snippet"}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

// Comment Item Component
function CommentItem({ comment }: { comment: Comment }) {
  // Extract relay hints from comment event tags
  const relaysForProfile = comment.event.tags
    .filter((t) => t[0] === "relay")
    .map((t) => t[1])
    .filter(Boolean);

  const createdDate = new Date(comment.event.created_at * 1000);

  return (
    <div className="flex gap-3 p-4 bg-base-50 rounded-lg">
      <UserAvatar pubkey={comment.event.pubkey} relays={relaysForProfile} size="sm" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm">
            <UserName pubkey={comment.event.pubkey} relays={relaysForProfile} fallback="Anonymous" />
          </span>
          <span className="text-xs opacity-60">
            {createdDate.toLocaleDateString()} at {createdDate.toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm">{comment.event.content}</p>
      </div>
    </div>
  );
}
