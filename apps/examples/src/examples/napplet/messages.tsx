/**
 * Mount a built-in napplet that reads and sends legacy and wrapped direct messages through NAP-DM
 * @tags nip-5d, napplet, kehto, nip-17, nip-04, nip-44, nip-59, nip-77, messages, dm
 * @related messages/gift-wrap, messages/legacy, napplet/identity
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { castUser, User } from "applesauce-common/casts";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { GiftWrapsModel } from "applesauce-common/models";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import {
  finalizeEvent,
  generateSecretKey,
  getDisplayName,
  getProfilePicture,
  isEncryptedContentUnlocked,
  isFromCache,
  isSameURL,
  kinds,
  markFromCache,
  mergeRelaySets,
  persistEventsToCache,
  unixNow,
  type EventTemplate,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { watchEventsUpdates } from "applesauce-core/observable";
import {
  createKehtoDmService,
  createKehtoIdentityService,
  createKehtoResourceService,
  createKehtoCommonService,
  type KehtoContext,
} from "applesauce-extra/kehto";
import { createKehtoHost, type KehtoNappletInstance } from "applesauce-extra/kehto/host";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, LogIn, LogOut } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useRef, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  EMPTY,
  ignoreElements,
  map,
  merge,
  Observable,
  startWith,
  take,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";
// The built-in napplet is bundled into one HTML string by the vite config
import NAPPLET_HTML from "../../napplets/messages/index.html?napplet";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const MAX_LOG = 100;
const DAY = 24 * 60 * 60;
// NIP-59 randomizes gift wrap timestamps up to two days into the past
const TWO_DAYS = 2 * DAY;
// Startup only reconciles recent messages, older history is synced on demand
const STARTUP_SPAN = 30 * DAY;
// How far back the bulk sync can load, zero syncs the whole history
const SYNC_SPANS = [
  ["6 months", 182 * DAY],
  ["1 year", 365 * DAY],
  ["5 years", 5 * 365 * DAY],
  ["All time", 0],
] as const;

const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent: (event) => isFromCache(event) || verifyEvent(event) });
const pool = new RelayPool();
const cache = await openDB();

// Messages and profiles are saved to IndexedDB so the next visit only syncs what changed
persistEventsToCache(eventStore, (events) => addEvents(cache, events));
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  cacheRequest: (filters) => getEventsForFilters(cache, filters),
});

// Decrypted messages are saved to PIN-encrypted storage so the napplet doesn't prompt the signer again
persistEncryptedContent(eventStore, storage$.pipe(defined()));

const sync = createSyncLoader({ eventStore, pool });

// DM relays usually require NIP-42 auth, requests wait (authTimeout: false) until the user approves them
const authRequests$ = new BehaviorSubject<string[]>([]);
function requestAuth({ url }: { url: string }) {
  if (!authRequests$.value.includes(url)) authRequests$.next([...authRequests$.value, url]);
}

/** Where each kind of message lives: gift wraps on the DM relays, legacy messages on the NIP-65 mailboxes */
function mailboxes(user: User): { relays$: Observable<string[]>; filter: Filter }[] {
  return [
    {
      relays$: user.directMessageRelays$.pipe(map((relays) => relays ?? [])),
      filter: { kinds: [kinds.GiftWrap], "#p": [user.pubkey] },
    },
    {
      relays$: combineLatest([user.inboxes$, user.directMessageRelays$]).pipe(
        map(([inboxes, dm]) => mergeRelaySets(inboxes, dm)),
      ),
      filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [user.pubkey] },
    },
    {
      relays$: user.outboxes$.pipe(map((relays) => relays ?? [])),
      filter: { kinds: [kinds.EncryptedDirectMessage], authors: [user.pubkey] },
    },
  ];
}

/** Adds the cached messages to the store so their decrypted content restores before the napplet reads them */
async function loadCachedMessages(pubkey: string) {
  const filters = mailboxes(castUser(pubkey, eventStore)).map((mailbox) => mailbox.filter);

  for (const event of (await getEventsForFilters(cache, filters)) as NostrEvent[]) {
    markFromCache(event);
    eventStore.add(event);
  }
}

/**
 * Reconciles every mailbox since a date using NIP-77 where supported
 * @param once takes the current relay lists so the sync completes instead of following list updates
 */
function syncMailboxes(user: User, since: number, once = false) {
  return combineLatest(
    mailboxes(user).map(({ relays$, filter }) =>
      sync({
        relays: once ? relays$.pipe(take(1)) : relays$,
        // Reach two days further back because gift wrap timestamps are randomized into the past
        filter: { ...filter, since: Math.max(0, since - TWO_DAYS) },
        onAuthRequired: requestAuth,
        authTimeout: false,
        // Each mailbox reports progress from the start, so a slow relay in one doesn't hide the others
      }).status$.pipe(startWith<SyncLoaderStatus>({ relays: {}, loaded: 0, done: false })),
    ),
  ).pipe(
    map((statuses) => ({
      loaded: statuses.reduce((total, status) => total + status.loaded, 0),
      done: statuses.every((status) => status.done),
    })),
  );
}

/** Subscribes to new messages in every mailbox */
function liveMailboxes(user: User) {
  return merge(
    ...mailboxes(user).map(({ relays$, filter }) =>
      pool
        .subscription(
          relays$,
          { ...filter, since: unixNow() - TWO_DAYS },
          { reconnect: true, onAuthRequired: requestAuth, authTimeout: false },
        )
        .pipe(
          mapEventsToStore(eventStore),
          catchError(() => EMPTY),
        ),
    ),
  );
}

// ---- Kehto host

type Prompt = { template: EventTemplate; resolve: (ok: boolean) => void };
const prompts$ = new BehaviorSubject<Prompt[]>([]);

type LogEntry = { id: number; direction: "in" | "out" | "error"; type: string; error?: string };
const log$ = new BehaviorSubject<LogEntry[]>([]);

let logId = 0;
function addLog(direction: LogEntry["direction"], type: string, error?: string) {
  log$.next([{ id: logId++, direction, type, error }, ...log$.value].slice(0, MAX_LOG));
}

/** Queues a send prompt for the host UI and waits for the user to answer it */
function approve(template: EventTemplate) {
  return new Promise<boolean>((resolve) => prompts$.next([...prompts$.value, { template, resolve }]));
}

function answer(prompt: Prompt, ok: boolean) {
  prompts$.next(prompts$.value.filter((current) => current !== prompt));
  prompt.resolve(ok);
}

const kehtoContext: KehtoContext = {
  pool,
  eventStore,
  signer: signer$,
  fallbackRelays: FALLBACK_RELAYS,
  // The DM protocols ask before signing, with the plaintext message as the template
  approve: ({ template }) => approve(template),
};

const services = {
  identity: createKehtoIdentityService(kehtoContext),
  resource: createKehtoResourceService(kehtoContext),
  common: createKehtoCommonService(kehtoContext),
  // The NIP-17 and NIP-04 protocols fail independently, so one broken backend still leaves the other readable
  dm: createKehtoDmService(kehtoContext, {
    onProtocolError: ({ protocol, operation, error }) => addLog("error", `${protocol} ${operation}`, String(error)),
  }),
};

// Log the NAP-DM requests and results passing through the bridge
const dm = services.dm!;
services.dm = {
  ...dm,
  handleMessage: (windowId, message, send) => {
    addLog("in", message.type);

    dm.handleMessage(windowId, message, (result) => {
      const { ok, error } = result as { ok?: boolean; error?: unknown };
      const failed = ok === false || typeof error === "string";
      addLog("out", result.type, failed ? String(error ?? "failed") : undefined);
      send(result);
    });
  },
};

// Register messaging and identity explicitly
const host = createKehtoHost(kehtoContext, { services });

import.meta.hot?.dispose(() => host.destroy());

// The manifest is signed with a throwaway key; its x tag pins the sha256 of the HTML bytes
const nappletBytes = new TextEncoder().encode(NAPPLET_HTML);
const nappletManifest = finalizeEvent(
  {
    kind: 35129,
    content: "Messages demo",
    created_at: unixNow(),
    tags: [
      ["d", "messages-demo"],
      ["x", bytesToHex(sha256(nappletBytes))],
    ],
  },
  generateSecretKey(),
);

/** Resolves a fresh napplet instance on subscribe and destroys it on unsubscribe */
function nappletInstance$() {
  return new Observable<KehtoNappletInstance>((subscriber) => {
    let closed = false;
    let instance: KehtoNappletInstance | undefined;

    host.resolve(nappletManifest, { fetchBlob: async () => nappletBytes }).then(
      (resolved) => {
        if (closed) return resolved.destroy();
        instance = resolved;
        subscriber.next(resolved);
      },
      (error) => subscriber.error(error),
    );

    return () => {
      closed = true;
      instance?.destroy();
    };
  });
}

// ---- UI

function Avatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      className="w-6 h-6 shrink-0 rounded-full object-cover"
      src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)}
      title={getDisplayName(profile, pubkey.slice(0, 8))}
      alt=""
    />
  );
}

function Toolbar({ onLogin }: { onLogin: () => void }) {
  const user = use$(user$);
  const profile = use$(() => user?.profile$, [user]);

  const logout = () => {
    forgetActiveAccount();
    signer$.next(undefined);
    user$.next(undefined);
    authRequests$.next([]);
  };

  return (
    <div className="flex items-center gap-2 p-2 border-b border-base-300">
      <span className="flex-1" />
      {user ? (
        <>
          <Avatar pubkey={user.pubkey} />
          <span className="truncate">{getDisplayName(profile, user.npub.slice(0, 12))}</span>
          <button aria-label="Logout" title="Logout" className="btn btn-sm btn-ghost btn-square" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </button>
        </>
      ) : (
        <button className="btn btn-sm" onClick={onLogin}>
          <LogIn className="w-4 h-4" /> Login
        </button>
      )}
    </div>
  );
}

/** A send request from the napplet, showing which protocol carries it and what it says */
function SendPrompt({ prompt }: { prompt: Prompt }) {
  const { template } = prompt;
  const recipients = template.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);

  return (
    <div className="flex items-center gap-2 p-2 border-b border-warning bg-warning/10">
      <span className="badge badge-warning shrink-0">
        {template.kind === kinds.PrivateDirectMessage ? "🎁 NIP-17" : "✉️ NIP-04"}
      </span>
      <div className="flex shrink-0 -space-x-2">
        {recipients.map((pubkey) => (
          <Avatar key={pubkey} pubkey={pubkey} />
        ))}
      </div>
      <span className="flex-1 truncate" title={template.content}>
        {template.content}
      </span>
      <button className="btn btn-sm" onClick={() => answer(prompt, false)}>
        Deny
      </button>
      <button className="btn btn-sm btn-primary" onClick={() => answer(prompt, true)}>
        Allow
      </button>
    </div>
  );
}

function NappletFrame() {
  const instance = use$(() => nappletInstance$(), []);
  const prompts = use$(prompts$);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {prompts.map((prompt, index) => (
        <SendPrompt key={index} prompt={prompt} />
      ))}
      {instance ? (
        <iframe
          key={instance.windowId}
          ref={(iframe) => {
            if (iframe) instance.mount(iframe);
          }}
          sandbox="allow-scripts"
          className="flex-1"
          title="Messages demo napplet"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="loading loading-spinner" />
        </div>
      )}
    </div>
  );
}

function RelayRow({ url }: { url: string }) {
  const relay = pool.relay(url);
  const icon = use$(relay.icon$);
  const authenticated = use$(relay.authenticated$);
  const requested = use$(() => authRequests$.pipe(map((urls) => urls.some((u) => isSameURL(u, url)))), [url]);

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <img src={icon} className="w-5 h-5 shrink-0 rounded-full bg-base-300" alt="" />
      <span className="flex-1 truncate" title={url}>
        {new URL(url).hostname}
      </span>
      {authenticated ? (
        <span className="text-success" title="Authenticated">
          ✓
        </span>
      ) : (
        requested && <AlertTriangle className="w-4 h-4 text-warning" aria-label="Waiting for sign in" />
      )}
    </div>
  );
}

/** The DM relays and the NIP-42 requests waiting for the user */
function Relays({ user, signer }: { user: User; signer: ISigner }) {
  const relays = use$(user.directMessageRelays$);
  const requests = use$(authRequests$);
  const [pending, setPending] = useState(false);

  const approveAll = async () => {
    setPending(true);
    await Promise.allSettled(
      requests.map(async (url) => {
        const response = await pool.relay(url).authenticate(signer);
        if (response.ok) authRequests$.next(authRequests$.value.filter((u) => u !== url));
      }),
    );
    setPending(false);
  };

  return (
    <section className="flex flex-col border-b border-base-300 py-1">
      {relays?.length === 0 && (
        <div className="flex items-center gap-2 px-2 py-1 text-warning" title="No kind 10050 DM relay list">
          <AlertTriangle className="w-4 h-4" /> 10050
        </div>
      )}
      {relays?.map((url) => (
        <RelayRow key={url} url={url} />
      ))}
      {requests.length > 0 && (
        <button className="btn btn-sm btn-warning m-2" disabled={pending} onClick={approveAll}>
          🔑 {requests.length}
        </button>
      )}
    </section>
  );
}

/** How many messages of each protocol the host has loaded and decrypted for the napplet */
function Counts({ user, synced }: { user: User; synced?: { loaded: number; done: boolean } }) {
  const wraps = use$(() => eventStore.model(GiftWrapsModel, user.pubkey), [user.pubkey]);
  const lockedWraps = use$(() => eventStore.model(GiftWrapsModel, user.pubkey, false), [user.pubkey]);
  // watchEventsUpdates re-emits the same array, so count inside the pipe to give React a new value
  const legacy = use$(
    () =>
      eventStore
        .timeline(
          mailboxes(user)
            .slice(1)
            .map((mailbox) => mailbox.filter),
        )
        .pipe(
          watchEventsUpdates(eventStore),
          map((events) => ({
            total: events.length,
            locked: events.filter((event) => !isEncryptedContentUnlocked(event)).length,
          })),
        ),
    [user],
  );

  return (
    <section className="flex flex-wrap items-center gap-2 p-2 border-b border-base-300">
      <span className="badge" title="Gift wraps (locked)">
        🎁 {wraps?.length ?? 0} · 🔒 {lockedWraps?.length ?? 0}
      </span>
      <span className="badge" title="Legacy messages (locked)">
        ✉️ {legacy?.total ?? 0} · 🔒 {legacy?.locked ?? 0}
      </span>
      {!synced?.done && <span className="loading loading-spinner loading-sm" title="Syncing the last 30 days" />}
    </section>
  );
}

/** Bulk loads older messages the same way startup reconciles the last month */
function SyncControl({ user }: { user: User }) {
  const [span, setSpan] = useState<number>(SYNC_SPANS[0][1]);
  const [run, setRun] = useState<{ since: number }>();
  const status = use$(() => run && syncMailboxes(user, run.since, true), [run, user]);
  const running = !!run && !status?.done;

  return (
    <section className="flex items-center gap-2 p-2 border-b border-base-300">
      <select
        className="select select-sm min-w-0 flex-1"
        value={span}
        onChange={(e) => setSpan(Number(e.target.value))}
        disabled={running}
        aria-label="Sync messages from"
      >
        {SYNC_SPANS.map(([label, value]) => (
          <option key={label} value={value}>
            {label}
          </option>
        ))}
      </select>
      {running ? (
        <button className="btn btn-sm" onClick={() => setRun(undefined)}>
          <span className="loading loading-spinner loading-sm" /> {status?.loaded ?? 0}
        </button>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={() => setRun({ since: span ? unixNow() - span : 0 })}>
          Sync {status && `· ${status.loaded}`}
        </button>
      )}
    </section>
  );
}

function MessageLog() {
  const entries = use$(log$);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto font-mono text-sm">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 px-2 py-1 border-b border-base-300" title={entry.error}>
          {entry.direction === "in" && <ArrowUpRight className="w-4 h-4 shrink-0 text-info" />}
          {entry.direction === "out" && <ArrowDownLeft className="w-4 h-4 shrink-0 text-success" />}
          {entry.direction === "error" && <AlertTriangle className="w-4 h-4 shrink-0 text-error" />}
          <span className="flex-1 truncate">{entry.type}</span>
          {entry.error && entry.direction !== "error" && <span>❌</span>}
        </div>
      ))}
    </div>
  );
}

/** Keeps the user's mailboxes loaded into the store the napplet reads from */
function Mailboxes({ user, signer }: { user: User; signer: ISigner }) {
  // The relay lists are kept loaded so the DM service routes sends without waiting for lookups
  use$(user.inboxes$);
  use$(user.outboxes$);

  const synced = use$(
    () => merge(syncMailboxes(user, unixNow() - STARTUP_SPAN), liveMailboxes(user).pipe(ignoreElements())),
    [user],
  );

  return (
    <>
      <Counts user={user} synced={synced} />
      <Relays user={user} signer={signer} />
      <SyncControl user={user} />
    </>
  );
}

function Sidebar() {
  const user = use$(user$);
  const signer = use$(signer$);

  return (
    <aside className="w-80 shrink-0 flex flex-col border-l border-base-300">
      {user && signer && <Mailboxes key={user.pubkey} user={user} signer={signer} />}
      <MessageLog />
    </aside>
  );
}

export default function NappletMessages() {
  const storage = use$(storage$);
  const login = useRef<HTMLDialogElement>(null);

  // Unlock the encrypted storage first so decrypted messages restore before any are loaded
  if (!storage)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <UnlockView onUnlock={(storage) => storage$.next(storage)} />
      </div>
    );

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    // Cached messages are added before the signer, so the DM service finds them already decrypted
    await loadCachedMessages(pubkey);
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
    login.current?.close();
  };

  return (
    <div className="flex flex-col min-h-0 grow">
      <Toolbar onLogin={() => login.current?.showModal()} />
      <div className="flex min-h-0 flex-1">
        <NappletFrame />
        <Sidebar />
      </div>

      <dialog className="modal" ref={login}>
        <div className="modal-box max-w-sm overflow-hidden border border-base-300 bg-base-200 p-0 shadow-none">
          <LoginView onLogin={handleLogin} />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
