/**
 * Display torrent files shared on Nostr with metadata, download information and NIP-22 comments
 * @tags nip-35, nip-22, torrent, feed, files, comments
 * @related torrent/publisher, torrent/search, torrent/manager, comment/feed
 */
import { CreateComment } from "applesauce-actions/actions";
import { ActionRunner } from "applesauce-actions";
import { Comment, Reaction, Torrent, Zap } from "applesauce-common/casts";
import { COMMENT_KIND, TORRENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { Filter, NostrEvent, persistEventsToCache, relaySet } from "applesauce-core/helpers";
import { createEventLoaderForStore, createReactionsLoader, createZapsLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BehaviorSubject, map, shareReplay } from "rxjs";
import { relayTimeline } from "../../extra/relay-timeline";
import LoginView from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Setup event store
const eventStore = new EventStore();

// Memoize plugins and components at module level
const remarkPlugins = [remarkGfm, remarkNostrMentions];
const markdownComponents = {
  h1: ({ ...props }: any) => <h1 className="text-3xl font-bold my-4" {...props} />,
  h2: ({ ...props }: any) => <h2 className="text-2xl font-bold my-3" {...props} />,
  h3: ({ ...props }: any) => <h3 className="text-xl font-bold my-2" {...props} />,
  p: ({ ...props }: any) => <p className="my-2" {...props} />,
  a: ({ ...props }: any) => <a className="link link-primary" target="_blank" {...props} />,
  ul: ({ ...props }: any) => <ul className="list-disc ml-4 my-2" {...props} />,
  ol: ({ ...props }: any) => <ol className="list-decimal ml-4 my-2" {...props} />,
  blockquote: ({ ...props }: any) => <blockquote className="border-l-4 border-primary pl-4 my-2" {...props} />,
  code: ({ ...props }: any) => <code className="bg-base-300 rounded px-1" {...props} />,
  pre: ({ ...props }: any) => <pre className="bg-base-300 rounded p-4 my-2 overflow-x-auto" {...props} />,
  table: ({ ...props }: any) => (
    <div className="overflow-x-auto my-4">
      <table className="table table-zebra w-full" {...props} />
    </div>
  ),
  thead: ({ ...props }: any) => <thead className="bg-base-200" {...props} />,
  tbody: ({ ...props }: any) => <tbody {...props} />,
  tr: ({ ...props }: any) => <tr {...props} />,
  th: ({ ...props }: any) => <th {...props} />,
  td: ({ ...props }: any) => <td {...props} />,
};

// Create a relay pool for connections
const pool = new RelayPool();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters<NostrEvent>(cache, filters).then((events) => {
    console.log("loaded events from cache", events.length);
    return events;
  });
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays$,
});

const zapLoader = createZapsLoader(pool, { eventStore });
const reactionLoader = createReactionsLoader(pool, { eventStore });

// BehaviorSubject to store the selected torrent
const selectedTorrent$ = new BehaviorSubject<Torrent | null>(null);

/** Component to render a single reaction */
function ReactionItem({ reaction }: { reaction: Reaction }) {
  const profile = use$(reaction.author.profile$);
  const displayName = profile?.displayName || reaction.author.npub;
  const picture = profile?.picture || `https://robohash.org/${reaction.author.pubkey}.png`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="avatar">
        <div className="w-6 rounded-full">
          <img src={picture} alt={displayName} />
        </div>
      </div>
      <span className="font-medium">{displayName}</span>
      <span className="text-base-content/60">{reaction.content || "+"}</span>
    </div>
  );
}

/** Component to render a single zap */
function ZapItem({ zap }: { zap: Zap }) {
  const profile = use$(zap.sender.profile$);
  const displayName = profile?.displayName || zap.sender.npub;
  const picture = profile?.picture || `https://robohash.org/${zap.sender.pubkey}.png`;
  const amountSats = Math.round(zap.amount / 1000); // Convert msats to sats

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="avatar">
        <div className="w-6 rounded-full">
          <img src={picture} alt={displayName} />
        </div>
      </div>
      <span className="font-medium">{displayName}</span>
      <span className="text-primary">⚡ {amountSats} sats</span>
    </div>
  );
}

// Optional signer for posting comments
const signer$ = new BehaviorSubject<ISigner | null>(null);

/** Posts a NIP-22 comment on the torrent with the CreateComment action */
function CommentBox({ torrent, relay }: { torrent: Torrent; relay: string }) {
  const signer = use$(signer$);
  const [showLogin, setShowLogin] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Publish to the user's outboxes and the parent author's inboxes, plus the relay this feed reads from
  const actions = useMemo(
    () =>
      signer &&
      new ActionRunner(eventStore, signer, async (event, relays) => {
        await pool.publish(relaySet(relays ?? [], [relay]), event);
      }),
    [signer, relay],
  );

  if (!actions) {
    if (showLogin) return <LoginView onLogin={(next) => signer$.next(next)} />;
    return (
      <button className="btn btn-sm btn-outline" onClick={() => setShowLogin(true)}>
        Log in to comment
      </button>
    );
  }

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await actions.run(CreateComment, torrent.event, text.trim());
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="textarea w-full"
        rows={2}
        placeholder="Write a comment..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn btn-sm btn-primary self-end" disabled={posting || !text.trim()} onClick={post}>
        {posting ? "Posting..." : "Comment"}
      </button>
      {error && <div className="text-error text-sm">{error}</div>}
    </div>
  );
}

/** Component to render a single NIP-22 comment */
function CommentItem({ comment }: { comment: Comment }) {
  const profile = use$(comment.author.profile$);

  return (
    <div className="border-l-2 border-base-300 pl-3">
      <div className="flex items-center gap-2 text-sm mb-1">
        <span className="font-medium">{profile?.displayName || comment.author.npub}</span>
        <time className="text-base-content/60">{comment.createdAt.toLocaleString()}</time>
      </div>
      <p className="whitespace-pre-wrap">{comment.event.content}</p>
    </div>
  );
}

/** Component to render a single torrent with reactions and zaps */
function TorrentItem({ torrent }: { torrent: Torrent }) {
  const profile = use$(torrent.author.profile$);
  const reactions = use$(torrent.reactions$);
  const zaps = use$(torrent.zaps$);

  const displayName = profile?.displayName || torrent.author.npub;
  const picture = profile?.picture || `https://robohash.org/${torrent.author.pubkey}.png`;

  // load zaps and reactions
  use$(() => zapLoader(torrent.event), [torrent.id]);
  use$(() => reactionLoader(torrent.event), [torrent.id]);

  // Group reactions by emoji
  const reactionGroups = reactions?.reduce(
    (acc, reaction) => {
      const emoji = reaction.content || "+";
      if (!acc[emoji]) {
        acc[emoji] = [];
      }
      acc[emoji].push(reaction);
      return acc;
    },
    {} as Record<string, Reaction[]>,
  );

  const totalZapAmount = zaps?.reduce((sum, zap) => sum + zap.amount, 0) || 0;
  const totalZapSats = Math.round(totalZapAmount / 1000);

  return (
    <div
      className="border border-base-300 bg-base-100  cursor-pointer  "
      onClick={() => selectedTorrent$.next(torrent)}
    >
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img src={picture} alt={displayName} />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">{displayName}</h3>
            <p className="text-sm text-base-content/60">{torrent.author.npub}</p>
          </div>
          <time className="text-sm text-base-content/60">{torrent.createdAt.toLocaleString()}</time>
        </div>

        {/* Torrent Info */}
        <div className="mb-3">
          <h4 className="font-bold text-lg mb-2">{torrent.title || "Untitled Torrent"}</h4>
          <div className="space-y-1 text-sm">
            <div>
              <span className="font-medium">Info Hash: </span>
              <code className="text-sm bg-base-200 px-1 py-0.5 rounded">{torrent.infoHash}</code>
            </div>
            {torrent.category && (
              <div>
                <span className="font-medium">Category: </span>
                <span>{torrent.category}</span>
              </div>
            )}
            {torrent.categoryPath && (
              <div>
                <span className="font-medium">Category Path: </span>
                <span>{torrent.categoryPath}</span>
              </div>
            )}
            {torrent.files && torrent.files.length > 0 && (
              <div>
                <span className="font-medium">Files: </span>
                <span>{torrent.files.length}</span>
              </div>
            )}
            {torrent.trackers && torrent.trackers.length > 0 && (
              <div>
                <span className="font-medium">Trackers: </span>
                <span>{torrent.trackers.length}</span>
              </div>
            )}
            {torrent.magnetLink && (
              <div>
                <a
                  href={torrent.magnetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  Open Magnet Link
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Reactions */}
        {reactionGroups && Object.keys(reactionGroups).length > 0 && (
          <div className="mt-2 pt-2 border-t border-base-300/50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">👍</span>
              <span className="font-semibold">
                {reactions?.length || 0} reaction{reactions?.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(reactionGroups).map(([emoji, reactionList]) => (
                <div key={emoji} className="flex flex-col gap-1">
                  <div className="badge badge-outline">
                    {emoji} {reactionList.length}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {reactionList.slice(0, 5).map((reaction) => (
                      <ReactionItem key={reaction.uid} reaction={reaction} />
                    ))}
                    {reactionList.length > 5 && (
                      <span className="text-sm text-base-content/60">+{reactionList.length - 5} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zaps */}
        {zaps && zaps.length > 0 && (
          <div className="mt-2 pt-2 border-t border-base-300/50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">⚡</span>
              <span className="font-semibold">
                {zaps.length} zap{zaps.length !== 1 ? "s" : ""} • {totalZapSats} sats total
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {zaps.map((zap) => (
                <ZapItem key={zap.uid} zap={zap} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Component for the full torrent view */
function TorrentView({ torrent, relay, onBack }: { torrent: Torrent; relay: string; onBack: () => void }) {
  const profile = use$(torrent.author.profile$);
  const reactions = use$(torrent.reactions$);
  const zaps = use$(torrent.zaps$);
  const comments = use$(torrent.comments$);

  // Load NIP-22 comments that reply directly to this torrent
  use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [COMMENT_KIND], "#e": [torrent.id] })
        .pipe(mapEventsToStore(eventStore)),
    [relay, torrent.id],
  );

  const displayName = profile?.displayName || torrent.author.npub;
  const picture = profile?.picture || `https://robohash.org/${torrent.author.pubkey}.png`;

  // Group reactions by emoji
  const reactionGroups = reactions?.reduce(
    (acc, reaction) => {
      const emoji = reaction.content || "+";
      if (!acc[emoji]) {
        acc[emoji] = [];
      }
      acc[emoji].push(reaction);
      return acc;
    },
    {} as Record<string, Reaction[]>,
  );

  const totalZapAmount = zaps?.reduce((sum, zap) => sum + zap.amount, 0) || 0;
  const totalZapSats = Math.round(totalZapAmount / 1000);

  return (
    <div className="container mx-auto my-8 max-w-6xl px-4 w-full">
      <div className="py-4">
        <button className="btn btn-ghost gap-2 mb-4" onClick={onBack}>
          Back to Feed
        </button>

        <div className="border border-base-300 bg-base-100 ">
          <div className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="avatar">
                <div className="w-12 rounded-full">
                  <img src={picture} alt={displayName} />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{displayName}</h3>
                <p className="text-sm text-base-content/60">{torrent.author.npub}</p>
              </div>
              <time className="text-sm text-base-content/60">{torrent.createdAt.toLocaleString()}</time>
            </div>

            <h1 className="text-4xl font-bold mb-4">{torrent.title || "Untitled Torrent"}</h1>

            {/* Torrent Info */}
            <div className="mb-6 p-4 border border-base-300 rounded-box">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">Info Hash: </span>
                  <code className="text-sm bg-base-300 px-2 py-1 rounded">{torrent.infoHash}</code>
                </div>
                {torrent.category && (
                  <div>
                    <span className="font-medium">Category: </span>
                    <span>{torrent.category}</span>
                  </div>
                )}
                {torrent.categoryPathParts.length > 0 && (
                  <div>
                    <span className="font-medium">Category Path: </span>
                    <span>{torrent.categoryPathParts.join(" › ")}</span>
                  </div>
                )}
                {torrent.externalIdentifiers.length > 0 && (
                  <div>
                    <span className="font-medium">External IDs: </span>
                    <span>{torrent.externalIdentifiers.map((id) => id.identifier).join(", ")}</span>
                  </div>
                )}
                {torrent.searchTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {torrent.searchTags.map((tag) => (
                      <span key={tag} className="badge badge-outline">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {torrent.files && torrent.files.length > 0 && (
                  <div>
                    <span className="font-medium">Files: </span>
                    <span>{torrent.files.length}</span>
                    <ul className="list-disc list-inside mt-1 ml-4">
                      {torrent.files.slice(0, 10).map((file, idx) => (
                        <li key={idx} className="text-sm">
                          {file.name} ({file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "unknown size"})
                        </li>
                      ))}
                      {torrent.files.length > 10 && (
                        <li className="text-sm">... and {torrent.files.length - 10} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {torrent.trackers && torrent.trackers.length > 0 && (
                  <div>
                    <span className="font-medium">Trackers: </span>
                    <span>{torrent.trackers.length}</span>
                    <ul className="list-disc list-inside mt-1 ml-4">
                      {torrent.trackers.slice(0, 5).map((tracker, idx) => (
                        <li key={idx} className="text-sm">
                          {tracker}
                        </li>
                      ))}
                      {torrent.trackers.length > 5 && (
                        <li className="text-sm">... and {torrent.trackers.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {torrent.magnetLink && (
                  <div className="mt-3">
                    <a
                      href={torrent.magnetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-sm"
                    >
                      Open Magnet Link
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Markdown Content */}
            {torrent.event.content && (
              <div className="prose prose-lg max-w-none mb-6">
                <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                  {torrent.event.content}
                </ReactMarkdown>
              </div>
            )}

            {/* Reactions */}
            {reactionGroups && Object.keys(reactionGroups).length > 0 && (
              <div className="mt-6 pt-6 border-t border-base-300/50">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">👍</span>
                  <span className="font-semibold">
                    {reactions?.length || 0} reaction{reactions?.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(reactionGroups).map(([emoji, reactionList]) => (
                    <div key={emoji} className="flex flex-col gap-1">
                      <div className="badge badge-outline">
                        {emoji} {reactionList.length}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reactionList.slice(0, 5).map((reaction) => (
                          <ReactionItem key={reaction.uid} reaction={reaction} />
                        ))}
                        {reactionList.length > 5 && (
                          <span className="text-sm text-base-content/60">+{reactionList.length - 5} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Zaps */}
            {zaps && zaps.length > 0 && (
              <div className="mt-6 pt-6 border-t border-base-300/50">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">⚡</span>
                  <span className="font-semibold">
                    {zaps.length} zap{zaps.length !== 1 ? "s" : ""} • {totalZapSats} sats total
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {zaps.map((zap) => (
                    <ZapItem key={zap.uid} zap={zap} />
                  ))}
                </div>
              </div>
            )}

            {/* NIP-22 Comments */}
            <div className="mt-6 pt-6 border-t border-base-300/50">
              <h2 className="font-semibold mb-3">Comments ({comments?.length ?? 0})</h2>
              <CommentBox torrent={torrent} relay={relay} />
              <div className="flex flex-col gap-3 mt-4">
                {comments?.map((comment) => (
                  <CommentItem key={comment.id} comment={comment} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TorrentFeed() {
  const [relay, setRelay] = useState("wss://relay.primal.net/");

  const selectedTorrent = use$(selectedTorrent$);

  const feed$ = useMemo(
    () =>
      relayTimeline(eventStore, pool, [relay], { kinds: [TORRENT_KIND] }).pipe(
        shareReplay({ bufferSize: 1, refCount: true }),
      ),
    [relay],
  );
  const feed = use$(feed$);
  const torrents = use$(
    () =>
      feed$.pipe(
        map((state) => state.events),
        castTimelineStream(Torrent, eventStore),
      ),
    [feed$],
  );

  if (selectedTorrent) {
    return <TorrentView torrent={selectedTorrent} relay={relay} onBack={() => selectedTorrent$.next(null)} />;
  }

  return (
    <div className="max-w-6xl w-full mx-auto my-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4">Torrent Feed</h1>
        <p className="text-base-content/60 mb-4">
          A social feed of BitTorrent torrents (NIP-35) with reactions and zaps
        </p>
        {feed?.status === "loading" && <p role="status">Loading…</p>}
        {feed?.errors.map((error) => (
          <p key={error} role="alert" className="text-error">
            {error}
          </p>
        ))}
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="flex flex-col gap-4">
        {torrents === undefined ? (
          <div className="flex justify-center my-8">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : torrents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-base-content/60">No torrents found. Try a different relay.</p>
          </div>
        ) : (
          torrents.map((torrent) => <TorrentItem key={torrent.id} torrent={torrent} />)
        )}
      </div>
    </div>
  );
}
