/**
 * Publish an expiring music status while playing local audio files and see what your contacts are listening to
 * @tags user-status, music, expiration, actions, nip-65, contacts
 * @related user-status/manager, user-status/explorer
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { ClearUserStatus, SetUserStatus } from "applesauce-actions/actions";
import { castUser, User, UserStatus } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import {
  EventStore,
  filterOptimalRelays,
  includeFallbackRelays,
  includeMailboxes,
  mapEventsToStore,
} from "applesauce-core";
import { createOutboxMap, getDisplayName, getProfilePicture, kinds, unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { useRef, useState } from "react";
import { BehaviorSubject, debounceTime, ignoreElements, map, merge, share, switchMap, timer } from "rxjs";

import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Publish to the user's outboxes, falling back when there are none
const actions = new ActionRunner(eventStore, new ProxySigner(signer$), async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error(responses[0]?.message ?? "No relay accepted the status");
});

// A shared clock for the expiration countdown
const now$ = timer(0, 1000).pipe(
  map(() => unixNow()),
  share(),
);

/** Loads the contacts' music statuses from their outboxes and renders the ones that have not expired */
function contactsListening(user: User) {
  const outboxMap$ = user.contacts$.pipe(
    map((contacts) => contacts.map((c) => ({ pubkey: c.pubkey }))),
    // Add each contact's NIP-65 outboxes as their relay lists load
    includeMailboxes(eventStore),
    includeFallbackRelays(FALLBACK_RELAYS),
    // Relay lists arrive one by one, wait for them to settle before re-picking relays
    debounceTime(500),
    filterOptimalRelays(20, 3),
    map(createOutboxMap),
  );

  const load$ = pool
    .outboxSubscription(outboxMap$, { kinds: [kinds.UserStatuses], "#d": ["music"] })
    .pipe(mapEventsToStore(eventStore), ignoreElements());

  // The store removes statuses when they expire, so the list only shows what is playing now
  const listening$ = user.contacts$.pipe(
    switchMap((contacts) =>
      eventStore.timeline({ kinds: [kinds.UserStatuses], "#d": ["music"], authors: contacts.map((c) => c.pubkey) }),
    ),
    castTimelineStream(UserStatus, eventStore),
    map((statuses) => statuses.filter((s) => !s.cleared)),
  );

  return merge(load$, listening$);
}

type Track = { url: string; title: string; link: string };

/** Publishes the music status, expiring when the track stops playing */
function publishPlaying(track: Track, audio: HTMLAudioElement) {
  const remaining = Math.ceil(audio.duration - audio.currentTime);
  return actions.run(SetUserStatus, track.title, {
    type: "music",
    expiration: unixNow() + remaining,
    link: track.link || undefined,
  });
}

/** The music status as other clients see it, removed from the store when it expires */
function PublishedStatus({ user }: { user: User }) {
  const status = use$(() => user.statuses$.pipe(map((all) => all.find((s) => s.type === "music"))), [user]);
  const now = use$(now$) ?? unixNow();

  return (
    <div className="border border-base-300 p-3">
      <div className="text-sm opacity-60">Published music status</div>
      {status ? (
        <div>
          🎵 {status.content}
          {status.expiration && (
            <span className="ml-2 text-sm opacity-60">expires in {Math.max(0, status.expiration - now)}s</span>
          )}
        </div>
      ) : (
        <div className="opacity-60">Nothing playing</div>
      )}
    </div>
  );
}

function ListeningRow({ status }: { status: UserStatus }) {
  const profile = use$(status.author.profile$);

  return (
    <div className="flex items-center gap-3 border-b border-base-300 p-2 last:border-b-0">
      <img
        src={getProfilePicture(profile, `https://robohash.org/${status.author.pubkey}.png`)}
        className="h-8 w-8 shrink-0 rounded-full"
      />
      <span className="shrink-0 font-medium">{getDisplayName(profile, status.author.pubkey.slice(0, 8))}</span>
      {status.url ? (
        <a href={status.url} target="_blank" className="link truncate">
          🎵 {status.content}
        </a>
      ) : (
        <span className="truncate">🎵 {status.content}</span>
      )}
    </div>
  );
}

function ContactsListening({ user }: { user: User }) {
  const contacts = use$(user.contacts$);
  const listening = use$(() => contactsListening(user), [user]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Contacts listening now</h2>
      <div className="flex flex-col border border-base-300">
        {!contacts?.length && <div className="p-3 text-sm opacity-60">Waiting for a contact list...</div>}
        {!!contacts?.length && listening?.length === 0 && (
          <div className="p-3 text-sm opacity-60">None of your {contacts.length} contacts are listening to music</div>
        )}
        {listening?.map((status) => (
          <ListeningRow key={status.id} status={status} />
        ))}
      </div>
    </div>
  );
}

function Player({ user }: { user: User }) {
  const audio = useRef<HTMLAudioElement>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string>();
  const track = tracks[current];

  const run = (work: Promise<void>) => {
    setError(undefined);
    work.catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files).map((file) => ({
      url: URL.createObjectURL(file),
      title: file.name.replace(/\.[^.]+$/, ""),
      link: "",
    }));
    setTracks((list) => [...list, ...added]);
  };

  const updateTrack = (index: number, patch: Partial<Track>) =>
    setTracks((list) => list.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const onPlay = () => track && audio.current && run(publishPlaying(track, audio.current));
  const onPause = () => audio.current && !audio.current.ended && run(actions.run(ClearUserStatus, "music"));
  const onEnded = () => {
    if (current < tracks.length - 1) setCurrent(current + 1);
    else run(actions.run(ClearUserStatus, "music"));
  };

  // Debounce seeking so scrubbing doesn't publish an event for every position
  const onSeeked = () => {
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      if (track && audio.current && !audio.current.paused) run(publishPlaying(track, audio.current));
    }, 1000);
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-4">
        <PublishedStatus user={user} />
        {error && <div className="text-sm text-error">{error}</div>}

        <audio
          ref={audio}
          src={track?.url}
          controls
          autoPlay
          className="w-full"
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
          onSeeked={onSeeked}
        />

        <input
          type="file"
          accept="audio/*"
          multiple
          className="file-input file-input-bordered w-full"
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="flex flex-col border border-base-300">
          {tracks.length === 0 && <div className="p-3 text-sm opacity-60">Add some audio files to start</div>}
          {tracks.map((t, i) => (
            <div key={t.url} className="flex items-center gap-2 border-b border-base-300 p-2 last:border-b-0">
              <button className="btn btn-ghost btn-sm w-10" onClick={() => setCurrent(i)}>
                {i === current ? "▶" : i + 1}
              </button>
              <input
                className="input input-bordered input-sm flex-1"
                value={t.title}
                placeholder="Artist - Title"
                onChange={(e) => updateTrack(i, { title: e.target.value })}
              />
              <input
                className="input input-bordered input-sm w-48"
                value={t.link}
                placeholder="Link (optional)"
                onChange={(e) => updateTrack(i, { link: e.target.value })}
              />
            </div>
          ))}
        </div>

        <ContactsListening user={user} />
      </div>
    </div>
  );
}

export default function App() {
  const signer = use$(signer$);
  const user = use$(user$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  return <Player user={user} />;
}
