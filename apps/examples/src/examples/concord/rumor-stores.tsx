/**
 * Walk a real Concord community from an invite link, following its Refounding epochs like
 * concord/crypto-history — but instead of only counting each plane, decrypt EVERY rumor on EVERY
 * plane (control, guestbook, channels, dissolved, rekey) and pour them into per-plane {@link RumorStore}s
 * so each plane's history renders live via `rumorStore.timeline`. Author avatars and names are pulled
 * from a separate global EventStore that lazily loads kind-0 profiles from public indexer relays.
 * @tags concord, encryption, rumor-store, timeline, epochs, rekey, relays, profiles
 * @related concord/crypto-history, concord/models
 */
import { EventStore, RumorStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import type { NostrEvent, Rumor } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import {
  ConcordRelayAuth,
  Helpers,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
} from "applesauce-concord";
import { ConcordCommunityStateModel } from "applesauce-concord/models";

const {
  decodeWrap,
  decryptBundle,
  deriveConcordKeys,
  foldControl,
  EPHEMERAL_GIFT_WRAP_KIND,
  GIFT_WRAP_KIND,
  INVITE_BUNDLE_KIND,
  parseInviteLink,
  readRekey,
  refoundAuthority,
  STOCK_RELAYS,
  verifyOwner,
} = Helpers;

type ConcordKeys = Helpers.ConcordKeys;
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useRef, useState } from "react";
import { BehaviorSubject, firstValueFrom, Subscription, takeUntil, timer, toArray } from "rxjs";

import LoginView from "../../components/login-view";

// ---- module singletons (a manual, functional walk — no ConcordClient) -------

const pool = new RelayPool();
const relayAuth = new ConcordRelayAuth(pool);
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

// A global EventStore for the (signed, public) events around rumor authors. It has its own relay
// loader so requesting `eventStore.profile(pubkey)` lazily fetches the kind-0 metadata from public
// indexer relays — kept apart from the RumorStores, which hold only unsigned community rumors.
const eventStore = new EventStore();
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/", "wss://relay.damus.io/"],
});

// ---- plane model -----------------------------------------------------------

type PlaneKind = "control" | "guestbook" | "channel" | "dissolved" | "rekey";

const PLANE_LABELS: Record<Exclude<PlaneKind, "channel">, string> = {
  control: "Control",
  guestbook: "Guestbook",
  dissolved: "Dissolved",
  rekey: "Rekey",
};

/** A rumor routed to its store, with enough context to name and order the plane. */
type RoutedRumor = { kind: PlaneKind; channelId?: string; channelName?: string; decoded: DecodedEvent };

/** One plane surfaced in the sidebar, each backed by its own {@link RumorStore}. */
type PlaneDescriptor = { key: string; kind: PlaneKind; label: string };

/** The store key: community planes key by kind, channels key by their stable id. */
function planeKey(entry: RoutedRumor): string {
  return entry.channelId ? `channel:${entry.channelId}` : entry.kind;
}

// ---- the walk (functional, over the exported crypto core) ------------------

/** The ordered chain of held roots the invite grants — epoch 0..current (see crypto-history). */
function buildChain(material: JoinMaterial): JoinMaterial[] {
  const roots = [...(material.held_roots ?? []), { epoch: material.root_epoch, key: material.community_root }].sort(
    (a, b) => a.epoch - b.epoch,
  );
  const seen = new Set<number>();
  const uniq = roots.filter((r) => (seen.has(r.epoch) ? false : (seen.add(r.epoch), true)));
  return uniq.map((r) => ({
    ...material,
    community_root: r.key,
    root_epoch: r.epoch,
    held_roots: uniq
      .filter((o) => o.epoch < r.epoch)
      .map((o) => ({ epoch: o.epoch, key: o.key }))
      .reverse(),
  }));
}

function relaysFor(material: JoinMaterial): string[] {
  return material.relays.length ? material.relays : STOCK_RELAYS;
}

/** One-shot fetch of every gift wrap at `authors`, completing gracefully at 10s. */
async function fetchWraps(relays: string[], authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  return firstValueFrom(
    pool
      .request(relays, [{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors }], { waitForAuth: authors })
      .pipe(takeUntil(timer(10_000)), toArray()),
  ).catch(() => [] as NostrEvent[]);
}

/** How the walk continues past this epoch — drives the epoch chip + whether we advance. */
// `removed` = a real CORD-02 Guestbook removal; `not-rekeyed` = a Refounding that
// rolled on without handing this invite a key (stale invite / never a member). Both
// end the walk, but they are not the same thing — see crypto-history for the detail.
type Transition = "known" | "adopt" | "removed" | "not-rekeyed" | "tip" | "cannot-follow";

type EpochSummary = { epoch: number; keys: ConcordKeys; transition: Transition; rumors: number };

type LoadResult = { summary: EpochSummary; adoptedMaterial?: JoinMaterial };

/**
 * Derive one epoch's keys, authenticate, fetch every plane's wraps, decode each to a rumor and hand
 * it to `route`, then decide how the walk continues. Mirrors crypto-history's `loadEpoch`, but the
 * decoded events are drained into the caller's stores instead of merely counted.
 */
async function loadEpoch(
  epochMaterial: JoinMaterial,
  prior: ConcordKeys | undefined,
  self: string,
  signer: ISigner,
  relays: string[],
  ensureAuth: (relays: string[]) => void,
  chainHasNext: boolean,
  route: (entry: RoutedRumor) => void,
): Promise<LoadResult> {
  let count = 0;
  const emit = (kind: PlaneKind, decoded: DecodedEvent, channelId?: string, channelName?: string) => {
    route({ kind, channelId, channelName, decoded });
    count++;
  };

  // 1. Derive with no channels yet; register the core planes and authenticate.
  let keys = deriveConcordKeys(epochMaterial, [], prior);
  relayAuth.registerStreamKeys([keys.control, keys.guestbook, keys.dissolved, keys.nextBaseRekey.key]);
  ensureAuth(relays);

  // 2. Fetch control / guestbook / dissolved / next-rekey wraps and route by plane.
  const authorsA = [keys.control.pk, keys.guestbook.pk, keys.dissolved.pk, keys.nextBaseRekey.key.pk];
  const control: DecodedEvent[] = [];
  const rekey: DecodedEvent[] = [];
  for (const ev of await fetchWraps(relays, authorsA)) {
    const info = keys.planes.get(ev.pubkey);
    if (!info) continue;
    const d = decodeWrap(ev, info.convKey);
    if (!d) continue;
    if (info.type === "control") (control.push(d), emit("control", d));
    else if (info.type === "guestbook") emit("guestbook", d);
    else if (info.type === "dissolved") emit("dissolved", d);
    else if (info.type === "rekey") (rekey.push(d), emit("rekey", d));
  }

  // 3. Fold the control plane → channels, re-derive to reveal the channel addresses, then fetch and
  //    route every channel's wraps under its own store (keyed by the stable channel_id).
  const state0 = foldControl(control, epochMaterial);
  const channelName = new Map(state0.channels.map((c) => [c.channel_id, c.name] as const));
  keys = deriveConcordKeys(epochMaterial, state0.channels, prior);
  relayAuth.registerStreamKeys([...keys.channels.values()]);
  for (const ev of await fetchWraps(
    relays,
    [...keys.channels.values()].map((k) => k.pk),
  )) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel" || !info.channelId) continue;
    const d = decodeWrap(ev, info.convKey);
    if (!d) continue;
    emit("channel", d, info.channelId, channelName.get(info.channelId));
  }

  // 4. Decide the transition exactly as crypto-history does. The reactive UI folds members with
  //    ConcordCommunityStateModel once the decoded rumors are in their RumorStores.
  let transition: Transition = "tip";
  let adoptedMaterial: JoinMaterial | undefined;
  if (chainHasNext) {
    transition = "known";
  } else if (!signer.nip44) {
    transition = "cannot-follow";
  } else {
    const outcome = await readRekey(keys, rekey, refoundAuthority(state0), self, signer, state0.channels);
    if (outcome.kind === "adopt") {
      transition = "adopt";
      adoptedMaterial = outcome.next.material;
    } else if (outcome.kind === "removed") {
      // A Refounding to the next epoch handed us no key. In Concord the Guestbook
      // (CORD-02) and rekey roster (CORD-06) are independent, so treat it as a real
      // *removal* only when the Guestbook corroborates it — here via the Banlist,
      // the clearest CORD-02 signal at fold time. Otherwise this invite was simply
      // never rekeyed into the new epoch (a stale invite / never a member), which is
      // not a removal even though the walk stops here (we hold no next root).
      transition = state0.banlist.has(self) ? "removed" : "not-rekeyed";
    }
  }

  return { summary: { epoch: epochMaterial.root_epoch, keys, transition, rumors: count }, adoptedMaterial };
}

/** Fetch the community's live invite bundle and project it to JoinMaterial (see crypto-history). */
async function resolveInvite(url: string): Promise<JoinMaterial> {
  const parsed = parseInviteLink(url);
  const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : STOCK_RELAYS;
  const events = await firstValueFrom(
    pool
      .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner] }])
      .pipe(takeUntil(timer(10_000)), toArray()),
  ).catch(() => [] as NostrEvent[]);
  const live = events
    .filter((e) => (e.tags.find((t) => t[0] === "vsk")?.[1] ?? "6") === "6")
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!live) throw new Error("invite bundle not found or revoked");
  const bundle: InviteBundle = decryptBundle(live.content, parsed.token);
  const material: JoinMaterial = {
    community_id: bundle.community_id,
    owner: bundle.owner,
    owner_salt: bundle.owner_salt,
    community_root: bundle.community_root,
    root_epoch: bundle.root_epoch,
    channels: bundle.channels ?? [],
    relays: bundle.relays ?? relays,
    name: bundle.name,
    held_roots: bundle.held_roots,
    refounder: bundle.refounder,
  };
  if (!verifyOwner(material)) throw new Error("invite failed owner verification");
  return material;
}

// ---- rendering helpers -----------------------------------------------------

function shortHex(hex: string): string {
  if (!hex) return "—";
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return shortHex(pubkey);
  }
}

function kindLabel(kind: number): string {
  switch (kind) {
    case 9:
      return "message";
    case 7:
      return "reaction";
    case 5:
      return "delete";
    case 11:
      return "thread";
    case 1111:
      return "comment";
    default:
      return `kind ${kind}`;
  }
}

/** One decoded rumor row — the author's avatar + name (pulled from the global profile store), the
 *  kind, time, and a preview of its content. */
function RumorRow({ rumor, relays }: { rumor: Rumor; relays: string[] }) {
  const profile = use$(() => eventStore.profile({ pubkey: rumor.pubkey, relays }), [rumor.pubkey]);
  const when = new Date(rumor.created_at * 1000).toLocaleString();
  return (
    <div className="border border-base-300 rounded-box p-3 flex gap-3">
      <div className="avatar shrink-0">
        <div className="w-9 h-9 rounded-full">
          <img
            alt={getDisplayName(profile) ?? shortNpub(rumor.pubkey)}
            src={getProfilePicture(profile, `https://robohash.org/${rumor.pubkey}`)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2 text-xs">
          <span className="font-semibold text-sm">{getDisplayName(profile) ?? shortNpub(rumor.pubkey)}</span>
          <span className="badge badge-ghost badge-sm">{kindLabel(rumor.kind)}</span>
          <span className="opacity-40 ml-auto">{when}</span>
        </div>
        {rumor.content && <div className="text-sm whitespace-pre-wrap break-words">{rumor.content}</div>}
      </div>
    </div>
  );
}

/** A sidebar button that reads its plane's live rumor count from `store.timeline`. */
function PlaneButton({
  desc,
  store,
  active,
  onClick,
}: {
  desc: PlaneDescriptor;
  store: RumorStore;
  active: boolean;
  onClick: () => void;
}) {
  const rumors = use$(() => store.timeline([{}]), [store]) ?? [];
  return (
    <button
      className={`btn btn-sm justify-between ${active ? "btn-primary" : "btn-ghost"}`}
      onClick={onClick}
    >
      <span className="truncate">{desc.label}</span>
      <span className="badge badge-sm">{rumors.length}</span>
    </button>
  );
}

/** The main panel: the selected plane's rumors, straight off its `timeline`. */
function PlaneTimeline({ store, relays }: { store: RumorStore; relays: string[] }) {
  const rumors = use$(() => store.timeline([{}]), [store]) ?? [];
  if (rumors.length === 0) return <div className="opacity-60 p-4">No rumors decoded on this plane.</div>;
  return (
    <div className="flex flex-col gap-2">
      {rumors.map((r) => (
        <RumorRow key={r.id} rumor={r} relays={relays} />
      ))}
    </div>
  );
}

// ---- the walker ------------------------------------------------------------

function Walker({
  material,
  signer,
  self,
  onReset,
}: {
  material: JoinMaterial;
  signer: ISigner;
  self: string;
  onReset: () => void;
}) {
  // Each plane's rumors live in their own RumorStore; the sidebar + timeline read them reactively.
  const storesRef = useRef<Map<string, RumorStore>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const [planes, setPlanes] = useState<PlaneDescriptor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [epochs, setEpochs] = useState<EpochSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relays = relaysFor(material);
  const driversSub = useRef<Subscription>(new Subscription());
  const seenRelays = useRef(new Set<string>());

  const ensureAuth = (rs: string[]) => {
    for (const url of rs) {
      if (seenRelays.current.has(url)) continue;
      seenRelays.current.add(url);
      driversSub.current.add(relayAuth.authenticateStreamKeys(pool.relay(url)));
    }
  };

  // Route one decoded rumor into its plane's store, registering the plane the first time we see it.
  const route = useCallback((entry: RoutedRumor) => {
    const key = planeKey(entry);
    let store = storesRef.current.get(key);
    if (!store) {
      store = new RumorStore();
      storesRef.current.set(key, store);
      const label = entry.channelId ? `# ${entry.channelName ?? shortHex(entry.channelId)}` : PLANE_LABELS[entry.kind as Exclude<PlaneKind, "channel">];
      setPlanes((prev) => (prev.some((p) => p.key === key) ? prev : [...prev, { key, kind: entry.kind, label }]));
      setSelected((sel) => sel ?? key);
    }
    store.add(entry.decoded.rumor);
    if (!seenRef.current.has(entry.decoded.rumor.id)) {
      seenRef.current.add(entry.decoded.rumor.id);
      setTotal((t) => t + 1);
    }
  }, []);

  // Auto-walk the whole chain to the tip on mount, draining every plane into its store as we go.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let prior: ConcordKeys | undefined;
        let chain = buildChain(material);
        let i = 0;
        while (alive && i < chain.length) {
          const res = await loadEpoch(chain[i], prior, self, signer, relays, ensureAuth, i + 1 < chain.length, route);
          if (!alive) return;
          prior = res.summary.keys;
          setEpochs((prev) => [...prev, res.summary]);
          if (res.adoptedMaterial) chain = [...chain, res.adoptedMaterial];
          else if (res.summary.transition !== "known") break; // tip / removed / not-rekeyed / cannot-follow
          i++;
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setDone(true);
      }
    })();
    return () => {
      alive = false;
      driversSub.current.unsubscribe();
      for (const store of storesRef.current.values()) store.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const channels = planes.filter((p) => p.kind === "channel");
  const system = planes.filter((p) => p.kind !== "channel");
  const activeStore = selected ? storesRef.current.get(selected) : undefined;
  const communityState = use$(() => {
    const control = storesRef.current.get("control");
    const guestbook = storesRef.current.get("guestbook");
    if (!control || !guestbook) return undefined;
    return control.model(ConcordCommunityStateModel, material, {
      guestbook,
      observed: [...storesRef.current.values()],
    });
  }, [material, planes.length]);

  return (
    <div className="w-full p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-lg flex-1">{material.name || "Community"}</h2>
        <button className="btn btn-sm btn-ghost" onClick={onReset}>
          ← New invite
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="text-xs opacity-60 break-all">{material.community_id}</code>
        <div className="flex-1" />
        {!done && <span className="loading loading-spinner loading-sm" />}
        <span className="badge badge-outline">{epochs.length} epochs</span>
        <span className="badge badge-outline">{planes.length} planes</span>
        <span className="badge badge-outline">{total} rumors</span>
        <span className="badge badge-outline">{communityState?.members.size ?? 0} members</span>
        <span className="badge badge-outline">{communityState?.banlist.size ?? 0} banned</span>
        {communityState && (
          <span className="badge badge-outline">{communityState.inviteLinks.size > 0 ? "public" : "private"}</span>
        )}
      </div>

      {epochs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {epochs.map((e) => (
            <span key={e.epoch} className="badge badge-ghost badge-sm gap-1">
              epoch {e.epoch}
              <span className="opacity-60">· {e.rumors}</span>
              {e.transition === "removed" && <span className="text-error">removed</span>}
              {e.transition === "not-rekeyed" && <span className="text-warning">not rekeyed</span>}
              {e.transition === "cannot-follow" && <span className="opacity-70">⛔</span>}
            </span>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error py-2">{error}</div>}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex flex-col gap-1 md:w-56 shrink-0">
          {channels.length > 0 && <span className="text-xs opacity-50 mt-1">channels</span>}
          {channels.map((p) => (
            <PlaneButton
              key={p.key}
              desc={p}
              store={storesRef.current.get(p.key)!}
              active={selected === p.key}
              onClick={() => setSelected(p.key)}
            />
          ))}
          {system.length > 0 && <span className="text-xs opacity-50 mt-2">community planes</span>}
          {system.map((p) => (
            <PlaneButton
              key={p.key}
              desc={p}
              store={storesRef.current.get(p.key)!}
              active={selected === p.key}
              onClick={() => setSelected(p.key)}
            />
          ))}
          {planes.length === 0 && <div className="opacity-60 text-sm">Decoding planes…</div>}
        </div>

        <div className="flex-1 min-w-0">{activeStore && <PlaneTimeline store={activeStore} relays={relays} />}</div>
      </div>
    </div>
  );
}

// ---- invite entry (behind login) -------------------------------------------

function InviteEntry({ signer, self }: { signer: ISigner; self: string }) {
  const [invite, setInvite] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<JoinMaterial | null>(null);

  async function open() {
    if (!invite.trim()) return;
    setResolving(true);
    setError(null);
    try {
      setMaterial(await resolveInvite(invite.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  }

  if (material)
    return (
      <Walker
        key={material.community_id + ":" + material.root_epoch}
        material={material}
        signer={signer}
        self={self}
        onReset={() => setMaterial(null)}
      />
    );

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      {error && <div className="alert alert-error py-2">{error}</div>}

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h2 className="font-bold">Invite link</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="input input-bordered flex-1 min-w-64 font-mono text-sm"
            placeholder="https://…/invite/naddr1…#…"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void open()}
          />
          <button className="btn btn-primary" onClick={() => void open()} disabled={!invite.trim() || resolving}>
            {resolving ? <span className="loading loading-spinner loading-sm" /> : "Decrypt history"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ConcordRumorStoresExample() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);

  if (!signer || !pubkey)
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );

  return <InviteEntry signer={signer} self={pubkey} />;
}
