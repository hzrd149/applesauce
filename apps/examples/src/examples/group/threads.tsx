/**
 * Display threaded conversations within groups with replies
 * @tags nip-29, nip-72, group, threads, comments
 * @related group/groups, comment/feed
 */
import { relayTimeline } from "../../extra/relay-timeline";

import { castTimelineStream } from "applesauce-common/observable";
import NoteContent from "../../components/note-content";
import { ForumThread, Comment, castEvent } from "applesauce-common/casts";
import { publishEvent } from "../../extra/publish";

import { CommentFactory, GroupThreadFactory } from "applesauce-common/factories";
import { COMMENT_KIND, decodeGroupPointer, GroupPointer } from "applesauce-common/helpers";

import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { useCallback, useRef, useMemo } from "react";
import { BehaviorSubject, of } from "rxjs";

import GroupPicker from "../../components/group-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

const signer = new ExtensionSigner();

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

function ThreadCard({ thread, onSelect }: { thread: ForumThread; onSelect?: (event: NostrEvent) => void }) {
  const event = thread.event;
  const profile = use$(thread.author.profile$);

  return (
    <div className="border border-base-300 bg-base-200 ">
      {onSelect && (
        <button className="btn btn-soft btn-primary absolute top-2 right-2" onClick={() => onSelect(event)}>
          View
        </button>
      )}
      <div className="p-4">
        <div className="flex items-center gap-4">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img
                alt={getDisplayName(profile)}
                src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)}
              />
            </div>
          </div>
          <div>
            <h3 className="font-bold">{thread.title || "Untitled"}</h3>
            <p className="text-sm opacity-60">
              by {getDisplayName(profile)} • {new Date(event.created_at * 1000).toLocaleString()}
            </p>
          </div>
        </div>
        <NoteContent event={event} className="mt-2" />
      </div>
    </div>
  );
}

function ThreadReply({ comment }: { comment: Comment }) {
  const event = comment.event;
  const raw = useRef<HTMLDialogElement>(null);
  const profile = use$(comment.author.profile$);

  return (
    <div className="chat chat-start">
      <div className="chat-image avatar">
        <div className="w-10 rounded-full">
          <img alt={getDisplayName(profile)} src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}`)} />
        </div>
      </div>
      <div className="chat-header">
        {getDisplayName(profile)}
        <time className="text-sm opacity-50">{new Date(event.created_at * 1000).toLocaleString()}</time>
      </div>
      <div className="chat-bubble">
        <NoteContent event={event} />
      </div>

      <span></span>
      <button className="btn btn-link btn-sm" onClick={() => raw.current?.showModal()}>
        View event
      </button>

      <dialog id={`event-${event.id}`} className="modal" ref={raw}>
        <div className="modal-box w-full max-w-6xl">
          <pre className="text-sm">
            <code>{JSON.stringify(event, null, 2)}</code>
          </pre>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

function ReplyForm({ event, pointer }: { event: NostrEvent; pointer: GroupPointer }) {
  const sending$ = useMemo(() => new BehaviorSubject(false), []);
  const sending = use$(sending$);

  const content$ = useMemo(() => new BehaviorSubject(""), []);
  const content = use$(content$);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sending$.next(true);
    try {
      // Create a comment and include the group h tag
      const signed = await CommentFactory.create(event, content).group(pointer).sign(signer);
      // Publish the event
      await publishEvent(pool, [pointer.relay], signed);
      // Add to the event store for the app
      eventStore.add(signed);
      content$.next("");
    } catch (error) {
      alert(String(error));
    } finally {
      sending$.next(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-4 flex-col max-w-xl mx-auto my-4">
      <textarea
        className="textarea textarea-bordered flex-grow w-full"
        value={content}
        onChange={(e) => content$.next(e.target.value)}
        placeholder="Type your reply..."
        required
      />

      <div className="join ms-auto">
        <button type="submit" disabled={sending} className="btn btn-primary join-item">
          {sending ? <span className="loading loading-spinner loading-sm"></span> : "Send"}
        </button>
      </div>
    </form>
  );
}

/** A component for viewing a thread */
function ThreadView({ event, pointer }: { event: NostrEvent; pointer: GroupPointer }) {
  const feed = use$(
    () =>
      relayTimeline(eventStore, pool, [pointer.relay], { kinds: [COMMENT_KIND], "#h": [pointer.id], "#E": [event.id] }),
    [pointer.relay, pointer.id, event.id],
  );
  const thread = useMemo(() => castEvent(event, ForumThread, eventStore), [event]);
  const replies = use$(thread.replies$);

  return (
    <div>
      <ThreadCard thread={thread} />
      <div className="mt-8 space-y-4">
        {replies?.map((reply) => (
          <ThreadReply key={reply.id} comment={reply} />
        ))}
      </div>

      {feed?.errors.map((error) => (
        <p key={error} role="alert" className="text-error">
          {error}
        </p>
      ))}
      <ReplyForm event={event} pointer={pointer} />
    </div>
  );
}

/** A component for creating a new thread */
function NewThreadForm({
  pointer,
  onCancel,
  onSuccess,
}: {
  pointer: GroupPointer;
  onCancel: () => void;
  onSuccess: (event: NostrEvent) => void;
}) {
  const sending$ = useMemo(() => new BehaviorSubject(false), []);
  const sending = use$(sending$);

  const content$ = useMemo(() => new BehaviorSubject(""), []);
  const content = use$(content$);

  const title$ = useMemo(() => new BehaviorSubject(""), []);
  const title = use$(title$);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sending$.next(true);
    try {
      const signed = await GroupThreadFactory.create(pointer, title, content).sign(signer);
      // Publish the event
      await publishEvent(pool, [pointer.relay], signed);
      // Add to the event store for the app
      eventStore.add(signed);

      onSuccess(signed);
    } catch (error) {
      alert(String(error));
    } finally {
      sending$.next(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-4 flex-col max-w-xl mx-auto my-4">
      <input
        type="text"
        className="input input-bordered flex-grow w-full"
        value={title}
        onChange={(e) => title$.next(e.target.value)}
        placeholder="Title"
        required
      />
      <textarea
        className="textarea textarea-bordered flex-grow w-full"
        value={content}
        onChange={(e) => content$.next(e.target.value)}
        placeholder="Type your message..."
        required
      />

      <div className="join ms-auto">
        <button type="button" disabled={sending} className="btn btn-ghost join-item" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={sending} className="btn btn-primary join-item">
          {sending ? <span className="loading loading-spinner loading-sm"></span> : "Send"}
        </button>
      </div>
    </form>
  );
}

/** A component for listing threads */
function ThreadsList({ pointer, onSelect }: { pointer: GroupPointer; onSelect: (event: NostrEvent) => void }) {
  const feed = use$(
    () => relayTimeline(eventStore, pool, [pointer.relay], { kinds: [11], "#h": [pointer.id] }),
    [pointer.relay, pointer.id],
  );
  const threads = use$(() => of(feed?.events ?? []).pipe(castTimelineStream(ForumThread, eventStore)), [feed]);

  return (
    <div className="space-y-4">
      {feed?.errors.map((error) => (
        <p key={error} role="alert" className="text-error">
          {error}
        </p>
      ))}
      {feed?.status === "loading" && <p>Loading threads…</p>}
      {threads?.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function ThreadsExample() {
  const identifier$ = useMemo(() => new BehaviorSubject(""), []);
  const identifier = use$(identifier$);

  const pointer = useMemo(() => {
    try {
      return decodeGroupPointer(identifier) ?? undefined;
    } catch {
      return undefined;
    }
  }, [identifier]);
  const selectedThread$ = useMemo(() => new BehaviorSubject<NostrEvent | undefined>(undefined), []);
  const selectedThread = use$(selectedThread$);

  const createThread$ = useMemo(() => new BehaviorSubject(false), []);
  const createThread = use$(createThread$);

  const setGroup = useCallback(
    (identifier: string) => {
      try {
        identifier$.next(identifier);
        selectedThread$.next(undefined);
      } catch (error) {}
    },
    [identifier$],
  );

  return (
    <div className="container mx-auto p-2 h-full">
      <div className="mb-4 flex w-full  gap-2">
        <GroupPicker identifier={identifier} setIdentifier={setGroup} />

        {pointer && !createThread && !selectedThread && (
          <button className="btn btn-primary ms-auto" onClick={() => createThread$.next(true)}>
            New Thread
          </button>
        )}
      </div>

      {pointer && createThread && !selectedThread && (
        <NewThreadForm
          pointer={pointer}
          onCancel={() => createThread$.next(false)}
          onSuccess={() => createThread$.next(false)}
        />
      )}

      {pointer && !selectedThread && (
        <ThreadsList
          pointer={pointer}
          onSelect={(value: typeof selectedThread$.value) => selectedThread$.next(value)}
        />
      )}
      {pointer && selectedThread && (
        <>
          <button className="btn btn-ghost mb-4" onClick={() => selectedThread$.next(undefined)}>
            ← Back to Threads
          </button>
          <ThreadView event={selectedThread} pointer={pointer} />
        </>
      )}
    </div>
  );
}
