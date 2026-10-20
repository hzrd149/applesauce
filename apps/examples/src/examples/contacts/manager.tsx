/**
 * Browse any user's contact list, or sign in to follow and unfollow people from your own
 * @tags nip-02, casting, contacts, follows, actions
 * @related mutes/manager, contacts/open-ranking
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { FollowUser, UnfollowUser } from "applesauce-actions/actions";
import { castUser, type Profile, type User } from "applesauce-common/casts";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { kinds, normalizeToProfilePointer, type ProfilePointer } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";
import {
  BehaviorSubject,
  combineLatest,
  endWith,
  ignoreElements,
  map,
  type Observable,
  of,
  startWith,
  switchMap,
  take,
  throttleTime,
  timeout,
} from "rxjs";

import LoginView from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

// The signed in account, only needed for editing
const signer$ = new BehaviorSubject<ISigner | null>(null);
const account$ = new BehaviorSubject<string | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Loads contact lists and profiles on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

// Follow actions publish to the outboxes of the contact list owner
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

type Row = { user: User; profile?: Profile };

/** Pairs every contact with its profile so the list can be searched and sorted by name */
function contactRows(user: User) {
  return user.contacts$.pipe(
    switchMap((contacts) =>
      contacts.length
        ? combineLatest(
            contacts.map((contact) =>
              contact.profile$.pipe(
                startWith(undefined),
                map((profile): Row => ({ user: contact, profile })),
              ),
            ),
          )
        : of<Row[]>([]),
    ),
    // Profiles are already in the store, this only limits re-renders while hundreds of them load
    throttleTime(250, undefined, { leading: true, trailing: true }),
  );
}

const displayName = ({ user, profile }: Row) => profile?.displayName || user.npub.slice(0, 16) + "…";

function Avatar({ row, size = "size-10" }: { row: Row; size?: string }) {
  return (
    <img
      src={row.profile?.picture ?? `https://robohash.org/${row.user.pubkey}.png`}
      className={`${size} shrink-0 rounded-full object-cover`}
      loading="lazy"
      alt=""
    />
  );
}

function AddContact({ onAdd }: { onAdd: (pointer: ProfilePointer) => Promise<boolean> }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const text = input.trim().replace(/^nostr:/, "");
  const pointer = /^(npub1|nprofile1|[0-9a-f]{64}$)/i.test(text) ? normalizeToProfilePointer(text) : null;
  const preview = useMemo(() => (pointer ? castUser(pointer.pubkey, eventStore) : undefined), [pointer?.pubkey]);
  const profile = use$(() => preview?.profile$, [preview]);

  const submit = async () => {
    if (!pointer || busy) return;
    setBusy(true);
    if (await onAdd(pointer)) setInput("");
    setBusy(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Follow someone</h2>
      <input
        className={`input w-full ${text && !pointer ? "input-error" : ""}`}
        placeholder="npub, nprofile, or hex pubkey"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {preview && (
        <div className="flex items-center gap-3 border border-base-300 p-2">
          <Avatar row={{ user: preview, profile }} size="size-8" />
          <span className="truncate">{displayName({ user: preview, profile })}</span>
        </div>
      )}
      <button className="btn btn-primary" disabled={!pointer || busy} onClick={submit}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : "Follow"}
      </button>
    </section>
  );
}

function ContactRows({ rows, children }: { rows: Row[]; children: (row: Row) => React.ReactNode }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => rows[index].user.pubkey,
    estimateSize: () => 61,
    overscan: 10,
  });

  return (
    <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={item.key}
              className="absolute inset-x-0 flex items-center gap-4 border-b border-base-300 px-4 py-2"
              style={{ top: item.start, height: item.size }}
            >
              <Avatar row={row} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{displayName(row)}</div>
                <div className="truncate font-mono text-sm text-base-content/50">
                  {row.profile?.dnsIdentity || row.user.npub}
                </div>
              </div>
              {children(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContactList({ pubkey, account, onSignIn }: { pubkey: string; account: string | null; onSignIn: () => void }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const profile = use$(user.profile$);
  const load = use$(() => loadFromOutboxes(user, kinds.Contacts), [user]);
  // A store query that only reads, the outbox request above fills it
  const list = use$(
    () => eventStore.timeline({ kinds: [kinds.Contacts], authors: [pubkey] }).pipe(map((events) => events[0])),
    [pubkey],
  );
  const rows = use$(() => contactRows(user), [user]);
  // The signed in account's follows, used to follow people from someone else's list
  const following = use$(
    () =>
      account
        ? castUser(account, eventStore).contacts$.pipe(map((c) => new Set(c.map((u) => u.pubkey))))
        : of(undefined),
    [account],
  );
  const own = pubkey === account;

  const [filter, setFilter] = useState<"all" | "following" | "not-following">("all");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string[]>([]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const matched = (rows ?? []).filter(
      (row) =>
        (filter === "all" || following?.has(row.user.pubkey) === (filter === "following")) &&
        (!query ||
          row.user.npub.includes(query) ||
          row.profile?.displayName?.toLowerCase().includes(query) ||
          row.profile?.dnsIdentity?.toLowerCase().includes(query)),
    );
    // New follows are appended to the list, so newest first is the reverse of tag order
    return sort === "recent" ? matched.reverse() : matched.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [rows, filter, following, query, sort]);

  const run = async (follow: boolean, pointer: ProfilePointer) => {
    setPending((p) => [...p, pointer.pubkey]);
    try {
      await actions.run(follow ? FollowUser : UnfollowUser, pointer);
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPending((p) => p.filter((k) => k !== pointer.pubkey));
    }
  };

  const shared = following && !own ? (rows ?? []).filter((row) => following.has(row.user.pubkey)).length : 0;

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-e border-base-300 p-4">
        <div>
          <p className="text-sm text-base-content/60">CONTACT LIST</p>
          <h1 className="truncate text-2xl font-semibold">{profile?.displayName || user.npub.slice(0, 16) + "…"}</h1>
          <p className="text-sm text-base-content/60">
            {list
              ? `Updated ${new Date(list.created_at * 1000).toLocaleString()}`
              : load?.done
                ? "No contact list published"
                : "Loading contact list…"}
          </p>
        </div>

        <OutboxStatus load={load} />

        <div className="flex gap-8">
          <p>
            <strong className="mr-2 text-2xl tabular-nums">{rows?.length ?? 0}</strong>following
          </p>
          {following && !own && (
            <p>
              <strong className="mr-2 text-2xl tabular-nums">{shared}</strong>in common
            </p>
          )}
        </div>

        {own ? (
          <AddContact onAdd={(pointer) => run(true, pointer)} />
        ) : (
          <p className="border-l-2 border-base-300 pl-3 text-sm text-base-content/70">
            {account ? (
              "Follow or unfollow people from this list on your own contact list."
            ) : (
              <>
                Read only.{" "}
                <button className="link" onClick={onSignIn}>
                  Sign in to manage your own contacts
                </button>
              </>
            )}
          </p>
        )}

        {following && !own && (
          <nav className="flex flex-col">
            {(
              [
                ["all", "Everyone", rows?.length ?? 0],
                ["following", "You follow", shared],
                ["not-following", "You don't follow", (rows?.length ?? 0) - shared],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                className={`flex justify-between border-s-2 px-3 py-1.5 text-left ${filter === key ? "border-primary bg-base-200" : "border-transparent"}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="tabular-nums text-base-content/60">{count}</span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
          <input
            type="search"
            className="input w-72"
            placeholder="Filter by name, NIP-05, or npub"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="join">
            {(
              [
                ["recent", "Recently followed"],
                ["name", "Name"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`btn join-item ${sort === key ? "btn-active" : ""}`}
                onClick={() => setSort(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ms-auto text-sm text-base-content/60">
            {visible.length} of {rows?.length ?? 0}
          </span>
        </div>

        {visible.length > 0 ? (
          <ContactRows rows={visible}>
            {({ user: contact }) =>
              account && (
                <button
                  className={`btn btn-sm ${own || following?.has(contact.pubkey) ? "btn-ghost text-error" : "btn-outline"}`}
                  disabled={pending.includes(contact.pubkey) || contact.pubkey === account}
                  onClick={() => run(!own && !following?.has(contact.pubkey), { pubkey: contact.pubkey })}
                >
                  {pending.includes(contact.pubkey) ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : own || following?.has(contact.pubkey) ? (
                    "Unfollow"
                  ) : (
                    "Follow"
                  )}
                </button>
              )
            }
          </ContactRows>
        ) : (
          <p className="p-8 text-center text-base-content/60">
            {rows?.length
              ? "Nobody matches these filters."
              : load?.done
                ? "Not following anyone."
                : "Loading contacts…"}
          </p>
        )}
      </main>
    </div>
  );
}

export default function ContactManagerExample() {
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
                My contacts
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
        <ContactList key={pubkey} pubkey={pubkey} account={account} onSignIn={() => setPubkey("")} />
      ) : (
        // LoginView also restores a saved account, which opens that account's contact list
        <div className="min-h-0 grow overflow-y-auto">
          <LoginView onLogin={login} />
        </div>
      )}
    </div>
  );
}
