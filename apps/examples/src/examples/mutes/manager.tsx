/**
 * Browse any user's mute list, or sign in to add and remove public and private mutes on your own
 * @tags nip-51, casting, mutes, moderation, actions
 * @related casting/contacts, contacts/manager
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import {
  MuteHashtag,
  MuteThread,
  MuteUser,
  MuteWord,
  UnmuteHashtag,
  UnmuteThread,
  UnmuteUser,
  UnmuteWord,
} from "applesauce-actions/actions";
import { castUser, Note, type User } from "applesauce-common/casts";
import { castEventStream } from "applesauce-common/observable";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { kinds, normalizeToEventPointer, normalizeToPubkey } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import {
  BehaviorSubject,
  endWith,
  ignoreElements,
  type Observable,
  of,
  startWith,
  switchMap,
  take,
  timeout,
} from "rxjs";

import LoginView from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

// The signed in account, only needed for editing
const signer$ = new BehaviorSubject<ISigner | null>(null);
const account$ = new BehaviorSubject<string | null>(null);

const eventStore = new EventStore();
const pool = new RelayPool();

// Loads profiles, mute lists, and muted notes on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

// Mute actions publish to the outboxes of the mute list owner
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  await publishEvent(pool, relays?.length ? relays : FALLBACK_RELAYS, event);
});

type OutboxLoad = { relays: string[]; fallback: boolean; done: boolean };

/**
 * Fetches a user's list from their outboxes, the source of truth for events they publish.
 * The store only loads missing events, so without this a copy found on the lookup relays (before the NIP-65 list arrives) would never be refreshed.
 */
function loadFromOutboxes(user: User, kind: number): Observable<OutboxLoad> {
  return user.outboxes$.pipe(
    defined(),
    take(1),
    // Users without a NIP-65 relay list fall back to a few popular relays
    timeout({ first: 10_000, with: () => of<string[]>([]) }),
    switchMap((outboxes) => {
      const fallback = outboxes.length === 0;
      const relays = fallback ? FALLBACK_RELAYS : outboxes;
      return pool
        .request(relays, { kinds: [kind], authors: [user.pubkey] })
        .pipe(
          mapEventsToStore(eventStore),
          ignoreElements(),
          startWith({ relays, fallback, done: false }),
          endWith({ relays, fallback, done: true }),
        );
    }),
  );
}

function OutboxStatus({ load }: { load?: OutboxLoad }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="font-semibold">Source</h2>
      {!load ? (
        <p className="text-sm text-base-content/60">Finding outbox relays…</p>
      ) : (
        <>
          <p className="text-sm text-base-content/60">
            {load.fallback
              ? "No outbox relays published, using fallback relays"
              : "Loaded from the user's outbox relays"}
            {load.done ? "" : "…"}
          </p>
          {load.relays.map((relay) => (
            <p key={relay} className="truncate font-mono text-sm">
              {new URL(relay).host}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

type Kind = "pubkeys" | "threads" | "words" | "hashtags";
type Entry = { kind: Kind; value: string; hidden: boolean };

const KINDS: { kind: Kind; label: string; noun: string; mute: typeof MuteUser; unmute: typeof UnmuteUser }[] = [
  { kind: "pubkeys", label: "Users", noun: "User", mute: MuteUser, unmute: UnmuteUser },
  { kind: "threads", label: "Threads", noun: "Thread", mute: MuteThread, unmute: UnmuteThread },
  { kind: "words", label: "Words", noun: "Word", mute: MuteWord, unmute: UnmuteWord },
  { kind: "hashtags", label: "Hashtags", noun: "Hashtag", mute: MuteHashtag, unmute: UnmuteHashtag },
];

const entryKey = (e: Entry) => `${e.kind}:${e.value}:${e.hidden}`;

/** Detects what a single input should mute: npub / nevent / #tag / word */
function parseInput(input: string): Omit<Entry, "hidden"> | null {
  const text = input.trim().replace(/^nostr:/, "");
  if (!text) return null;
  const pubkey = normalizeToPubkey(text);
  if (pubkey) return { kind: "pubkeys", value: pubkey };
  if (/^(note|nevent)1/.test(text)) {
    const pointer = normalizeToEventPointer(text);
    return pointer ? { kind: "threads", value: pointer.id } : null;
  }
  if (text.startsWith("#")) return text.length > 1 ? { kind: "hashtags", value: text.slice(1).toLowerCase() } : null;
  return { kind: "words", value: text.toLowerCase() };
}

function UserLabel({ pubkey }: { pubkey: string }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const profile = use$(user.profile$);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
        className="size-8 shrink-0 rounded-full object-cover"
        alt=""
      />
      <div className="min-w-0">
        <div className="truncate font-medium">{profile?.displayName ?? user.npub.slice(0, 16) + "…"}</div>
        <div className="truncate font-mono text-sm text-base-content/50">{user.npub}</div>
      </div>
    </div>
  );
}

function ThreadLabel({ id }: { id: string }) {
  const note = use$(() => eventStore.event({ id }).pipe(castEventStream(Note, eventStore)), [id]);
  const profile = use$(() => note?.author.profile$, [note]);

  if (!note) return <span className="font-mono text-sm text-base-content/50">Loading {id.slice(0, 16)}…</span>;

  return (
    <div className="min-w-0">
      <div className="text-sm text-base-content/60">
        {profile?.displayName ?? note.author.npub.slice(0, 12)} · {note.createdAt.toLocaleDateString()}
      </div>
      <p className="line-clamp-2">{note.event.content}</p>
    </div>
  );
}

function EntryLabel({ entry }: { entry: Omit<Entry, "hidden"> }) {
  switch (entry.kind) {
    case "pubkeys":
      return <UserLabel pubkey={entry.value} />;
    case "threads":
      return <ThreadLabel id={entry.value} />;
    case "hashtags":
      return <span className="font-mono">#{entry.value}</span>;
    default:
      return <span className="font-mono">{entry.value}</span>;
  }
}

function AddMute({ onAdd }: { onAdd: (entry: Entry) => Promise<boolean> }) {
  const [input, setInput] = useState("");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = parseInput(input);

  const submit = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    if (await onAdd({ ...parsed, hidden })) setInput("");
    setBusy(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Add mute</h2>
      <input
        className={`input w-full ${input.trim() && !parsed ? "input-error" : ""}`}
        placeholder="npub, nevent, #hashtag, or word"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {parsed && (
        <div className="border border-base-300 p-2">
          <div className="mb-1 text-sm text-base-content/60">
            Mute {KINDS.find((k) => k.kind === parsed.kind)?.noun.toLowerCase()}
          </div>
          <EntryLabel entry={parsed} />
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={hidden}
          onChange={(e) => setHidden(e.target.checked)}
        />
        Private (encrypted to yourself)
      </label>
      <button className="btn btn-primary" disabled={!parsed || busy} onClick={submit}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : "Mute"}
      </button>
    </section>
  );
}

function MuteList({ pubkey, account, onSignIn }: { pubkey: string; account: string | null; onSignIn: () => void }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const profile = use$(user.profile$);
  const load = use$(() => loadFromOutboxes(user, kinds.Mutelist), [user]);
  const mutes = use$(user.mutes$);
  const hidden = use$(() => mutes?.hidden$, [mutes]);
  const signer = use$(signer$);
  const editable = pubkey === account && !!signer;

  const [filter, setFilter] = useState<Kind | "all">("all");
  const [visibility, setVisibility] = useState<"all" | "public" | "private">("all");
  const [search, setSearch] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [pending, setPending] = useState<string[]>([]);

  const entries = useMemo<Entry[]>(
    () =>
      KINDS.flatMap(({ kind }) => [
        ...Array.from(mutes?.[kind] ?? [], (value) => ({ kind, value, hidden: false })),
        ...Array.from(hidden?.[kind] ?? [], (value) => ({ kind, value, hidden: true })),
      ]),
    [mutes, hidden],
  );

  const query = search.trim().toLowerCase();
  const visible = entries.filter(
    (e) =>
      (filter === "all" || e.kind === filter) &&
      (visibility === "all" || e.hidden === (visibility === "private")) &&
      (!query || e.value.includes(query)),
  );

  const run = async (entry: Entry, mute: boolean) => {
    const { mute: muteAction, unmute } = KINDS.find((k) => k.kind === entry.kind)!;
    const key = mute ? undefined : entryKey(entry);
    if (key) setPending((p) => [...p, key]);
    try {
      await actions.run(mute ? muteAction : unmute, entry.value, entry.hidden);
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (key) setPending((p) => p.filter((k) => k !== key));
    }
  };

  const unlock = async () => {
    if (!mutes || !signer) return;
    setUnlocking(true);
    try {
      await mutes.unlock(signer);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unlock private mutes");
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-e border-base-300 p-4">
        <div>
          <p className="text-sm text-base-content/60">MUTE LIST</p>
          <h1 className="truncate text-2xl font-semibold">{profile?.displayName ?? user.npub.slice(0, 16) + "…"}</h1>
          <p className="text-sm text-base-content/60">
            {mutes
              ? `Updated ${mutes.createdAt.toLocaleString()}`
              : load?.done
                ? "No mute list published"
                : "Loading mute list…"}
          </p>
        </div>

        <OutboxStatus load={load} />

        {editable ? (
          <AddMute onAdd={(entry) => run(entry, true)} />
        ) : (
          <p className="border-l-2 border-base-300 pl-3 text-sm text-base-content/70">
            Read only.{" "}
            {!account && (
              <button className="link" onClick={onSignIn}>
                Sign in to manage your own mutes
              </button>
            )}
          </p>
        )}

        {mutes?.hasHidden && !hidden && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Private mutes</h2>
            <p className="text-sm text-base-content/60">
              {editable
                ? "Some entries are encrypted. Decrypt them with your signer to view and edit."
                : "This list has encrypted entries only its owner can read."}
            </p>
            {editable && (
              <button className="btn btn-outline" onClick={unlock} disabled={unlocking}>
                {unlocking ? <span className="loading loading-spinner loading-sm" /> : "Unlock private mutes"}
              </button>
            )}
          </section>
        )}

        <nav className="flex flex-col">
          {[{ kind: "all" as const, label: "Everything" }, ...KINDS].map(({ kind, label }) => (
            <button
              key={kind}
              className={`flex justify-between border-s-2 px-3 py-1.5 text-left ${filter === kind ? "border-primary bg-base-200" : "border-transparent"}`}
              onClick={() => setFilter(kind)}
            >
              {label}
              <span className="tabular-nums text-base-content/60">
                {entries.filter((e) => kind === "all" || e.kind === kind).length}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
          <input
            type="search"
            className="input w-72"
            placeholder="Filter by value"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="join">
            {(["all", "public", "private"] as const).map((v) => (
              <button
                key={v}
                className={`btn join-item capitalize ${visibility === v ? "btn-active" : ""}`}
                onClick={() => setVisibility(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <span className="ms-auto text-sm text-base-content/60">
            {visible.length} of {entries.length}
          </span>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-base-300 overflow-y-auto">
          {visible.map((entry) => {
            const key = entryKey(entry);
            return (
              <div key={key} className="flex items-center gap-4 px-4 py-2">
                <span className="w-20 shrink-0 text-sm text-base-content/50">
                  {KINDS.find((k) => k.kind === entry.kind)?.noun}
                </span>
                <div className="min-w-0 flex-1">
                  <EntryLabel entry={entry} />
                </div>
                {entry.hidden && <span className="badge badge-outline">private</span>}
                {editable && (
                  <button
                    className="btn btn-ghost btn-sm text-error"
                    disabled={pending.includes(key)}
                    onClick={() => run(entry, false)}
                  >
                    {pending.includes(key) ? <span className="loading loading-spinner loading-sm" /> : "Unmute"}
                  </button>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="p-8 text-center text-base-content/60">
              {entries.length ? "Nothing matches these filters." : load?.done ? "Nothing muted." : "Loading mutes…"}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function MuteManagerExample() {
  const account = use$(account$);
  const [pubkey, setPubkey] = useState("");

  const login = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    account$.next(pubkey);
    setPubkey(pubkey);
  };
  const logout = () => {
    signer$.next(null);
    account$.next(null);
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
        <PubkeyPicker value={pubkey} onChange={setPubkey} className="flex-1" />
        {account ? (
          <>
            {pubkey !== account && (
              <button className="btn" onClick={() => setPubkey(account)}>
                My mutes
              </button>
            )}
            <button className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </>
        ) : (
          pubkey && (
            <button className="btn" onClick={() => setPubkey("")}>
              Sign in
            </button>
          )
        )}
      </div>

      {pubkey ? (
        <MuteList key={pubkey} pubkey={pubkey} account={account} onSignIn={() => setPubkey("")} />
      ) : (
        // LoginView also restores a saved account, which opens that account's mute list
        <div className="min-h-0 grow overflow-y-auto">
          <LoginView onLogin={login} />
        </div>
      )}
    </div>
  );
}
