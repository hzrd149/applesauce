/**
 * Walk a real Concord community's cryptographic history epoch by epoch from an invite link, deriving each
 * epoch's ConcordKeys and fetching its plane events live; past the invite's tip, your signer folds the
 * rekey blobs addressed to you to follow further Refoundings.
 * @tags concord, encryption, crypto, epochs, rekey, relays, nip-42
 * @related concord/crypto-lifecycle, concord/community-list
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import {
  ConcordRelayAuth,
  Helpers,
  type CommunityState,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
  type Role,
} from "applesauce-concord";

const {
  decodeWrap,
  decryptBundle,
  deriveConcordKeys,
  foldControl,
  EPHEMERAL_GIFT_WRAP_KIND,
  foldMembers,
  GIFT_WRAP_KIND,
  INVITE_BUNDLE_KIND,
  parseInviteLink,
  readRekey,
  refoundAuthority,
  resolveStanding,
  STOCK_RELAYS,
  verifyOwner,
} = Helpers;

type ConcordKeys = Helpers.ConcordKeys;
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useRef, useState } from "react";
import { BehaviorSubject, firstValueFrom, Subscription, takeUntil, timer, toArray } from "rxjs";

import LoginView from "../../components/login-view";

// ---- module singletons (no ConcordClient — a manual, functional walk) ------

const pool = new RelayPool();
const relayAuth = new ConcordRelayAuth(pool);
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

// ---- model -----------------------------------------------------------------

type PlaneCounts = { control: number; guestbook: number; channels: number; dissolved: number; rekey: number };

/** How the walk continues after an epoch — drives the Next button + the badge. */
type Transition = "known" | "adopt" | "removed" | "tip" | "cannot-follow";

/** One rendered epoch: its derived keys, folded state, and what fetching found. */
type EpochSnapshot = {
  epoch: number;
  keys: ConcordKeys;
  state: CommunityState;
  memberCount: number;
  counts: PlaneCounts;
  transition: Transition;
  rotator?: string;
};

/** The result of loading one epoch: the snapshot + the next epoch to walk (if any). */
type LoadResult = { snapshot: EpochSnapshot; adoptedMaterial?: JoinMaterial };

// ---- the walk (functional, over the exported crypto core) ------------------

/**
 * The ordered chain of epochs the invite grants: every prior root retained in
 * `held_roots` plus the current one. `rollForward` prepends
 * `{epoch: prevEpoch, key: prevRoot}` on each Refounding, so this yields epoch
 * 0..current. Reconstructing a held epoch needs only its root — no signer.
 */
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
    // Only roots strictly older than this epoch were "held" at it (cosmetic count).
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

/**
 * Derive one epoch's keys, authenticate + fetch its plane events, fold them, and
 * decide how the walk continues. `prior` threads the previous epoch's key state so
 * `planes` accumulates and already-fetched history stays decodable (mirrors
 * `rollForward`). `chainHasNext` is true when the invite already holds the next
 * root; otherwise the user's signer folds the rekey blobs to follow further.
 */
async function loadEpoch(
  epochMaterial: JoinMaterial,
  prior: ConcordKeys | undefined,
  self: string,
  signer: ISigner,
  relays: string[],
  ensureAuth: (relays: string[]) => void,
  chainHasNext: boolean,
): Promise<LoadResult> {
  // 1. Derive with no channels yet; register the core planes and authenticate.
  let keys = deriveConcordKeys(epochMaterial, [], prior);
  relayAuth.registerStreamKeys([keys.control, keys.guestbook, keys.dissolved, keys.nextBaseRekey.key]);
  ensureAuth(relays);

  // 2. Fetch control / guestbook / dissolved / next-rekey wraps and bucket by plane.
  const authorsA = [keys.control.pk, keys.guestbook.pk, keys.dissolved.pk, keys.nextBaseRekey.key.pk];
  const control: DecodedEvent[] = [];
  const guestbook: DecodedEvent[] = [];
  const dissolved: DecodedEvent[] = [];
  const rekey: DecodedEvent[] = [];
  for (const ev of await fetchWraps(relays, authorsA)) {
    const info = keys.planes.get(ev.pubkey);
    if (!info) continue;
    const d = decodeWrap(ev, info.convKey);
    if (!d) continue;
    if (info.type === "control") control.push(d);
    else if (info.type === "guestbook") guestbook.push(d);
    else if (info.type === "dissolved") dissolved.push(d);
    else if (info.type === "rekey") rekey.push(d);
  }

  // 3. Fold the control plane → channels/roles/grants, then re-derive to reveal the
  //    channel addresses (public roll every epoch; private reuse material.channels).
  const state0 = foldControl(control, epochMaterial);
  keys = deriveConcordKeys(epochMaterial, state0.channels, prior);
  relayAuth.registerStreamKeys([...keys.channels.values()]);
  const channelDecoded: DecodedEvent[] = [];
  for (const ev of await fetchWraps(
    relays,
    [...keys.channels.values()].map((k) => k.pk),
  )) {
    const info = keys.planes.get(ev.pubkey);
    if (!info || info.type !== "channel") continue;
    const d = decodeWrap(ev, info.convKey);
    if (d) channelDecoded.push(d);
  }

  // 4. Members = folded Guestbook ∪ everyone observed publishing, minus the Banlist.
  const observed = new Map<string, number>();
  for (const d of [...control, ...guestbook, ...channelDecoded, ...dissolved]) {
    if (d.ms > (observed.get(d.author) ?? 0)) observed.set(d.author, d.ms);
  }
  const rolesMap = new Map<string, Role>(state0.roles.map((r) => [r.role_id, r]));
  const members = foldMembers(guestbook, observed, state0.banlist, (m) =>
    resolveStanding(m, epochMaterial.owner, rolesMap, state0.grants),
  );
  const state: CommunityState = { ...state0, members };

  // 5. Decide the transition. If the invite already holds the next root it's a known
  //    Refounding; otherwise fold the rekey blobs with the user's signer — adopt the
  //    new root if one is addressed to us, or detect that we were removed.
  let transition: Transition = "tip";
  let rotator: string | undefined;
  let adoptedMaterial: JoinMaterial | undefined;
  if (chainHasNext) {
    transition = "known";
  } else if (!signer.nip44) {
    transition = "cannot-follow";
  } else {
    const outcome = await readRekey(keys, rekey, refoundAuthority(state), self, signer, state.channels);
    if (outcome.kind === "adopt") {
      transition = "adopt";
      rotator = outcome.rotator;
      adoptedMaterial = outcome.next.material;
    } else if (outcome.kind === "removed") {
      transition = "removed";
    }
  }

  return {
    snapshot: {
      epoch: epochMaterial.root_epoch,
      keys,
      state,
      memberCount: members.size,
      counts: {
        control: control.length,
        guestbook: guestbook.length,
        channels: channelDecoded.length,
        dissolved: dissolved.length,
        rekey: rekey.length,
      },
      transition,
      rotator,
    },
    adoptedMaterial,
  };
}

/** Fetch the community's live invite bundle and project it to JoinMaterial. */
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
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return shortHex(pubkey);
  }
}

/** An address row, highlighted when it rolled since the previous epoch. */
function Row({ label, value, changed }: { label: string; value: string; changed?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-32 shrink-0 text-xs opacity-60">{label}</span>
      <code className={`text-xs break-all font-mono ${changed ? "text-warning font-semibold" : "opacity-80"}`}>
        {value}
      </code>
      {changed && <span className="badge badge-warning badge-xs">rolled</span>}
    </div>
  );
}

function changedAddrs(cur: EpochSnapshot, prev?: EpochSnapshot): Set<string> {
  const out = new Set<string>();
  if (!prev) return out;
  const a = cur.keys;
  const b = prev.keys;
  if (a.material.community_root !== b.material.community_root) out.add("root");
  if (a.control.pk !== b.control.pk) out.add("control");
  if (a.guestbook.pk !== b.guestbook.pk) out.add("guestbook");
  if (a.dissolved.pk !== b.dissolved.pk) out.add("dissolved");
  if (a.nextBaseRekey.key.pk !== b.nextBaseRekey.key.pk) out.add("nextRekey");
  return out;
}

function TransitionBadge({ snap }: { snap: EpochSnapshot }) {
  switch (snap.transition) {
    case "known":
    case "adopt":
      return (
        <span className="badge badge-warning badge-outline gap-1">
          ↻ Refounded → epoch {snap.epoch + 1}
          {snap.rotator && <span className="opacity-70">by {shortNpub(snap.rotator)}</span>}
        </span>
      );
    case "removed":
      return <span className="badge badge-error badge-outline">You were removed at epoch {snap.epoch + 1}</span>;
    case "cannot-follow":
      return <span className="badge badge-ghost">Signer can't decrypt rekeys — can't follow past epoch {snap.epoch}</span>;
    case "tip":
      return <span className="badge badge-success badge-outline">✓ Current tip (epoch {snap.epoch})</span>;
  }
}

function EpochCard({ snap, prev }: { snap: EpochSnapshot; prev?: EpochSnapshot }) {
  const changed = changedAddrs(snap, prev);
  const k = snap.keys;
  const channels = k.material.channels; // key-bearing channel set at this epoch
  return (
    <div className="border border-base-300 rounded-box p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold flex-1">Epoch {snap.epoch}</h3>
        <span className="badge badge-outline">{snap.state.material.held_roots?.length ?? 0} held roots</span>
        <span className="badge badge-outline">{k.planes.size} planes</span>
        {snap.state.dissolved && <span className="badge badge-error">dissolved</span>}
      </div>

      <Row label="community_root" value={shortHex(k.material.community_root)} changed={changed.has("root")} />
      <Row label="control" value={shortHex(k.control.pk)} changed={changed.has("control")} />
      <Row label="guestbook" value={shortHex(k.guestbook.pk)} changed={changed.has("guestbook")} />
      <Row label="dissolved" value={shortHex(k.dissolved.pk)} changed={changed.has("dissolved")} />
      <Row label="next rekey" value={shortHex(k.nextBaseRekey.key.pk)} changed={changed.has("nextRekey")} />

      {snap.state.channels.length > 0 && (
        <div className="border-t border-base-300 mt-1 pt-2 flex flex-col gap-1">
          <span className="text-xs opacity-60">channels</span>
          {snap.state.channels.map((c) => (
            <div key={c.channel_id} className="flex items-baseline gap-2">
              <span className="w-32 shrink-0 text-xs flex items-center gap-1">
                #{c.name}
                <span className={`badge badge-xs ${c.private ? "badge-secondary" : "badge-ghost"}`}>
                  {c.private ? "private" : "public"}
                </span>
              </span>
              <code className="text-xs font-mono break-all opacity-80">
                {shortHex(k.channels.get(c.channel_id)?.pk ?? "")}
              </code>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-base-300 mt-1 pt-2 flex flex-wrap gap-2 text-xs">
        <span className="badge badge-ghost">{snap.counts.control} control</span>
        <span className="badge badge-ghost">{snap.counts.guestbook} guestbook</span>
        <span className="badge badge-ghost">{snap.counts.channels} channel msgs</span>
        <span className="badge badge-ghost">{snap.counts.rekey} rekey</span>
        <span className="badge badge-ghost">{snap.memberCount} members</span>
        <span className="badge badge-ghost">{snap.state.roles.length} roles</span>
        {channels.length > 0 && <span className="badge badge-ghost">{channels.length} keyed channels</span>}
      </div>

      <div className="mt-1">
        <TransitionBadge snap={snap} />
      </div>
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
  const [chain, setChain] = useState<JoinMaterial[]>(() => buildChain(material));
  const [snaps, setSnaps] = useState<EpochSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [atTip, setAtTip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relays = relaysFor(material);
  const driversSub = useRef<Subscription>(new Subscription());
  const seenRelays = useRef(new Set<string>());
  const aliveRef = useRef(true);
  const startedRef = useRef(false);

  const ensureAuth = (rs: string[]) => {
    for (const url of rs) {
      if (seenRelays.current.has(url)) continue;
      seenRelays.current.add(url);
      driversSub.current.add(relayAuth.authenticateStreamKeys(pool.relay(url)));
    }
  };

  // Advance one epoch: load chain[snaps.length], append it, extend/stop the walk.
  async function advance() {
    const i = snaps.length;
    if (busy || atTip || i >= chain.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await loadEpoch(chain[i], snaps[i - 1]?.keys, self, signer, relays, ensureAuth, i + 1 < chain.length);
      if (!aliveRef.current) return;
      setSnaps((prev) => [...prev, res.snapshot]);
      if (res.adoptedMaterial) setChain((prev) => [...prev, res.adoptedMaterial!]);
      else if (res.snapshot.transition !== "known") setAtTip(true);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  // Load genesis once on mount; tear the auth drivers down on unmount.
  useEffect(() => {
    aliveRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      void advance();
    }
    return () => {
      aliveRef.current = false;
      driversSub.current.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canNext = !busy && !atTip && snaps.length < chain.length;

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-lg flex-1">{material.name || "Community"}</h2>
        <button className="btn btn-sm btn-ghost" onClick={onReset}>
          ← New invite
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs opacity-60 break-all">{material.community_id}</code>
        <div className="flex-1" />
        <span className="badge badge-outline">
          {snaps.length} / {chain.length}
          {atTip ? "" : "+"} epochs
        </span>
      </div>

      {error && <div className="alert alert-error py-2">{error}</div>}

      <div className="flex flex-col gap-2">
        {snaps.map((snap, idx) => (
          <div key={snap.epoch} className="flex flex-col gap-2">
            {idx > 0 && <div className="text-center text-xs opacity-40">↓</div>}
            <EpochCard snap={snap} prev={idx > 0 ? snaps[idx - 1] : undefined} />
          </div>
        ))}
        {snaps.length === 0 && !error && <div className="opacity-70">Deriving genesis keys and fetching…</div>}
      </div>

      <div className="sticky bottom-0 bg-base-100 border-t border-base-300 py-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => void advance()} disabled={!canNext}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Next epoch ›"}
        </button>
        {busy && <span className="opacity-70">Fetching epoch {snaps.length}…</span>}
        {atTip && !busy && <span className="opacity-70">Reached the current tip.</span>}
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
            {resolving ? <span className="loading loading-spinner loading-sm" /> : "Walk history"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ConcordCryptoHistoryExample() {
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
