// ConcordPrivateChannel — the sub-community engine for ONE private channel.
//
// A private channel is keyed independently of the community_root (CORD-03) at its
// own epoch, so it syncs and rotates on its own lifecycle, lifted out of the
// community epoch walk. This mirrors ConcordCommunity's shape — derive keys →
// route decoded wraps into a RumorStore → epoch-atomic sync → live subscription →
// follow channel Rekeys — scoped to a single channel. It carries no fold logic:
// consumers read its `store` with the standard timeline/model API.

import type { Debugger } from "debug";
import { BehaviorSubject, Observable, Subscription, combineLatest, shareReplay, switchMap } from "rxjs";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { ISigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";

import { logger } from "../logger.js";
import type { ConcordRelayAuth } from "./relay-auth.js";
import { ExtraRelays, type ExtraRelaysOption } from "../helpers/relays.js";
import { deriveChannelKeys, readChannelRekey, type ChannelKeys, type PlaneInfo } from "../helpers/keys.js";
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND, decodeWrapCached } from "../helpers/gift-wrap.js";
import { checkChatBinding } from "../helpers/chat.js";
import { VOICE_PRESENCE_KIND } from "../helpers/voice.js";
import { isStrictlyLowerKey } from "../helpers/rekey.js";
import type {
  ChannelKey,
  ConcordPrivateChannelStatus,
  ConcordSyncPhase,
  DecodedEvent,
  JoinMaterial,
} from "../types.js";
import type { ConcordRumorStore } from "./storage.js";
import { syncAuthors } from "./sync.js";
import { channelLiveAuthors, syncChannelEpochs, type ChannelSyncContext } from "./channel-sync.js";

/** Options for a {@link ConcordPrivateChannel}, wired by {@link ConcordCommunity}. */
export interface ConcordPrivateChannelOptions {
  /** The channel's key material (independent secret + own epoch chain). */
  channelKey: ChannelKey;
  /** Accessor for the community's CURRENT material — its root/held_roots move on a
   *  Refounding and the channel-rekey address keys on them. */
  material: () => JoinMaterial;
  signer: ISigner;
  pubkey: string;
  pool: RelayPool;
  relayAuth: ConcordRelayAuth;
  /** Shared wrap-level store (dedup + NIP-77 local store). */
  eventStore: EventStore;
  /** The `channel:<id>` rumor store (owned by the community's store factory). */
  store: ConcordRumorStore;
  /** The channel's protocol relay set. Keeps its exact current meaning — never
   *  mutated, reassigned, or widened by `extraRelays` (D-14). */
  relays: string[];
  /** Additional transport-only relays threaded down from `ConcordClientOptions`
   *  (via the community), unioned into every request/subscription/publish/auth
   *  target this channel engine dials — but never written into any published
   *  content. Purely additive: with no extras configured, every relay set this
   *  engine uses is identical to `relays` alone (D-14); it never substitutes
   *  for `relays`. */
  extraRelays?: ExtraRelaysOption;
  /** May `rotator` rotate this channel at all — holds `MANAGE_CHANNELS` (CORD-04).
   *  Gates adoption and validity. */
  isAuthorized: (rotator: string) => boolean;
  /** May `rotator` remove US from the channel — `MANAGE_CHANNELS` AND strictly
   *  outranks us (CORD-04). Gates only the removal outcome, so an under-ranked
   *  manager can't sever us. When omitted, any authorized rotator may remove us. */
  canRemoveSelf?: (rotator: string) => boolean;
  /** vac verification against the folded Roster (CORD-04 D-08/D-12): a
   *  non-owner rotation must cite its Grant, structurally resolving to
   *  `grantLocator` AND still holding `MANAGE_CHANNELS` in the CURRENT folded
   *  Roster; the owner is exempt. Gates candidacy entirely (both adopt and
   *  removed), independent of `isAuthorized`. */
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean;
  /** Called when the channel key rolls forward (a Rekey) so the community persists it. */
  onKeyChange?: (channelKey: ChannelKey) => void;
  /** Called when a channel Rekey excludes us from the channel. */
  onRemoved?: (channelId: string) => void;
  /** A custom debug logger (defaults to the "applesauce:concord" namespace). */
  logger?: Debugger;
}

export class ConcordPrivateChannel {
  /** The channel's current epoch (bumps on each adopted Rekey). */
  readonly epoch$: BehaviorSubject<number>;
  /** The channel's sync-lifecycle phase (idle → syncing → live; removed/error). */
  readonly phase$ = new BehaviorSubject<ConcordSyncPhase>("idle");
  /** The last sync error message, or null. */
  readonly error$ = new BehaviorSubject<string | null>(null);
  /** Whether any of the channel's relays (plus any configured `extraRelays`) has
   *  an open socket — derived from the merged transport set (D-07). Because this
   *  is an any-of check, an always-up app-local extra keeps this reporting
   *  connected even when every real channel relay is down; an accepted,
   *  documented consequence of routing status through the merged set, not a
   *  defect. */
  readonly connected$: Observable<boolean>;
  /** Whether the channel's stream keys are NIP-42-authenticated on every
   *  connected relay in the merged transport set (D-07). Because this is an
   *  all-of check over connected relays, an extra that challenges and rejects
   *  our stream keys holds this flag low indefinitely; an accepted, documented
   *  consequence of routing status through the merged set, not a defect. */
  readonly authenticated$: Observable<boolean>;
  /** A flat snapshot of the channel's status, for UI to react to as one value. */
  readonly status$: Observable<ConcordPrivateChannelStatus>;

  /** The channel's debug logger — `options.logger` when threaded from the parent
   *  community, otherwise the `applesauce:concord` module base (D-01/D-02). */
  private readonly log: Debugger;
  /** The `:sync` sub-logger, derived ONCE in the constructor — handed to every
   *  {@link ChannelSyncContext} this instance builds. `syncContext()` runs once
   *  per `walk()` AND once per adopted rekey in `catchUpCurrent()`, so
   *  `.extend()`ing there would reallocate on every rotation. */
  private readonly syncLog: Debugger;
  /** The `:sync:decode` per-dropped-wrap logger (D-07), derived ONCE in the
   *  constructor — never re-`.extend()`d per wrap. */
  private readonly decodeLog: Debugger;
  private readonly opts: ConcordPrivateChannelOptions;
  /** The per-engine transport-only extras holder (D-04) — merges into every
   *  network target this engine dials; `opts.relays` itself is never touched. */
  private readonly extras: ExtraRelays;
  private channelKey: ChannelKey;
  private keys: ChannelKeys;
  /** Retained channel-rekey events, for the live rotation check. */
  private readonly rekeyEvents = new Map<string, DecodedEvent>();

  private liveSub?: Subscription;
  /** Reacts to every later `extraRelays` emission (D-08/D-09): re-opens the live
   *  subscription once one already exists, so a no-op emission before the
   *  channel has ever gone live cannot prematurely open its socket, and a real
   *  later change re-derives the merged set via `openLive()`'s own widened
   *  churn guard (Pitfall 4). */
  private extrasSub: Subscription;
  /** URL → the Subscription {@link relay-auth.js}'s `authenticateStreamKeys`
   *  returned for it (WR-04) — see `community.ts`'s identical field for the
   *  full rationale (prune on removal, fresh driver on re-add, no churn on an
   *  unchanged set, D-09). */
  private authDrivers = new Map<string, Subscription>();
  private liveAuthors = "";
  private rekeyTimer?: ReturnType<typeof setTimeout>;
  /** epoch → lowest adopted channel key (D-04 down-only anti-refork latch). A
   *  strictly lower sibling replaces the entry; an equal-or-higher one is
   *  ignored — mirrors community.ts's root-scope latch, in-memory only (A3). */
  private rekeyHandled = new Map<number, Uint8Array>();
  private started = false;
  private disposed = false;

  constructor(options: ConcordPrivateChannelOptions) {
    this.log = options.logger ?? logger;
    this.syncLog = this.log.extend("sync");
    this.decodeLog = this.syncLog.extend("decode");
    this.opts = options;
    // Constructed BEFORE the status observables below so their synchronous
    // snapshot is already seeded when connected$/authenticated$ build (D-04).
    this.extras = new ExtraRelays(options.extraRelays);
    this.channelKey = options.channelKey;
    this.keys = deriveChannelKeys(options.material(), options.channelKey);
    this.epoch$ = new BehaviorSubject<number>(options.channelKey.epoch);

    // Re-derive reactively on every extras emission (D-08) rather than once
    // from a construction-time snapshot — no first-value-only operator here, so
    // a later change on an `extraRelays` Observable keeps taking effect (D-11).
    this.connected$ = this.extras.relays$.pipe(switchMap(() => options.relayAuth.connected$(this.transport())));
    this.authenticated$ = this.extras.relays$.pipe(
      switchMap(() =>
        options.relayAuth.authenticated$(this.transport(), () =>
          channelLiveAuthors(this.opts.material(), this.channelKey).authors,
        ),
      ),
    );
    this.status$ = combineLatest({
      phase: this.phase$,
      epoch: this.epoch$,
      connected: this.connected$,
      authenticated: this.authenticated$,
      error: this.error$,
    }).pipe(shareReplay(1));

    this.extrasSub = this.extras.relays$.subscribe(() => {
      if (!this.disposed && this.liveSub) this.openLive();
    });
  }

  get channelId(): string {
    return this.channelKey.id;
  }

  /** The channel's message rumor store — read with `.timeline([{ kinds: [9] }])`. */
  get store(): ConcordRumorStore {
    return this.opts.store;
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Walk the channel to its tip (message planes + forward Rekeys), then open live. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.log("starting channel sync walk");
    await this.walk();
  }

  /** Re-walk after the community root rotated: the channel-rekey address keys on
   *  the root, and a Refounding may bundle a channel Rekey sealed under the prior
   *  root (CORD-06 §94). Called by {@link ConcordCommunity} on adopt. */
  async refreshForCommunityEpoch(): Promise<void> {
    if (!this.started || this.disposed) return;
    await this.walk();
  }

  dispose(): void {
    this.disposed = true;
    this.liveSub?.unsubscribe();
    for (const sub of this.authDrivers.values()) sub.unsubscribe();
    this.authDrivers.clear();
    this.extrasSub.unsubscribe();
    this.extras.dispose();
    if (this.rekeyTimer) clearTimeout(this.rekeyTimer);
    // The store is owned by the community's store factory — not disposed here.
  }

  private async walk(): Promise<void> {
    this.phase$.next("syncing");
    try {
      const result = await syncChannelEpochs(this.syncContext(), this.channelKey);
      if (this.disposed) return;
      if (result.removed) {
        this.handleRemoved();
        return;
      }
      if (result.tipKey) {
        const rolled = result.tipKey.epoch !== this.channelKey.epoch;
        this.setChannelKey(result.tipKey);
        if (rolled) this.opts.onKeyChange?.(result.tipKey);
        this.openLive();
      }
      this.error$.next(null);
      this.phase$.next("live");
      this.log("channel epoch walk complete tip_epoch=%d", this.channelKey.epoch);
    } catch (err) {
      if (this.disposed) return;
      this.error$.next(err instanceof Error ? err.message : String(err));
      this.phase$.next("error");
    }
  }

  private setChannelKey(next: ChannelKey): void {
    this.channelKey = next;
    this.keys = deriveChannelKeys(this.opts.material(), next);
    this.epoch$.next(next.epoch);
  }

  /** Feed a wrap into the channel directly (an optimistic echo of a rekey the
   *  community just published, so the rotator adopts without a relay round-trip). */
  ingest(event: NostrEvent): void {
    this.onWrap(event);
  }

  // ---- routing ------------------------------------------------------------

  private onWrap(event: NostrEvent): void {
    const info = this.keys.planes.get(event.pubkey);
    if (!info) return;
    const canonical = (this.opts.eventStore.add(event) as NostrEvent | null) ?? event;
    const decoded = decodeWrapCached(canonical, info.convKey);
    if (decoded) {
      this.route(info, decoded);
    } else {
      // Prefer the PLANE's own epoch (rekey planes address `epoch + 1`), falling
      // back to the enclosing channel's known epoch — RESEARCH Pitfall 3, and the
      // same rule `route()` below and the sync walk use, so a wrap dropped live
      // and the same wrap dropped during sync report the same `epoch=`.
      this.decodeLog(
        "dropped wrap=%s plane=%s epoch=%d",
        canonical.id.slice(0, 8),
        info.type,
        info.epoch ?? this.channelKey.epoch,
      );
    }
  }

  private route(info: PlaneInfo, decoded: DecodedEvent): void {
    if (info.type === "channel") {
      // CORD-03 §44: drop any rumor whose channel/epoch binding doesn't match the
      // key that opened it, and voice presence (not chat).
      if (!checkChatBinding(decoded.rumor.tags, this.channelId, info.epoch ?? this.channelKey.epoch)) return;
      if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;
      // `.add` is sync for an in-memory store and a Promise for an async-database-backed one;
      // state derives reactively from `insert$`, so fire-and-forget while surfacing errors.
      Promise.resolve(this.opts.store.add(decoded.rumor)).catch((err) => {
        this.log("failed to add rumor to channel store: %s", (err as Error)?.message ?? err);
        console.error("[applesauce-concord] Failed to add rumor to channel store:", err);
      });
    } else if (info.type === "rekey") {
      this.rekeyEvents.set(decoded.wrapId, decoded);
      this.scheduleRekeyCheck();
    }
  }

  // ---- sync context / live subscription -----------------------------------

  /** The merged transport target for this channel: `opts.relays` unioned with
   *  the current extras snapshot (D-04) — the ONLY merge point in the class.
   *  `opts.relays` itself keeps its exact protocol meaning untouched; this is
   *  for network targets only (pool subscription/request/publish, auth), never
   *  for anything written into signed or published content. */
  private transport(): string[] {
    return this.extras.merge(this.opts.relays);
  }

  private syncContext(): ChannelSyncContext {
    return {
      pool: this.opts.pool,
      relayAuth: this.opts.relayAuth,
      eventStore: this.opts.eventStore,
      signer: this.opts.signer,
      self: this.opts.pubkey,
      relays: this.transport(),
      material: this.opts.material(),
      isAuthorized: this.opts.isAuthorized,
      canRemoveSelf: this.opts.canRemoveSelf,
      verifyVac: this.opts.verifyVac,
      route: (info, decoded) => this.route(info, decoded),
      ensureAuth: (relays) => this.ensureAuth(relays),
      alive: () => !this.disposed,
      logger: this.syncLog,
      decodeLogger: this.decodeLog,
    };
  }

  /** Synchronise the per-URL auth-driver registry against `relays` (WR-04) —
   *  mirrors `community.ts`'s identical method: prune any driver whose URL
   *  left the set, register a fresh one for anything new (including a re-add
   *  after removal), and leave an entry untouched if it's still wanted (no
   *  churn, D-09). MUST always be called with the COMPLETE current transport
   *  set, never a subset — both call sites below (`syncContext()`,
   *  `openLive()`) pass a full transport snapshot. */
  private ensureAuth(relays: string[]): void {
    const wanted = new Set(relays);
    for (const [url, sub] of this.authDrivers) {
      if (wanted.has(url)) continue;
      sub.unsubscribe();
      this.authDrivers.delete(url);
    }
    for (const url of wanted) {
      if (this.authDrivers.has(url)) continue;
      this.authDrivers.set(url, this.opts.relayAuth.authenticateStreamKeys(this.opts.pool.relay(url)));
    }
  }

  private openLive(): void {
    this.keys = deriveChannelKeys(this.opts.material(), this.channelKey);
    const { authors } = channelLiveAuthors(this.opts.material(), this.channelKey);
    // Computed ONCE and reused for the guard, the auth registration, the
    // subscription target, and the debug log's length (mirrors
    // `community.ts`'s `openLive()` `targets` local verbatim) — the previous
    // four separate `transport()` calls made the guard agree with what was
    // actually dialled only by accident, and the fourth allocated a merged
    // array purely to read its length. D-09/Pitfall 4: the churn guard's key
    // covers BOTH the sorted authors list and the sorted merged transport set,
    // so a no-op `extraRelays$` re-emission (already de-duped upstream by
    // `ExtraRelays`) still can't tear down and reopen the live socket if
    // neither actually changed.
    const targets = this.transport();
    const sig = `${[...authors].sort().join(",")}|${[...targets].sort().join(",")}`;
    if (sig === this.liveAuthors && this.liveSub) return;
    this.liveAuthors = sig;
    this.opts.relayAuth.registerStreamKeys([this.keys.current, ...this.keys.nextRekey.map((r) => r.key)]);
    this.ensureAuth(targets);
    this.liveSub?.unsubscribe();
    this.liveSub = this.opts.pool
      .subscription(targets, [{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors }], {
        waitForAuth: authors,
      })
      .subscribe((event) => this.onWrap(event as NostrEvent));
    this.log("live subscription open targets=%d", targets.length);
  }

  // ---- live channel-rekey adoption ----------------------------------------

  private scheduleRekeyCheck(): void {
    if (this.rekeyTimer) return;
    this.rekeyTimer = setTimeout(() => {
      this.rekeyTimer = undefined;
      void this.checkRekey();
    }, 200);
  }

  private async checkRekey(): Promise<void> {
    const outcome = await readChannelRekey(
      this.channelKey,
      [...this.rekeyEvents.values()],
      this.opts.isAuthorized,
      this.opts.pubkey,
      this.opts.signer,
      this.opts.canRemoveSelf,
      this.opts.verifyVac,
    );
    if (outcome.kind === "none" || this.disposed) return;
    if (outcome.kind === "removed") {
      this.log("channel rekey fold: removed epoch=%d", outcome.epoch);
      this.handleRemoved();
      return;
    }
    // Down-only latch (D-04): adopt when unlatched, or when the candidate
    // channel key is STRICTLY lower than the latched one; an equal-or-higher
    // sibling is already-converged and ignored (never re-fork a settled epoch).
    const candidate = hexToBytes(outcome.next.key);
    const latched = this.rekeyHandled.get(outcome.epoch);
    if (latched && !isStrictlyLowerKey(latched, candidate)) return;
    this.rekeyHandled.set(outcome.epoch, candidate);
    this.log("channel rekey fold: adopting epoch=%d", outcome.epoch);
    // Adopt: roll to the new key, persist, reopen live, and catch up the new
    // epoch's message history (published between the rekey and now).
    this.setChannelKey(outcome.next);
    this.opts.onKeyChange?.(outcome.next);
    this.openLive();
    void this.catchUpCurrent();
  }

  private async catchUpCurrent(): Promise<void> {
    const current = this.keys.current.pk;
    for (const event of await syncAuthors(this.syncContext(), [current])) this.onWrap(event);
  }

  private handleRemoved(): void {
    const id = this.channelId;
    this.log("channel removed id=%s", id.slice(0, 8));
    this.phase$.next("removed");
    this.dispose();
    this.opts.onRemoved?.(id);
  }
}
