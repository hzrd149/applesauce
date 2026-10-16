/**
 * Publish an expiring music status while playing local audio files
 * @tags user-status, music, expiration, actions
 * @related user-status/manager, user-status/explorer
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { ClearUserStatus, SetUserStatus } from "applesauce-actions/actions";
import { castUser, User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { useEffect, useRef, useState } from "react";
import { BehaviorSubject, map } from "rxjs";

import LoginView from "../../components/login-view";

const DEFAULT_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

const actions = new ActionRunner(eventStore, new ProxySigner(signer$), async (event, relays) => {
  await pool.publish(relays?.length ? relays : DEFAULT_RELAYS, event);
});

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
  const [now, setNow] = useState(unixNow());

  useEffect(() => {
    const id = setInterval(() => setNow(unixNow()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border border-base-300 p-3">
      <div className="text-xs uppercase opacity-50">Published music status</div>
      {status ? (
        <div>
          🎵 {status.content}
          {status.expiration && (
            <span className="ml-2 text-xs opacity-50">expires in {Math.max(0, status.expiration - now)}s</span>
          )}
        </div>
      ) : (
        <div className="text-sm opacity-50">Nothing playing</div>
      )}
    </div>
  );
}

function Player({ user }: { user: User }) {
  const audio = useRef<HTMLAudioElement>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout>>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState(0);
  const track = tracks[current];

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

  const onPlay = () => track && audio.current && publishPlaying(track, audio.current);
  const onPause = () => audio.current && !audio.current.ended && actions.run(ClearUserStatus, "music");
  const onEnded = () => {
    if (current < tracks.length - 1) setCurrent(current + 1);
    else actions.run(ClearUserStatus, "music");
  };

  // Debounce seeking so scrubbing doesn't publish an event for every position
  const onSeeked = () => {
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      if (track && audio.current && !audio.current.paused) publishPlaying(track, audio.current);
    }, 1000);
  };

  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Now Playing</h1>
      <PublishedStatus user={user} />

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
        {tracks.length === 0 && <div className="p-3 text-sm opacity-50">Add some audio files to start</div>}
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
    </div>
  );
}

export default function App() {
  const signer = use$(signer$);
  const user = use$(user$);

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  return <Player user={user} />;
}
