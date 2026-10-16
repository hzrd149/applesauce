/**
 * Set, clear, and display user statuses with links, custom emojis, and expiration
 * @tags user-status, actions, casts, emojis, expiration
 * @related user-status/timeline, user-status/now-playing, user-status/explorer
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { ClearUserStatus, SetUserStatus } from "applesauce-actions/actions";
import { castUser, EmojiPack, User, UserStatus } from "applesauce-common/casts";
import type { Emoji, UserStatusPointer } from "applesauce-common/helpers";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, kinds, unixNow } from "applesauce-core/helpers";
import { decodeAddressPointer, decodeEventPointer, decodeProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, combineLatest, ignoreElements, map, merge, of, share, switchMap, timer } from "rxjs";

import LoginView from "../../components/login-view";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const DURATIONS: Record<string, number | undefined> = {
  Never: undefined,
  "1 minute": 60,
  "30 minutes": 60 * 30,
  "1 hour": 60 * 60,
  "1 day": 60 * 60 * 24,
};

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Publish to the relays the action picked (the user's outboxes), falling back when there are none
const actions = new ActionRunner(eventStore, new ProxySigner(signer$), async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error(responses[0]?.message ?? "No relay accepted the status");
});

// A shared clock for expiration countdowns
const now$ = timer(0, 1000).pipe(
  map(() => unixNow()),
  share(),
);

/** Loads the statuses of a user and everyone they follow into the store */
function loadStatuses(user: User) {
  return combineLatest([user.contacts$, user.outboxes$]).pipe(
    switchMap(([contacts, outboxes]) =>
      pool.subscription([...FALLBACK_RELAYS, ...(outboxes ?? [])], {
        kinds: [kinds.UserStatuses],
        authors: [user.pubkey, ...contacts.map((c) => c.pubkey)],
      }),
    ),
    mapEventsToStore(eventStore),
    ignoreElements(),
  );
}

/** Parses a URL or a nostr: / bech32 string into a status link */
function parseLink(input: string): string | UserStatusPointer | undefined {
  const value = input.trim().replace(/^nostr:/, "");
  if (!value) return undefined;

  const address = decodeAddressPointer(value);
  if (address) return { type: "naddr", data: address };
  const event = decodeEventPointer(value);
  if (event) return { type: "nevent", data: event };
  const profile = decodeProfilePointer(value);
  if (profile) return { type: "nprofile", data: profile };

  return value;
}

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="inline h-5 w-5 align-text-bottom" />,
};

const TYPE_ICONS: Record<string, string> = { general: "💬", music: "🎵" };

function LinkedUser({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="text-sm text-primary">@{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>;
}

function Expiration({ expiration }: { expiration: number }) {
  const now = use$(now$) ?? unixNow();
  return <span className="text-sm opacity-60">Expires in {Math.max(0, expiration - now)}s</span>;
}

function StatusLine({ status }: { status: UserStatus }) {
  const content = useRenderedContent(status.event, components);
  const linked = use$(status.linkedEvent$);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div>
        {TYPE_ICONS[status.type] ?? "🏷️"} {content}
      </div>
      {status.url && (
        <a href={status.url} target="_blank" className="link truncate text-sm">
          {status.url}
        </a>
      )}
      {status.user && <LinkedUser user={status.user} />}
      {linked && <div className="truncate border-l-2 border-base-300 pl-2 text-sm opacity-60">{linked.content}</div>}
      {status.expiration && <Expiration expiration={status.expiration} />}
    </div>
  );
}

function EmojiPicker({ user, onPick }: { user: User; onPick: (emoji: Emoji) => void }) {
  const favorites = use$(user.favoriteEmojis$);
  const packs = use$(() => favorites?.packs$ ?? of<EmojiPack[]>([]), [favorites]);
  const emojis = useMemo(
    () => [...(favorites?.emojis ?? []), ...(packs ?? []).flatMap((pack) => pack.emojis)].slice(0, 48),
    [favorites, packs],
  );

  if (emojis.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border border-base-300 p-2">
      {emojis.map((emoji) => (
        <button
          key={emoji.shortcode + emoji.url}
          type="button"
          className="btn btn-ghost btn-sm"
          title={`:${emoji.shortcode}:`}
          onClick={() => onPick(emoji)}
        >
          <img src={emoji.url} className="h-5 w-5" />
        </button>
      ))}
    </div>
  );
}

function StatusForm({ user }: { user: User }) {
  const [type, setType] = useState("general");
  const [customType, setCustomType] = useState("");
  const [content, setContent] = useState("");
  const [link, setLink] = useState("");
  const [duration, setDuration] = useState("Never");
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();

  const pickEmoji = (emoji: Emoji) => {
    setContent((c) => `${c}:${emoji.shortcode}:`);
    setEmojis((list) => [...list, emoji]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishing(true);
    setError(undefined);
    try {
      const seconds = DURATIONS[duration];
      await actions.run(SetUserStatus, content, {
        type: type === "custom" ? customType : type,
        link: parseLink(link),
        expiration: seconds ? unixNow() + seconds : undefined,
        emojis,
      });
      setContent("");
      setLink("");
      setEmojis([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish status");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border border-base-300 p-4">
      <div className="flex gap-2">
        <select className="select select-bordered" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="general">General</option>
          <option value="music">Music</option>
          <option value="custom">Custom</option>
        </select>
        {type === "custom" && (
          <input
            className="input input-bordered w-32"
            placeholder="type"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            required
          />
        )}
        <input
          className="input input-bordered flex-1"
          placeholder={type === "music" ? "Intergalatic - Beastie Boys" : "Working"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </div>
      <EmojiPicker user={user} onPick={pickEmoji} />
      <div className="flex gap-2">
        <input
          className="input input-bordered flex-1"
          placeholder="Link: URL, npub, nevent, or naddr (optional)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <select className="select select-bordered" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {Object.keys(DURATIONS).map((label) => (
            <option key={label} value={label}>
              Expires: {label}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="text-sm text-error">{error}</div>}
      <button className="btn btn-primary" disabled={publishing}>
        {publishing ? "Publishing..." : "Set status"}
      </button>
    </form>
  );
}

function MyStatusRow({ status }: { status: UserStatus }) {
  const [error, setError] = useState<string>();

  const clear = () =>
    actions
      .run(ClearUserStatus, status.type)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  return (
    <div className="flex items-start justify-between gap-2 border-b border-base-300 p-3 last:border-b-0">
      <StatusLine status={status} />
      <div className="flex flex-col items-end gap-1">
        <button className="btn btn-ghost btn-sm" onClick={clear}>
          Clear
        </button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

function MyStatuses({ user }: { user: User }) {
  const statuses = use$(user.statuses$);

  if (!statuses) return <div className="border border-base-300 p-3 text-sm opacity-60">Loading...</div>;
  if (statuses.length === 0) return <div className="border border-base-300 p-3 text-sm opacity-60">No status set</div>;
  return (
    <div className="flex flex-col border border-base-300">
      {statuses.map((status) => (
        <MyStatusRow key={status.type} status={status} />
      ))}
    </div>
  );
}

function FollowingRow({ user }: { user: User }) {
  const profile = use$(user.profile$);
  const statuses = use$(user.statuses$);
  if (!statuses?.length) return null;

  return (
    <div className="flex items-start gap-3 border-b border-base-300 py-3">
      <img
        src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
        className="h-10 w-10 rounded-full"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>
        {statuses.map((status) => (
          <StatusLine key={status.type} status={status} />
        ))}
      </div>
    </div>
  );
}

function Following({ user }: { user: User }) {
  // Keep the status subscription open while this list is mounted
  const contacts = use$(() => merge(loadStatuses(user), user.contacts$), [user]);

  if (!contacts) return <div className="text-sm opacity-60">Loading contacts...</div>;
  return (
    <div className="flex flex-col">
      {contacts.map((contact) => (
        <FollowingRow key={contact.pubkey} user={contact} />
      ))}
    </div>
  );
}

function StatusManager({ user }: { user: User }) {
  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-4">
        <StatusForm user={user} />
        <h2 className="text-lg font-semibold">My statuses</h2>
        <MyStatuses user={user} />
        <h2 className="text-lg font-semibold">Following</h2>
        <Following user={user} />
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
  return <StatusManager user={user} />;
}
