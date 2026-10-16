/**
 * Manage your published NIP-35 torrents: edit them with TorrentFactory.modify and delete old versions with NIP-09
 * @tags nip-35, nip-09, torrent, factory, modify, delete, actions
 * @related torrent/publisher, torrent/feed, torrent/search, simple/event-deletion
 */
import { Action, ActionRunner } from "applesauce-actions";
import { castUser, Torrent, User } from "applesauce-common/casts";
import { TorrentFactory } from "applesauce-common/factories";
import { TORRENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { DeleteFactory } from "applesauce-core/factories";
import { getDisplayName, getProfilePicture, kinds, type NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { type FormEvent, useState } from "react";
import { BehaviorSubject, ignoreElements, map, merge, switchMap } from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

/** Publishes action events to the relays the action picked, falling back when there are none */
async function publish(event: NostrEvent, relays?: string[]) {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error(responses[0]?.message ?? "No relay accepted the event");
}

// The signed in user and an action runner for their signer
const account$ = new BehaviorSubject<{ user: User; actions: ActionRunner } | undefined>(undefined);

function login(signer: ISigner, pubkey: string) {
  // Actions save their events to the store, so edits and deletions show up in the list immediately
  account$.next({ user: castUser(pubkey, eventStore), actions: new ActionRunner(eventStore, signer, publish) });
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  account$.next(undefined);
}

/** Subscribes to the user's torrents and deletions on their outboxes and returns their torrents */
function userTorrents(user: User) {
  const load$ = user.outboxes$.pipe(
    map((outboxes) => (outboxes?.length ? outboxes : FALLBACK_RELAYS)),
    switchMap((relays) =>
      pool.subscription(relays, [
        { kinds: [TORRENT_KIND], authors: [user.pubkey] },
        // Load deletions too, so torrents the user already deleted stay hidden
        { kinds: [kinds.EventDeletion], authors: [user.pubkey], "#k": [String(TORRENT_KIND)] },
      ]),
    ),
    mapEventsToStore(eventStore),
    ignoreElements(),
  );

  const torrents$ = eventStore
    .timeline({ kinds: [TORRENT_KIND], authors: [user.pubkey] })
    .pipe(castTimelineStream(Torrent, eventStore));

  return merge(load$, torrents$);
}

type Edit = { title: string; content: string; categoryPath: string; trackers: string[]; tags: string[] };

/** An action that republishes an edited torrent and deletes the old version */
function EditTorrent(torrent: Torrent, edit: Edit): Action {
  return async ({ user, signer, publish }) => {
    let factory = TorrentFactory.modify(torrent.event).content(edit.content);
    if (edit.title) factory = factory.title(edit.title);
    factory = edit.categoryPath ? factory.categoryPath(edit.categoryPath) : factory.clearCategoryPath();

    // The list builder methods only add, so apply the difference
    for (const url of torrent.trackers) if (!edit.trackers.includes(url)) factory = factory.removeTracker(url);
    for (const url of edit.trackers) if (!torrent.trackers.includes(url)) factory = factory.addTracker(url);
    for (const tag of torrent.searchTags) if (!edit.tags.includes(tag)) factory = factory.removeSearchTag(tag);
    for (const tag of edit.tags) if (!torrent.searchTags.includes(tag)) factory = factory.addSearchTag(tag);

    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(await factory.sign(signer), outboxes);

    // Torrents are regular events, so the old version stays unless it is deleted
    const deletion = DeleteFactory.fromEvents([torrent.event], "Replaced by an edited torrent");
    await publish(await deletion.sign(signer), outboxes);
  };
}

/** An action that requests deletion of a torrent */
function DeleteTorrent(torrent: Torrent): Action {
  return async ({ user, signer, publish }) => {
    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(await DeleteFactory.fromEvents([torrent.event]).sign(signer), outboxes);
  };
}

const lines = (value: string) =>
  value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

function Editor({ torrent, actions }: { torrent: Torrent; actions: ActionRunner }) {
  const [title, setTitle] = useState(torrent.title ?? "");
  const [content, setContent] = useState(torrent.event.content);
  const [categoryPath, setCategoryPath] = useState(torrent.categoryPath ?? "");
  const [trackers, setTrackers] = useState(torrent.trackers.join("\n"));
  const [tags, setTags] = useState(torrent.searchTags.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const edit = { title, content, categoryPath, trackers: lines(trackers), tags: lines(tags) };
    run(actions.run(EditTorrent, torrent, edit));
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2 p-4">
      <h2 className="text-lg font-semibold">{torrent.title || "Untitled torrent"}</h2>
      <a href={torrent.magnetLink} className="truncate font-mono text-sm opacity-60">
        {torrent.infoHash}
      </a>

      <label className="label">Title</label>
      <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="label">Description</label>
      <textarea className="textarea w-full" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
      <label className="label">Category path</label>
      <input
        className="input w-full"
        placeholder="video,movie,4k"
        value={categoryPath}
        onChange={(e) => setCategoryPath(e.target.value)}
      />
      <label className="label">Search tags</label>
      <input className="input w-full" placeholder="movie, 4k" value={tags} onChange={(e) => setTags(e.target.value)} />
      <label className="label">Trackers (one per line)</label>
      <textarea
        className="textarea w-full font-mono text-sm"
        rows={4}
        value={trackers}
        onChange={(e) => setTrackers(e.target.value)}
      />

      <h3 className="mt-2 font-semibold">Files ({torrent.files.length})</h3>
      <ul className="max-h-40 overflow-y-auto border border-base-300 p-2 font-mono text-sm">
        {torrent.files.map((file) => (
          <li key={file.name} className="truncate">
            {file.name}
          </li>
        ))}
      </ul>

      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>
          Save and delete old version
        </button>
        <button
          type="button"
          className="btn btn-error btn-outline"
          disabled={busy}
          onClick={() => run(actions.run(DeleteTorrent, torrent))}
        >
          Delete
        </button>
      </div>
    </form>
  );
}

function Account({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <img
        src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
        className="h-8 w-8 shrink-0 rounded-full"
      />
      <span className="min-w-0 flex-1 truncate">{getDisplayName(profile, user.npub.slice(0, 12))}</span>
      <button className="btn btn-sm btn-ghost" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function TorrentManager({ user, actions }: { user: User; actions: ActionRunner }) {
  const torrents = use$(() => userTorrents(user), [user]);
  const [selected, setSelected] = useState<string>();
  const torrent = torrents?.find((t) => t.id === selected);

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {torrents?.length === 0 && <p className="p-4 text-sm opacity-60">No torrents published yet</p>}
          {torrents?.map((t) => (
            <button
              key={t.id}
              className={`border-b border-s-2 border-b-base-300 px-3 py-2 text-left ${t.id === selected ? "border-s-primary bg-base-200" : "border-s-transparent"}`}
              onClick={() => setSelected(t.id)}
            >
              <div className="truncate font-semibold">{t.title || "Untitled torrent"}</div>
              <div className="text-sm opacity-60">
                {t.files.length} files · {t.createdAt.toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
        <Account user={user} />
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {/* Saving or deleting removes the torrent from the list, which closes the editor */}
        {torrent ? (
          <Editor key={torrent.id} torrent={torrent} actions={actions} />
        ) : (
          <p className="p-8 text-center opacity-60">Select a torrent to edit</p>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const account = use$(account$);

  if (!account) return <LoginView onLogin={login} />;
  return <TorrentManager key={account.user.pubkey} {...account} />;
}
