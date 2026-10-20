/**
 * Browse torrents from a set of relays with their metadata, reactions, zaps and NIP-22 comments
 * @tags nip-35, nip-22, torrent, feed, files, comments
 * @related torrent/publisher, torrent/search, torrent/manager, comment/feed
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { CreateComment } from "applesauce-actions/actions";
import { type Comment, type Reaction, Torrent, type User, type Zap } from "applesauce-common/casts";
import { COMMENT_KIND, TORRENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { combineLatestByValue, defined, EventStore, mapEventsToStore } from "applesauce-core";
import { getSeenRelays, isSafeRelayURL, normalizeURL, relaySet } from "applesauce-core/helpers";
import { createEventLoaderForStore, createReactionsLoader, createZapsLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BehaviorSubject, catchError, filter, map, of, startWith } from "rxjs";

import LoginView from "../../components/login-view";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

// Torrents are spread across many relays, so the feed reads from a set of them instead of a single one.
// Shared with the publish method so comments reach the same relays
const relays$ = new BehaviorSubject(["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"]);

// The signed in account, only needed for commenting
const signer$ = new BehaviorSubject<ISigner | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const zapLoader = createZapsLoader(pool, { eventStore });
const reactionLoader = createReactionsLoader(pool, { eventStore });

// Comments publish to the action's relays (outboxes and the torrent author's inboxes) plus the feed relays
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  await publishEvent(pool, relaySet(relays, relays$.value), event);
});

type RelayStatus = { url: string; loading: boolean; error?: string };

/** Subscribes to torrents on one relay and reports when it has sent its stored events */
function loadTorrents(url: string) {
  return pool
    .relay(url)
    .subscription({ kinds: [TORRENT_KIND], limit: 100 })
    .pipe(
      mapEventsToStore(eventStore),
      filter((message) => message === "EOSE"),
      map((): RelayStatus => ({ url, loading: false })),
      startWith<RelayStatus>({ url, loading: true }),
      // A failing relay only ends its own subscription
      catchError((err) =>
        of<RelayStatus>({ url, loading: false, error: err instanceof Error ? err.message : String(err) }),
      ),
    );
}

// One subscription per relay, so adding or removing a relay leaves the others open
const statuses$ = relays$.pipe(
  combineLatestByValue(loadTorrents),
  map((statuses) => [...statuses.values()]),
);

/** Parses a relay URL or bare hostname, returning undefined when it isn't a safe websocket URL */
function parseRelay(input: string) {
  const value = input.trim();
  if (!value) return undefined;
  try {
    const url = normalizeURL(value.includes("://") ? value : `wss://${value}`);
    return isSafeRelayURL(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

const remarkPlugins = [remarkGfm, remarkNostrMentions];
const markdownComponents = {
  h1: (props: any) => <h1 className="my-4 text-2xl font-bold" {...props} />,
  h2: (props: any) => <h2 className="my-3 text-xl font-bold" {...props} />,
  h3: (props: any) => <h3 className="my-2 text-lg font-bold" {...props} />,
  p: (props: any) => <p className="my-2" {...props} />,
  a: (props: any) => <a className="link link-primary" target="_blank" {...props} />,
  ul: (props: any) => <ul className="my-2 ms-4 list-disc" {...props} />,
  ol: (props: any) => <ol className="my-2 ms-4 list-decimal" {...props} />,
  code: (props: any) => <code className="bg-base-200 px-1" {...props} />,
  pre: (props: any) => <pre className="my-2 overflow-x-auto border border-base-300 p-4" {...props} />,
  table: (props: any) => <table className="table my-4" {...props} />,
};

/** Formats a byte count as a short human readable size */
function formatSize(bytes?: number) {
  if (bytes === undefined) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function UserName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="truncate font-semibold">{profile?.displayName || user.npub.slice(0, 12)}</span>;
}

function Avatar({ user, size = "size-8" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
      alt=""
      className={`${size} shrink-0 rounded-full object-cover`}
    />
  );
}

/** Reaction counts grouped by emoji */
function ReactionSummary({ reactions }: { reactions?: Reaction[] }) {
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const reaction of reactions ?? []) {
      const emoji = reaction.content || "+";
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [reactions]);

  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map(([emoji, count]) => (
        <span key={emoji} className="badge badge-outline tabular-nums">
          {emoji} {count}
        </span>
      ))}
    </div>
  );
}

/** Total sats zapped and the number of zaps */
function ZapSummary({ zaps }: { zaps?: Zap[] }) {
  if (!zaps?.length) return null;
  const sats = Math.round(zaps.reduce((sum, zap) => sum + zap.amount, 0) / 1000);
  return (
    <span className="badge badge-outline tabular-nums">
      ⚡ {sats} sats · {zaps.length} {zaps.length === 1 ? "zap" : "zaps"}
    </span>
  );
}

function TorrentRow({ torrent, selected, onSelect }: { torrent: Torrent; selected: boolean; onSelect: () => void }) {
  const reactions = use$(torrent.reactions$);
  const zaps = use$(torrent.zaps$);

  // Load zaps and reactions for each visible torrent
  use$(() => zapLoader(torrent.event), [torrent.id]);
  use$(() => reactionLoader(torrent.event), [torrent.id]);

  return (
    <button
      className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-base-200 ${selected ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <span className="font-semibold">{torrent.title || "Untitled torrent"}</span>
      <span className="flex items-center gap-2 text-sm text-base-content/60">
        <UserName user={torrent.author} /> · {torrent.files.length} files · {torrent.createdAt.toLocaleDateString()}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <ReactionSummary reactions={reactions} />
        <ZapSummary zaps={zaps} />
      </span>
    </button>
  );
}

/** Posts a NIP-22 comment on the torrent with the CreateComment action */
function CommentBox({ torrent, onSignIn }: { torrent: Torrent; onSignIn: () => void }) {
  const signer = use$(signer$);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signer)
    return (
      <button className="btn btn-sm btn-outline self-start" onClick={onSignIn}>
        Sign in to comment
      </button>
    );

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      await actions.run(CreateComment, torrent.event, text.trim());
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        {posting ? <span className="loading loading-spinner loading-sm" /> : "Comment"}
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="flex flex-col gap-1 border-s-2 border-base-300 ps-3">
      <div className="flex items-center gap-2 text-sm">
        <UserName user={comment.author} />
        <time className="text-base-content/60">{comment.createdAt.toLocaleString()}</time>
      </div>
      <p className="whitespace-pre-wrap">{comment.event.content}</p>
    </div>
  );
}

function TorrentDetail({ torrent, onSignIn }: { torrent: Torrent; onSignIn: () => void }) {
  const relays = use$(relays$);
  const reactions = use$(torrent.reactions$);
  const zaps = use$(torrent.zaps$);
  const comments = use$(torrent.comments$);

  // Load NIP-22 comments from the feed relays and every relay the torrent was seen on
  use$(
    () =>
      pool
        .subscription(relaySet(relays, getSeenRelays(torrent.event)), { kinds: [COMMENT_KIND], "#e": [torrent.id] })
        .pipe(mapEventsToStore(eventStore)),
    [relays, torrent.id],
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-3">
        <Avatar user={torrent.author} size="size-10" />
        <div className="flex min-w-0 flex-1 flex-col">
          <UserName user={torrent.author} />
          <time className="text-sm text-base-content/60">{torrent.createdAt.toLocaleString()}</time>
        </div>
        {torrent.magnetLink && (
          <a className="btn btn-primary btn-sm" href={torrent.magnetLink}>
            Open magnet link
          </a>
        )}
      </div>

      <h1 className="text-2xl font-bold">{torrent.title || "Untitled torrent"}</h1>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-base-content/60">Info hash</dt>
        <dd className="truncate font-mono">{torrent.infoHash}</dd>
        {torrent.categoryPathParts.length > 0 && (
          <>
            <dt className="text-base-content/60">Category</dt>
            <dd>{torrent.categoryPathParts.join(" › ")}</dd>
          </>
        )}
        {torrent.externalIdentifiers.length > 0 && (
          <>
            <dt className="text-base-content/60">External IDs</dt>
            <dd>{torrent.externalIdentifiers.map((id) => id.identifier).join(", ")}</dd>
          </>
        )}
        {torrent.searchTags.length > 0 && (
          <>
            <dt className="text-base-content/60">Tags</dt>
            <dd>{torrent.searchTags.map((tag) => `#${tag}`).join(" ")}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-1">
        <ReactionSummary reactions={reactions} />
        <ZapSummary zaps={zaps} />
      </div>

      {torrent.event.content && (
        <div className="max-w-none">
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {torrent.event.content}
          </ReactMarkdown>
        </div>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Files ({torrent.files.length})</h2>
        <ul className="max-h-64 divide-y divide-base-300 overflow-y-auto border border-base-300 text-sm">
          {torrent.files.map((file) => (
            <li key={file.name} className="flex justify-between gap-4 px-3 py-1">
              <span className="truncate font-mono">{file.name}</span>
              <span className="shrink-0 tabular-nums text-base-content/60">{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      </section>

      {torrent.trackers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">Trackers ({torrent.trackers.length})</h2>
          {torrent.trackers.map((tracker) => (
            <p key={tracker} className="truncate font-mono text-sm">
              {tracker}
            </p>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3 border-t border-base-300 pt-4">
        <h2 className="font-semibold">Comments ({comments?.length ?? 0})</h2>
        <CommentBox torrent={torrent} onSignIn={onSignIn} />
        {comments?.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </section>
    </div>
  );
}

/** The relays the feed reads from, as removable chips with an input to add more */
function RelayList({ relays }: { relays: string[] }) {
  const [input, setInput] = useState("");
  const url = parseRelay(input);

  const add = () => {
    if (!url) return;
    if (!relays.includes(url)) relays$.next([...relays, url]);
    setInput("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {relays.map((relay) => (
        <button
          key={relay}
          className="badge badge-outline gap-1 font-mono"
          onClick={() => relays$.next(relays.filter((r) => r !== relay))}
        >
          {new URL(relay).host} ✕
        </button>
      ))}
      <div className="join">
        <input
          className={`input input-sm join-item w-48 ${input && !url ? "input-error" : ""}`}
          placeholder="relay.example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-sm join-item" disabled={!url} onClick={add}>
          Add relay
        </button>
      </div>
    </div>
  );
}

export default function TorrentFeed() {
  const relays = use$(relays$);
  const signer = use$(signer$);
  const [selected, setSelected] = useState<string | null>(null);
  const login = useRef<HTMLDialogElement>(null);

  // Subscribe to the relays and render every torrent in the store
  const statuses = use$(statuses$);
  const torrents = use$(
    () => eventStore.timeline({ kinds: [TORRENT_KIND] }).pipe(castTimelineStream(Torrent, eventStore)),
    [],
  );
  const torrent = torrents?.find((t) => t.id === selected);
  const loading = !statuses || statuses.some((s) => s.loading);

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
        <RelayList relays={relays} />
        {loading && <span className="loading loading-spinner loading-sm" />}
        <span className="ms-auto text-sm text-base-content/60">{torrents?.length ?? 0} torrents</span>
        {signer ? (
          <button className="btn btn-sm btn-ghost" onClick={() => signer$.next(null)}>
            Sign out
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => login.current?.showModal()}>
            Sign in
          </button>
        )}
      </div>
      {statuses?.map(
        (s) =>
          s.error && (
            <p key={s.url} className="border-b border-base-300 px-3 py-1 text-sm text-error">
              {new URL(s.url).host}: {s.error}
            </p>
          ),
      )}

      <div className="flex min-h-0 grow">
        <aside className="w-96 shrink-0 divide-y divide-base-300 overflow-y-auto border-e border-base-300">
          {torrents?.length ? (
            torrents.map((t) => (
              <TorrentRow key={t.id} torrent={t} selected={t.id === selected} onSelect={() => setSelected(t.id)} />
            ))
          ) : (
            <p className="p-8 text-center text-base-content/60">
              {loading ? "Loading torrents…" : "No torrents found. Try adding another relay."}
            </p>
          )}
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {torrent ? (
            <TorrentDetail key={torrent.id} torrent={torrent} onSignIn={() => login.current?.showModal()} />
          ) : (
            <p className="p-8 text-center text-base-content/60">Select a torrent to see its files and comments.</p>
          )}
        </main>
      </div>

      <dialog className="modal" ref={login}>
        <div className="modal-box">
          <LoginView
            onLogin={(next) => {
              signer$.next(next);
              login.current?.close();
            }}
          />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
