/**
 * Run NIP-5D napplets with the kehto runtime, using applesauce as the cache-first data layer behind every NAP
 * @tags nip-5d, napplet, nip-44, nip-65, cache, outbox
 * @related napplet/browser, napplet/store, outbox/client-startup, cache/nostr-idb
 */
import {
  fetchBlob,
  getNappletCatalogId,
  openNappletArtifactCache,
  parseNappletManifest,
  resolveNapplet,
  type ResolvedNapplet,
} from "@kehto/nip/5d";
import {
  createCatalogIntentResolver,
  createCommonService,
  createHttpUploader,
  createIdentityService,
  createIntentService,
  createKeysService,
  createLinkService,
  createNotifyService,
  createOutboxService,
  createResourceService,
  createThemeService,
  createUploadService,
  manifestToIntentCatalogEntry,
  ResourceServiceError,
  type IntentDispatchParams,
  type OutboxQueryOptions,
  type OutboxRelayPlan,
  type OutboxRouter,
} from "@kehto/services";
import {
  createShellBridge,
  denyNappletControllerAccess,
  originRegistry,
  prepareNappletSrcdoc,
  resolveShellEnvironment,
  type RelayPoolLike,
  type ShellAdapter,
  type ShellEnvironment,
} from "@kehto/shell";
import { ActionRunner } from "applesauce-actions";
import { FollowUser, ReportEvent, ReportUser, UnfollowUser } from "applesauce-actions/actions";
import { castEvent, castUser, Napplet, Profile, User } from "applesauce-common/casts";
import { ReactionFactory } from "applesauce-common/factories";
import {
  getZapAmount,
  getZapRequest,
  getZapSender,
  isValidNapplet,
  mergeBlossomServers,
  normalizeBlossomServer,
  NAPPLET_KIND,
  NAPPLET_KINDS,
  NAPPLET_ROOT_KIND,
  ReportReason,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  canHaveEncryptedContent,
  decodePointer,
  getInboxes,
  getOutboxes,
  getTagValue,
  isFromCache,
  kinds,
  mergeRelaySets,
  persistEventsToCache,
  selectOptimalRelays,
  setFallbackRelays,
  unixNow,
  unlockEncryptedContent,
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
import {
  BehaviorSubject,
  catchError,
  concatMap,
  defaultIfEmpty,
  defer,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  ignoreElements,
  map,
  merge,
  type Observable,
  of,
  skip,
  take,
  tap,
  timeout,
  timer,
} from "rxjs";
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
const user = () => (pubkey$.value ? castUser(pubkey$.value, eventStore) : undefined);

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const FALLBACK_BLOSSOM = ["https://blossom.primal.net/"];

/** Waits briefly for a defined value, so answers already in the store or cache return immediately */
function settle<T>(value$: Observable<T | undefined>, fallback: T, ms = 4000): Promise<T> {
  const value = value$.pipe(
    filter((v): v is T => v !== undefined),
    timeout({ first: ms }),
    catchError(() => of(fallback)),
  );
  return firstValueFrom(value.pipe(defaultIfEmpty(fallback)));
}

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
  resolved: ResolvedNapplet;
  environment: ShellEnvironment;
  source: "cache" | "blossom";
  ms: number;
  badge$: BehaviorSubject<number>;
  window?: Window;
  loaded: Promise<void>;
  onLoad: () => void;
};
const panes$ = new BehaviorSubject<Pane[]>([]);
const paneFor = (windowId: string) => panes$.value.find((p) => p.windowId === windowId);

// ---- Relay pool: kehto routes every relay.subscribe, query and publish through this store-backed pool

/** Picks relays from the authors' cached NIP-65 outboxes, falling back to the user's relays */
function selectRelays(filters: Filter[]): string[] {
  const mine = pubkey$.value ? eventStore.getReplaceable(kinds.RelayList, pubkey$.value) : undefined;
  const defaults = mergeRelaySets(mine ? getInboxes(mine) : [], FALLBACK_RELAYS);
  const authors = [...new Set(filters.flatMap((f) => f.authors ?? []))];
  // Publishing asks with no filters: use the user's outboxes
  if (filters.length === 0) return mine ? mergeRelaySets(getOutboxes(mine)) : FALLBACK_RELAYS;
  if (authors.length === 0) return defaults;

  const users = authors.map((pubkey) => {
    const list = eventStore.getReplaceable(kinds.RelayList, pubkey);
    return { pubkey, relays: list ? getOutboxes(list) : [] };
  });
  const selected = selectOptimalRelays(setFallbackRelays(users, defaults), { maxConnections: 12, maxRelaysPerUser: 3 });
  return mergeRelaySets(selected.flatMap((u) => u.relays ?? []));
}

/** Decrypts NIP-04/44 content before delivery, since napplets must never handle ciphertext */
async function reveal(event: NostrEvent): Promise<NostrEvent | undefined> {
  if (!canHaveEncryptedContent(event.kind)) return event;
  const signer = signer$.value;
  const me = pubkey$.value;
  if (!signer || !me) return undefined;
  const peer = event.pubkey === me ? (getTagValue(event, "p") ?? me) : event.pubkey;
  return unlockEncryptedContent(event, peer, signer).then(
    (content) => ({ ...event, content }),
    () => undefined,
  );
}

/** Emits a single "EOSE" once every relay has finished sending stored events (or after a short timeout) */
function loadFromRelays(relays: string[], filters: Filter[]): Observable<"EOSE"> {
  const settled = new Set<string>();
  // Raw req() exposes per-relay EOSE, which RelayPool.subscription() hides
  const network$ = pool.req(relays, filters).pipe(
    tap((msg) => msg.type === "EVENT" && eventStore.add(msg.event, msg.from)),
    filter((msg) => msg.type !== "OPEN" && msg.type !== "EVENT" && settled.add(msg.from).size >= relays.length),
  );
  return merge(network$, timer(relays.length ? 4000 : 0)).pipe(
    take(1),
    map(() => "EOSE" as const),
  );
}

/** Fills the store from IndexedDB and relays, emitting "EOSE" once the relays have sent their stored events */
const hydrate = (relays: string[], filters: Filter[]) =>
  merge(
    makeCacheRequest(cacheRequest, filters).pipe(mapEventsToStore(eventStore), ignoreElements()),
    defer(() => loadFromRelays(relays, filters)),
  );

/** Matching events already in the store, then anything new, including events other napplets loaded */
const fromStore = (filters: Filter[]) => eventStore.filters(filters).pipe(concatMap(reveal), filter(Boolean));

/** Waits for the "EOSE" from {@link hydrate}, then reads the newest matches from the store */
async function queryStore(relays: string[], filters: Filter[], limit = 500, ms = 8000) {
  await firstValueFrom(
    hydrate(relays, filters).pipe(
      timeout({ first: ms }),
      catchError(() => of(null)),
    ),
    {
      defaultValue: null,
    },
  );
  const events = [...eventStore.getByFilters(filters)].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  return (await Promise.all(events.map(reveal))).filter((e): e is NostrEvent => !!e);
}

const storePool: RelayPoolLike = {
  subscription: (relays, filters: Filter[]) => merge(fromStore(filters), hydrate(relays, filters)),
  request: (relays, filters) => pool.request(relays, filters),
  publish: async (relays, event: NostrEvent) => {
    eventStore.add(event);
    // Encrypted events also go to the recipient's inboxes
    const recipient = canHaveEncryptedContent(event.kind) && getTagValue(event, "p");
    const inbox = recipient && eventStore.getReplaceable(kinds.RelayList, recipient);
    const results = await pool.publish(mergeRelaySets(relays, inbox ? getInboxes(inbox) : []), event);
    if (!results.some((r) => r.ok)) throw new Error(results[0]?.message ?? "No relay accepted the event");
  },
};

// ---- Signer: napplets never sign directly, kehto asks this signer during relay.publish

// Signing grants are remembered per napplet artifact
const grants = new Set<string>(JSON.parse(localStorage.getItem("napplet-grants") ?? "[]"));

async function approve(windowId: string, template: EventTemplate) {
  const pane = paneFor(windowId);
  const key = pane ? `${pane.resolved.manifest.catalogId}:${pane.resolved.aggregateHash}` : windowId;
  if (grants.has(key)) return;
  if (!(await ask(windowId, `Sign kind ${template.kind} events`))) throw new Error("User denied");
  grants.add(key);
  localStorage.setItem("napplet-grants", JSON.stringify([...grants]));
}

/** Wraps the account signer with an approval prompt and NIP-65 relays for identity.getRelays */
function nappletSigner(windowId?: string) {
  const signer = signer$.value;
  if (!signer) return null;
  return {
    getPublicKey: () => signer.getPublicKey(),
    nip04: signer.nip04,
    nip44: signer.nip44,
    getRelays: async () => {
      const { inboxes, outboxes } = await settle(user()!.mailboxes$, { inboxes: [], outboxes: [] });
      const relays: Record<string, { read: boolean; write: boolean }> = {};
      for (const url of inboxes) (relays[url] ??= { read: false, write: false }).read = true;
      for (const url of outboxes) (relays[url] ??= { read: false, write: false }).write = true;
      return relays;
    },
    signEvent: async (template: EventTemplate) => {
      if (windowId) await approve(windowId, template);
      // kehto rejects events older than 30 seconds, so stamp after the prompt
      return signer.signEvent({ ...template, created_at: unixNow() });
    },
  };
}

// ---- Services: kehto implements the protocol, applesauce answers the data questions

/** Resolves a user observable for the current account, so cached data answers instantly */
const fromUser = <T,>(fn: (user: User) => Observable<T | undefined>, fallback: T) => {
  const current = user();
  return current ? settle(fn(current), fallback) : Promise.resolve(fallback);
};

const LIST_KINDS: Record<string, number> = {
  bookmarks: kinds.BookmarkList,
  pins: kinds.Pinlist,
  interests: kinds.InterestsList,
  communities: kinds.CommunitiesList,
  emojis: kinds.UserEmojiList,
};

/** Maps a profile cast to the NAP profile shape */
function profileData(profile: Profile) {
  const { name, about, picture, banner, nip05, lud16, website } = profile.metadata;
  return { name, displayName: profile.displayName, about, picture, banner, nip05, lud16, website };
}

/** Reads a user's NIP-65 inboxes from the store */
function inboxesOf(pubkey: string) {
  const list = eventStore.getReplaceable(kinds.RelayList, pubkey);
  return list ? getInboxes(list) : [];
}

const identity = createIdentityService({
  getSigner: () => nappletSigner(),
  getProfile: async () => {
    const profile = await fromUser((u) => u.profile$, undefined);
    return profile ? profileData(profile) : null;
  },
  getFollows: async () => (await fromUser((u) => u.contacts$, [])).map((u) => u.pubkey),
  getMutes: async () => Array.from((await fromUser((u) => u.mutes$, undefined))?.pubkeys ?? []),
  getList: async (listType) => {
    const kind = LIST_KINDS[listType];
    const list = kind ? await fromUser((u) => eventStore.replaceable(kind, u.pubkey), undefined) : undefined;
    return list?.tags.filter((t) => t[0] !== "d" && t[1]).map((t) => t[1]) ?? [];
  },
  getZaps: async (pubkey) => {
    if (!pubkey) return [];
    const filters = [{ kinds: [kinds.Zap], "#p": [pubkey] }];
    const zaps = await queryStore(selectRelays(filters), filters, 100);
    return zaps.map((zap) => ({
      eventId: zap.id,
      sender: getZapSender(zap) ?? "",
      amount: getZapAmount(zap) ?? 0,
      content: getZapRequest(zap)?.content,
    }));
  },
  getBadges: async () => {
    const slots = await fromUser((u) => u.profileBadges$.badges$, []);
    return slots.flatMap(({ badge, award }) =>
      badge ? [{ id: badge.id, name: badge.name, image: badge.image?.url, awardedBy: award?.author.pubkey ?? "" }] : [],
    );
  },
});

/** Maps the DaisyUI theme variables to a NAP-THEME object */
function getTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
  return { colors: { background: v("base-100"), text: v("base-content"), primary: v("primary") } };
}
const theme = createThemeService({ initialTheme: getTheme(), onBroadcast: (env) => bridge.publishTheme(env.theme) });

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

// ---- NAP-OUTBOX: outbox-model reads and writes, backed by the store's batched loaders

/** Loads missing NIP-65 lists through the store's batched loader, so many authors share a few REQs */
async function loadRelayLists(pubkeys: string[]) {
  const missing = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  await Promise.all(missing.map((pubkey) => settle(eventStore.replaceable(kinds.RelayList, pubkey), undefined, 3000)));
}

/** Plans relays for reading users' events (their outboxes) or writing to them (their inboxes) */
async function planRelays(pubkeys: string[], direction: "read" | "write" = "read"): Promise<OutboxRelayPlan> {
  if (pubkeys.length === 0) return { relays: selectRelays(direction === "write" ? [] : [{}]), source: "policy" };
  await loadRelayLists(pubkeys);
  const missingAuthors = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  const relays =
    direction === "read" ? selectRelays([{ authors: pubkeys }]) : mergeRelaySets(...pubkeys.map(inboxesOf));
  const source = missingAuthors.length === pubkeys.length ? "fallback" : "nip65";
  return {
    relays: relays.length ? relays : FALLBACK_RELAYS,
    source,
    ...(missingAuthors.length ? { missingAuthors } : {}),
  };
}

/** Uses explicit relays when given, otherwise the outboxes of the requested authors */
async function readRelays(filters: Filter[], options?: OutboxQueryOptions) {
  if (options?.relays?.length) return options.relays;
  const authors = options?.authors ?? filters.flatMap((f) => f.authors ?? []);
  return (await planRelays([...new Set(authors)])).relays;
}

// outbox.publish carries no window id, so the wrapper below records the sender for the signing prompt
let publishingWindow: string | undefined;

const outboxRouter: OutboxRouter = {
  resolveRelays: ({ authors = [], pubkey, direction }) => planRelays(pubkey ? [pubkey] : authors, direction),
  getEvent: async (id, options) => {
    // The store's event loader batches lookups from every napplet into shared REQs
    const pointer = { id, author: options?.author, relays: options?.relays };
    const event = await settle(eventStore.event(pointer), undefined, options?.timeoutMs ?? 8000);
    const revealed = event && (await reveal(event));
    return revealed ? { result: { event: revealed } } : { error: "not found" };
  },
  // kehto's NostrFilter is structurally a NIP-01 filter
  query: async (nostrFilters, options) => {
    const filters = nostrFilters as Filter[];
    const events = await queryStore(await readRelays(filters, options), filters, options?.limit, options?.timeoutMs);
    return { events: events.map((event) => ({ event })) };
  },
  subscribe: (nostrFilters, options, sink) => {
    const filters = nostrFilters as Filter[];
    const sub = defer(() => readRelays(filters, options))
      .pipe(concatMap((relays) => merge(fromStore(filters), hydrate(relays, filters).pipe(ignoreElements()))))
      .subscribe({ next: (event) => sink.event({ event }), error: (err) => sink.closed(String(err)) });
    return { close: () => sub.unsubscribe() };
  },
  publish: async (template, options = {}) => {
    const signer = nappletSigner(publishingWindow);
    if (!signer) return { ok: false, error: "no signer configured" };
    const event = await signer.signEvent(template);
    const inboxes = options.toInboxes?.length ? (await planRelays(options.toInboxes, "write")).relays : [];
    const outboxes = options.toOutbox === false ? [] : selectRelays([]);
    eventStore.add(event);
    const results = await pool.publish(mergeRelaySets(options.relays, outboxes, inboxes), event);
    const ok = results.some((r) => r.ok);
    const relays = Object.fromEntries(results.map((r) => [r.from, r.ok]));
    return { ok, event, eventId: event.id, relays, error: ok ? undefined : (results[0]?.message ?? "rejected") };
  },
};

const outboxService = createOutboxService({ router: outboxRouter });
const outbox: typeof outboxService = {
  ...outboxService,
  handleMessage: (windowId, message, send) => {
    // router.publish runs synchronously inside handleMessage, so it reads this before any await
    publishingWindow = windowId;
    outboxService.handleMessage(windowId, message, send);
  },
};

// ---- NAP-COMMON: social actions run through applesauce actions and the napplet's signing prompt

/** Accepts hex, npub or nprofile and returns a hex pubkey */
function toPubkey(target: string) {
  if (/^[0-9a-f]{64}$/.test(target)) return target;
  const decoded = decodePointer(target);
  if (decoded.type === "npub") return decoded.data;
  if (decoded.type === "nprofile") return decoded.data.pubkey;
  throw new Error("invalid pubkey");
}

type ActionTools = {
  runner: ActionRunner;
  signer: ISigner;
  publish: (event: NostrEvent, relays?: string[]) => Promise<void>;
};

/** Runs a social action for a napplet and reports the event it published */
async function act(windowId: string, action: (tools: ActionTools) => Promise<void>) {
  const signer = nappletSigner(windowId);
  if (!signer) return { ok: false, error: "no signer configured" };
  let event: NostrEvent | undefined;
  const publish = async (signed: NostrEvent, relays?: string[]) => {
    event = signed;
    await storePool.publish(relays?.length ? relays : selectRelays([]), signed);
  };
  try {
    await action({ runner: new ActionRunner(eventStore, signer, publish), signer, publish });
    return { ok: true, event, eventId: event?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Loads an event through the store's batched loader */
async function loadEvent(id: string) {
  const event = await settle(eventStore.event(id), undefined, 8000);
  if (!event) throw new Error("event not found");
  return event;
}

const common = createCommonService({
  getProfile: async (target) => {
    try {
      const pubkey = toPubkey(target);
      const profile = await settle(castUser(pubkey, eventStore).profile$, undefined);
      return {
        ok: true,
        pubkey,
        profile: profile ? profileData(profile) : null,
        result: profile && { event: profile.event },
      };
    } catch (err) {
      return { ok: false, pubkey: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
  follows: async () => ({ ok: true, pubkeys: (await fromUser((u) => u.contacts$, [])).map((u) => u.pubkey) }),
  follow: (pubkeys, { windowId }) =>
    act(windowId, async ({ runner }) => {
      for (const pubkey of pubkeys) await runner.run(FollowUser, toPubkey(pubkey));
    }),
  unfollow: (pubkeys, { windowId }) =>
    act(windowId, async ({ runner }) => {
      for (const pubkey of pubkeys) await runner.run(UnfollowUser, toPubkey(pubkey));
    }),
  react: (id, reaction, href, { windowId }) =>
    act(windowId, async ({ signer, publish }) => {
      const target = await loadEvent(id);
      const emoji = href ? { shortcode: reaction.replace(/^:|:$/g, ""), url: href } : reaction;
      const event = await ReactionFactory.create(target, emoji).sign(signer);
      // Reactions go to our outboxes and the author's inboxes so they see it
      await publish(event, mergeRelaySets(selectRelays([]), inboxesOf(target.pubkey)));
    }),
  report: (target, reason, text, { windowId }) =>
    act(windowId, async ({ runner }) => {
      if (target.type === "pubkey")
        return runner.run(ReportUser, toPubkey(target.pubkey), reason as ReportReason, text);
      const pubkey = target.pubkey ?? (await loadEvent(target.id)).pubkey;
      await runner.run(ReportEvent, { id: target.id, pubkey }, reason as ReportReason, text);
    }),
});

// ---- NAP-UPLOAD: files go to the user's Blossom servers, authorized through the napplet's signing prompt

const upload = createUploadService({
  uploadInfo: { rails: [{ rail: "blossom", enabled: true }] },
  uploader: {
    upload: async (request, ctx) => {
      const signer = nappletSigner(ctx.windowId);
      if (!signer) throw new Error("no signer configured");
      const servers = (await fromUser((u) => u.blossomServers$, [] as URL[])).map(String);
      const blossom = { servers: servers.length ? servers : FALLBACK_BLOSSOM };
      return createHttpUploader({ rails: { blossom }, signEvent: signer.signEvent }).upload(
        { ...request, rail: "blossom" },
        ctx,
      );
    },
  },
});

// ---- NAP-KEYS: napplets bind actions to chords, which fire while the host page has focus
const keys = createKeysService();

// ---- NAP-RESOURCE: every byte is fetched and verified by the host

/** Fetches a Blossom blob from the first server that returns bytes matching the hash */
const fetchBytes = async (url: string, onType?: (type: string) => void) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  onType?.(res.headers.get("content-type") ?? "");
  return new Uint8Array(await res.arrayBuffer());
};

const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
// Browsers can't see resolved IPs, so this blocks literal private hosts only
const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/;

/** Rasterizes an SVG to PNG in an <img>, where scripts and network requests never run */
async function rasterize(svg: Uint8Array) {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" }));
  await img.decode().finally(() => URL.revokeObjectURL(img.src));
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [Math.min(img.width || 512, 2048), Math.min(img.height || 512, 2048)];
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await png!.arrayBuffer());
}

/** Resolves blossom:, nostr: and https: URLs to raw bytes and the content type their source declares */
async function resolveResource(url: URL, servers: readonly string[], signal: AbortSignal) {
  // Temporary compatibility for kehto's legacy blossom:sha256: resource URLs
  if (url.protocol === "blossom:") url = new URL(url.href.replace(/^blossom:sha256:/i, "blossom:"));
  else if (url.protocol === "https:" || url.protocol === "http:")
    url.pathname = url.pathname.replace(/^\/sha256:(?=[0-9a-f])/i, "/");

  // BUD-10 blossom: URIs resolve against server hints and are hash-verified like the napplet itself
  if (url.protocol === "blossom:") {
    const hash = /^([0-9a-f]{64})(?:\.[^/]+)?$/.exec(url.pathname)?.[1];
    if (!hash) throw new ResourceServiceError("invalid-request", "invalid Blossom hash");
    const hints = url.searchParams.getAll("xs").flatMap((server) => {
      const candidates = /^https?:\/\//i.test(server) ? [server] : [`https://${server}`, `http://${server}`];
      return candidates.flatMap((candidate) => {
        try {
          return [normalizeBlossomServer(candidate).href];
        } catch {
          return [];
        }
      });
    });
    const preferred = await fromUser((u) => u.blossomServers$, [] as URL[]);
    const all = mergeBlossomServers<string | URL>(hints, [...servers], preferred, FALLBACK_BLOSSOM).map(String);
    let type = "";
    const bytes = await fetchBlob(all, hash, (u) =>
      fetchBytes(u, (t) => (type = t)),
    );
    return { bytes, type };
  }
  // nostr: references resolve one hop through the store's loaders and return the event JSON
  if (url.protocol === "nostr:") {
    const decoded = decodePointer(url.pathname);
    const pointer =
      decoded.type === "nevent" || decoded.type === "naddr"
        ? decoded.data
        : decoded.type === "note"
          ? decoded.data
          : { kind: kinds.Metadata, pubkey: decoded.type === "nprofile" ? decoded.data.pubkey : String(decoded.data) };
    const event = await settle(eventStore.event(pointer), undefined, 8000);
    if (!event) throw new ResourceServiceError("not-found", "event not found");
    return { bytes: new TextEncoder().encode(JSON.stringify(event)), type: "application/json" };
  }
  if (url.protocol !== "https:" && url.protocol !== "data:")
    throw new ResourceServiceError("unsupported-scheme", url.protocol);
  if (PRIVATE_HOST.test(url.hostname)) throw new ResourceServiceError("blocked-by-policy", "private host");
  const res = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new ResourceServiceError("not-found", `${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

const resource = createResourceService({
  resourceInfo: {
    schemes: ["https", "data", "blossom", "nostr"].map((scheme) => ({ scheme, enabled: true })),
    maxBytes: MAX_RESOURCE_BYTES,
  },
  fetch: async (url, { signal, servers = [] }) => {
    let { bytes, type } = await resolveResource(new URL(url), servers, signal);
    // Raw SVG can carry scripts, so napplets only ever receive a PNG rendering of it
    if (type.startsWith("image/svg+xml")) [bytes, type] = [await rasterize(bytes), "image/png"];
    if (bytes.byteLength > MAX_RESOURCE_BYTES) throw new ResourceServiceError("too-large", `${bytes.byteLength} bytes`);
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      headers: { "content-type": type || "application/octet-stream" },
    });
  },
});

/** Opens the handler napplet for an intent and delivers the request once its document loads */
async function deliverIntent({ handler, sender, archetype, action, convention, payload }: IntentDispatchParams) {
  const event = eventStore.getByFilters({ kinds: NAPPLET_KINDS }).find((e) => getNappletCatalogId(e) === handler);
  if (!event) throw new Error("Handler not found");
  const pane = await openNapplet(event);
  await pane.loaded;
  pane.window?.postMessage(
    { type: "intent.deliver", delivery: { sender, archetype, action, convention, payload } },
    "*",
  );
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
  resolveSender: (windowId) => paneFor(windowId)?.resolved.manifest.catalogId,
});

// ---- Shell bridge

const subscriptions = new Map<string, () => void>();
const available = { isAvailable: () => true };
const adapter: ShellAdapter = {
  relayPool: {
    getRelayPool: () => storePool,
    trackSubscription: (key, cleanup) => subscriptions.set(key, cleanup),
    untrackSubscription: (key) => (subscriptions.get(key)?.(), subscriptions.delete(key)),
    openScopedRelay: () => {},
    closeScopedRelay: () => {},
    publishToScopedRelay: () => false,
    selectRelayTier: selectRelays,
  },
  relayConfig: {
    addRelay: () => {},
    removeRelay: () => {},
    getRelayConfig: () => ({ discovery: [], super: [], outbox: selectRelays([]) }),
    getNip66Suggestions: () => [],
  },
  auth: { getUserPubkey: () => pubkey$.value || null, getSigner: nappletSigner },
  crypto: { verifyEvent: async (event) => verifyEvent(event) },
  windowManager: { createWindow: () => null },
  config: { getNappUpdateBehavior: () => "banner" },
  hotkeys: { executeHotkeyFromForward: () => {} },
  // The relay pool above already reads and writes the IndexedDB cache
  workerRelay: { getWorkerRelay: () => null },
  intent: available,
  link: available,
  common: available,
  upload: { getUploader: () => ({ rails: ["blossom"] }) },
  services: { identity, theme: theme.handler, notify, link, resource, intent, outbox, common, upload, keys },
};

const bridge = createShellBridge(adapter);
window.addEventListener("message", bridge.handleMessage);

// Push theme and account changes to every running napplet
const themeObserver = new MutationObserver(() => theme.publishTheme(getTheme()));
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
const identitySub = pubkey$.pipe(distinctUntilChanged(), skip(1)).subscribe((p) => bridge.publishIdentityChanged(p));

import.meta.hot?.dispose(() => {
  panes$.value.forEach(closeNapplet);
  window.removeEventListener("message", bridge.handleMessage);
  themeObserver.disconnect();
  identitySub.unsubscribe();
  keys.destroy();
  bridge.destroy();
});

// ---- Napplet lifecycle

async function openNapplet(event: NostrEvent): Promise<Pane> {
  const napplet = castEvent(event, Napplet, eventStore);
  const start = performance.now();
  let source: Pane["source"] = "cache";

  // kehto verifies the signature and every blob hash; applesauce supplies the author's Blossom servers
  const resolved = await resolveNapplet({
    event,
    cache: artifactCache,
    fetchBlob: async (hash, servers) => {
      source = "blossom";
      const author = await settle(napplet.author.blossomServers$, [], servers.length ? 0 : 2000);
      const all = mergeBlossomServers<string | URL>([...servers], author).map(String);
      return fetchBlob(all.length ? all : FALLBACK_BLOSSOM, hash, fetchBytes);
    },
  });

  // Unsupported domains don't block loading; napplets check window.napplet and degrade gracefully
  const environment = resolveShellEnvironment(adapter, { dTag: resolved.dTag, aggregateHash: resolved.aggregateHash });

  let onLoad = () => {};
  const loaded = new Promise<void>((resolve) => (onLoad = resolve));
  const windowId = `napp-${crypto.randomUUID()}`;
  const ms = performance.now() - start;
  const pane: Pane = {
    windowId,
    napplet,
    resolved,
    environment,
    source,
    ms,
    badge$: new BehaviorSubject(0),
    loaded,
    onLoad,
  };
  panes$.next([...panes$.value, pane]);
  return pane;
}

/** Registers the iframe window with kehto before any napplet code can run */
function mountNapplet(pane: Pane, iframe: HTMLIFrameElement | null) {
  if (!iframe?.contentWindow || pane.window) return;
  const { windowId, resolved, environment } = pane;
  const identity = { dTag: resolved.dTag, aggregateHash: resolved.aggregateHash };
  const register = () => {
    pane.window = iframe.contentWindow!;
    originRegistry.register(pane.window, windowId, identity);
    originRegistry.setEnvironment(pane.window, environment);
  };
  denyNappletControllerAccess(iframe);
  register();
  iframe.addEventListener("load", () => {
    // Assigning srcdoc can replace the window, so register it again before resolving
    if (originRegistry.getWindowId(iframe.contentWindow!) !== windowId) register();
    pane.onLoad();
  });
  iframe.srcdoc = prepareNappletSrcdoc(resolved.indexHtml, { domains: environment.capabilities.domains });
}

function closeNapplet(pane: Pane) {
  bridge.runtime.destroyWindow(pane.windowId);
  bridge.runtime.sessionRegistry.unregister(pane.windowId);
  originRegistry.unregister(pane.windowId);
  panes$.next(panes$.value.filter((p) => p !== pane));
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

  return (
    <div className="flex flex-col min-w-96 flex-1 border-r border-base-300">
      <div className="flex items-center gap-2 p-2 border-b border-base-300">
        <NappletIcon napplet={pane.napplet} size="w-6 h-6" />
        <span className="font-semibold truncate">{title(pane.napplet)}</span>
        {badge ? <span className="badge badge-primary">{badge}</span> : null}
        <span className="flex-1" />
        <span className="badge badge-success gap-1 whitespace-nowrap" title={pane.resolved.aggregateHash}>
          {pane.source === "cache" ? <Database className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
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
      <iframe
        ref={(iframe) => mountNapplet(pane, iframe)}
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
