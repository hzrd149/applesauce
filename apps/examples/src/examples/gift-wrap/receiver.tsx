/**
 * Receive, decrypt and durably store every NIP-59 gift wrap for an account with shared automatic and manual processing
 * @tags gift-wrap, nip-59, nip-44, nip-42, nip-77, encryption, sync, cache, receiver
 * @related gift-wrap/generator, gift-wrap/dashboard, messages/gift-wrap
 */
import { castUser, type User } from "applesauce-common/casts";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked, type Rumor } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { AsyncRumorStore, EventMemory, type IAsyncEventDatabase } from "applesauce-core/event-store";
import {
  getDisplayName,
  getProfilePicture,
  persistEventsToCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  GiftWrapReceiver,
  type GiftWrapFailure,
  type GiftWrapProcessingStore,
  type GiftWrapReadResult,
} from "applesauce-extra/gift-wrap";
import type { MessageAuthRequest } from "applesauce-extra/messages";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Lock } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type ReactNode, useRef, useState } from "react";
import {
  BehaviorSubject,
  combineLatest,
  finalize,
  from,
  map,
  merge,
  NEVER,
  of,
  scan,
  shareReplay,
  switchMap,
} from "rxjs";

import JsonBlock from "../../components/json-block";
import LoginView, { forgetActiveAccount } from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

type HistoryRange = "recent" | "year" | "all";
type View = "rumors" | "locked" | "failed" | "envelopes";

// Used when the account has not published kind 10050 inbox relays
const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

const PAGE = 50;
const OUTCOME_LIMIT = 50;

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
const storage$ = new BehaviorSubject<SecureStorage | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Encrypted envelopes are cached as-is; only their plaintext needs encrypted storage
const db = await openDB();
const cacheRequest = async (filters: Parameters<typeof getEventsForFilters>[1]) =>
  (await getEventsForFilters(db, filters)) as NostrEvent[];

persistEventsToCache(eventStore, (events) => addEvents(db, events));
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, cacheRequest });

/** Creates a processing store that keeps one encrypted checkpoint per envelope */
function createProcessingStore(storage: SecureStorage): GiftWrapProcessingStore {
  return {
    list: async () => {
      const keys = await storage.keys();
      const records = await Promise.all(keys.map((key) => storage.getItem(key)));

      return records.filter((record) => record !== null).map((record) => JSON.parse(record));
    },
    set: async (record) => {
      // The receiver only records progress once this write resolves, so failed writes must reject
      const saved = await storage.setItem(record.eventId, JSON.stringify(record));
      if (!saved) throw new Error("Failed to save processing checkpoint");
    },
  };
}

/** Creates a rumor database that loads saved rumors into memory and encrypts each new rumor before it resolves */
async function createRumorDatabase(storage: SecureStorage): Promise<IAsyncEventDatabase<Rumor>> {
  const memory = new EventMemory<Rumor>();

  const keys = await storage.keys();
  const saved = await Promise.all(keys.map((key) => storage.getItem(key)));
  for (const json of saved) if (json) memory.add(JSON.parse(json));

  const remove = async (rumor: string | Rumor) => {
    const id = typeof rumor === "string" ? rumor : rumor.id;
    await storage.removeItem(id);
    return memory.remove(id);
  };

  return {
    hasEvent: async (id) => memory.hasEvent(id),
    getEvent: async (id) => memory.getEvent(id),
    hasReplaceable: async (kind, pubkey, identifier) => memory.hasReplaceable(kind, pubkey, identifier),
    getReplaceable: async (kind, pubkey, identifier) => memory.getReplaceable(kind, pubkey, identifier),
    getReplaceableHistory: async (kind, pubkey, identifier) => memory.getReplaceableHistory(kind, pubkey, identifier),
    getByFilters: async (filters) => memory.getByFilters(filters),
    getTimeline: async (filters) => memory.getTimeline(filters),
    // Writing the same rumor twice only overwrites it, so a repeated add after a crash is harmless
    add: async (rumor) => {
      const saved = await storage.setItem(rumor.id, JSON.stringify(rumor));
      if (!saved) throw new Error("Failed to save rumor");

      return memory.add(rumor);
    },
    remove,
    removeByFilters: async (filters) => {
      const matches = memory.getByFilters(filters);
      for (const rumor of matches) await remove(rumor);

      return matches.length;
    },
  };
}

// The stream owns one receiver per account; switching accounts or leaving the page disposes it
const receiver$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!signer || !user || !storage) return of(undefined);

    const scoped = (name: string) => storage.createInstance({ name: `gift-wrap-receiver:${name}:${user.pubkey}` });

    return from(createRumorDatabase(scoped("rumors"))).pipe(
      switchMap((database) => {
        const receiver = new GiftWrapReceiver({
          pubkey: user.pubkey,
          signer,
          eventStore,
          pool,
          cacheRequest,
          // Both decrypted layers are cached, so a reload never asks the signer twice
          decryptionCache: storage,
          rumorStore: new AsyncRumorStore({ database }),
          processingStore: createProcessingStore(scoped("processing")),
          fallbackRelays: FALLBACK_RELAYS,
          // Timeouts and storage failures retry with backoff; signer failures wait for the user
          retryPolicy: { maxAttempts: 3 },
        });

        return merge(of(receiver), NEVER).pipe(finalize(() => receiver.dispose()));
      }),
    );
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Collects the newest outcomes from the live watch, or from store processing only */
function outcomes$(receiver: GiftWrapReceiver, live: boolean) {
  const source$ = live ? receiver.watch$ : receiver.receive$;

  return source$.pipe(
    scan((outcomes: GiftWrapReadResult[], outcome) => [outcome, ...outcomes].slice(0, OUTCOME_LIMIT), []),
  );
}

/** Returns the start of a history range, or undefined for the receiver's live lookback */
function getHistorySince(range: HistoryRange) {
  if (range === "year") return unixNow() - 365 * 86400;
  if (range === "all") return 0;
  return undefined;
}

/** Formats a timestamp as a time for today and a date otherwise */
function formatShortTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

/** Describes a failure for a tooltip */
function describeFailure(failure: GiftWrapFailure) {
  const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
  return `${failure.stage} stage, ${failure.attempts} attempts, ${failure.retry} retry\n${message}`;
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function AuthenticationRelay({ request, onAuthenticate }: { request: MessageAuthRequest; onAuthenticate: () => void }) {
  const relay = pool.relay(request.url);
  const name = use$(relay.name$);
  const icon = use$(relay.icon$);

  return (
    <button
      className="flex min-w-0 items-center gap-2 rounded p-2 text-left hover:bg-base-200 disabled:opacity-60"
      disabled={request.state === "authenticating"}
      title={request.error ? String(request.error) : request.url}
      onClick={onAuthenticate}
    >
      <img src={icon} alt="" className="h-6 w-6 shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate">{name ?? new URL(request.url).hostname}</span>
      {request.state === "authenticating" && <span className="loading loading-spinner loading-sm" />}
      {request.state === "failed" && <span className="text-sm text-error">Retry</span>}
    </button>
  );
}

/** Pull-based processing paced by the app, cancelled through an AbortController */
function ManualControls({ receiver, locked, failed }: { receiver: GiftWrapReceiver; locked: number; failed: number }) {
  const [running, setRunning] = useState<"next" | "all" | "retry">();
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);

  const run = async (task: "next" | "all" | "retry", work: (signal: AbortSignal) => Promise<void>) => {
    const current = new AbortController();
    controller.current = current;
    setRunning(task);
    setError(undefined);

    try {
      await work(current.signal);
    } catch (error) {
      if (!current.signal.aborted) setError(String(error));
    } finally {
      controller.current = undefined;
      setRunning(undefined);
    }
  };

  // Outcomes from every pull also reach the shared outcome stream, so the loops ignore them
  const unlockNext = () =>
    run("next", async (signal) => {
      await receiver.readNext({ signal });
    });

  const unlockAll = () =>
    run("all", async (signal) => {
      for await (const _outcome of receiver.readInbox({ signal })) {
        // The next envelope starts only after this pull finishes, so the app sets the pace
      }
    });

  const retryFailed = () =>
    run("retry", async (signal) => {
      for await (const _outcome of receiver.retryFailed({ signal })) {
        // Each failed envelope is retried with any layers it already decrypted
      }
    });

  if (running && running !== "next")
    return (
      <button className="btn btn-sm" onClick={() => controller.current?.abort()}>
        <span className="loading loading-spinner loading-sm" />
        Stop
      </button>
    );

  return (
    <>
      <div className="join">
        <button className="btn btn-sm join-item flex-1" disabled={!!running || locked === 0} onClick={unlockNext}>
          {running === "next" && <span className="loading loading-spinner loading-sm" />}
          Unlock next
        </button>
        <button className="btn btn-sm join-item flex-1" disabled={!!running || locked === 0} onClick={unlockAll}>
          Unlock all
        </button>
      </div>
      {failed > 0 && (
        <button className="btn btn-sm" disabled={!!running} onClick={retryFailed}>
          Retry {failed} failed
        </button>
      )}
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </>
  );
}

function HistoryControls({ receiver, live }: { receiver: GiftWrapReceiver; live: boolean }) {
  const [range, setRange] = useState<HistoryRange>("recent");

  // Older ranges reconcile with NIP-77 on top of the live lookback; recent relies on the watch alone
  const history = use$(
    () => (range === "recent" ? undefined : receiver.sync$({ since: getHistorySince(range) })),
    [receiver, range],
  );
  const relayErrors = Object.values(history?.relays ?? {}).filter((relay) => relay.error);

  return (
    <>
      <div className="join">
        {HISTORY_RANGES.map((option) => (
          <button
            key={option.value}
            className={`btn btn-sm join-item flex-1 ${range === option.value ? "btn-active" : ""}`}
            disabled={option.value === "recent" && !live}
            onClick={() => setRange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {history && (
        <div className="flex flex-wrap items-center gap-2 text-sm opacity-60">
          {!history.done && <span className="loading loading-spinner loading-sm" />}
          <span>{history.loaded} synced</span>
          {relayErrors.length > 0 && (
            <span
              className="text-error"
              title={relayErrors.map((relay) => `${relay.relay}: ${relay.error?.message}`).join("\n")}
            >
              {relayErrors.length} relays failed
            </span>
          )}
        </div>
      )}
    </>
  );
}

function RumorRow({ rumor }: { rumor: Rumor }) {
  const author = castUser(rumor.pubkey, eventStore);

  return (
    <div className="flex items-center gap-3 border-b border-base-300 p-3">
      <Avatar user={author} size="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <Name user={author} />
          <span className="badge badge-ghost">kind {rumor.kind}</span>
          <span className="ms-auto shrink-0 text-sm opacity-60">{formatShortTime(rumor.created_at)}</span>
        </div>
        <span className="truncate text-sm opacity-60">{rumor.content || "No content"}</span>
      </div>
    </div>
  );
}

function EnvelopeRow({
  receiver,
  envelope,
  failure,
}: {
  receiver: GiftWrapReceiver;
  envelope: NostrEvent;
  failure?: GiftWrapFailure;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const rumor = getGiftWrapRumor(envelope);

  // A single envelope joins any processing already running for it instead of decrypting twice
  const process = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);

    try {
      await work();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <div className="flex items-center gap-3">
        {rumor ? (
          <span className="badge badge-success">kind {rumor.kind}</span>
        ) : failure ? (
          <span className="badge badge-error" title={describeFailure(failure)}>
            {failure.code}
          </span>
        ) : (
          <Lock className="h-4 w-4 opacity-60" aria-label="Locked" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-sm opacity-60" title={envelope.id}>
          {envelope.id}
        </span>
        <span className="shrink-0 text-sm opacity-60">{formatShortTime(envelope.created_at)}</span>

        {!rumor && !failure && (
          <button className="btn btn-sm" disabled={busy} onClick={() => process(() => receiver.unlock(envelope))}>
            {busy && <span className="loading loading-spinner loading-sm" />}
            Unlock
          </button>
        )}
        {failure && failure.retry !== "never" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => process(() => receiver.retry(envelope.id))}>
            {busy && <span className="loading loading-spinner loading-sm" />}
            Retry
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
      {open && (
        <div className="text-sm">
          <JsonBlock value={{ wrap: envelope, seal: getGiftWrapSeal(envelope), rumor }} />
        </div>
      )}
    </div>
  );
}

function OutcomeRow({ outcome }: { outcome: GiftWrapReadResult }) {
  return (
    <div className="flex items-center gap-2 border-b border-base-300 p-3 text-sm">
      {outcome.status === "success" ? (
        <>
          <span className="badge badge-success">kind {outcome.rumor.kind}</span>
          <span className="min-w-0 flex-1 truncate opacity-60">{outcome.rumor.content || "No content"}</span>
        </>
      ) : (
        <>
          <span className="badge badge-error" title={describeFailure(outcome.failure)}>
            {outcome.failure.code}
          </span>
          <span className="min-w-0 flex-1 truncate opacity-60">{outcome.failure.stage}</span>
        </>
      )}
      <span className="shrink-0 opacity-60">{formatShortTime(outcome.event.created_at)}</span>
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

function Receiver({ receiver, user }: { receiver: GiftWrapReceiver; user: User }) {
  const state = use$(receiver.decryptionState$);
  const envelopes = use$(receiver.giftWraps$);
  const rumors = use$(receiver.rumors$);
  const relays = use$(receiver.relays$);
  const autoUnlock = use$(receiver.autoUnlock$);
  const auth = use$(receiver.authRequests$) ?? [];
  const failure = use$(
    () => receiver.errors$.pipe(map((error) => `${error.operation}: ${String(error.error)}`)),
    [receiver],
  );

  // Live watching loads from relays and processes; receiving only processes envelopes already in the store
  const [live, setLive] = useState(true);
  const outcomes = use$(() => outcomes$(receiver, live), [receiver, live]);

  const [view, setView] = useState<View>("rumors");
  const [limit, setLimit] = useState(PAGE);
  const [authenticatingAll, setAuthenticatingAll] = useState(false);

  const failures = state?.errors ?? new Map<string, GiftWrapFailure>();
  const locked = (envelopes ?? []).filter((event) => !isGiftWrapUnlocked(event) && !failures.has(event.id));
  const failed = (envelopes ?? []).filter((event) => failures.has(event.id));

  const views: { value: View; label: string; count: number }[] = [
    { value: "rumors", label: "Rumors", count: rumors?.length ?? 0 },
    { value: "locked", label: "Locked", count: locked.length },
    { value: "failed", label: "Failed", count: failed.length },
    { value: "envelopes", label: "Envelopes", count: envelopes?.length ?? 0 },
  ];
  const listed = view === "locked" ? locked : view === "failed" ? failed : (envelopes ?? []);

  const selectView = (next: View) => {
    setView(next);
    setLimit(PAGE);
  };

  const authenticateAll = async () => {
    setAuthenticatingAll(true);

    // Each relay row shows its own failure and retry
    await receiver.authenticateAll().catch(() => undefined);
    setAuthenticatingAll(false);
  };

  return (
    <div className="flex min-h-0 min-w-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Receiving">
            <Toggle label="Watch relays" checked={live} onChange={setLive} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-ghost" title={relays?.join("\n")}>
                {relays?.length ?? 0} relays
              </span>
              <span className="badge badge-ghost">{rumors?.length ?? 0} stored</span>
            </div>
          </Section>

          <Section title="Decryption">
            <Toggle
              label="Auto-unlock"
              checked={autoUnlock ?? false}
              onChange={(enabled) => receiver.setAutoUnlock(enabled)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-ghost">{state?.unlocked ?? 0} unlocked</span>
              <span className="badge badge-ghost">{state?.locked ?? 0} locked</span>
              {failures.size > 0 && <span className="badge badge-error">{failures.size} failed</span>}
            </div>
            <ManualControls receiver={receiver} locked={locked.length} failed={failed.length} />
          </Section>

          <Section title="History">
            <HistoryControls receiver={receiver} live={live} />
          </Section>

          {auth.length > 0 && (
            <Section title="Authentication">
              {auth.map((request) => (
                <AuthenticationRelay
                  key={request.url}
                  request={request}
                  onAuthenticate={() => receiver.authenticate(request.url).catch(() => undefined)}
                />
              ))}
              <button
                className="btn btn-sm"
                disabled={authenticatingAll || auth.every((request) => request.state === "authenticating")}
                onClick={authenticateAll}
              >
                {authenticatingAll && <span className="loading loading-spinner loading-sm" />}
                Auth all
              </button>
            </Section>
          )}

          {failure && <p className="p-3 text-sm text-error [overflow-wrap:anywhere]">{failure}</p>}
        </div>
        <Account user={user} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-base-300 p-3">
          <div className="join">
            {views.map((option) => (
              <button
                key={option.value}
                className={`btn btn-sm join-item ${view === option.value ? "btn-active" : ""}`}
                onClick={() => selectView(option.value)}
              >
                {option.label}
                <span className="badge badge-ghost">{option.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === "rumors" ? (
            rumors === undefined ? (
              <span className="loading loading-dots m-6" />
            ) : rumors.length === 0 ? (
              <p className="p-6 text-center opacity-60">No rumors</p>
            ) : (
              rumors.slice(0, limit).map((rumor) => <RumorRow key={rumor.id} rumor={rumor} />)
            )
          ) : envelopes === undefined ? (
            <span className="loading loading-dots m-6" />
          ) : listed.length === 0 ? (
            <p className="p-6 text-center opacity-60">No envelopes</p>
          ) : (
            listed
              .slice(0, limit)
              .map((envelope) => (
                <EnvelopeRow
                  key={envelope.id}
                  receiver={receiver}
                  envelope={envelope}
                  failure={failures.get(envelope.id)}
                />
              ))
          )}

          {(view === "rumors" ? (rumors?.length ?? 0) : listed.length) > limit && (
            <button className="btn btn-ghost m-3" onClick={() => setLimit(limit + PAGE)}>
              Show more
            </button>
          )}
        </div>
      </main>

      <aside className="flex w-80 shrink-0 flex-col border-s border-base-300">
        <div className="flex items-center gap-2 border-b border-base-300 p-3">
          <span className="font-semibold">Outcomes</span>
          <span className="badge badge-ghost">{outcomes?.length ?? 0}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {outcomes?.length ? (
            outcomes.map((outcome, index) => <OutcomeRow key={`${outcome.event.id}:${index}`} outcome={outcome} />)
          ) : (
            <p className="p-6 text-center opacity-60">No outcomes</p>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function GiftWrapReceiverExample() {
  const signer = use$(signer$);
  const user = use$(user$);
  const storage = use$(storage$);
  const receiver = use$(receiver$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!receiver) return <span className="loading loading-spinner m-auto" />;

  return <Receiver key={user.pubkey} receiver={receiver} user={user} />;
}
