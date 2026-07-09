/**
 * Open a Concord community invite, decrypt its planes into RumorStores, then demonstrate every
 * applesauce-concord model: control state, observed authors, members, full community state, banlist,
 * channels, and roles.
 * @tags concord, models, rumor-store, communities, encryption, relays
 * @related concord/rumor-stores, concord/crypto-history
 */
import { EventStore, RumorStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import {
  ConcordRelayAuth,
  Helpers,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
} from "applesauce-concord";
import {
  ConcordBanlistModel,
  ConcordChannelsModel,
  ConcordCommunityStateModel,
  ConcordControlModel,
  ConcordMembersModel,
  ConcordObservedAuthorsModel,
  ConcordRolesModel,
} from "applesauce-concord/models";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useRef, useState } from "react";
import { BehaviorSubject, firstValueFrom, Subscription, takeUntil, timer, toArray } from "rxjs";

import LoginView from "../../components/login-view";

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
type PlaneKind = "control" | "guestbook" | "channel" | "dissolved" | "rekey";
type RoutedRumor = { kind: PlaneKind; channelId?: string; channelName?: string; decoded: DecodedEvent };
type PlaneDescriptor = { key: string; kind: PlaneKind; label: string };
type Transition = "known" | "adopt" | "removed" | "tip" | "cannot-follow";
type EpochSummary = { epoch: number; transition: Transition; rumors: number };

const pool = new RelayPool();
const relayAuth = new ConcordRelayAuth(pool);
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const PROFILE_RELAYS = ["wss://purplepag.es/", "wss://index.hzrd149.com/", "wss://relay.damus.io/"];

// Public Nostr profiles are signed kind-0 events, so keep them in a normal EventStore.
// Concord rumors stay in RumorStores because they are unsigned decrypted inner events.
const profileStore = new EventStore();
createEventLoaderForStore(profileStore, pool, { lookupRelays: PROFILE_RELAYS });

const PLANE_LABELS: Record<Exclude<PlaneKind, "channel">, string> = {
  control: "Control",
  guestbook: "Guestbook",
  dissolved: "Dissolved",
  rekey: "Rekey",
};

function shortHex(hex: string): string {
  return hex ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : "-";
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return shortHex(pubkey);
  }
}

function planeKey(entry: RoutedRumor): string {
  return entry.channelId ? `channel:${entry.channelId}` : entry.kind;
}

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

async function fetchWraps(relays: string[], authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  return firstValueFrom(
    pool
      .request(relays, [{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors }], { waitForAuth: authors })
      .pipe(takeUntil(timer(10_000)), toArray()),
  ).catch(() => [] as NostrEvent[]);
}

async function loadEpoch(
  epochMaterial: JoinMaterial,
  prior: ConcordKeys | undefined,
  self: string,
  signer: ISigner,
  relays: string[],
  ensureAuth: (relays: string[]) => void,
  chainHasNext: boolean,
  route: (entry: RoutedRumor) => void,
): Promise<{ summary: EpochSummary; adoptedMaterial?: JoinMaterial; keys: ConcordKeys }> {
  let count = 0;
  const emit = (kind: PlaneKind, decoded: DecodedEvent, channelId?: string, channelName?: string) => {
    route({ kind, channelId, channelName, decoded });
    count++;
  };

  let keys = deriveConcordKeys(epochMaterial, [], prior);
  relayAuth.registerStreamKeys([keys.control, keys.guestbook, keys.dissolved, keys.nextBaseRekey.key]);
  ensureAuth(relays);

  const control: DecodedEvent[] = [];
  const rekey: DecodedEvent[] = [];
  for (const ev of await fetchWraps(relays, [keys.control.pk, keys.guestbook.pk, keys.dissolved.pk, keys.nextBaseRekey.key.pk])) {
    const info = keys.planes.get(ev.pubkey);
    if (!info) continue;
    const decoded = decodeWrap(ev, info.convKey);
    if (!decoded) continue;
    if (info.type === "control") (control.push(decoded), emit("control", decoded));
    else if (info.type === "guestbook") emit("guestbook", decoded);
    else if (info.type === "dissolved") emit("dissolved", decoded);
    else if (info.type === "rekey") (rekey.push(decoded), emit("rekey", decoded));
  }

  const state0 = foldControl(control, epochMaterial);
  const channelName = new Map(state0.channels.map((c) => [c.channel_id, c.name] as const));
  keys = deriveConcordKeys(epochMaterial, state0.channels, prior);
  relayAuth.registerStreamKeys([...keys.channels.values()]);
  for (const ev of await fetchWraps(relays, [...keys.channels.values()].map((k) => k.pk))) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel" || !info.channelId) continue;
    const decoded = decodeWrap(ev, info.convKey);
    if (!decoded) continue;
    emit("channel", decoded, info.channelId, channelName.get(info.channelId));
  }

  let transition: Transition = "tip";
  let adoptedMaterial: JoinMaterial | undefined;
  if (chainHasNext) transition = "known";
  else if (!signer.nip44) transition = "cannot-follow";
  else {
    const outcome = await readRekey(keys, rekey, refoundAuthority(state0), self, signer, state0.channels);
    if (outcome.kind === "adopt") {
      transition = "adopt";
      adoptedMaterial = outcome.next.material;
    } else if (outcome.kind === "removed") transition = "removed";
  }

  return { summary: { epoch: epochMaterial.root_epoch, transition, rumors: count }, adoptedMaterial, keys };
}

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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-base-300 rounded-box px-3 py-2">
      <div className="text-xs uppercase tracking-wide opacity-50">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function ProfileBadge({ pubkey }: { pubkey: string }) {
  const profile = use$(() => profileStore.profile({ pubkey, relays: PROFILE_RELAYS }), [pubkey]);
  const name = getDisplayName(profile) ?? shortNpub(pubkey);

  return (
    <div className="badge badge-outline h-auto gap-2 py-1.5 pl-1.5 pr-2 max-w-56">
      <div className="avatar shrink-0">
        <div className="w-5 rounded-full">
          <img alt={name} src={getProfilePicture(profile, `https://robohash.org/${pubkey}`)} />
        </div>
      </div>
      <span className="truncate text-xs">{name}</span>
    </div>
  );
}

function ModelOutputs({ material, stores, allStore }: { material: JoinMaterial; stores: Map<string, RumorStore>; allStore: RumorStore }) {
  const controlStore = stores.get("control");
  const guestbookStore = stores.get("guestbook");
  const observedStores = [...stores.values(), allStore];

  const control = use$(() => controlStore?.model(ConcordControlModel, material), [controlStore, material]);
  const observed = use$(() => allStore.model(ConcordObservedAuthorsModel), [allStore]);
  const members = use$(
    () => (guestbookStore && control && observed ? guestbookStore.model(ConcordMembersModel, material, control, observed) : undefined),
    [guestbookStore, control, observed, material],
  );
  const community = use$(
    () =>
      controlStore?.model(ConcordCommunityStateModel, material, {
        guestbook: guestbookStore,
        observed: observedStores,
      }),
    [controlStore, guestbookStore, stores.size, allStore, material],
  );
  const banlist = use$(() => controlStore?.model(ConcordBanlistModel, material), [controlStore, material]);
  const channels = use$(() => controlStore?.model(ConcordChannelsModel, material), [controlStore, material]);
  const roles = use$(() => controlStore?.model(ConcordRolesModel, material), [controlStore, material]);

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h3 className="font-bold">High-level community state</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="metadata" value={community?.metadata?.name ?? material.name ?? "-"} />
          <Stat label="members" value={community?.members.size ?? 0} />
          <Stat label="banned" value={community?.banlist.size ?? 0} />
          <Stat label="visibility" value={(community?.inviteLinks.size ?? 0) > 0 ? "public" : "private"} />
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h3 className="font-bold">Focused models</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="font-semibold">ConcordControlModel</div>
            <div className="opacity-70">
              {control?.channels.length ?? 0} channels, {control?.roles.length ?? 0} roles, {control?.inviteLinks.size ?? 0} invite links
            </div>
          </div>
          <div>
            <div className="font-semibold">ConcordObservedAuthorsModel</div>
            <div className="opacity-70">{observed?.size ?? 0} authors observed publishing</div>
          </div>
          <div>
            <div className="font-semibold">ConcordMembersModel</div>
            <div className="opacity-70">{members?.size ?? 0} complete members after guestbook + observation - bans</div>
          </div>
          <div>
            <div className="font-semibold">Selector models</div>
            <div className="opacity-70">
              {banlist?.size ?? 0} bans, {channels?.length ?? 0} channels, {roles?.length ?? 0} roles
            </div>
          </div>
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h3 className="font-bold">Channels</h3>
        <div className="flex flex-wrap gap-2">
          {(channels ?? []).map((channel) => (
            <span key={channel.channel_id} className="badge badge-outline gap-1">
              # {channel.name}
              {channel.private && <span className="opacity-60">private</span>}
            </span>
          ))}
          {channels?.length === 0 && <span className="opacity-60">No channels folded yet.</span>}
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h3 className="font-bold">Members</h3>
        <div className="flex flex-wrap gap-2">
          {[...(members ?? new Set<string>())].slice(0, 30).map((member) => (
            <ProfileBadge key={member} pubkey={member} />
          ))}
          {(members?.size ?? 0) > 30 && <span className="badge badge-ghost">+{(members?.size ?? 0) - 30}</span>}
          {members?.size === 0 && <span className="opacity-60">No members folded yet.</span>}
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h3 className="font-bold">Public profile loading</h3>
        <p className="text-sm opacity-70">
          Member names and avatars above come from public kind-0 profile events loaded from {PROFILE_RELAYS.length} public relays,
          separate from the encrypted Concord rumor stores.
        </p>
      </section>
    </div>
  );
}

function Walker({ material, signer, self, onReset }: { material: JoinMaterial; signer: ISigner; self: string; onReset: () => void }) {
  const storesRef = useRef<Map<string, RumorStore>>(new Map());
  const allStoreRef = useRef(new RumorStore());
  const seenRef = useRef<Set<string>>(new Set());
  const driversSub = useRef<Subscription>(new Subscription());
  const seenRelays = useRef(new Set<string>());
  const [planes, setPlanes] = useState<PlaneDescriptor[]>([]);
  const [epochs, setEpochs] = useState<EpochSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relays = relaysFor(material);
  const ensureAuth = (rs: string[]) => {
    for (const url of rs) {
      if (seenRelays.current.has(url)) continue;
      seenRelays.current.add(url);
      driversSub.current.add(relayAuth.authenticateStreamKeys(pool.relay(url)));
    }
  };

  const route = useCallback((entry: RoutedRumor) => {
    const key = planeKey(entry);
    let store = storesRef.current.get(key);
    if (!store) {
      store = new RumorStore();
      storesRef.current.set(key, store);
      const label = entry.channelId ? `# ${entry.channelName ?? shortHex(entry.channelId)}` : PLANE_LABELS[entry.kind as Exclude<PlaneKind, "channel">];
      setPlanes((prev) => (prev.some((p) => p.key === key) ? prev : [...prev, { key, kind: entry.kind, label }]));
    }
    store.add(entry.decoded.rumor);
    allStoreRef.current.add(entry.decoded.rumor);
    if (!seenRef.current.has(entry.decoded.rumor.id)) {
      seenRef.current.add(entry.decoded.rumor.id);
      setTotal((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let prior: ConcordKeys | undefined;
        let chain = buildChain(material);
        let i = 0;
        while (alive && i < chain.length) {
          const result = await loadEpoch(chain[i], prior, self, signer, relays, ensureAuth, i + 1 < chain.length, route);
          if (!alive) return;
          prior = result.keys;
          setEpochs((prev) => [...prev, result.summary]);
          if (result.adoptedMaterial) chain = [...chain, result.adoptedMaterial];
          else if (result.summary.transition !== "known") break;
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
      allStoreRef.current.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-lg flex-1">{material.name || "Community models"}</h2>
        <button className="btn btn-sm btn-ghost" onClick={onReset}>
          New invite
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!done && <span className="loading loading-spinner loading-sm" />}
        <span className="badge badge-outline">{epochs.length} epochs</span>
        <span className="badge badge-outline">{planes.length} stores</span>
        <span className="badge badge-outline">{total} rumors</span>
        <code className="text-xs opacity-60 break-all">{shortHex(material.community_id)}</code>
      </div>

      {error && <div className="alert alert-error py-2">{error}</div>}

      <div className="border border-base-300 rounded-box p-4 flex flex-col gap-2">
        <h3 className="font-bold">Rumor stores populated from the invite</h3>
        <div className="flex flex-wrap gap-2">
          {planes.map((plane) => (
            <span key={plane.key} className="badge badge-ghost">
              {plane.label}
            </span>
          ))}
          {planes.length === 0 && <span className="opacity-60">Loading planes…</span>}
        </div>
      </div>

      {storesRef.current.has("control") && (
        <ModelOutputs material={material} stores={storesRef.current} allStore={allStoreRef.current} />
      )}
    </div>
  );
}

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

  if (material) {
    return <Walker key={material.community_id + ":" + material.root_epoch} material={material} signer={signer} self={self} onReset={() => setMaterial(null)} />;
  }

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      {error && <div className="alert alert-error py-2">{error}</div>}
      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h2 className="font-bold">Concord invite link</h2>
        <p className="text-sm opacity-70">
          Paste an invite to decrypt the community planes into RumorStores and watch the Concord models fold them.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input input-bordered flex-1 min-w-64 font-mono text-sm"
            placeholder="https://.../invite/naddr1...#..."
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void open()}
          />
          <button className="btn btn-primary" onClick={() => void open()} disabled={!invite.trim() || resolving}>
            {resolving ? <span className="loading loading-spinner loading-sm" /> : "Load models"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ConcordModelsExample() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);

  if (!signer || !pubkey) {
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );
  }

  return <InviteEntry signer={signer} self={pubkey} />;
}
