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
  distinctUntilChanged,
  firstValueFrom,
  map,
  timeout,
  toArray,
} from "rxjs";
import { EventStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";
import { kinds, type NostrEvent } from "applesauce-core/helpers";
import { getGiftWrapRumor } from "applesauce-common/helpers/gift-wrap";
import { castUser } from "applesauce-common/casts";
import type { RelayAuthHandler, RelayPool } from "applesauce-relay";
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
import { createUserAuthHandler } from "./auth.js";
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
   *  watcher performs — including the reactive user-AUTH answer a gating relay
   *  among them triggers on refusal (D-03/D-12). Distinct from both `relays`
   *  (fallback inboxes) and `inboxRelays` (an explicit inbox override): extras
   *  are additive transport targets, never a source of discovered inboxes, and
   *  never written into any published content. Purely additive: with no extras
   *  configured, {@link ExtraRelays.merge}'s identity fast path returns whatever
   *  this watcher resolves on its own completely unchanged (D-14). When extras
   *  ARE configured, the merged transport set is normalized and deduplicated
   *  (`mergeRelaySets`), which changes the shape of relay-target strings for
   *  that configuration. */
  extraRelays?: ExtraRelaysOption;
  /** Override the storage namespace for cursors/dismissals. */
  cursorKey?: string;
  /** Decrypt invites as they arrive instead of exposing them via `pending$`. */
  autoDecrypt?: boolean;
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

  /** The watcher's debug logger — `options.logger` when threaded from
   *  {@link ConcordClient}, otherwise the `applesauce:concord:invite` module base
   *  (D-01/D-02). */
  private readonly log: Debugger;
  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordStorage;
  private readonly fallbackRelays: string[];
  private readonly inboxRelays?: string[];
  /** This watcher's OWN user-auth handler (D-09) — a separate `createUserAuthHandler`
   *  instance from `ConcordClient`'s, since the two engines' latency and user-visible
   *  auth consequences differ even though they resolve the same identity. Answers a
   *  gating inbox relay's refusal of one of this watcher's own reads with the user's
   *  key, never proactively (D-01). */
  private readonly userOnAuthRequired: RelayAuthHandler;
  private readonly autoDecrypt: boolean;
  private readonly scanUntagged: boolean;
  private readonly overlapSeconds: number;
  private readonly requestTimeout: number;
  private readonly cursorKey?: string;
  /** The per-engine transport-only extras holder (D-04) — merges into every
   *  network target this watcher dials; the discovered-inbox subject
   *  (`relays$`) is never fed a merged value (prohibition). */
  private readonly extras: ExtraRelays;

  private readonly records = new Map<string, DirectInviteRecord>();
  private liveSub?: Subscription;
  /** Reacts to every later `extraRelays` emission (D-09): re-opens the live
   *  subscription once one already exists, so a no-op emission before the
   *  watcher has ever gone live cannot prematurely open its socket, and a real
   *  later change re-derives the merged set via `openLive()`'s own churn guard. */
  private extrasSub!: Subscription;
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
    // This watcher's OWN instance (D-09) — never shared with ConcordClient's.
    // `() => this.pubkey` rather than a bare value since this watcher resolves
    // its pubkey asynchronously in `start()`.
    this.userOnAuthRequired = createUserAuthHandler(this.signer, () => this.pubkey);
    this.autoDecrypt = options.autoDecrypt ?? false;
    // Constructed before the tail below so its synchronous snapshot is
    // already seeded when later derivations first build (D-04). Its position
    // here is unchanged (load-bearing) — but EVERYTHING after it, to the end
    // of the constructor, is now wrapped for shape-consistency with
    // `ConcordCommunity`'s and `ConcordPrivateChannel`'s identical guards
    // (WR-01): this tail has no throw site TODAY, but a bare, unguarded
    // `ExtraRelays` construction here would silently drift out of step with
    // the other two engines' self-cleaning constructors the next time this
    // tail gains one. No dedicated behavioral test for this one; the
    // source-level acceptance criterion covers it.
    this.extras = new ExtraRelays(options.extraRelays);
    try {
      this.pendingCount$ = this.pending$.pipe(
        map((pending) => pending.length),
        distinctUntilChanged(),
      );
      this.scanUntagged = options.scanUntagged ?? false;
      this.overlapSeconds = options.overlapSeconds ?? 2 * 60 * 60;
      this.requestTimeout = options.requestTimeout ?? 10_000;
      this.cursorKey = options.cursorKey;

      this.subscribeExtras();
    } catch (err) {
      this.extras.dispose();
      throw err;
    }
  }

  /**
   * (Re-)establish the reactive extras subscription that reopens the live
   * subscription on every later `extraRelays` emission (D-08/D-09). Extracted
   * so {@link start} can re-establish it after {@link stop} closed it —
   * `stop()` is pause-only and must not leave the watcher frozen on a stale
   * extras snapshot forever (WR-06); `dispose()` is what actually releases the
   * holder. Does NOT rebuild `this.extras` itself — `openLive()`'s churn guard
   * and `transport()` both close over that same holder's stream, so replacing
   * the object would silently detach that reactivity.
   */
  private subscribeExtras(): void {
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
    // Restart-safe (WR-06): `stop()` closed this subscription (pause-only); a
    // fresh `start()` after it must re-establish reactivity to LATER
    // `extraRelays` emissions rather than staying frozen. The very first
    // `start()` finds it still open (from the constructor) and this is a
    // no-op.
    if (this.extrasSub.closed) this.subscribeExtras();
    this.pubkey = await this.signer.getPublicKey();
    this.pubkey$.next(this.pubkey);
    await this.loadDismissed();
    await this.loadCursor();
    this.ingestLocalEvents();
    const relays = await this.resolveRelays();
    this.relays$.next(relays);
    await this.refresh();
    this.openLive();
  }

  /** Pause: unsubscribes the live/extras-reactivity subscriptions but
   *  leaves the extras holder ({@link ExtraRelays}) itself alive and
   *  subscribed to the app-supplied source — restartable via {@link start},
   *  which re-establishes the extras reactivity `stop()` closed (WR-06). To
   *  actually release the app's extras source (e.g. before discarding this
   *  watcher for good), call {@link dispose} instead. */
  stop(): void {
    this.log("stopping direct invite watcher");
    this.started = false;
    this.liveSub?.unsubscribe();
    this.liveSub = undefined;
    this.extrasSub.unsubscribe();
    this.status$.next("");
  }

  /** Releases this watcher's subscription to the app-supplied `extraRelays`
   *  source (WR-05) — unlike {@link stop} (pause-only, restartable), the
   *  watcher is NOT restartable after `dispose()`. */
  dispose(): void {
    this.stop();
    this.extrasSub.unsubscribe();
    this.extras.dispose();
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
      this.pool
        .request(this.transport(relays), requestFilters, {
          waitForAuth: [this.pubkey],
          onAuthRequired: this.userOnAuthRequired,
        })
        .pipe(toArray(), timeout(this.requestTimeout)),
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
    this.liveSub = this.pool
      .subscription(target, this.filters(), {
        waitForAuth: [this.pubkey],
        onAuthRequired: this.userOnAuthRequired,
      })
      .subscribe((event) => void this.ingest(event));
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
