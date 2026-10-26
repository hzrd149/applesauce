/**
 * Sync every NIP-59 gift wrap a set of relays will serve, authenticating with NIP-42 where required, and rank the recipients
 * @tags gift-wrap, nip-59, nip-42, nip-77, sync, negentropy, loader, dashboard, auth
 * @related gift-wrap/generator, gift-wrap/timeline, messages/gift-wrap, moderation/reports
 */
import { castUser, type User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  getTagValue,
  kinds,
  normalizeToPubkey,
  relaySet,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncRelayStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { Lock, RefreshCw, ShieldCheck, X } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { BehaviorSubject, combineLatest, ignoreElements, map, merge, throttleTime } from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

// Inbox and DM relays that usually require auth, followed by popular public relays
const PRESET_RELAYS = [
  "wss://auth.nostr1.com/",
  "wss://inbox.relays.land/",
  "wss://nip17.com/",
  "wss://relay.0xchat.com/",
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.primal.net/",
];

const DAY = 24 * 60 * 60;
const WINDOWS: { label: string; span?: number }[] = [
  { label: "24h", span: DAY },
  { label: "7d", span: 7 * DAY },
  { label: "30d", span: 30 * DAY },
  { label: "All" },
];
const PAGE = 100;

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

// The relays to sync, a subject so the sync loader starts added relays and stops removed ones without restarting
const relays$ = new BehaviorSubject<string[]>(["wss://auth.nostr1.com/", "wss://relay.damus.io/", "wss://nos.lol/"]);

// Relays waiting for NIP-42 auth, the sync waits on them (authTimeout: false) until the user approves
const authRequests$ = new BehaviorSubject<string[]>([]);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Recipient profiles load on demand from the lookup relays
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: relays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

function requestAuth({ relay }: { relay: { url: string } }) {
  if (!authRequests$.value.includes(relay.url)) authRequests$.next([...authRequests$.value, relay.url]);
}

/** Syncs every gift wrap since a timestamp into the store and emits the sync status */
function syncWraps$(since?: number) {
  const { status$, events$ } = syncLoader({
    relays: relays$,
    filter: { kinds: [kinds.GiftWrap], since },
    onAuthRequired: requestAuth,
    authTimeout: false,
  });
  // Subscribing to events$ stops the loader buffering them, the store already has every event
  return merge(events$.pipe(ignoreElements()), status$);
}

/** The stored gift wraps seen on the selected relays, throttled so large syncs re-render twice a second */
function wraps$(since?: number) {
  const timeline$ = eventStore
    .timeline({ kinds: [kinds.GiftWrap], since })
    .pipe(throttleTime(500, undefined, { leading: true, trailing: true }));

  // Removing a relay drops the wraps only it served from the counts
  return combineLatest([timeline$, relays$]).pipe(
    map(([events, relays]) => events.filter((e) => [...(getSeenRelays(e) ?? [])].some((r) => relays.includes(r)))),
  );
}

type Recipient = { pubkey: string; count: number; relays: Set<string>; latest: number };

/** Groups gift wraps by their "p" tag recipient, most wraps first */
function groupByRecipient(events: NostrEvent[]): Recipient[] {
  const recipients = new Map<string, Recipient>();
  for (const event of events) {
    const pubkey = getTagValue(event, "p");
    if (!pubkey) continue;
    const r = recipients.get(pubkey) ?? { pubkey, count: 0, relays: new Set(), latest: 0 };
    r.count++;
    r.latest = Math.max(r.latest, event.created_at);
    for (const relay of getSeenRelays(event) ?? []) r.relays.add(relay);
    recipients.set(pubkey, r);
  }
  return [...recipients.values()].sort((a, b) => b.count - a.count);
}

/**
 * Signs an AUTH event for a relay, removing it from the queue so its waiting sync resumes
 * @throws if the relay rejects the AUTH event
 */
async function authenticate(signer: ISigner, url: string) {
  const response = await pool.relay(url).authenticate(signer);
  if (!response.ok) throw new Error(response.message ?? "Rejected by relay");
  authRequests$.next(authRequests$.value.filter((u) => u !== url));
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
}

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");

function Avatar({ user, size = "size-8" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
      className={`${size} shrink-0 rounded-full object-cover`}
      alt=""
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="min-w-0 truncate font-medium">{getDisplayName(profile, user.npub.slice(0, 12))}</span>;
}

/** A relay with its sync progress, auth state and an authenticate button when the relay asks for it */
function RelayRow({
  url,
  status,
  selected,
  onToggle,
  onRemove,
  onAuth,
}: {
  url: string;
  status?: SyncRelayStatus;
  selected: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onAuth: () => Promise<unknown>;
}) {
  const relay = pool.relay(url);
  const authedAs = use$(relay.authenticatedAs$);
  const requested = use$(() => authRequests$.pipe(map((urls) => urls.includes(url))), [url]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const auth = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const state = selected ? (status?.state ?? "pending") : undefined;
  const title = [
    url,
    status?.method && `via ${status.method}${status.fallbackReason ? ` (${status.fallbackReason.message})` : ""}`,
    status?.error?.message,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex flex-col gap-1 border-b border-base-300 px-3 py-2">
      <div className="flex items-center gap-2">
        <input type="checkbox" className="checkbox checkbox-sm" checked={selected} onChange={onToggle} />
        <span className="min-w-0 flex-1 truncate" title={title}>
          {short(url)}
        </span>
        {authedAs ? (
          <ShieldCheck className="size-4 text-success" aria-label={`Authenticated as ${authedAs}`} />
        ) : (
          requested && <Lock className="size-4 text-warning" aria-label="Auth required" />
        )}
        {state && (state === "checking" || state === "loading") && !requested && (
          <span className="loading loading-spinner loading-sm" />
        )}
        {state && (
          <span className={`tabular-nums ${state === "error" ? "text-error" : "opacity-60"}`} title={title}>
            {status?.count ?? 0}
          </span>
        )}
        {onRemove && (
          <button className="btn btn-ghost btn-sm btn-square" title="Remove relay" onClick={onRemove}>
            <X className="size-4" />
          </button>
        )}
      </div>
      {selected && requested && !authedAs && (
        <button className="btn btn-sm btn-warning" disabled={busy} onClick={auth}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Authenticate"}
        </button>
      )}
      {error && <span className="text-sm text-error">{error}</span>}
      {state === "error" && <span className="truncate text-sm text-error">{status?.error?.message}</span>}
    </div>
  );
}

function Account({ user, onSignIn }: { user?: User; onSignIn: () => void }) {
  if (!user)
    return (
      <div className="border-t border-base-300 p-2">
        <button className="btn btn-sm w-full" onClick={onSignIn}>
          Sign in to authenticate
        </button>
      </div>
    );

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} />
      <Name user={user} />
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-32 flex-1 border-e border-base-300 p-3 last:border-e-0" title={title}>
      <div className="text-sm opacity-60">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function RecipientRow({ rank, recipient, self }: { rank: number; recipient: Recipient; self?: string }) {
  const user = castUser(recipient.pubkey, eventStore);
  const relays = [...recipient.relays];

  return (
    <tr className={recipient.pubkey === self ? "bg-primary/10" : undefined}>
      <td className="tabular-nums opacity-60">{rank}</td>
      <td className="w-full max-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar user={user} />
          <div className="flex min-w-0 flex-col">
            <Name user={user} />
            <code className="truncate text-sm opacity-60">{user.npub}</code>
          </div>
          {recipient.pubkey === self && <span className="badge badge-primary">You</span>}
        </div>
      </td>
      <td>
        <span className="badge badge-ghost whitespace-nowrap" title={relays.join("\n")}>
          {relays.length} {relays.length === 1 ? "relay" : "relays"}
        </span>
      </td>
      <td className="tabular-nums opacity-60">{new Date(recipient.latest * 1000).toLocaleDateString()}</td>
      <td className="text-right font-semibold tabular-nums">{recipient.count.toLocaleString()}</td>
    </tr>
  );
}

export default function GiftWrapDashboard() {
  const login = useRef<HTMLDialogElement>(null);
  const signer = use$(signer$);
  const user = use$(user$);
  const relays = use$(relays$);
  const requests = use$(authRequests$);

  const [range, setRange] = useState(WINDOWS[1]);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // A new window or a refresh starts a new sync, negentropy only downloads what the store is missing
  const since = useMemo(() => (range.span ? unixNow() - range.span : undefined), [range, refresh]);
  const status = use$(() => syncWraps$(since), [since]);
  const wraps = use$(() => wraps$(since), [since]);

  const recipients = useMemo(() => groupByRecipient(wraps ?? []), [wraps]);
  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return recipients;
    let pubkey: string | null = null;
    try {
      pubkey = normalizeToPubkey(query);
    } catch {}
    return recipients.filter((r) => (pubkey ? r.pubkey === pubkey : r.pubkey.startsWith(query)));
  }, [recipients, query]);

  const mine = user ? recipients.find((r) => r.pubkey === user.pubkey) : undefined;
  const statuses = Object.values(status?.relays ?? {});
  const finished = statuses.filter((s) => s.state === "complete" || s.state === "error").length;
  const syncing = !status?.done;

  const list = relaySet(PRESET_RELAYS, relays ?? []);
  const toggleRelay = (url: string) =>
    relays$.next(relays$.value.includes(url) ? relays$.value.filter((r) => r !== url) : [...relays$.value, url]);
  const addRelay = (url: string) => relays$.next(relaySet(relays$.value, url));
  const removeRelay = (url: string) => relays$.next(relays$.value.filter((r) => r !== url));

  // Authenticating needs a signer, so ask the user to sign in first
  const auth = async (url: string) => {
    if (!signer) return login.current?.showModal();
    await authenticate(signer, url);
  };
  const authAll = (urls: string[]) => {
    if (!signer) return login.current?.showModal();
    // Each row shows its own retry, so failures here are left for the user to retry individually
    Promise.allSettled(urls.map((url) => authenticate(signer, url)));
  };
  const pending = (requests ?? []).filter((url) => relays?.includes(url));

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="flex items-center gap-2 border-b border-base-300 p-3">
          <span className="font-semibold">Relays</span>
          <span className="badge badge-ghost" title={(relays ?? []).join("\n")}>
            {finished}/{relays?.length ?? 0}
          </span>
          {pending.length > 1 && (
            <button className="btn btn-sm btn-warning ms-auto" onClick={() => authAll(pending)}>
              Auth all
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((url) => (
            <RelayRow
              key={url}
              url={url}
              status={status?.relays[url]}
              selected={!!relays?.includes(url)}
              onToggle={() => toggleRelay(url)}
              onRemove={PRESET_RELAYS.includes(url) ? undefined : () => removeRelay(url)}
              onAuth={() => auth(url)}
            />
          ))}
          <div className="p-3">
            {/* Remount after each add so the picker clears */}
            <RelayPicker key={list.join()} value="" onChange={addRelay} common={PRESET_RELAYS} className="w-full" />
          </div>
        </div>
        <Account user={user} onSignIn={() => login.current?.showModal()} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-wrap border-b border-base-300">
          <Stat
            label="Gift wraps"
            value={(wraps?.length ?? 0).toLocaleString()}
            title={`${status?.loaded ?? 0} synced`}
          />
          <Stat label="Recipients" value={recipients.length.toLocaleString()} />
          <Stat
            label="Relays"
            value={`${finished}/${statuses.length}`}
            title={statuses.map((s) => `${short(s.relay)}: ${s.state} (${s.count})`).join("\n")}
          />
          {user && <Stat label="To you" value={(mine?.count ?? 0).toLocaleString()} />}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
          <div className="join">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                className={`btn btn-sm join-item ${w === range ? "btn-primary" : ""}`}
                onClick={() => setRange(w)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm btn-square"
            title="Sync again"
            disabled={syncing}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {syncing ? <span className="loading loading-spinner loading-sm" /> : <RefreshCw className="size-4" />}
          </button>
          <input
            type="search"
            className="input input-sm w-80"
            placeholder="npub or pubkey"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {pending.length > 0 && (
            <span className="badge badge-warning gap-1" title={pending.join("\n")}>
              <Lock className="size-3" /> {pending.length} waiting for auth
            </span>
          )}
          <span className="ms-auto">
            <strong>{filtered.length.toLocaleString()}</strong> of {recipients.length.toLocaleString()} recipients
          </span>
        </div>

        {filtered.length > 0 ? (
          <table className="table table-pin-rows">
            <thead>
              <tr>
                <th>#</th>
                <th>Recipient</th>
                <th>Seen on</th>
                <th>Latest</th>
                <th className="text-right">Wraps</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => (
                <RecipientRow key={r.pubkey} rank={i + 1} recipient={r} self={user?.pubkey} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-8 text-center opacity-60">
            {syncing ? "Syncing gift wraps…" : query ? "No matching recipients" : "No gift wraps on these relays"}
          </p>
        )}
        {filtered.length > limit && (
          <button className="btn btn-ghost m-3" onClick={() => setLimit(limit + PAGE)}>
            Show more ({(filtered.length - limit).toLocaleString()} left)
          </button>
        )}
      </main>

      <dialog className="modal" ref={login}>
        <div className="modal-box">
          <LoginView
            onLogin={(signer, pubkey) => {
              signer$.next(signer);
              user$.next(castUser(pubkey, eventStore));
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
