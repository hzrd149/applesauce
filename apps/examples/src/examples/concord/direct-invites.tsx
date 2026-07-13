/**
 * Watch your NIP-59 gift-wrap inbox for Concord Direct Invites, hide communities already accepted on
 * your community list, and accept pending invites by publishing both the list update and Guestbook Join.
 * @tags concord, direct-invites, communities, gift-wraps, encryption, nip-44, reactive
 * @related concord/community-list, concord/invite-manager
 */
import { getRumorGiftWraps } from "applesauce-common/helpers/gift-wrap";
import {
  ConcordRelayAuth,
  InviteWatcher,
  type CommunityListCommunity,
  type InviteBundle,
  type JoinMaterial,
} from "applesauce-concord";
import type { ConcordDirectInvite } from "applesauce-concord/casts";
import { COMMUNITY_LIST_KIND, deriveConcordKeys, STOCK_RELAYS, wrapForTarget } from "applesauce-concord/helpers";
import { BehaviorSubject, EventStore } from "applesauce-core";
import { castUser } from "applesauce-core/casts";
import { kinds, relaySet } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { combineLatest, map, of, switchMap } from "rxjs";

import "applesauce-concord/casts";
import LoginView from "../../components/login-view";
import { CommunityListFactory, JoinLeaveFactory } from "applesauce-concord/factories";

const eventStore = new EventStore();
const pool = new RelayPool();
const relayAuth = new ConcordRelayAuth(pool);
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));
const extraRelays$ = new BehaviorSubject(STOCK_RELAYS.join("\n"));

const extraRelayList$ = extraRelays$.pipe(
  map((text) =>
    text
      .split(/\n|,/)
      .map((relay) => relay.trim())
      .filter(Boolean),
  ),
);

const outboxes$ = user$.pipe(switchMap((user) => user?.outboxes$ ?? of(undefined)));
const directMessageRelays$ = user$.pipe(switchMap((user) => user?.directMessageRelays$ ?? of(undefined)));

const relays$ = combineLatest([outboxes$, extraRelayList$]).pipe(
  map(([outboxes, extraRelayList]) => relaySet(outboxes, extraRelayList)),
);

const inboxRelays$ = directMessageRelays$.pipe(map((relays) => relaySet(relays)));

const loader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: extraRelayList$,
});

function shortId(id: string) {
  return id.slice(0, 8) + "…" + id.slice(-8);
}

function entryFromMaterial(material: JoinMaterial): CommunityListCommunity {
  return { community_id: material.community_id, seed: material, current: material, added_at: Date.now() };
}

function materialFromBundle(bundle: InviteBundle): JoinMaterial {
  return {
    community_id: bundle.community_id,
    owner: bundle.owner,
    owner_salt: bundle.owner_salt,
    community_root: bundle.community_root,
    root_epoch: bundle.root_epoch,
    channels: bundle.channels ?? [],
    relays: bundle.relays ?? [],
    name: bundle.name,
    held_roots: bundle.held_roots,
    refounder: bundle.refounder,
  };
}

async function loadReplaceable(kind: number, pubkey: string, relays: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    loader({ kind, pubkey, relays }).subscribe({ complete: resolve, error: resolve });
  });
}

function InviteRow({
  invite,
  wrap,
  disabled,
  onAccept,
  onDismiss,
}: {
  invite: ConcordDirectInvite;
  wrap: NostrEvent | undefined;
  disabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const bundle = invite.bundle!;
  const expired = invite.expired();

  return (
    <div className={`border border-base-300 rounded-box p-4 flex flex-col gap-3 ${expired ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <h3 className="font-semibold text-lg flex-1 min-w-0 break-words">{bundle.name || "Unnamed community"}</h3>
        {expired && <span className="badge badge-error">expired</span>}
        <span className="badge badge-outline">epoch {bundle.root_epoch}</span>
      </div>

      <code className="text-xs opacity-60 break-all">{shortId(bundle.community_id)}</code>

      <div className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <div className="font-medium">Inviter</div>
          <code className="break-all opacity-70">{shortId(nip19.npubEncode(invite.inviter))}</code>
        </div>
        <div>
          <div className="font-medium">Owner</div>
          <code className="break-all opacity-70">{shortId(nip19.npubEncode(bundle.owner))}</code>
        </div>
      </div>

      <div className="text-sm">
        <div className="font-medium">
          Relays <span className="opacity-60">· {bundle.channels.length} channel keys</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {(bundle.relays.length ? bundle.relays : ["No relays in invite"]).map((relay) => (
            <span key={relay} className="badge badge-ghost badge-sm font-mono">
              {relay}
            </span>
          ))}
        </div>
      </div>

      {bundle.label && <div className="text-sm opacity-70">Invite label: {bundle.label}</div>}
      {bundle.expires_at && <div className="text-xs opacity-60">Expires {new Date(bundle.expires_at).toLocaleString()}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn btn-sm btn-ghost" onClick={onDismiss} disabled={disabled || !wrap}>
          Dismiss
        </button>
        <button className="btn btn-sm btn-primary" onClick={onAccept} disabled={disabled || expired}>
          Accept + publish Join
        </button>
      </div>
    </div>
  );
}

function ConcordDirectInvites() {
  const signer = use$(signer$);
  const user = use$(user$);
  const extraRelays = use$(extraRelays$);
  const relays = use$(relays$);
  const inboxRelays = use$(inboxRelays$);

  const communityList = use$(() => user?.concordCommunityList$, [user]);
  const liveCommunities = use$(() => communityList?.liveCommunities$, [communityList]);

  const [watcher, setWatcher] = useState<InviteWatcher | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watcherInvites = use$(() => watcher?.invites$, [watcher]);
  const pendingWraps = use$(() => watcher?.pending$, [watcher]);
  const dismissed = use$(() => watcher?.dismissed$, [watcher]);
  const status = use$(() => watcher?.status$, [watcher]);

  useEffect(() => {
    if (!user || !relays) return;
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : "Failed to load relay data");
    const subs = [
      loader({ kind: COMMUNITY_LIST_KIND, pubkey: user.pubkey, relays }).subscribe({ error: onError }),
      loader({ kind: kinds.RelayList, pubkey: user.pubkey, relays }).subscribe({ error: onError }),
      loader({ kind: kinds.DirectMessageRelaysList, pubkey: user.pubkey, relays }).subscribe({ error: onError }),
    ];
    return () => subs.forEach((sub) => sub.unsubscribe());
  }, [user?.pubkey, relays]);

  useEffect(() => {
    if (!communityList || communityList.unlocked || !signer?.nip44) return;
    let alive = true;
    communityList
      .unlock(signer)
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to unlock community list"));
    return () => {
      alive = false;
    };
  }, [communityList, signer]);

  useEffect(() => {
    if (!signer || !user || !inboxRelays) return;
    let alive = true;
    const next = new InviteWatcher({
      signer,
      pool,
      eventStore,
      inboxRelays,
      autoDecrypt: true,
    });

    setLoadingInbox(true);
    Promise.allSettled([loadReplaceable(kinds.DirectMessageRelaysList, user.pubkey, relays ?? [])])
      .then(() => next.start())
      .then(() => alive && setWatcher(next))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to start direct invite watcher"))
      .finally(() => alive && setLoadingInbox(false));

    return () => {
      alive = false;
      next.stop();
    };
  }, [signer, user?.pubkey, inboxRelays?.join("\n")]);

  const liveCommunityIds = useMemo(() => new Set((liveCommunities ?? []).map((c) => c.community_id)), [liveCommunities]);
  const visibleInvites = useMemo(
    () => (watcherInvites ?? []).filter((invite) => invite.bundle && !liveCommunityIds.has(invite.bundle.community_id)),
    [watcherInvites, liveCommunityIds],
  );

  function listFactory() {
    const event = communityList?.event;
    return event ? CommunityListFactory.modify(event) : CommunityListFactory.create();
  }

  async function publishCommunityList(material: JoinMaterial) {
    if (!signer?.nip44) throw new Error("This signer does not support NIP-44 encryption.");
    const signed = await listFactory().join(entryFromMaterial(material)).sign(signer);
    await eventStore.add(signed);
    if (relays?.length) await pool.publish(relays, signed);
  }

  async function publishGuestbookJoin(bundle: InviteBundle, material: JoinMaterial) {
    if (!signer || !user) return;
    const keys = deriveConcordKeys(material, []);
    const relays = material.relays.length ? material.relays : STOCK_RELAYS;
    const rumor = await JoinLeaveFactory.create("join", {
      invite: bundle.creator_npub ? { creator: bundle.creator_npub, label: bundle.label } : undefined,
    });
    const { wrap } = await wrapForTarget(keys, { plane: "guestbook" }, signer, rumor, {});
    relayAuth.registerStreamKeys([keys.guestbook]);
    const authDrivers = relays.map((relay) => relayAuth.authenticateStreamKeys(pool.relay(relay)));
    try {
      await pool.publish(relays, wrap, { waitForAuth: keys.guestbook.pk });
    } finally {
      authDrivers.forEach((sub) => sub.unsubscribe());
    }
  }

  async function accept(invite: ConcordDirectInvite) {
    const bundle = invite.bundle;
    if (!bundle || !watcher) return;
    if (bundle.expires_at && Date.now() > bundle.expires_at) return setError("This invite has expired.");
    const material = materialFromBundle(bundle);

    setBusy(`Joining ${material.name || "community"}...`);
    setError(null);
    try {
      await publishCommunityList(material);
      await publishGuestbookJoin(bundle, material);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept direct invite");
    } finally {
      setBusy(null);
    }
  }

  async function refreshInbox() {
    if (!watcher) return;
    setBusy("Refreshing direct invites...");
    setError(null);
    try {
      await watcher.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh direct invites");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || loadingInbox;

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      {error && (
        <div className="alert alert-error py-2">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Direct invite inbox</h2>
          <span className="badge badge-outline">{user ? shortId(user.pubkey) : "..."}</span>
          <span className="badge badge-outline">{loadingInbox ? "loading" : watcher ? "watching" : "idle"}</span>
          <span className="badge badge-outline">{visibleInvites.length} pending</span>
          <span className="badge badge-outline">{dismissed?.size ?? 0} dismissed</span>
        </div>
        <textarea
          className="textarea textarea-bordered font-mono text-sm"
          rows={4}
          value={extraRelays ?? ""}
          onChange={(e) => extraRelays$.next(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm opacity-70">
          <span>
            Reading from {inboxRelays?.length ?? 0} inbox relay{inboxRelays?.length === 1 ? "" : "s"}.
          </span>
          <span>{pendingWraps?.length ?? 0} wraps still locked.</span>
          {status && <span>{status}</span>}
        </div>
        <div className="flex gap-2 justify-end">
          <button className="btn btn-sm btn-ghost" onClick={() => watcher?.clearDismissed()} disabled={disabled || !watcher}>
            Clear dismissed
          </button>
          <button className="btn btn-sm btn-primary" onClick={refreshInbox} disabled={disabled || !watcher}>
            Refresh inbox
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Pending invites</h2>
          <span className="badge badge-outline">{liveCommunities?.length ?? 0} accepted communities hidden</span>
        </div>

        {!watcher && <p className="opacity-70">Starting the direct invite watcher...</p>}
        {watcher && visibleInvites.length === 0 && (
          <p className="opacity-70">
            No pending direct invites. Already-accepted communities are hidden from this list.
          </p>
        )}
        {visibleInvites.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleInvites.map((invite) => {
              const wrap = getRumorGiftWraps(invite.rumor)[0];
              return (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  wrap={wrap}
                  disabled={disabled}
                  onAccept={() => accept(invite)}
                  onDismiss={() => {
                    if (wrap) void watcher?.dismiss(wrap);
                  }}
                />
              );
            })}
          </div>
        )}
        {busy && <span className="text-sm opacity-70">{busy}</span>}
      </section>
    </div>
  );
}

export default function ConcordDirectInvitesExample() {
  const signer = use$(signer$);
  const user = use$(user$);

  if (!signer || !user) {
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );
  }

  return <ConcordDirectInvites />;
}
