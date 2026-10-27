/**
 * Private notes and replies using an account-scoped WrappedMessagesClient
 * @tags nip-17, nip-44, nip-59, notes, encryption, self-messaging, nip-77
 * @related messages/gift-wrap, messages/legacy
 */
import { castUser, User } from "applesauce-common/casts";
import { getWrappedMessageParent, type Rumor } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, unixNow } from "applesauce-core/helpers";
import { WrappedMessagesClient } from "applesauce-extra/messages";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { BehaviorSubject, combineLatest, concat, defer, finalize, map, NEVER, of, shareReplay, switchMap } from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

const EXPIRATIONS = [
  { value: 0, label: "Never" },
  { value: 86400, label: "1 day" },
  { value: 3 * 86400, label: "3 days" },
  { value: 7 * 86400, label: "1 week" },
];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
const storage$ = new BehaviorSubject<SecureStorage | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// The stream owns the client; switching accounts or leaving the page disposes it
const client$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!signer || !user || !storage) return of(undefined);

    return defer(() => {
      const client = new WrappedMessagesClient({
        pubkey: user.pubkey,
        signer,
        eventStore,
        pool,
        decryptionCache: storage,
      });

      return defer(() => client.start()).pipe(
        switchMap(() => concat(of(client), NEVER)),
        finalize(() => client.dispose()),
      );
    });
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Formats a timestamp as a time for today and a date otherwise */
function formatShortTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
  storage$.next(undefined);
}

function Avatar({ user, size = "h-6 w-6" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
      className={`${size} shrink-0 rounded-full`}
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="min-w-0 truncate font-medium">{getDisplayName(profile, user.npub.slice(0, 12))}</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <span className="text-sm opacity-60">{title}</span>
      {children}
    </div>
  );
}

function Account({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function SyncStatus({ client }: { client: WrappedMessagesClient }) {
  const auth = use$(client.authRequests$) ?? [];
  const [authError, setAuthError] = useState<string>();
  const stats = use$(client.decryptionState$);
  const sync = use$(client.syncStatus$);
  const [autoUnlock, setAutoUnlock] = useState(false);

  // Reconcile older notes from the chosen date while one is selected
  const [since, setSince] = useState<number>();
  const history = use$(() => (since === undefined ? undefined : client.sync$({ since })), [client, since]);
  const progress = history ?? sync;

  const toggleAutoUnlock = () => {
    client.setAutoUnlock(!autoUnlock);
    setAutoUnlock(!autoUnlock);
  };

  return (
    <Section title="Sync">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-ghost">
          {!progress?.done && <span className="loading loading-spinner loading-sm" />}
          {progress?.loaded ?? 0} events
        </span>
        <span className="badge badge-ghost">{stats?.locked ?? 0} locked</span>
        {!!stats?.failed.length && <span className="badge badge-error">{stats.failed.length} failed</span>}
      </div>
      <button className={`btn btn-sm ${autoUnlock ? "btn-active" : ""}`} onClick={toggleAutoUnlock}>
        {autoUnlock ? "Stop decrypting" : "Decrypt notes"}
      </button>
      {auth.map(({ url, state, error }) => (
        <button
          key={url}
          className="btn btn-sm"
          disabled={state === "authenticating" || !client.signer}
          title={error ? String(error) : url}
          onClick={async () => {
            setAuthError(undefined);
            try {
              await client.authenticate(url);
            } catch (error) {
              setAuthError(String(error));
            }
          }}
        >
          {state === "authenticating" ? "Authenticating" : state === "failed" ? "Retry authentication" : "Authenticate"}{" "}
          {new URL(url).hostname}
        </button>
      ))}
      {authError && <p className="text-sm text-error">{authError}</p>}
      <input
        aria-label="Load history since"
        title="Load history since"
        type="date"
        className="input input-sm"
        onChange={(event) => {
          const value = Date.parse(event.target.value);
          setSince(Number.isFinite(value) ? Math.floor(value / 1000) : undefined);
        }}
      />
    </Section>
  );
}

function NoteRow({
  note,
  replies,
  active,
  onSelect,
}: {
  note: Rumor;
  replies: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex w-full flex-col gap-1 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <span className="line-clamp-2 whitespace-pre-wrap break-words">{note.content}</span>
      <span className="flex gap-2 text-sm opacity-60">
        {formatShortTime(note.created_at)}
        {replies > 0 && <span>· {replies} replies</span>}
      </span>
    </button>
  );
}

function Editor({ client, parent, onSaved }: { client: WrappedMessagesClient; parent?: Rumor; onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [expiration, setExpiration] = useState(3 * 86400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(undefined);

    try {
      const expires = expiration ? unixNow() + expiration : undefined;
      await client.send({
        recipients: [client.pubkey],
        content: text,
        replyTo: parent?.id,
        expiration: expires,
        envelopeExpiration: expires,
      });

      setText("");
      onSaved?.();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <textarea
        className="textarea w-full"
        rows={parent ? 2 : 6}
        placeholder={parent ? "Reply to note" : "Write a private note"}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <select
          aria-label="Note expiration"
          title="Note expiration"
          className="select w-36"
          value={expiration}
          onChange={(event) => setExpiration(Number(event.target.value))}
        >
          {EXPIRATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary ms-auto" disabled={busy || !text.trim()} onClick={save}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : parent ? "Reply" : "Save note"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function Thread({ client, note, replies }: { client: WrappedMessagesClient; note: Rumor; replies: Rumor[] }) {
  return (
    <>
      <div className="flex flex-col gap-2 border-b border-base-300 p-4">
        <span className="text-sm opacity-60">{new Date(note.created_at * 1000).toLocaleString()}</span>
        <p className="whitespace-pre-wrap break-words">{note.content}</p>
      </div>
      {replies.map((reply) => (
        <div key={reply.id} className="flex flex-col gap-2 border-b border-base-300 p-4 ps-8">
          <span className="text-sm opacity-60">{new Date(reply.created_at * 1000).toLocaleString()}</span>
          <p className="whitespace-pre-wrap break-words">{reply.content}</p>
        </div>
      ))}
      <Editor key={note.id} client={client} parent={note} />
    </>
  );
}

function Notes({ client, user }: { client: WrappedMessagesClient; user: User }) {
  const notes = use$(() => client.conversation$(client.pubkey), [client]);
  const error = use$(() => client.errors$.pipe(map((failure) => String(failure.error))), [client]);
  const [selected, setSelected] = useState<string>();

  // Split the self-conversation into top-level notes and their replies, oldest reply first
  const { roots, replies } = useMemo(() => {
    const roots: Rumor[] = [];
    const replies = new Map<string, Rumor[]>();
    for (const note of notes ?? []) {
      const parent = getWrappedMessageParent(note);
      if (!parent) roots.push(note);
      else replies.set(parent, [note, ...(replies.get(parent) ?? [])]);
    }
    return { roots, replies };
  }, [notes]);

  const note = roots.find((note) => note.id === selected);

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 border-b border-base-300 p-3">
            <span className="badge badge-ghost">{roots.length} notes</span>
            <button
              className={`btn btn-sm ms-auto ${selected === undefined ? "btn-active" : ""}`}
              onClick={() => setSelected(undefined)}
            >
              <Plus className="h-4 w-4" /> New note
            </button>
          </div>

          <SyncStatus client={client} />

          {notes === undefined ? (
            <div className="flex justify-center p-6">
              <span className="loading loading-dots" />
            </div>
          ) : roots.length === 0 ? (
            <p className="p-6 text-center opacity-60">No notes</p>
          ) : (
            roots.map((root) => (
              <NoteRow
                key={root.id}
                note={root}
                replies={replies.get(root.id)?.length ?? 0}
                active={selected === root.id}
                onSelect={() => setSelected(root.id)}
              />
            ))
          )}
        </div>
        <Account user={user} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {error && <div className="border-b border-base-300 p-3 text-sm text-error">{error}</div>}
        {note ? (
          <Thread client={client} note={note} replies={replies.get(note.id) ?? []} />
        ) : (
          <Editor client={client} />
        )}
      </main>
    </div>
  );
}

export default function PersonalNotesExample() {
  const signer = use$(signer$);
  const user = use$(user$);
  const storage = use$(storage$);
  const client = use$(client$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!client) return <span className="loading loading-spinner m-auto" />;

  return <Notes key={user.pubkey} client={client} user={user} />;
}
