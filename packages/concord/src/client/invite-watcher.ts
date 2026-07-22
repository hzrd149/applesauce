// InviteWatcher — user-inbox reader for CORD-05 §6 Direct Invites.
//
// Direct Invites are standard NIP-59 gift wraps addressed to the user's real
// pubkey, carrying a kind-3313 rumor. This class owns the client-side receive
// loop: discover inbox relays, authenticate as the user when relays challenge,
// fetch/live-subscribe gift wraps, optionally decrypt them, and keep local
// dismissal state so apps can hide invites without deleting relay data.

import type { Debugger } from "debug";
import {
  BehaviorSubject,
  Observable,
  Subscription,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  timeout,
  toArray,
} from "rxjs";
import { EventStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";
import { kinds, normalizeURL, type NostrEvent } from "applesauce-core/helpers";
import { getGiftWrapRumor } from "applesauce-common/helpers/gift-wrap";
import { castUser } from "applesauce-common/casts";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import { logger } from "../logger.js";
import { ConcordDirectInvite } from "../casts/direct-invite.js";
import {
  directInviteFilter,
  isValidDirectInvite,
  lockDirectInvite,
  unlockDirectInvite,
} from "../helpers/direct-invite.js";
import { ExtraRelays, type ExtraRelaysOption } from "../helpers/relays.js";
import { ConcordRelayAuth } from "./relay-auth.js";
import { defaultStorage, type ConcordStorage } from "./storage.js";

interface DirectInviteRecord {
  wrap: NostrEvent;
  invite?: ConcordDirectInvite;
  error?: unknown;
}

/** Options for constructing a {@link InviteWatcher}. */
export interface InviteWatcherOptions {
  /** The logged-in user's signer. Must support NIP-44 decryption for unwraps. */
  signer: ISigner;
  /** The applesauce RelayPool used for inbox requests/subscriptions. */
  pool: RelayPool;
  /** Shared wrap-level store. Defaults to a fresh {@link EventStore}. */
  eventStore?: EventStore;
  /** Persistence for cursors and locally dismissed invite ids. */
  storage?: ConcordStorage;
  /** Fallback inbox relays when no 10050/NIP-65 inboxes are known. */
  relays?: string[];
  /** Explicit inbox relays to read from instead of discovering 10050/NIP-65 relays. */
  inboxRelays?: string[];
  /** Additional transport-only relays unioned onto every request/subscription this
   *  watcher performs, and onto the per-relay user-AUTH loop (D-03/D-12). Distinct
   *  from both `relays` (fallback inboxes) and `inboxRelays` (an explicit inbox
   *  override): extras are additive transport targets, never a source of
   *  discovered inboxes, and never written into any published content. Purely
   *  additive: with no extras configured, every relay set this watcher uses is
   *  identical to what it resolves on its own (D-14). */
  extraRelays?: ExtraRelaysOption;
  /** Override the storage namespace for cursors/dismissals. */
  cursorKey?: string;
  /** Decrypt invites as they arrive instead of exposing them via `pending$`. */
  autoDecrypt?: boolean;
  /** NIP-42-authenticate as the user when relays challenge. Defaults to `true`; set `false`
   *  and call {@link authenticateUser} when {@link needsAuth$} is true. */
  autoAuthenticate?: boolean;
  /** Also scan all `#p=me` gift wraps to catch unindexed kind-3313 rumors. */
  scanUntagged?: boolean;
  /** Seconds to overlap cursor-based fetches. Defaults to two hours for NIP-59 timestamp randomization. */
  overlapSeconds?: number;
  /** Timeout for one-shot relay requests. Defaults to 10 seconds. */
  requestTimeout?: number;
  /** A custom debug logger (defaults to the "applesauce:concord" namespace, extended
   *  with "invite" when threaded from {@link ConcordClient}). */
  logger?: Debugger;
}

/** Watches the user's gift-wrap inbox for Concord Direct Invites. */
export class InviteWatcher {
  readonly signer: ISigner;
  readonly pubkey$ = new BehaviorSubject<string | undefined>(undefined);
  readonly relays$ = new BehaviorSubject<string[]>([]);
  /** All discovered candidate wrap events. */
  readonly wraps$ = new BehaviorSubject<NostrEvent[]>([]);
  /** Locked, indexed direct-invite wraps that have not been dismissed — the invites still
   *  waiting to be unlocked. {@link readPending} decrypts them all. */
  readonly pending$ = new BehaviorSubject<NostrEvent[]>([]);
  /** How many pending (locked, undismissed) invites are waiting to be unlocked — for a UI badge. */
  readonly pendingCount$: Observable<number>;
  /** Decrypted valid invites, including dismissed and expired invites. */
  readonly allInvites$ = new BehaviorSubject<ConcordDirectInvite[]>([]);
  /** Decrypted valid invites visible to the app. Dismissed and expired invites are hidden. */
  readonly invites$ = new BehaviorSubject<ConcordDirectInvite[]>([]);
  readonly dismissed$ = new BehaviorSubject<Set<string>>(new Set());
  readonly status$ = new BehaviorSubject<string>("");
  /** Whether any connected inbox relay requires user NIP-42 auth that hasn't been satisfied yet. */
  readonly needsAuth$: Observable<boolean>;

  /** The watcher's debug logger — `options.logger` when threaded from
   *  {@link ConcordClient}, otherwise the `applesauce:concord:invite` module base
   *  (D-01/D-02). */
  private readonly log: Debugger;
  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordStorage;
  private readonly fallbackRelays: string[];
  private readonly inboxRelays?: string[];
  private readonly relayAuth: ConcordRelayAuth;
  private readonly autoDecrypt: boolean;
  private readonly autoAuthenticate: boolean;
  private readonly scanUntagged: boolean;
  private readonly overlapSeconds: number;
  private readonly requestTimeout: number;
  private readonly cursorKey?: string;
  /** The per-engine transport-only extras holder (D-04) — merges into every
   *  network target this watcher dials; the discovered-inbox subject
   *  (`relays$`) is never fed a merged value (prohibition). */
  private readonly extras: ExtraRelays;

  private readonly records = new Map<string, DirectInviteRecord>();
  private authSub?: Subscription;
  private liveSub?: Subscription;
  /** Reacts to every later `extraRelays` emission (D-09): re-opens the live
   *  subscription once one already exists, so a no-op emission before the
   *  watcher has ever gone live cannot prematurely open its socket, and a real
   *  later change re-derives the merged set via `openLive()`'s own churn guard. */
  private extrasSub: Subscription;
  /** The signature `openLive()` last opened a subscription for (pubkey plus the
   *  sorted merged transport set) — guards against tearing down and reopening
   *  the socket for a no-op re-emission (D-09/Pitfall 4, mirrors private-channel.ts). */
  private liveSignature = "";
  private started = false;
  private pubkey?: string;
  private cursor = 0;

  constructor(options: InviteWatcherOptions) {
    this.log = options.logger ?? logger.extend("invite");
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore ?? new EventStore();
    this.storage = options.storage ?? defaultStorage();
    this.fallbackRelays = options.relays ?? [];
    this.inboxRelays = options.inboxRelays;
    this.relayAuth = new ConcordRelayAuth(options.pool);
    this.autoDecrypt = options.autoDecrypt ?? false;
    this.autoAuthenticate = options.autoAuthenticate ?? true;
    // Constructed before needsAuth$ below so its synchronous snapshot is
    // already seeded when the derivation first builds (D-04).
    this.extras = new ExtraRelays(options.extraRelays);
    // Re-derive on every extras emission too (D-11: no first-value-only
    // operator), computing the merged set locally via `transport()` rather
    // than widening the public `relays$` subject — a gating extras relay now
    // factors into needsAuth$ because we authenticate against it (D-03), but
    // relays$ itself must keep reporting only what discovery found.
    this.needsAuth$ = combineLatest([this.relays$, this.extras.relays$, this.pool.status$, this.pubkey$]).pipe(
      map(([relays, , statuses, pubkey]) => this.userNeedsAuth(this.transport(relays), statuses, pubkey)),
      distinctUntilChanged(),
    );
    this.pendingCount$ = this.pending$.pipe(
      map((pending) => pending.length),
      distinctUntilChanged(),
    );
    this.scanUntagged = options.scanUntagged ?? false;
    this.overlapSeconds = options.overlapSeconds ?? 2 * 60 * 60;
    this.requestTimeout = options.requestTimeout ?? 10_000;
    this.cursorKey = options.cursorKey;

    this.extrasSub = this.extras.relays$.subscribe(() => {
      if (this.liveSub) this.openLive();
    });
  }

  /** The merged transport target for a given base relay set: `base` unioned
   *  with the current extras snapshot (D-04) — the ONLY merge point in the
   *  class. Never fed to the public `relays$` discovered-inbox subject, which
   *  only ever reports what `resolveRelays()` found (prohibition). */
  private transport(base: string[]): string[] {
    return this.extras.merge(base);
  }

  get eventStoreRef(): EventStore {
    return this.eventStore;
  }

  // ---- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.log("starting direct invite watcher");
    this.pubkey = await this.signer.getPublicKey();
    this.pubkey$.next(this.pubkey);
    await this.loadDismissed();
    await this.loadCursor();
    this.ingestLocalEvents();
    const relays = await this.resolveRelays();
    this.relays$.next(relays);
    if (this.autoAuthenticate) this.authSub = this.relayAuth.autoAuthenticate(this.signer, this.pubkey);
    await this.refresh();
    this.openLive();
  }

  /** NIP-42-authenticate as the user on every connected inbox relay that requires auth. */
  async authenticateUser(): Promise<void> {
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    // Merged so a gating extras relay also receives the user's AUTH (D-03).
    const relays = this.transport(this.relays$.value);
    if (relays.length === 0) return;
    const statuses = await firstValueFrom(this.pool.status$);
    for (const url of relays) {
      const status = statuses[normalizeURL(url)] ?? statuses[url];
      if (!status?.connected) continue;
      if (!status.authRequiredForRead && !status.authRequiredForPublish) continue;
      const relay = this.pool.relay(url);
      if (relay.isAuthenticated(this.pubkey)) continue;
      try {
        await relay.authenticate(this.signer);
      } catch (err) {
        this.log("user AUTH to %s failed: %s", url, (err as Error)?.message ?? err);
        console.warn(`user AUTH to ${url} failed`, err);
      }
    }
  }

  stop(): void {
    this.log("stopping direct invite watcher");
    this.started = false;
    this.authSub?.unsubscribe();
    this.authSub = undefined;
    this.liveSub?.unsubscribe();
    this.liveSub = undefined;
    this.extrasSub.unsubscribe();
    this.extras.dispose();
    this.status$.next("");
  }

  /** Fetches historical Direct Invite wraps from the current inbox relays. */
  async refresh(): Promise<void> {
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    const relays = this.relays$.value.length ? this.relays$.value : await this.resolveRelays();
    if (relays.length === 0) return;
    this.relays$.next(relays);
    const filters = this.filters();
    const since = this.cursor > 0 ? Math.max(0, this.cursor - this.overlapSeconds) : undefined;
    const requestFilters = since === undefined ? filters : filters.map((filter) => ({ ...filter, since }));

    this.status$.next("Fetching direct invites...");
    const events = await firstValueFrom(
      this.pool.request(this.transport(relays), requestFilters).pipe(toArray(), timeout(this.requestTimeout)),
    ).catch(() => [] as NostrEvent[]);

    for (const event of events) await this.ingest(event);
    await this.saveCursorFromEvents(events);
    this.status$.next("");
  }

  /** Adds a raw gift wrap from any source and optionally decrypts it. */
  async ingest(event: NostrEvent): Promise<void> {
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    if (!this.acceptWrap(event)) return;
    const canonical = (this.eventStore.add(event) as NostrEvent | null) ?? event;
    this.log("received direct invite wrap id=%s", canonical.id.slice(0, 8));
    if (!this.records.has(canonical.id)) this.records.set(canonical.id, { wrap: canonical });
    else this.records.get(canonical.id)!.wrap = canonical;
    this.recompute();
    if (this.autoDecrypt) await this.decrypt(canonical);
  }

  async ingestMany(events: Iterable<NostrEvent>): Promise<void> {
    for (const event of events) await this.ingest(event);
  }

  /** Decrypts a pending wrap and returns its cast Direct Invite when valid. */
  async decrypt(event: NostrEvent | string): Promise<ConcordDirectInvite | undefined> {
    const wrap = this.resolveWrap(event);
    if (!wrap) return undefined;
    let record = this.records.get(wrap.id);
    if (!record) {
      record = { wrap };
      this.records.set(wrap.id, record);
    }
    if (record.invite) return record.invite;
    try {
      const bundle = await unlockDirectInvite(wrap, this.signer);
      const rumor = bundle ? getGiftWrapRumor(wrap) : undefined;
      if (!rumor) return undefined;
      const invite = castEvent(rumor, ConcordDirectInvite, this.eventStore);
      if (!invite.valid) return undefined;
      record.invite = invite;
      record.error = undefined;
      this.recompute();
      return invite;
    } catch (err) {
      record.error = err;
      this.recompute();
      return undefined;
    }
  }

  async decryptAll(): Promise<ConcordDirectInvite[]> {
    const invites: ConcordDirectInvite[] = [];
    for (const record of this.sortedRecords()) {
      const invite = await this.decrypt(record.wrap);
      if (invite) invites.push(invite);
    }
    return invites;
  }

  /**
   * Unlock every pending (locked, undismissed) invite so the app can show them for the user to
   * accept. This is the deliberate signer-decryption entry point when the client runs without
   * auto-unlock: {@link pending$} / {@link pendingCount$} surface how many are waiting, and this
   * decrypts them (each moves from `pending$` into {@link invites$}). Wraps that fail to decrypt
   * are skipped. Returns the newly-unlocked invites.
   */
  async readPending(): Promise<ConcordDirectInvite[]> {
    const invites: ConcordDirectInvite[] = [];
    for (const wrap of this.pending$.value) {
      const invite = await this.decrypt(wrap);
      if (invite) invites.push(invite);
    }
    return invites;
  }

  lock(event: NostrEvent | string): void {
    const wrap = this.resolveWrap(event);
    if (!wrap) return;
    lockDirectInvite(wrap);
    const record = this.records.get(wrap.id);
    if (record) delete record.invite;
    this.recompute();
  }

  async dismiss(event: NostrEvent | string): Promise<void> {
    const wrap = this.resolveWrap(event);
    if (!wrap) return;
    const dismissed = new Set(this.dismissed$.value);
    dismissed.add(wrap.id);
    this.dismissed$.next(dismissed);
    this.recompute();
    await this.saveDismissed();
  }

  async restore(event: NostrEvent | string): Promise<void> {
    const wrap = this.resolveWrap(event);
    if (!wrap) return;
    const dismissed = new Set(this.dismissed$.value);
    dismissed.delete(wrap.id);
    this.dismissed$.next(dismissed);
    this.recompute();
    await this.saveDismissed();
  }

  async clearDismissed(): Promise<void> {
    this.dismissed$.next(new Set());
    this.recompute();
    await this.saveDismissed();
  }

  isDismissed(event: NostrEvent | string): boolean {
    const wrap = this.resolveWrap(event);
    return !!wrap && this.dismissed$.value.has(wrap.id);
  }

  // ---- relay setup --------------------------------------------------------

  private userNeedsAuth(
    relays: string[],
    statuses: Record<string, { connected?: boolean; authRequiredForRead?: boolean; authRequiredForPublish?: boolean }>,
    pubkey?: string,
  ): boolean {
    if (!pubkey || relays.length === 0) return false;
    return relays.some((url) => {
      const status = statuses[normalizeURL(url)] ?? statuses[url];
      if (!status?.connected) return false;
      if (!status.authRequiredForRead && !status.authRequiredForPublish) return false;
      return !this.pool.relay(url).isAuthenticated(pubkey);
    });
  }

  private async resolveRelays(): Promise<string[]> {
    if (this.inboxRelays) return this.uniqueRelays(this.inboxRelays);
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    const user = castUser(this.pubkey, this.eventStore);
    const [dmRelays, inboxes] = await Promise.all([
      user.directMessageRelays$.$first(1_000, undefined),
      user.inboxes$.$first(1_000, undefined),
    ]);
    // Always union the fallback relays with the discovered NIP-17/NIP-65 inboxes:
    // a Direct Invite can arrive on the user's DM relays OR — a channel grant from
    // a co-member (CORD-05 §6) — on the shared community relays the app passes as
    // fallback. Listening only on discovered inboxes would miss the latter.
    return this.uniqueRelays([...(dmRelays ?? []), ...(inboxes ?? []), ...this.fallbackRelays]);
  }

  private openLive(): void {
    const relays = this.relays$.value;
    if (!this.pubkey || relays.length === 0) return;
    const target = this.transport(relays);
    // D-09/Pitfall 4: the churn guard's key covers both the pubkey the live
    // filter targets and the sorted merged transport set, so a no-op
    // `extraRelays$` re-emission (already de-duped upstream by `ExtraRelays`)
    // still can't tear down and reopen the live socket if neither changed.
    const sig = `${this.pubkey}|${[...target].sort().join(",")}`;
    if (sig === this.liveSignature && this.liveSub) return;
    this.liveSignature = sig;
    this.liveSub?.unsubscribe();
    this.liveSub = this.pool.subscription(target, this.filters()).subscribe((event) => void this.ingest(event));
  }

  private filters(): Array<{ kinds: number[]; "#p": string[]; "#k"?: string[]; since?: number }> {
    if (!this.pubkey) return [];
    return this.scanUntagged ? [{ kinds: [kinds.GiftWrap], "#p": [this.pubkey] }] : [directInviteFilter(this.pubkey)];
  }

  // ---- persistence --------------------------------------------------------

  private storagePrefix(): string {
    return this.cursorKey ?? `concord:direct-invites:${this.pubkey}`;
  }

  private async loadDismissed(): Promise<void> {
    try {
      const raw = await this.storage.getItem(`${this.storagePrefix()}:dismissed`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { ids?: string[] };
      this.dismissed$.next(new Set((parsed.ids ?? []).filter((id) => typeof id === "string")));
    } catch {
      this.dismissed$.next(new Set());
    }
  }

  private async saveDismissed(): Promise<void> {
    try {
      await this.storage.setItem(
        `${this.storagePrefix()}:dismissed`,
        JSON.stringify({ version: 1, ids: [...this.dismissed$.value] }),
      );
    } catch (err) {
      this.log("failed to persist dismissed direct invites: %s", (err as Error)?.message ?? err);
      console.warn("failed to persist dismissed direct invites", err);
    }
  }

  private async loadCursor(): Promise<void> {
    try {
      const raw = await this.storage.getItem(`${this.storagePrefix()}:cursor`);
      this.cursor = raw ? Number(raw) || 0 : 0;
    } catch {
      this.cursor = 0;
    }
  }

  private async saveCursorFromEvents(events: NostrEvent[]): Promise<void> {
    const max = events.reduce((latest, event) => Math.max(latest, event.created_at), this.cursor);
    if (max <= this.cursor) return;
    this.cursor = max;
    try {
      await this.storage.setItem(`${this.storagePrefix()}:cursor`, String(max));
    } catch (err) {
      this.log("failed to persist direct invite cursor: %s", (err as Error)?.message ?? err);
      console.warn("failed to persist direct invite cursor", err);
    }
  }

  // ---- state --------------------------------------------------------------

  private ingestLocalEvents(): void {
    if (!this.pubkey) return;
    for (const event of this.eventStore.getByFilters(this.filters())) {
      if (this.acceptWrap(event)) this.records.set(event.id, { wrap: event });
    }
    this.recompute();
  }

  private acceptWrap(event: NostrEvent): boolean {
    if (!this.pubkey || event.kind !== kinds.GiftWrap) return false;
    if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === this.pubkey)) return false;
    return this.scanUntagged || isValidDirectInvite(event);
  }

  private resolveWrap(event: NostrEvent | string): NostrEvent | undefined {
    if (typeof event !== "string") return event;
    return this.records.get(event)?.wrap ?? this.eventStore.getEvent(event);
  }

  private sortedRecords(): DirectInviteRecord[] {
    return [...this.records.values()].sort(
      (a, b) => b.wrap.created_at - a.wrap.created_at || a.wrap.id.localeCompare(b.wrap.id),
    );
  }

  private recompute(): void {
    const records = this.sortedRecords();
    const dismissed = this.dismissed$.value;
    const wraps = records.map((record) => record.wrap);
    const pending = records
      .filter((record) => !dismissed.has(record.wrap.id) && !record.invite && isValidDirectInvite(record.wrap))
      .map((record) => record.wrap);
    const allInvites = records.flatMap((record) => (record.invite ? [record.invite] : []));
    const invites = records.flatMap((record) => {
      if (!record.invite || dismissed.has(record.wrap.id) || record.invite.expired()) return [];
      return [record.invite];
    });

    this.wraps$.next(wraps);
    this.pending$.next(pending);
    this.allInvites$.next(allInvites);
    this.invites$.next(invites);
  }

  private uniqueRelays(relays: string[] | undefined): string[] {
    return [...new Set((relays ?? []).filter(Boolean))];
  }
}
