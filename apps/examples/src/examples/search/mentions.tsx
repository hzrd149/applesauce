/**
 * Search a user's NIP-50 capable inbox relays for events that tag their pubkey
 * @tags nip-50, nip-65, search, mentions, inbox
 * @related search/relay, negentrapy/mentions
 */
import { default as NoteContent } from "../../components/note-content";
import { catchError, combineLatest, map, of, startWith } from "rxjs";

import { castUser, User } from "applesauce-common/casts";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { getDisplayName, getProfilePicture, getSeenRelays, kinds } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";

import { neventEncode } from "applesauce-core/helpers/pointers";
import { useMemo, useState } from "react";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

function UserHeader({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user.pubkey]);
  const name = getDisplayName(profile, user.pubkey.slice(0, 8) + "…");
  const picture = getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`);

  return (
    <div className="flex items-center gap-3 p-3 border border-base-300 rounded-lg">
      <div className="avatar">
        <div className="w-12 h-12 rounded-full border border-base-300">
          <img src={picture} alt={name} />
        </div>
      </div>
      <div className="min-w-0">
        <div className="font-semibold">{name}</div>
        <div className="text-sm text-base-content/50 font-mono truncate">{user.pubkey}</div>
      </div>
    </div>
  );
}

function InboxRelayOption({ url, supported }: { url: string; supported: number[] | null | undefined }) {
  let suffix = "";
  if (supported === undefined) suffix = " (checking…)";
  else if (supported === null) suffix = " (info unavailable)";
  else if (supported.includes(50)) suffix = " ✅";
  else suffix = " ❌";

  return <option value={url}>{url + suffix}</option>;
}

function ResultCard({ event, fallbackRelay }: { event: NostrEvent; fallbackRelay: string }) {
  const author = useMemo(() => castUser(event.pubkey, eventStore), [event.pubkey]);
  const profile = use$(() => author.profile$, [event.pubkey]);
  const [copied, setCopied] = useState(false);

  const name = getDisplayName(profile, event.pubkey.slice(0, 8) + "…");
  const picture = getProfilePicture(profile, `https://robohash.org/${event.pubkey}.png`);

  const handleCopy = async () => {
    const seen = getSeenRelays(event);
    const relays = seen && seen.size > 0 ? Array.from(seen) : [fallbackRelay];
    const nevent = neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays });
    try {
      await navigator.clipboard.writeText(nevent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy nevent:", err);
    }
  };

  return (
    <div className="border border-base-300 bg-base-100 border border-base-300">
      <div className="p-4 p-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-10 h-10 rounded-full">
              <img src={picture} alt={name} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{name}</div>
            <div className="text-sm text-base-content/50">{new Date(event.created_at * 1000).toLocaleString()}</div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy nevent"}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <NoteContent event={event} maxLength={280} />
      </div>
    </div>
  );
}

export default function InboxMentionsSearch() {
  const [pubkey, setPubkey] = useState("");
  const [selectedRelayChoice, setSelectedRelayChoice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const user = useMemo(() => (pubkey ? castUser(pubkey, eventStore) : undefined), [pubkey]);
  const inboxes = use$(() => user?.inboxes$, [user?.pubkey]);

  // Subscribe to NIP-11 supported_nips for every inbox in one place so the
  // parent can both render the labels and auto-select the first NIP-50 supporter.
  const supportMap = use$(() => {
    if (!inboxes || inboxes.length === 0) return of({} as Record<string, number[] | null | undefined>);
    return combineLatest(
      inboxes.map((url) =>
        pool.relay(url).supported$.pipe(
          startWith(undefined as number[] | null | undefined),
          map((s) => [url, s] as const),
        ),
      ),
    ).pipe(map((entries) => Object.fromEntries(entries)));
  }, [inboxes?.join("|")]);

  const selectedRelay =
    selectedRelayChoice && inboxes?.includes(selectedRelayChoice)
      ? selectedRelayChoice
      : (inboxes?.find((url) => supportMap?.[url]?.includes(50)) ?? null);
  const [command, setCommand] = useState<{ pubkey: string; relay: string; query: string } | null>(null);
  const state = use$(() => {
    if (!command || command.pubkey !== pubkey || command.relay !== selectedRelay)
      return of<{ status: "idle" | "loading" | "ready" | "error"; results: NostrEvent[]; error: string }>({
        status: "idle",
        results: [],
        error: "",
      });
    return pool
      .relay(command.relay)
      .request(
        { kinds: [kinds.ShortTextNote], "#p": [command.pubkey], search: command.query, limit: 50 },
        { timeout: 10_000 },
      )
      .pipe(
        mapEventsToStore(eventStore),
        mapEventsToTimeline(),
        map((results) => ({ status: "ready" as const, results, error: "" })),
        startWith({ status: "loading" as const, results: [] as NostrEvent[], error: "" }),
        catchError((error) =>
          of({ status: "error" as const, results: [] as NostrEvent[], error: String(error.message ?? error) }),
        ),
      );
  }, [pubkey, selectedRelay, command]);
  const results = state?.results ?? [];
  const searching = state?.status === "loading";
  const error = state?.error;
  const handleSearch = () => {
    if (selectedRelay && query.trim()) setCommand({ pubkey, relay: selectedRelay, query: query.trim() });
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="container mx-auto max-w-4xl p-4 space-y-4">
      <div>
        <h1 className="font-semibold text-2xl mb-1">Search Inbox Mentions</h1>
        <p className="text-sm opacity-70">
          Pick a user, then search one of their NIP-65 inbox relays for kind&nbsp;1 events that tag them via{" "}
          <code className="font-mono">#p</code>. Requires the relay to support NIP-50.
        </p>
      </div>

      <PubkeyPicker value={pubkey} onChange={setPubkey} placeholder="Enter pubkey or nostr identifier…" />

      {user && <UserHeader user={user} />}

      {user && inboxes === undefined && (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          Loading inbox relays…
        </div>
      )}

      {user && inboxes && inboxes.length === 0 && (
        <div className="alert alert-warning">
          <span>This user has no NIP-65 inbox relays published.</span>
        </div>
      )}

      {user && inboxes && inboxes.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="label">
            <span className="label-text font-semibold">Inbox relay</span>
          </label>
          <select
            className="select select-bordered w-full font-mono"
            value={selectedRelay ?? ""}
            onChange={(e) => setSelectedRelayChoice(e.target.value || null)}
          >
            <option value="">Select an inbox relay…</option>
            {inboxes.map((url) => (
              <InboxRelayOption key={url} url={url} supported={supportMap?.[url]} />
            ))}
          </select>
        </div>
      )}

      {selectedRelay && (
        <div className="flex flex-col gap-2">
          <label className="label">
            <span className="label-text font-semibold">Search query</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search content of mentions…"
              className="input input-bordered flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
            >
              {searching ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Searching…
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {results.length > 0 && selectedRelay && (
        <div className="space-y-3">
          <div className="text-sm font-semibold">Results ({results.length})</div>
          {results.map((event) => (
            <ResultCard key={event.id} event={event} fallbackRelay={selectedRelay} />
          ))}
        </div>
      )}

      {selectedRelay && state?.status === "ready" && results.length === 0 && (
        <div className="alert alert-info">
          <span>No matching events found.</span>
        </div>
      )}
    </div>
  );
}
