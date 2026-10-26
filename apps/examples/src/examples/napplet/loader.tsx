/**
 * Run NIP-5D napplets with the kehto runtime, using applesauce as the cache-first data layer behind every NAP
 * @tags nip-5d, napplet, nip-44, nip-65, cache, outbox
 * @related napplet/browser, napplet/store, outbox/client-startup, cache/nostr-idb
 */
import { getNappletCatalogId, openNappletArtifactCache, parseNappletManifest } from "@kehto/nip/5d";
import {
  createCatalogIntentResolver,
  createIntentService,
  createKeysService,
  createLinkService,
  createNotifyService,
  createResourceService,
  createThemeService,
  manifestToIntentCatalogEntry,
  type IntentDispatchParams,
} from "@kehto/services";
import {
  createKehtoIdentityService,
  createKehtoOutboxService,
  createKehtoCommonService,
  createKehtoCountService,
  createKehtoListsService,
  createKehtoUploadService,
  createResourceOptions,
  kehtoAccount$,
  type KehtoContext,
} from "applesauce-extra/kehto";
import { createKehtoHost, type KehtoNappletInstance } from "applesauce-extra/kehto/host";
import { castEvent, castUser, Napplet, User } from "applesauce-common/casts";
import {
  isValidNapplet,
  mergeBlossomServers,
  NAPPLET_KIND,
  NAPPLET_KINDS,
  NAPPLET_ROOT_KIND,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  decodePointer,
  isFromCache,
  persistEventsToCache,
  type EventTemplate,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Bell, Database, LogOut, Play, ShieldCheck, X } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { BehaviorSubject, catchError, concatMap, filter, from, map, merge, of, take } from "rxjs";
import LoginView, { forgetActiveAccount } from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

// Cached events were verified before they were written, the optimistic verifier handles the rest
const eventStore = new EventStore({ verifyEvent: (event) => isFromCache(event) || verifyEvent(event) });
const pool = new RelayPool();

// Every event a napplet loads lands in IndexedDB, so the next napplet (or reload) reads it locally
const cache = await openDB();
const cacheRequest = (filters: Filter[]) => getEventsForFilters<NostrEvent>(cache, filters);
persistEventsToCache(eventStore, (events) => addEvents(cache, events));
createEventLoaderForStore(eventStore, pool, { cacheRequest, lookupRelays: lookupRelays$ });

// Verified napplet artifacts are kept in Cache Storage, so a second launch never touches Blossom
const artifactCache = await openNappletArtifactCache();

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const pubkey$ = new BehaviorSubject("");

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const FALLBACK_BLOSSOM = ["https://blossom.primal.net/"];

// ---- Prompts, toasts and panes: plain module state rendered by the UI below

type Prompt = { label: string; windowId: string; resolve: (ok: boolean) => void };
const prompts$ = new BehaviorSubject<Prompt[]>([]);
const ask = (windowId: string, label: string) =>
  new Promise<boolean>((resolve) => prompts$.next([...prompts$.value, { windowId, label, resolve }]));
function answer(prompt: Prompt, ok: boolean) {
  prompts$.next(prompts$.value.filter((p) => p !== prompt));
  prompt.resolve(ok);
}

type Toast = { id: string; windowId: string; title: string; body?: string; emit: (msg: any) => void };
const toasts$ = new BehaviorSubject<Toast[]>([]);
const removeToast = (id: string) => toasts$.next(toasts$.value.filter((t) => t.id !== id));

type Pane = {
  windowId: string;
  napplet: Napplet;
  instance: KehtoNappletInstance;
  ms: number;
  badge$: BehaviorSubject<number>;
};
const panes$ = new BehaviorSubject<Pane[]>([]);
const paneFor = (windowId: string) => panes$.value.find((p) => p.windowId === windowId);

// ---- Signing approval

// Signing grants are remembered per napplet artifact
const grants = new Set<string>(JSON.parse(localStorage.getItem("napplet-grants") ?? "[]"));

async function approve(windowId: string, template: EventTemplate) {
  const pane = paneFor(windowId);
  const key = pane ? `${pane.instance.resolved.manifest.catalogId}:${pane.instance.resolved.aggregateHash}` : windowId;
  if (grants.has(key)) return;
  if (!(await ask(windowId, `Sign kind ${template.kind} events`))) throw new Error("User denied");
  grants.add(key);
  localStorage.setItem("napplet-grants", JSON.stringify([...grants]));
}

/** Maps the DaisyUI theme variables to a NAP-THEME object */
function getTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
  return { colors: { background: v("base-100"), text: v("base-content"), primary: v("primary") } };
}
const theme = createThemeService({
  initialTheme: getTheme(),
  onBroadcast: (env) => host.bridge.publishTheme(env.theme),
});

const notify = createNotifyService({
  present: ({ windowId, notificationId: id, message, emit }) =>
    toasts$.next([...toasts$.value, { id, windowId, title: message.title, body: message.body, emit }]),
  dismiss: (_windowId, id) => removeToast(id),
  setBadge: (windowId, count) => paneFor(windowId)?.badge$.next(count),
  requestPermission: () => true,
});

const link = createLinkService({
  open: async ({ windowId, url }) => {
    if (!(await ask(windowId, `Open ${url.href}`))) return { status: "denied" };
    window.open(url.href, "_blank", "noopener,noreferrer");
    return { status: "opened" };
  },
});

// ---- NAP-KEYS: napplets bind actions to chords, which fire while the host page has focus
const keys = createKeysService();

// ---- NAP-RESOURCE: every byte is fetched and verified by the host

/** Opens the handler napplet for an intent and delivers the request once its document loads */
async function deliverIntent({ handler, sender, archetype, action, convention, payload }: IntentDispatchParams) {
  const event = eventStore.getByFilters({ kinds: NAPPLET_KINDS }).find((e) => getNappletCatalogId(e) === handler);
  if (!event) throw new Error("Handler not found");
  const pane = await openNapplet(event);
  await pane.instance.whenReady();
  const delivered = pane.instance.send({
    type: "intent.deliver",
    delivery: { sender, archetype, action, convention, payload },
  });
  if (!delivered) throw new Error("Intent delivery denied or target closed");
}

const intent = createIntentService({
  resolver: createCatalogIntentResolver({
    // Every napplet manifest in the store is a potential intent handler
    loadCatalog: () =>
      eventStore.getByFilters({ kinds: NAPPLET_KINDS }).flatMap((event) => {
        try {
          return [manifestToIntentCatalogEntry(parseNappletManifest(event))];
        } catch {
          return [];
        }
      }),
    targets: { accept: (params) => ({ completion: deliverIntent(params) }) },
  }),
  resolveSender: (windowId) => paneFor(windowId)?.instance.resolved.manifest.catalogId,
});

// ---- Shell bridge

const kehtoContext: KehtoContext = {
  pool,
  eventStore,
  signer: signer$,
  fallbackRelays: FALLBACK_RELAYS,
  fallbackBlossomServers: FALLBACK_BLOSSOM,
  approve: async ({ windowId, template }) => {
    if (!windowId) return false;
    await approve(windowId, template);
    return true;
  },
};

// Rasterize SVG in the browser before delivering it to a napplet.
const resourceOptions = createResourceOptions({
  eventStore,
  pubkey: kehtoAccount$(kehtoContext).pipe(map((account) => account?.pubkey)),
  fallbackServers: FALLBACK_BLOSSOM,
});
const resource = createResourceService({
  ...resourceOptions,
  fetch: async (url, init) => {
    const response = await resourceOptions.fetch!(url, init);
    if (!response.headers.get("content-type")?.startsWith("image/svg+xml")) return response;

    const image = new Image();
    image.src = URL.createObjectURL(await response.blob());
    await image.decode().finally(() => URL.revokeObjectURL(image.src));

    const canvas = document.createElement("canvas");
    canvas.width = Math.min(image.width || 512, 2048);
    canvas.height = Math.min(image.height || 512, 2048);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return new Response(png, { headers: { "content-type": "image/png" } });
  },
});

const host = createKehtoHost(kehtoContext, {
  cache: artifactCache,
  services: {
    identity: createKehtoIdentityService(kehtoContext),
    outbox: createKehtoOutboxService(kehtoContext),
    common: createKehtoCommonService(kehtoContext),
    count: createKehtoCountService(kehtoContext),
    lists: createKehtoListsService(kehtoContext),
    upload: createKehtoUploadService(kehtoContext),
    theme: theme.handler,
    notify,
    link,
    intent,
    keys,
    resource,
  },
});

// Push theme changes; the host forwards account changes automatically
const themeObserver = new MutationObserver(() => theme.publishTheme(getTheme()));
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

import.meta.hot?.dispose(() => {
  panes$.value.forEach(closeNapplet);
  themeObserver.disconnect();
  keys.destroy();
  host.destroy();
});

// ---- Napplet lifecycle

async function openNapplet(event: NostrEvent): Promise<Pane> {
  const napplet = castEvent(event, Napplet, eventStore);
  const start = performance.now();

  // The host verifies artifacts, selects Blossom servers, and owns each iframe lifecycle.
  const instance = await host.resolve(event);
  const pane: Pane = {
    windowId: instance.windowId,
    napplet,
    instance,
    ms: performance.now() - start,
    badge$: new BehaviorSubject(0),
  };
  panes$.next([...panes$.value, pane]);
  return pane;
}

function closeNapplet(pane: Pane) {
  pane.instance.destroy();
  panes$.next(panes$.value.filter((current) => current !== pane));
  for (const prompt of prompts$.value.filter((current) => current.windowId === pane.windowId)) answer(prompt, false);
}

// ---- UI

function title(napplet: Napplet) {
  return napplet.title || napplet.event.tags.find((t) => t[0] === "d")?.[1] || "Napplet";
}

function NappletIcon({ napplet, size = "w-10 h-10" }: { napplet: Napplet; size?: string }) {
  const servers = use$(napplet.author.blossomServers$);
  const server = mergeBlossomServers<string | URL>(napplet.servers, servers)[0];
  if (napplet.icon && server)
    return (
      <img className={`${size} rounded shrink-0 object-cover`} src={new URL(napplet.icon.sha256, server).href} alt="" />
    );
  return (
    <div className={`${size} rounded shrink-0 border border-base-300 flex items-center justify-center font-bold`}>
      {title(napplet)[0]?.toUpperCase()}
    </div>
  );
}

function Author({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="flex items-center gap-2 min-w-0 text-sm text-base-content/60">
      <img
        className="w-5 h-5 rounded-full shrink-0"
        src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
        alt=""
      />
      <span className="truncate">{profile?.displayName || user.npub.slice(0, 12)}</span>
    </div>
  );
}

function NappletItem({ napplet }: { napplet: Napplet }) {
  const [state, setState] = useState<"idle" | "loading" | Error>("idle");
  const run = () => {
    setState("loading");
    openNapplet(napplet.event).then(
      () => setState("idle"),
      (err) => setState(err instanceof Error ? err : new Error(String(err))),
    );
  };

  return (
    <button
      className="w-full flex items-center gap-2 p-2 border-b border-base-300 text-left hover:bg-base-200 disabled:opacity-60"
      disabled={state === "loading"}
      onClick={run}
    >
      <NappletIcon napplet={napplet} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{title(napplet)}</div>
        <Author user={napplet.author} />
        {state instanceof Error && <div className="text-sm text-error truncate">{state.message}</div>}
      </div>
      {state === "loading" && <span className="loading loading-spinner loading-sm" />}
    </button>
  );
}

function NappletPane({ pane }: { pane: Pane }) {
  const prompts = use$(prompts$)?.filter((p) => p.windowId === pane.windowId) ?? [];
  const badge = use$(pane.badge$);
  const initializationError = use$(
    () =>
      from(pane.instance.whenReady()).pipe(
        map(() => null),
        catchError((error) => of(error instanceof Error ? error : new Error(String(error)))),
      ),
    [pane],
  );

  return (
    <div className="flex flex-col min-w-96 flex-1 border-r border-base-300">
      <div className="flex items-center gap-2 p-2 border-b border-base-300">
        <NappletIcon napplet={pane.napplet} size="w-6 h-6" />
        <span className="font-semibold truncate">{title(pane.napplet)}</span>
        {badge ? <span className="badge badge-primary">{badge}</span> : null}
        <span className="flex-1" />
        <span className="badge badge-success gap-1 whitespace-nowrap" title={pane.instance.resolved.aggregateHash}>
          {pane.instance.source === "cache" ? <Database className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          {Math.round(pane.ms)}ms
        </span>
        <button aria-label="Close" className="btn btn-sm btn-ghost btn-square" onClick={() => closeNapplet(pane)}>
          <X className="w-4 h-4" />
        </button>
      </div>
      {prompts.map((p, i) => (
        <div key={i} className="flex items-center gap-2 p-2 border-b border-warning bg-warning/10">
          <span className="flex-1 truncate">{p.label}</span>
          <button className="btn btn-sm" onClick={() => answer(p, false)}>
            Deny
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => answer(p, true)}>
            Allow
          </button>
        </div>
      ))}
      {initializationError === undefined && <p className="p-2">Starting napplet…</p>}
      {initializationError && <p className="p-2 text-error">{initializationError.message}</p>}
      <iframe
        ref={(iframe) => {
          if (iframe) pane.instance.mount(iframe);
        }}
        sandbox="allow-scripts"
        className="flex-1"
        title={title(pane.napplet)}
      />
    </div>
  );
}

function Account() {
  const pubkey = use$(pubkey$);
  const [login, setLogin] = useState(false);
  const current = pubkey ? castUser(pubkey, eventStore) : undefined;
  const profile = use$(() => current?.profile$, [pubkey]);
  // Keep the user's relay list loaded so relay selection can read it synchronously
  use$(() => current?.mailboxes$, [pubkey]);

  if (!pubkey)
    return login ? (
      <LoginView onLogin={(signer, pk) => (signer$.next(signer), pubkey$.next(pk), setLogin(false))} />
    ) : (
      <button className="btn btn-sm" onClick={() => setLogin(true)}>
        Login
      </button>
    );

  const logout = () => (forgetActiveAccount(), signer$.next(undefined), pubkey$.next(""));
  return (
    <div className="flex items-center gap-2">
      <img className="w-6 h-6 rounded-full" src={profile?.picture || `https://robohash.org/${pubkey}.png`} alt="" />
      <span className="flex-1 truncate">{profile?.displayName || current?.npub.slice(0, 12)}</span>
      <button aria-label="Logout" className="btn btn-sm btn-ghost btn-square" onClick={logout}>
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = use$(toasts$) ?? [];
  const click = (t: Toast) => (t.emit({ type: "notify.clicked", notificationId: t.id }), removeToast(t.id));

  return (
    <div className="toast toast-end">
      {toasts.map((t) => (
        <div key={t.id} role="button" className="alert border border-base-300 cursor-pointer" onClick={() => click(t)}>
          <Bell className="w-4 h-4" />
          <div>
            <div className="font-semibold">{t.title}</div>
            {t.body && <div className="text-sm">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Pointers opened from a ?pointer= link, so a remount doesn't open them twice
const opened = new Set<string>();

export default function NappletLoader() {
  const [relay, setRelay] = useState("wss://relay.primal.net/");
  const [params] = useSearchParams();
  const pointer = params.get("pointer");
  const panes = use$(panes$) ?? [];

  // Cached manifests render immediately while the relay fills in new ones
  use$(
    () =>
      merge(
        makeCacheRequest(cacheRequest, [{ kinds: NAPPLET_KINDS }]),
        pool.relay(relay).subscription({ kinds: NAPPLET_KINDS, limit: 200 }),
      ).pipe(mapEventsToStore(eventStore)),
    [relay],
  );
  const napplets = use$(
    // Snapshots are pinned versions of a napplet, so only root and named napplets are listed
    () =>
      eventStore.timeline({ kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND] }).pipe(castTimelineStream(Napplet, eventStore)),
    [],
  );

  // Open the napplet from a ?pointer= link once the loader finds its manifest
  use$(() => {
    if (!pointer || opened.has(pointer)) return undefined;
    opened.add(pointer);
    const decoded = decodePointer(pointer);
    if (decoded.type !== "naddr" && decoded.type !== "nevent") return undefined;
    return eventStore.event(decoded.data).pipe(
      filter(isValidNapplet),
      take(1),
      concatMap((event) => openNapplet(event)),
      catchError(() => of(null)),
    );
  }, [pointer]);

  return (
    <div className="flex min-h-0 grow overflow-hidden">
      <div className="w-80 shrink-0 flex flex-col gap-2 p-2 border-r border-base-300 overflow-hidden">
        <Account />
        <RelayPicker value={relay} onChange={setRelay} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {napplets === undefined && <span className="loading loading-spinner" />}
          {napplets?.length === 0 && <p className="text-base-content/60">No napplets on this relay</p>}
          {napplets?.map((napplet) => (
            <NappletItem key={napplet.id} napplet={napplet} />
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-x-auto">
        {panes.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-base-content/40">
            <Play className="w-12 h-12" />
          </div>
        )}
        {panes.map((pane) => (
          <NappletPane key={pane.windowId} pane={pane} />
        ))}
      </div>

      <Toasts />
    </div>
  );
}
