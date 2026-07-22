// ConcordInviteManager — client-owned CORD-05 Invite List management.
//
// The Community publishes public invite bundles and registry edits, but the
// creator's private kind-13303 Invite List is per-user account state. This
// manager owns that list the same way ConcordClient owns the Community List:
// merge remote copies, expose rich app-facing records, and publish only when the
// plaintext content actually changed.

import type { Debugger } from "debug";
import { BehaviorSubject, Subscription, firstValueFrom, map, of, switchMap, timeout, toArray } from "rxjs";
import { EventStore, mapEventsToStore } from "applesauce-core";
import type { User } from "applesauce-core/casts";
import { setHiddenContentCache } from "applesauce-core/helpers";
import { finalizeEvent } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import { logger } from "../logger.js";
import type { ConcordInviteList } from "../casts/index.js";
import { canonicalJson } from "../helpers/community-list.js";
import { parseInviteLink } from "../helpers/invite-bundle.js";
import { ExtraRelays, type ExtraRelaysOption } from "../helpers/relays.js";
import { InviteBundleFactory } from "../factories/invite-bundle.js";
import {
  INVITE_LIST_KIND,
  inviteListWithinByteCap,
  liveInviteEntries,
  mergeInvites,
  mergeTombstones,
} from "../helpers/invite-list.js";
import type { InviteListInvite, InviteListTombstone } from "../types.js";

export interface ConcordInviteLink {
  /** Hex-encoded invite unlock token. Also the Invite List merge key. */
  token: string;
  /** Hex-encoded link signer secret key, needed to refresh or revoke the bundle. */
  signerSk: string;
  /** The link signer's public key, i.e. the kind-33301 coordinate author. */
  signerPubkey: string;
  communityId: string;
  url: string;
  label?: string;
  /** Private channel ids this link grants. Omitted or empty grants none. */
  channels?: string[];
  /** Unix seconds, matching the CORD-05 Invite List wire field. */
  createdAt: number;
  /** Unix seconds (D-05), matching the CommunityInvite bundle field. */
  expiresAt?: number;
  revoked: boolean;
}

export interface ConcordInviteManagerOptions {
  signer: ISigner;
  pool: RelayPool;
  eventStore: EventStore;
  relays: string[];
  autoUnlock?: boolean;
  getCommunity: (communityId: string) =>
    | {
        admin: {
          createInvite: (options: CreateInviteOptions) => Promise<ConcordInviteLink>;
          revokeInvite: (invite: ConcordInviteLink) => Promise<ConcordInviteLink>;
        };
      }
    | undefined;
  /** Additional transport-only relays unioned onto every request/publish this
   *  manager performs (D-12). Never written into any published content, and
   *  purely additive: with no extras configured, {@link ExtraRelays.merge}'s
   *  identity fast path returns `relays` completely unchanged (D-14). When
   *  extras ARE configured, the merged transport set is normalized and
   *  deduplicated (`mergeRelaySets`), which changes the shape of relay-target
   *  strings and `pool.status$` lookup keys for that configuration. */
  extraRelays?: ExtraRelaysOption;
  /** A custom debug logger (defaults to the "applesauce:concord" namespace, extended
   *  with "invite" when threaded from {@link ConcordClient}). */
  logger?: Debugger;
}

export interface CreateInviteOptions {
  base: string;
  label?: string;
  /** Unix seconds (D-05). */
  expiresAt?: number;
  /** Private channels this link grants, by channel id. Omit to grant none. */
  channels?: string[];
}

export class ConcordInviteManager {
  readonly event$ = new BehaviorSubject<ConcordInviteList | undefined>(undefined);
  readonly entries$ = new BehaviorSubject<ConcordInviteLink[]>([]);
  readonly live$ = new BehaviorSubject<ConcordInviteLink[]>([]);
  readonly revoked$ = new BehaviorSubject<ConcordInviteLink[]>([]);
  readonly dirty$ = new BehaviorSubject<boolean>(false);

  /** The invite manager's debug logger — `options.logger` when threaded from
   *  {@link ConcordClient}, otherwise the `applesauce:concord:invite` module base
   *  (D-01/D-02). */
  private readonly log: Debugger;
  private readonly signer: ISigner;
  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly relays: string[];
  private readonly autoUnlock: boolean;
  private readonly getCommunity: ConcordInviteManagerOptions["getCommunity"];
  /** The per-engine transport-only extras holder (D-04) — merges into every
   *  network target this manager dials; `this.relays` itself is never touched. */
  private readonly extras: ExtraRelays;

  private pubkey?: string;
  private sub?: Subscription;
  private invites: InviteListInvite[] = [];
  private tombstones: InviteListTombstone[] = [];
  private publishedFingerprint: string | null = canonicalJson({ entries: [], tombstones: [] });
  private readonly autoUnlocked = new Set<string>();

  constructor(options: ConcordInviteManagerOptions) {
    this.log = options.logger ?? logger.extend("invite");
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore;
    this.relays = options.relays;
    this.autoUnlock = options.autoUnlock ?? false;
    this.getCommunity = options.getCommunity;
    this.extras = new ExtraRelays(options.extraRelays);
  }

  /** The merged transport target for this manager: `base` (defaulting to
   *  `this.relays`) unioned with the current extras snapshot (D-04) — the ONLY
   *  merge point in the class. Every call site here is one-shot, so the
   *  holder's synchronous snapshot is the correct consumption shape (D-11).
   *  The optional `base` exists for the revoke path, which merges onto the
   *  link's own bootstrap relays rather than this manager's default set (D-12). */
  private transport(base?: string[]): string[] {
    return this.extras.merge(base ?? this.relays);
  }

  async start(user: User): Promise<void> {
    this.log("starting invite manager for %s", user.pubkey.slice(0, 8));
    this.pubkey = user.pubkey;
    this.sub?.unsubscribe();
    this.sub = user.concordInviteList$
      .pipe(switchMap((cast) => (cast ? cast.invites$.pipe(map(() => cast)) : of(undefined))))
      .subscribe((cast) => {
        this.event$.next(cast);
        if (!cast) return;
        if (this.autoUnlock && !cast.unlocked) {
          this.autoUnlockCast(cast);
          return;
        }
        this.reconcile(cast);
      });
    await this.refresh();
  }

  /** Pause: resets the in-memory list state but leaves the extras holder
   *  ({@link ExtraRelays}) alive and subscribed to the app-supplied source —
   *  restartable via {@link start}. To actually release the app's extras
   *  source, call {@link dispose} instead. */
  stop(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.pubkey = undefined;
    this.event$.next(undefined);
    this.invites = [];
    this.tombstones = [];
    this.publishedFingerprint = canonicalJson({ entries: [], tombstones: [] });
    this.emit();
    this.dirty$.next(false);
  }

  /** Releases this manager's subscription to the app-supplied `extraRelays`
   *  source (WR-05) — unlike {@link stop} (pause-only, restartable), the
   *  manager is NOT restartable after `dispose()`. */
  dispose(): void {
    this.stop();
    this.extras.dispose();
  }

  async refresh(): Promise<void> {
    this.log("refreshing invite list");
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    await firstValueFrom(
      this.pool
        .request(this.transport(), [{ kinds: [INVITE_LIST_KIND], authors: [this.pubkey] }])
        .pipe(mapEventsToStore(this.eventStore), toArray(), timeout(8000)),
    ).catch(() => []);
  }

  async unlock(): Promise<void> {
    const event = this.event$.value;
    if (!event || event.unlocked) return;
    await event.unlock(this.signer);
    this.reconcile(event);
  }

  get(token: string): ConcordInviteLink | undefined {
    return this.entries$.value.find((invite) => invite.token === token);
  }

  forCommunity(communityId: string): ConcordInviteLink[] {
    return this.entries$.value.filter((invite) => invite.communityId === communityId);
  }

  async create(communityId: string, options: CreateInviteOptions): Promise<ConcordInviteLink> {
    this.log("building invite bundle for community=%s", communityId.slice(0, 8));
    const community = this.getCommunity(communityId);
    if (!community) throw new Error("community not found");
    const invite = await community.admin.createInvite(options);
    if (!this.get(invite.token)) await this.record(invite);
    return this.get(invite.token) ?? invite;
  }

  async revoke(inviteOrToken: string | ConcordInviteLink | InviteListInvite): Promise<ConcordInviteLink> {
    const invite =
      typeof inviteOrToken === "string"
        ? this.get(inviteOrToken)
        : fromInviteListInvite(toInviteListInvite(inviteOrToken), this.tombstones);
    if (!invite) throw new Error("invite not found");
    // Identify the link by its PUBLIC signer pubkey, never by the token — the
    // token is 128 bits of secret key material, not a public identifier, so the
    // 8-char truncation convention used for event/community ids does not apply.
    this.log("revoking invite link=%s community=%s", invite.signerPubkey.slice(0, 8), invite.communityId.slice(0, 8));
    // While we're still a member the community revokes the bundle AND unregisters the public link
    // (CORD-05 §5). Once we've left, the registry — which holds only public link coordinates, never
    // any private material — is neither reachable nor needed: revoke the bundle straight from the
    // stored link key so old invites can still be cleaned up.
    const community = this.getCommunity(invite.communityId);
    const revoked = community ? await community.admin.revokeInvite(invite) : await this.revokeBundle(invite);
    if (!this.get(revoked.token)?.revoked) await this.tombstone(revoked);
    return this.get(revoked.token) ?? revoked;
  }

  /** Revoke just the bundle, membership-free: publish an empty vsk-9 edition signed by the invite's
   *  stored link key to its own bootstrap relays. The community-side registry unregister is skipped —
   *  it needs a membership we no longer have, and a stale registry link resolves to a revoked bundle. */
  private async revokeBundle(invite: ConcordInviteLink): Promise<ConcordInviteLink> {
    const signed = finalizeEvent(await InviteBundleFactory.revoke(), hexToBytes(invite.signerSk));
    this.eventStore.add(signed);
    // The revoke path merges the extras onto the LINK's own bootstrap relays
    // (falling back to this manager's default set), never the manager's set
    // directly (D-12) — the base-vs-merged split is kept visible here.
    const bootstrapRelays = parseInviteLink(invite.url).bootstrapRelays;
    const base = bootstrapRelays.length ? bootstrapRelays : this.relays;
    await this.pool.publish(this.transport(base), signed).catch((err) => {
      this.log("bundle revocation publish failed: %s", (err as Error)?.message ?? err);
      console.warn("bundle revocation publish failed", err);
    });
    return { ...invite, revoked: true };
  }

  /** Record a newly minted link into the private Invite List and publish it. */
  async record(invite: ConcordInviteLink | InviteListInvite): Promise<void> {
    this.invites = mergeInvites(this.invites, [toInviteListInvite(invite)]);
    this.markDirty();
    await this.save();
  }

  /** Add the terminal private tombstone for a revoked link and publish it. */
  async tombstone(invite: ConcordInviteLink | InviteListInvite): Promise<void> {
    const entry = toInviteListInvite(invite);
    this.tombstones = mergeTombstones(this.tombstones, [{ token: entry.token, community_id: entry.community_id }]);
    this.markDirty();
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.signer.nip44) return;
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    const fingerprint = canonicalJson({ entries: this.invites, tombstones: this.tombstones });
    if (fingerprint === this.publishedFingerprint) {
      this.dirty$.next(false);
      return;
    }
    if (!inviteListWithinByteCap(this.invites, this.tombstones)) {
      this.log("invite list exceeds the NIP-44 byte cap; not publishing");
      console.warn("invite list exceeds the NIP-44 byte cap; not publishing");
      return;
    }
    const plaintext = JSON.stringify({ entries: this.invites, tombstones: this.tombstones });
    const content = await this.signer.nip44.encrypt(this.pubkey, plaintext);
    const previous = this.eventStore.getReplaceable(INVITE_LIST_KIND, this.pubkey);
    const createdAt = Math.max(Math.floor(Date.now() / 1000), (previous?.created_at ?? 0) + 1);
    const signed = await this.signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: createdAt });
    setHiddenContentCache(signed, plaintext);
    this.eventStore.add(signed);
    this.pool.publish(this.transport(), signed).catch((err) => {
      this.log("invite list publish failed: %s", (err as Error)?.message ?? err);
      console.warn("invite list publish failed", err);
    });
    this.publishedFingerprint = fingerprint;
    this.dirty$.next(false);
  }

  private reconcile(cast: ConcordInviteList): void {
    const invites = cast.invites;
    if (!invites) return;
    this.invites = mergeInvites(this.invites, invites);
    this.tombstones = mergeTombstones(this.tombstones, cast.tombstones ?? []);
    this.publishedFingerprint = canonicalJson({
      entries: mergeInvites([], invites),
      tombstones: mergeTombstones([], cast.tombstones ?? []),
    });
    this.emit();
  }

  private autoUnlockCast(cast: ConcordInviteList): void {
    if (!this.signer.nip44 || this.autoUnlocked.has(cast.id)) return;
    this.autoUnlocked.add(cast.id);
    void cast.unlock(this.signer).catch(() => {});
  }

  private markDirty(): void {
    this.emit();
    this.dirty$.next(true);
  }

  private emit(): void {
    const entries = this.invites.map((invite) => fromInviteListInvite(invite, this.tombstones));
    this.entries$.next(entries);
    const liveTokens = new Set(liveInviteEntries(this.invites, this.tombstones).map((invite) => invite.token));
    this.live$.next(entries.filter((invite) => liveTokens.has(invite.token)));
    this.revoked$.next(entries.filter((invite) => invite.revoked));
  }
}

function fromInviteListInvite(invite: InviteListInvite, tombstones: InviteListTombstone[] = []): ConcordInviteLink {
  return {
    token: invite.token,
    signerSk: invite.signer_sk,
    signerPubkey: getPublicKey(hexToBytes(invite.signer_sk)),
    communityId: invite.community_id,
    url: invite.url,
    label: invite.label,
    channels: invite.channels,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    revoked: tombstones.some((t) => t.token === invite.token),
  };
}

function toInviteListInvite(invite: ConcordInviteLink | InviteListInvite): InviteListInvite {
  if ("signer_sk" in invite) return invite;
  return {
    token: invite.token,
    signer_sk: invite.signerSk,
    community_id: invite.communityId,
    url: invite.url,
    label: invite.label,
    channels: invite.channels,
    created_at: invite.createdAt,
    expires_at: invite.expiresAt,
  };
}
