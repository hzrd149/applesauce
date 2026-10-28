/**
 * Plugs multiple messaging protocol adapters into a built-in napplet through NAP-DM
 * @tags nip-5d, napplet, kehto, nip-17, nip-04, nip-44, nip-59, nip-77, messages, dm, ndr
 * @related messages/gift-wrap, messages/legacy, napplet/identity
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ActionRunner, type ActionBuilder } from "applesauce-actions";
import {
  AddDirectMessageRelay,
  RemoveDirectMessageRelay,
  AddInboxRelay,
  RemoveInboxRelay,
  AddOutboxRelay,
  RemoveOutboxRelay,
} from "applesauce-actions/actions";
import { ProxySigner } from "applesauce-accounts";
import { castUser, User } from "applesauce-common/casts";
import { isGiftWrapUnlocked, persistEncryptedContent } from "applesauce-common/helpers";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import {
  ensureWebSocketURL,
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
  createWrappedMessageProtocol,
  createLegacyMessageProtocol,
  defaultDmRouter,
  firstMatchingRoute,
  useProtocolWhenSupported,
  type DmProtocolAdapter,
  type KehtoContext,
} from "applesauce-extra/kehto";
import { createKehtoHost, type KehtoNappletInstance } from "applesauce-extra/kehto/host";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronDown, Settings, LogIn, LogOut, X } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useRef, useState, type ReactNode } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  EMPTY,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import RelayPicker from "../../components/relay-picker";
import SecureStorage from "../../extra/encrypted-storage";
import { createNdrMessageProtocol } from "../../extra/ndr-message-protocol";
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
type MailboxProtocol = "nip17" | "nip04";
const nip17Enabled$ = new BehaviorSubject(false);
const nip04Enabled$ = new BehaviorSubject(false);
const ndrEnabled$ = new BehaviorSubject(false);
const ndrRelays$ = new BehaviorSubject(FALLBACK_RELAYS);
const sendProtocol$ = new BehaviorSubject("auto");

const eventStore = new EventStore({ verifyEvent: (event) => isFromCache(event) || verifyEvent(event) });
const pool = new RelayPool();
const relayActions = new ActionRunner(eventStore, new ProxySigner(signer$), async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((response) => response.ok)) throw new Error("No relay accepted the relay list");
});
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
function mailboxes(user: User, protocol?: MailboxProtocol): { relays$: Observable<string[]>; filter: Filter }[] {
  const mailboxes = [
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
  return protocol === "nip17" ? mailboxes.slice(0, 1) : protocol === "nip04" ? mailboxes.slice(1) : mailboxes;
}

/** Routes every signer decryption through encrypted storage and shares concurrent requests */
function cachedSigner(signer: ISigner, pubkey: string, storage: SecureStorage): ISigner {
  const pending = new Map<string, Promise<string>>();

  function encryption(method: "nip04" | "nip44") {
    const implementation = signer[method];
    if (!implementation) return undefined;

    return {
      encrypt: implementation.encrypt.bind(implementation),
      decrypt: (peer: string, ciphertext: string) => {
        const digest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([method, peer, ciphertext]))));
        const key = `decrypt:${pubkey}:${digest}`;
        const existing = pending.get(key);
        if (existing) return existing;

        const request = (async () => {
          const cached = await storage.getItem(key);
          if (cached !== null) return cached;

          const plaintext = await implementation.decrypt(peer, ciphertext);
          if (!(await storage.setItem(key, plaintext))) throw new Error("Failed to cache decrypted message");
          return plaintext;
        })();

        pending.set(key, request);
        const release = () => pending.delete(key);
        void request.then(release, release);
        return request;
      },
    };
  }

  // Bind methods to the original signer so class instances keep their private state.
  return new Proxy(signer, {
    get(target, property) {
      if (property === "nip04" || property === "nip44") return encryption(property);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
function syncMailboxes(user: User, since: number, once = false, protocol?: MailboxProtocol) {
  return combineLatest(
    mailboxes(user, protocol).map(({ relays$, filter }) =>
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
function liveMailboxes(user: User, protocol: MailboxProtocol) {
  return merge(
    ...mailboxes(user, protocol).map(({ relays$, filter }) =>
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

type Prompt = { template: EventTemplate; protocol?: string; resolve: (ok: boolean) => void };
const prompts$ = new BehaviorSubject<Prompt[]>([]);

type LogEntry = { id: number; direction: "in" | "out" | "error"; type: string; error?: string };
const log$ = new BehaviorSubject<LogEntry[]>([]);

let logId = 0;
function addLog(direction: LogEntry["direction"], type: string, error?: string) {
  log$.next([{ id: logId++, direction, type, error }, ...log$.value].slice(0, MAX_LOG));
}

/** Queues a send prompt for the host UI and waits for the user to answer it */
function approve(template: EventTemplate, protocol?: string, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const prompt: Prompt = {
      template,
      protocol,
      resolve: (ok) => {
        signal?.removeEventListener("abort", cancel);
        resolve(ok);
      },
    };
    const cancel = () => answer(prompt, false);
    if (signal?.aborted) return resolve(false);
    signal?.addEventListener("abort", cancel, { once: true });
    prompts$.next([...prompts$.value, prompt]);
  });
}

function answer(prompt: Prompt, ok: boolean) {
  prompts$.next(prompts$.value.filter((current) => current !== prompt));
  prompt.resolve(ok);
}

const kehtoContext: KehtoContext = {
  pool,
  eventStore,
  signer: signer$,
  decryptionCache: {
    getItem: (key) => storage$.value!.getItem(`napplet:${key}`),
    setItem: (key, content) => storage$.value!.setItem(`napplet:${key}`, content),
  },
  fallbackRelays: FALLBACK_RELAYS,
  // The DM protocols ask before signing, with the plaintext message as the template
  approve: ({ template }) => approve(template),
};

// NDR owns its encrypted runtime internally and plugs into the same adapter interface.
const { protocol: ndrProtocol, view$: ndrView$ } = createNdrMessageProtocol({
  pool,
  eventStore,
  enabled$: ndrEnabled$,
  storage$,
  signer$,
  ownerPubkey$: user$.pipe(map((user) => user?.pubkey)),
  relays$: ndrRelays$,
  approve,
  addLog,
});

/** Stops a protocol's session work while disabled without rebuilding the host */
function toggleProtocol(protocol: DmProtocolAdapter, enabled$: BehaviorSubject<boolean>): DmProtocolAdapter {
  return {
    ...protocol,
    session$: enabled$.pipe(
      switchMap((enabled) => (enabled ? protocol.session$ : of(undefined))),
      shareReplay({ bufferSize: 1, refCount: true }),
    ),
  };
}

const wrappedProtocol = toggleProtocol(createWrappedMessageProtocol(kehtoContext), nip17Enabled$);
const legacyProtocol = toggleProtocol(createLegacyMessageProtocol(kehtoContext), nip04Enabled$);
const autoDmRouter = firstMatchingRoute(useProtocolWhenSupported("ndr"), defaultDmRouter);

function setProtocolEnabled(protocol: string, enabled$: BehaviorSubject<boolean>, enabled: boolean) {
  if (!enabled && sendProtocol$.value === protocol) sendProtocol$.next("auto");
  if (!enabled) {
    for (const prompt of prompts$.value) {
      const promptProtocol =
        prompt.protocol === "NDR" ? "ndr" : prompt.template.kind === kinds.PrivateDirectMessage ? "nip17" : "nip04";
      if (promptProtocol === protocol) answer(prompt, false);
    }
  }
  enabled$.next(enabled);
}

const services = {
  identity: createKehtoIdentityService(kehtoContext),
  resource: createKehtoResourceService(kehtoContext),
  common: createKehtoCommonService(kehtoContext),
  // The NIP-17 and NIP-04 protocols fail independently, so one broken backend still leaves the other readable
  dm: createKehtoDmService(kehtoContext, {
    protocols: [wrappedProtocol, legacyProtocol, ndrProtocol],
    routeSend: (context) => (sendProtocol$.value === "auto" ? autoDmRouter(context) : sendProtocol$.value),
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
    for (const prompt of prompts$.value) answer(prompt, false);
    sendProtocol$.next("auto");
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

/** Keeps status mounted when collapsed so presentation does not control protocol lifetimes */
function ProtocolSection({
  name,
  enabled,
  onToggle,
  onSettings,
  state,
  children,
}: {
  name: string;
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  onSettings: () => void;
  state?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-b border-base-300">
      <div className="flex items-center gap-2 p-2">
        <button
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
          aria-label={`${name} status`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <span className="flex-1">{name}</span>
          {state && <span className="badge">{state}</span>}
        </button>
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={`${name} settings`}
          title={`${name} setup and settings`}
          onClick={onSettings}
        >
          <Settings className="size-4" />
        </button>
        <input
          type="checkbox"
          className="toggle toggle-sm"
          aria-label={`Enable ${name}`}
          checked={enabled}
          disabled={!onToggle}
          onChange={(event) => onToggle?.(event.target.checked)}
        />
      </div>
      <div hidden={!expanded} className="px-2 pb-2">
        {children}
      </div>
    </section>
  );
}

function SettingsRelayRow({ url, onRemove }: { url: string; onRemove: () => void }) {
  const relay = pool.relay(url);
  const name = use$(relay.name$);
  const icon = use$(relay.icon$);

  return (
    <li className="flex items-center gap-3 border-b border-base-300 py-2">
      <img src={icon} className="size-8 shrink-0 rounded-full bg-base-300 object-cover" alt="" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={name}>
          {name || new URL(url).hostname}
        </div>
        <div className="truncate text-sm text-base-content/60" title={url}>
          {url}
        </div>
      </div>
      <button className="btn btn-ghost btn-square btn-sm" aria-label={`Remove ${url}`} onClick={onRemove}>
        <X className="size-4" />
      </button>
    </li>
  );
}

function NdrSetup({ onClose }: { onClose: () => void }) {
  const enabled = use$(ndrEnabled$) ?? false;
  const view = use$(ndrView$);
  const activeRelays = use$(ndrRelays$) ?? FALLBACK_RELAYS;
  const [relays, setRelays] = useState(activeRelays);
  const [busy, setBusy] = useState(false);
  const [inviteSubmitted, setInviteSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const relaysChanged = relays.join() !== activeRelays.join();

  const addRelay = (value: string) => {
    try {
      const url = ensureWebSocketURL(value.trim());
      setRelays((current) => (current.some((relay) => isSameURL(relay, url)) ? current : [...current, url]));
      setError(undefined);
    } catch (error) {
      setError(String(error));
    }
  };

  const run = async () => {
    if (!view?.run || busy || relaysChanged) return;
    setBusy(true);
    setError(undefined);
    setInviteSubmitted(false);
    try {
      await view.run(view.phase === "register" ? "register" : "invite");
      setInviteSubmitted(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      className="modal"
      aria-labelledby="ndr-setup-title"
      ref={(dialog) => dialog?.showModal()}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="modal-box">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 id="ndr-setup-title" className="text-lg font-semibold">
            NDR setup and settings
          </h2>
          <button
            className="btn btn-ghost btn-square btn-sm"
            aria-label="Close NDR setup"
            disabled={busy}
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <ProtocolToggle
          name="NDR"
          enabled={enabled}
          onToggle={(enabled) => setProtocolEnabled("ndr", ndrEnabled$, enabled)}
        />
        <ol className="flex flex-col gap-5">
          <li>
            <h3 className="font-medium mb-2">1. Choose relays</h3>
            <fieldset disabled={busy} className="min-w-0">
              <ul className="mb-2">
                {relays.map((relay) => (
                  <SettingsRelayRow
                    key={relay}
                    url={relay}
                    onRemove={() => setRelays(relays.filter((selected) => selected !== relay))}
                  />
                ))}
              </ul>
              <RelayPicker
                key={relays.join()}
                value=""
                onChange={addRelay}
                common={FALLBACK_RELAYS}
                className="w-full"
              />
              {relays.length === 0 && <p className="text-sm text-error mt-2">Choose at least one relay</p>}
              {relaysChanged && (
                <button
                  className="btn btn-sm mt-2"
                  disabled={!relays.length}
                  onClick={() => {
                    setInviteSubmitted(false);
                    setError(undefined);
                    ndrRelays$.next(relays);
                  }}
                >
                  Apply relays
                </button>
              )}
            </fieldset>
          </li>
          <li className="flex items-center justify-between gap-2">
            <h3 className="font-medium">2. Register this device</h3>
            <span className="badge">
              {view?.phase === "ready" ? "Registered" : view?.phase === "starting" ? "Checking…" : "Required"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <h3 className="font-medium">3. Publish invite</h3>
            <span className="badge">{inviteSubmitted ? "Submitted" : busy ? "Submitting…" : "Pending"}</span>
          </li>
        </ol>
        <div aria-live="polite" className="mt-4 text-sm">
          {view?.phase === "starting" && (
            <span>
              <span className="loading loading-spinner loading-sm mr-2" />
              Loading device state…
            </span>
          )}
          {view?.phase === "login" && <span>Sign in and unlock storage to continue</span>}
          {inviteSubmitted && <span>Invite submitted. Relay acknowledgements appear in the message log.</span>}
          {(error || view?.error) && (
            <p role="alert" className="text-error break-words">
              {error ?? view?.error}
            </p>
          )}
        </div>
        <div className="modal-action">
          {view?.phase === "error" && (
            <button className="btn" onClick={() => ndrRelays$.next([...relays])} disabled={!relays.length}>
              Retry connection
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!view?.run || busy || relaysChanged || !relays.length}
            onClick={run}
          >
            {busy && <span className="loading loading-spinner loading-sm" />}
            {view?.phase === "register" ? "Register device & publish invite" : "Publish invite"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            {inviteSubmitted ? "Done" : "Close"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function NdrStatus() {
  const relays = use$(ndrRelays$) ?? [];
  const view = use$(ndrView$);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
        <dt>Relays</dt>
        <dd title={relays.join("\n")}>{relays.length}</dd>
        {view?.state ? (
          <>
            <dt>Registered devices</dt>
            <dd>{view.state.registeredDevices.length}</dd>
            <dt>This device</dt>
            <dd title={view.state.currentDevicePubkey ?? undefined}>
              {view.state.isCurrentDeviceRegistered ? "Registered" : "Unregistered"}
            </dd>
            <dt>Private messaging</dt>
            <dd>{view.state.canSendPrivateMessages ? "Ready" : "Not ready"}</dd>
            <dt>Local app keys</dt>
            <dd>{view.state.hasLocalAppKeys ? "Available" : "Missing"}</dd>
            <dt>Session manager</dt>
            <dd>{view.state.sessionManagerReady ? "Ready" : "Starting"}</dd>
            <dt>App keys subscription</dt>
            <dd>{view.state.appKeysSubscriptionActive ? "Active" : "Inactive"}</dd>
          </>
        ) : (
          <>
            <dt>Device state</dt>
            <dd>
              {view?.phase === "starting" ? "Loading…" : view?.phase === "login" ? "Sign in to load" : "Unavailable"}
            </dd>
          </>
        )}
      </dl>
      {view?.error && (
        <p className="text-error break-words" role="alert">
          {view.error}
        </p>
      )}
    </div>
  );
}

function ProtocolSettingsModal({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = `protocol-settings-${name}`;

  return (
    <dialog className="modal" aria-labelledby={titleId} ref={(dialog) => dialog?.showModal()} onClose={onClose}>
      <div className="modal-box border border-base-300 shadow-none">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {name} setup and settings
          </h2>
          <button className="btn btn-ghost btn-square btn-sm" aria-label={`Close ${name} settings`} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>Close</button>
      </form>
    </dialog>
  );
}

function ProtocolToggle({
  name,
  enabled,
  onToggle,
}: {
  name: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 mb-4">
      Enable {name}
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={enabled}
        onChange={(event) => onToggle(event.target.checked)}
      />
    </label>
  );
}

/** Lists independent protocol lifetimes above the explicit send preference */
function ProtocolControls() {
  const [settingsProtocol, setSettingsProtocol] = useState<MailboxProtocol | "ndr">();
  const nip17 = use$(nip17Enabled$);
  const nip04 = use$(nip04Enabled$);
  const ndr = use$(ndrEnabled$);
  const view = use$(ndrView$);
  const selected = use$(sendProtocol$);
  const user = use$(user$);
  const signer = use$(signer$);

  return (
    <section aria-label="Messaging protocols">
      <ProtocolSection
        name="NIP-17"
        enabled={nip17 ?? false}
        onToggle={(enabled) => setProtocolEnabled("nip17", nip17Enabled$, enabled)}
        onSettings={() => setSettingsProtocol("nip17")}
      >
        {nip17 && user && signer && <Mailboxes key={user.pubkey} user={user} signer={signer} protocol="nip17" />}
      </ProtocolSection>
      <ProtocolSection
        name="NIP-04"
        enabled={nip04 ?? false}
        onToggle={(enabled) => setProtocolEnabled("nip04", nip04Enabled$, enabled)}
        onSettings={() => setSettingsProtocol("nip04")}
      >
        {nip04 && user && signer && <Mailboxes key={user.pubkey} user={user} signer={signer} protocol="nip04" />}
      </ProtocolSection>
      <ProtocolSection
        name="NDR"
        enabled={ndr ?? false}
        onToggle={(enabled) => setProtocolEnabled("ndr", ndrEnabled$, enabled)}
        state={ndr && view?.phase !== "disabled" ? view?.phase : undefined}
        onSettings={() => setSettingsProtocol("ndr")}
      >
        <NdrStatus />
      </ProtocolSection>
      {settingsProtocol === "ndr" && <NdrSetup onClose={() => setSettingsProtocol(undefined)} />}
      {settingsProtocol && settingsProtocol !== "ndr" && (
        <ProtocolSettingsModal
          name={settingsProtocol === "nip17" ? "NIP-17" : "NIP-04"}
          onClose={() => setSettingsProtocol(undefined)}
        >
          <ProtocolToggle
            name={settingsProtocol === "nip17" ? "NIP-17" : "NIP-04"}
            enabled={(settingsProtocol === "nip17" ? nip17 : nip04) ?? false}
            onToggle={(enabled) =>
              setProtocolEnabled(
                settingsProtocol,
                settingsProtocol === "nip17" ? nip17Enabled$ : nip04Enabled$,
                enabled,
              )
            }
          />
          {user && signer ? (
            <MailboxSettings key={`${user.pubkey}:${settingsProtocol}`} user={user} protocol={settingsProtocol} />
          ) : (
            <p>Sign in to load relay settings</p>
          )}
        </ProtocolSettingsModal>
      )}
      <div className="p-2 border-b border-base-300">
        <label className="flex items-center gap-2">
          Routing
          <select
            className="select select-sm flex-1"
            aria-label="Send protocol"
            value={selected ?? "auto"}
            onChange={(event) => sendProtocol$.next(event.target.value)}
          >
            <option value="auto">Auto</option>
            <option value="nip17" disabled={!nip17}>
              NIP-17
            </option>
            <option value="nip04" disabled={!nip04}>
              NIP-04
            </option>
            <option value="ndr" disabled={!ndr || view?.phase !== "ready"}>
              NDR
            </option>
          </select>
        </label>
      </div>
    </section>
  );
}

/** A send request from the napplet, showing which protocol carries it and what it says */
function SendPrompt({ prompt }: { prompt: Prompt }) {
  const { template } = prompt;
  const recipients = template.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);

  return (
    <div className="flex items-center gap-2 p-2 border-b border-warning bg-warning/10">
      <span className="badge badge-warning shrink-0">
        {prompt.protocol ?? (template.kind === kinds.PrivateDirectMessage ? "NIP-17" : "NIP-04")}
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
  const name = use$(relay.name$);
  const authenticated = use$(relay.authenticated$);
  const requested = use$(() => authRequests$.pipe(map((urls) => urls.some((u) => isSameURL(u, url)))), [url]);

  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-sm">
      <img src={icon} className="w-5 h-5 shrink-0 rounded-full bg-base-300" alt="" />
      <span className="flex-1 truncate" title={url}>
        {name || new URL(url).hostname}
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

function MailboxRelayEditor({ user, list }: { user: User; list: "dm" | "inbox" | "outbox" }) {
  const relayStream = list === "dm" ? user.directMessageRelays$ : list === "inbox" ? user.inboxes$ : user.outboxes$;
  const relays = use$(relayStream) ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [relayInput, setRelayInput] = useState("");
  const title = list === "dm" ? "Direct message relays" : list === "inbox" ? "Inbox relays" : "Outbox relays";
  const addAction = list === "dm" ? AddDirectMessageRelay : list === "inbox" ? AddInboxRelay : AddOutboxRelay;
  const removeAction =
    list === "dm" ? RemoveDirectMessageRelay : list === "inbox" ? RemoveInboxRelay : RemoveOutboxRelay;

  const updateRelay = async (action: ActionBuilder<[string | string[]]>, value: string) => {
    setBusy(true);
    setError(undefined);

    try {
      const url = ensureWebSocketURL(value.trim());
      await relayActions.run(action, url);
      setRelayInput("");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="font-medium mb-2">{title}</h3>
      <fieldset disabled={busy} className="min-w-0">
        <ul className="mb-2">
          {relays.map((url) => (
            <SettingsRelayRow key={url} url={url} onRemove={() => void updateRelay(removeAction, url)} />
          ))}
        </ul>
        {relays.length === 0 && <p className="text-sm text-base-content/60 mb-2">No relays configured</p>}
        <RelayPicker value={relayInput} onChange={setRelayInput} common={FALLBACK_RELAYS} className="w-full" />
        <button
          className="btn btn-sm mt-2"
          disabled={!relayInput.trim()}
          onClick={() => void updateRelay(addAction, relayInput)}
        >
          {busy && <span className="loading loading-spinner loading-sm" />} Add relay
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error break-words mt-2">
          {error}
        </p>
      )}
    </section>
  );
}

function MailboxSettings({ user, protocol }: { user: User; protocol: MailboxProtocol }) {
  const signer = use$(signer$);
  return (
    <div className="flex flex-col gap-5">
      {protocol === "nip17" ? (
        <MailboxRelayEditor user={user} list="dm" />
      ) : (
        <>
          <MailboxRelayEditor user={user} list="inbox" />
          <MailboxRelayEditor user={user} list="outbox" />
          <MailboxRelayEditor user={user} list="dm" />
        </>
      )}
      {signer && <Relays user={user} signer={signer} protocol={protocol} showRows={false} />}
    </div>
  );
}

/** The DM relays and the NIP-42 requests waiting for the user */
function Relays({
  user,
  signer,
  protocol,
  allowAuthentication = true,
  showRows = true,
}: {
  user: User;
  signer: ISigner;
  protocol: MailboxProtocol;
  allowAuthentication?: boolean;
  showRows?: boolean;
}) {
  const relays = use$(
    () =>
      protocol === "nip17"
        ? user.directMessageRelays$.pipe(map((relays) => relays ?? []))
        : combineLatest([user.inboxes$, user.outboxes$, user.directMessageRelays$]).pipe(
            map(([inboxes, outboxes, dm]) => mergeRelaySets(inboxes, outboxes, dm)),
          ),
    [user, protocol],
  );
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
      {showRows && protocol === "nip17" && relays?.length === 0 && (
        <div className="flex items-center gap-2 px-2 py-1 text-warning" title="No kind 10050 DM relay list">
          <AlertTriangle className="w-4 h-4" /> 10050
        </div>
      )}
      {showRows && relays?.map((url) => <RelayRow key={url} url={url} />)}
      {allowAuthentication && requests.length > 0 && (
        <button className="btn btn-sm btn-warning m-2" disabled={pending} onClick={approveAll}>
          Authenticate relays ({requests.length})
        </button>
      )}
    </section>
  );
}

/** How many messages of each protocol the host has loaded and decrypted for the napplet */
function Counts({
  user,
  protocol,
  synced,
}: {
  user: User;
  protocol: MailboxProtocol;
  synced?: { loaded: number; done: boolean };
}) {
  const counts = use$(
    () =>
      eventStore.timeline(mailboxes(user, protocol).map((mailbox) => mailbox.filter)).pipe(
        watchEventsUpdates(eventStore),
        // Emit count values rather than mutable timeline arrays; never wait for a signer here.
        map((events) => ({
          loaded: events.length,
          locked: events.filter((event) =>
            protocol === "nip17" ? !isGiftWrapUnlocked(event) : !isEncryptedContentUnlocked(event),
          ).length,
        })),
      ),
    [user, protocol],
  );

  return (
    <section className="flex flex-wrap items-center gap-2 p-2 border-b border-base-300">
      <span className="badge" title="Loaded messages">
        {counts?.loaded ?? 0} loaded
      </span>
      <span className="badge" title="Messages still encrypted">
        {counts?.locked ?? 0} locked
      </span>
      {!synced?.done && <span className="loading loading-spinner loading-sm" title="Syncing the last 30 days" />}
    </section>
  );
}

/** Bulk loads older messages the same way startup reconciles the last month */
function SyncControl({ user, protocol }: { user: User; protocol: MailboxProtocol }) {
  const [span, setSpan] = useState<number>(SYNC_SPANS[0][1]);
  const [run, setRun] = useState<{ since: number }>();
  const status = use$(() => run && syncMailboxes(user, run.since, true, protocol), [run, user, protocol]);
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
    <div className="max-h-80 overflow-y-auto font-mono text-sm">
      {entries.length === 0 && <div className="p-2 text-base-content/60">No messages logged</div>}
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
function Mailboxes({ user, signer, protocol }: { user: User; signer: ISigner; protocol: MailboxProtocol }) {
  // The relay lists are kept loaded so the DM service routes sends without waiting for lookups
  use$(user.inboxes$);
  use$(user.outboxes$);

  const synced = use$(
    () =>
      merge(
        syncMailboxes(user, unixNow() - STARTUP_SPAN, false, protocol),
        liveMailboxes(user, protocol).pipe(ignoreElements()),
      ),
    [user, protocol],
  );

  return (
    <>
      <Counts user={user} protocol={protocol} synced={synced} />
      <Relays user={user} signer={signer} protocol={protocol} allowAuthentication={false} />
      <SyncControl user={user} protocol={protocol} />
    </>
  );
}

function Sidebar() {
  return (
    <aside className="w-80 shrink-0 min-h-0 overflow-y-auto border-l border-base-300">
      <ProtocolControls />
      <details className="border-b border-base-300">
        <summary className="p-2 cursor-pointer">Debug</summary>
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-sm">Message log</span>
          <button className="btn btn-sm btn-ghost" onClick={() => log$.next([])}>
            Clear
          </button>
        </div>
        <MessageLog />
      </details>
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
    signer$.next(cachedSigner(signer, pubkey, storage));
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
