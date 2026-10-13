/**
 * Discord-style community client that treats a NIP-29 relay as a server and its groups as channels
 * @tags nip-29, nip-42, group, chat, community
 * @related group/groups, group/relay-chat, group/threads
 */
import { castUser, User } from "applesauce-common/casts";
import { GroupMessageFactory } from "applesauce-common/factories";
import {
  getGroupMetadata,
  GROUP_MESSAGE_KIND,
  GROUP_METADATA_KIND,
  GroupPointer,
  groupMessageEvents,
} from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  Filter,
  getDisplayName,
  getProfilePicture,
  insertEventIntoDescendingList,
  isSameURL,
  relaySet,
  NostrEvent,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useCallback, useMemo, useState } from "react";
import { BehaviorSubject, catchError, map, Observable, of, scan, startWith, switchMap } from "rxjs";
import LoginView from "../../components/login-view";
import NoteContent from "../../components/note-content";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Load profiles for message authors on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Optional sign in state shared by the whole example
const signer$ = new BehaviorSubject<ISigner | null>(null);
const user$ = new BehaviorSubject<User | null>(null);

/** A channel in the sidebar, built from a kind 39000 metadata event or a joined group pointer */
type Channel = { id: string; name: string; about?: string; isPrivate?: boolean; isClosed?: boolean };

/** The state of a relay subscription: events, whether EOSE was received, and any error */
type RelayTimeline = { events: NostrEvent[]; loading: boolean; error?: Error };

const initialTimeline: RelayTimeline = { events: [], loading: true };

/** Subscribes to a single relay, adds events to the store, and tracks EOSE and errors */
function relayTimeline(relay: string, filter: Filter): Observable<RelayTimeline> {
  return pool
    .relay(relay)
    .subscription(filter, { reconnect: true, authTimeout: false })
    .pipe(
      scan((state, message) => {
        if (message === "EOSE") return { ...state, loading: false };
        const event = eventStore.add(message) ?? message;
        return { ...state, events: insertEventIntoDescendingList([...state.events], event) };
      }, initialTimeline),
      startWith(initialTimeline),
      catchError((error) => of({ events: [], loading: false, error })),
    );
}

/** The current user's joined groups (public and unlocked hidden) from their kind 10009 list */
const joinedGroups$: Observable<GroupPointer[] | undefined> = user$.pipe(
  switchMap((user) => {
    if (!user) return of(undefined);
    return user.groups$.pipe(
      switchMap((list) =>
        list ? list.hidden$.pipe(map((hidden) => [...list.groups, ...(hidden ?? [])])) : of([] as GroupPointer[]),
      ),
    );
  }),
);

/** The unique relays of the current user's joined groups */
const joinedRelays$ = joinedGroups$.pipe(map((groups) => groups && relaySet(groups.map((g) => g.relay))));

function Avatar({ user, size = "size-10" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  // self-start keeps the avatar square when the parent row stretches its children
  return (
    <div className="avatar shrink-0 self-start">
      <div className={`${size} rounded-full`}>
        <img src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)} alt="" />
      </div>
    </div>
  );
}

/** A relay's NIP-11 icon, name, and description */
function RelayInfo({ relay }: { relay: string }) {
  const info = use$(() => pool.relay(relay).information$, [relay]);
  const icon = use$(() => pool.relay(relay).icon$, [relay]);
  const name = use$(() => pool.relay(relay).name$, [relay]);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="avatar shrink-0 self-start">
        <div className="size-10 rounded-lg bg-base-300">{icon && <img src={icon} alt="" />}</div>
      </div>
      <div className="min-w-0 text-left">
        <div className="truncate font-bold">{name}</div>
        {info?.description && <div className="truncate text-sm opacity-60">{info.description}</div>}
      </div>
    </div>
  );
}

/** Lists the user's joined communities and a relay picker in place of the channel list */
function CommunityList({ relay, onSelect }: { relay: string; onSelect: (relay: string) => void }) {
  const joinedRelays = use$(joinedRelays$);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
      {joinedRelays && (
        <div className="space-y-1">
          <div className="px-2 py-1 text-sm font-semibold opacity-60">Your communities</div>
          {joinedRelays.map((url) => (
            <button
              key={url}
              onClick={() => onSelect(url)}
              className={`w-full rounded p-2 hover:bg-base-300 ${isSameURL(url, relay) ? "bg-base-300" : ""}`}
            >
              <RelayInfo relay={url} />
            </button>
          ))}
          {joinedRelays.length === 0 && (
            <div className="px-2 text-sm opacity-60">You haven't joined any groups yet</div>
          )}
        </div>
      )}

      <div className="space-y-1 px-2">
        <div className="py-1 text-sm font-semibold opacity-60">Other relay</div>
        <RelayPicker value={relay} onChange={onSelect} supportedNips={["29"]} className="w-full" />
      </div>
    </div>
  );
}

function CommunityHeader({ relay, switching, onToggle }: { relay: string; switching: boolean; onToggle: () => void }) {
  return (
    <div className="space-y-3 border-b border-base-300 p-3">
      <RelayInfo relay={relay} />
      <button className="btn btn-sm w-full" onClick={onToggle}>
        {switching ? "Back to channels" : "Switch community"}
      </button>
    </div>
  );
}

function ChannelList({
  relay,
  selected,
  onSelect,
}: {
  relay: string;
  selected?: string;
  onSelect: (channel: Channel) => void;
}) {
  const user = use$(user$);
  const metadata = use$(() => relayTimeline(relay, { kinds: [GROUP_METADATA_KIND] }), [relay]);
  const joined = use$(joinedGroups$);
  const groupsList = use$(() => user?.groups$, [user]);
  const signer = use$(signer$);

  const channels = useMemo<Channel[]>(() => {
    const all = (metadata?.events ?? [])
      .map((event) => getGroupMetadata(event))
      .filter((m) => !!m)
      .map((m) => ({ ...m, name: m.name || m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Anonymous users browse every channel on the relay
    if (!joined) return all;

    // Signed in users only see the channels from their groups list that live on this relay
    return joined
      .filter((pointer) => isSameURL(pointer.relay, relay))
      .map((pointer) => all.find((c) => c.id === pointer.id) ?? { id: pointer.id, name: pointer.name || pointer.id });
  }, [metadata, joined, relay]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-sm font-semibold opacity-60">{joined ? "Joined channels" : "Channels"}</span>
        {metadata?.loading && <span className="loading loading-spinner loading-sm opacity-60" />}
      </div>

      {metadata?.error && <div className="px-2 py-1 text-sm text-error">{metadata.error.message}</div>}

      {channels.map((channel) => (
        <button
          key={channel.id}
          onClick={() => onSelect(channel)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-base-300 ${
            selected === channel.id ? "bg-base-300 font-semibold" : "opacity-80"
          }`}
        >
          <span className="opacity-50">{channel.isPrivate ? "🔒" : "#"}</span>
          <span className="truncate">{channel.name}</span>
        </button>
      ))}

      {!metadata?.loading && channels.length === 0 && (
        <div className="px-2 py-1 text-sm opacity-60">
          {joined ? "You haven't joined any channels on this community" : "No channels found on this relay"}
        </div>
      )}

      {groupsList?.hasHidden && !groupsList.unlocked && signer && (
        <button className="btn btn-ghost btn-sm mt-2 w-full" onClick={() => groupsList.unlock(signer)}>
          Unlock private channels
        </button>
      )}
    </div>
  );
}

function AuthPanel({ relay }: { relay: string }) {
  const challenge = use$(() => pool.relay(relay).challenge$, [relay]);
  const authenticated = use$(() => pool.relay(relay).authenticated$, [relay]);
  const signer = use$(signer$);
  const [error, setError] = useState<string | null>(null);

  if (!challenge || authenticated) return null;

  const authenticate = async () => {
    if (!signer) return;
    try {
      setError(null);
      const response = await pool.relay(relay).authenticate(signer);
      if (!response.ok) setError(response.message ?? "Authentication rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    }
  };

  return (
    <div className="border-t border-base-300 p-3 space-y-2">
      <div className="text-sm opacity-70">This community requests authentication</div>
      {signer ? (
        <button className="btn btn-sm btn-primary w-full" onClick={authenticate}>
          Authenticate
        </button>
      ) : (
        <div className="text-sm opacity-70">Sign in to authenticate</div>
      )}
      {error && <div className="text-sm text-error">{error}</div>}
    </div>
  );
}

function UserPanel({ onSignIn }: { onSignIn: () => void }) {
  const user = use$(user$);
  const profile = use$(() => user?.profile$, [user]);

  const signOut = () => {
    signer$.next(null);
    user$.next(null);
  };

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-3">
      {user ? (
        <>
          <Avatar user={user} size="size-8" />
          <span className="flex-1 truncate">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <button className="btn btn-primary btn-sm w-full" onClick={onSignIn}>
          Sign in
        </button>
      )}
    </div>
  );
}

function MessageGroup({ messages }: { messages: NostrEvent[] }) {
  const user = useMemo(() => castUser(messages[0].pubkey, eventStore), [messages[0].pubkey]);
  const profile = use$(user.profile$);

  return (
    <div className="flex gap-3 px-4 py-2 hover:bg-base-200">
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>
          <time className="text-sm opacity-50">{new Date(messages[0].created_at * 1000).toLocaleString()}</time>
        </div>
        {messages.map((message) => (
          <NoteContent key={message.id} event={message} />
        ))}
      </div>
    </div>
  );
}

function Composer({ pointer, channel, recent }: { pointer: GroupPointer; channel: Channel; recent: NostrEvent[] }) {
  const signer = use$(signer$);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signer) return <div className="border-t border-base-300 p-4 opacity-60">Sign in to send messages</div>;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    try {
      setSending(true);
      setError(null);
      // Reference recent messages with "previous" tags so the relay can detect out-of-context messages
      const signed = await GroupMessageFactory.create(pointer, text.trim()).previous(recent).sign(signer);
      const response = await pool.relay(pointer.relay).publish(signed);
      if (!response.ok) throw new Error(response.message || "Message rejected by relay");
      setText("");
      setSending(false);
    } catch (err) {
      setSending(false);
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  return (
    <form onSubmit={send} className="border-t border-base-300 p-4 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
          placeholder={`Message #${channel.name}`}
          className="input input-bordered grow"
        />
        <button type="submit" disabled={sending || !text.trim()} className="btn btn-primary">
          {sending ? <span className="loading loading-spinner loading-sm" /> : "Send"}
        </button>
      </div>
      {error && <div className="text-sm text-error">{error}</div>}
    </form>
  );
}

function ChannelView({ relay, channel }: { relay: string; channel: Channel }) {
  const pointer = useMemo<GroupPointer>(() => ({ relay, id: channel.id, name: channel.name }), [relay, channel]);
  const timeline = use$(
    () => relayTimeline(relay, { kinds: [GROUP_MESSAGE_KIND], "#h": [channel.id], limit: 200 }),
    [relay, channel.id],
  );
  const messages = timeline?.events ?? [];

  // Group consecutive messages oldest-first, then reverse for the bottom-anchored list
  const groups = useMemo(() => groupMessageEvents([...messages].reverse()).reverse(), [messages]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
        <span className="text-lg opacity-50">{channel.isPrivate ? "🔒" : "#"}</span>
        <span className="font-bold">{channel.name}</span>
        {channel.about && <span className="truncate border-l border-base-300 pl-2 opacity-60">{channel.about}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto py-2">
        {groups.map((group) => (
          <MessageGroup key={group[0].id} messages={group} />
        ))}
        {timeline?.loading && messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        )}
        {timeline?.error && <div className="p-4 text-error">{timeline.error.message}</div>}
        {!timeline?.loading && !timeline?.error && messages.length === 0 && (
          <div className="p-4 opacity-60">This is the beginning of #{channel.name}</div>
        )}
      </div>

      <Composer key={`${relay}:${channel.id}`} pointer={pointer} channel={channel} recent={messages} />
    </>
  );
}

export default function CommunityExample() {
  const [relay, setRelay] = useState("wss://pyramid.fiatjaf.com/");
  const [channel, setChannel] = useState<Channel | undefined>(undefined);
  const [login, setLogin] = useState(false);
  const [switching, setSwitching] = useState(false);

  const handleLogin = useCallback((signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
    setLogin(false);
  }, []);

  if (login) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex min-h-0 grow overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-base-300 bg-base-200">
        <CommunityHeader relay={relay} switching={switching} onToggle={() => setSwitching(!switching)} />
        {switching ? (
          // Changing the community clears the selected channel
          <CommunityList
            relay={relay}
            onSelect={(relay) => {
              setRelay(relay);
              setChannel(undefined);
              setSwitching(false);
            }}
          />
        ) : (
          <ChannelList relay={relay} selected={channel?.id} onSelect={setChannel} />
        )}
        <AuthPanel relay={relay} />
        <UserPanel onSignIn={() => setLogin(true)} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {channel ? (
          <ChannelView relay={relay} channel={channel} />
        ) : (
          <div className="flex flex-1 items-center justify-center opacity-60">Select a channel to start chatting</div>
        )}
      </main>
    </div>
  );
}
