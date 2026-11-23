/**
 * Manage profile badge pins with reactive casts and typed factories
 * @tags nip-58, profile, badges, editing
 * @related badges/profile
 */
import { Badge, BadgeAward, castUser, ProfileBadges, User } from "applesauce-common/casts";
import { ProfileBadgesFactory } from "applesauce-common/factories";
import {
  LEGACY_PROFILE_BADGES_IDENTIFIER,
  LEGACY_PROFILE_BADGES_KIND,
  PROFILE_BADGES_KIND,
} from "applesauce-common/helpers";
import { defined } from "applesauce-core";
import { EventStore } from "applesauce-core/event-store";
import { getDisplayName, getReplaceableAddressFromPointer, kinds, mergeRelaySets } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { buildBlossomURI, handleMediaFallbacks, parseBlossomURI } from "blossom-client-sdk";
import { ArrowDown, ArrowUp, Award, GripVertical, X } from "lucide-react";
import { useCallback, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  concat,
  distinctUntilChanged,
  endWith,
  firstValueFrom,
  ignoreElements,
  map,
  of,
  startWith,
  switchMap,
  timeout,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

type LoadState = { loading: boolean; error?: string };
type DragState = { dragging: number; over: number | null };

function logout() {
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
}

function getFactory(event: NostrEvent | undefined) {
  return event ? ProfileBadgesFactory.modify(event) : ProfileBadgesFactory.create();
}

function reorder<T>(items: T[], from: number, to: number): T[] {
  const reordered = [...items];
  const [item] = reordered.splice(from, 1);
  reordered.splice(to, 0, item);
  return reordered;
}

/** Loads the initial badge collection, then keeps it up to date */
function badgeSync$(user: User) {
  const filters = [
    { kinds: [PROFILE_BADGES_KIND], authors: [user.pubkey] },
    { kinds: [LEGACY_PROFILE_BADGES_KIND], authors: [user.pubkey], "#d": [LEGACY_PROFILE_BADGES_IDENTIFIER] },
    { kinds: [kinds.BadgeAward], "#p": [user.pubkey] },
  ];

  return user.mailboxes$.pipe(
    map((mailboxes) => mergeRelaySets(mailboxes?.inboxes, mailboxes?.outboxes)),
    map((relays) => (relays.length ? relays : FALLBACK_RELAYS)),
    distinctUntilChanged((previous, current) => previous.join() === current.join()),
    switchMap((relays) =>
      concat(
        // A finite request distinguishes a loaded empty collection from initial loading.
        pool.request(relays, filters, { eventStore }).pipe(ignoreElements(), endWith<LoadState>({ loading: false })),
        pool.subscription(relays, filters, { eventStore }).pipe(ignoreElements()),
      ).pipe(
        startWith<LoadState>({ loading: true }),
        catchError((error) => of<LoadState>({ loading: false, error: String(error?.message ?? error) })),
      ),
    ),
  );
}

/** Looks up an author's Blossom servers without blocking media fallback indefinitely */
async function getBlossomServers(pubkey?: string) {
  if (!pubkey) return [];

  try {
    return await firstValueFrom(
      castUser(pubkey, eventStore).blossomServers$.pipe(defined(), timeout({ first: 10_000 })),
    );
  } catch {
    return [];
  }
}

function BadgeImage({ badge }: { badge: Badge | undefined }) {
  const author = badge?.author.pubkey;
  let image = badge?.image?.url;

  try {
    if (image?.startsWith("blossom:")) {
      const uri = parseBlossomURI(image);
      // Preserve URI hints and use the issuer's servers as an additional fallback.
      if (author && !uri.authors.includes(author)) uri.authors.push(author);
      image = buildBlossomURI(uri);
    }
  } catch {
    image = undefined;
  }

  const attachFallbacks = useCallback(
    (element: HTMLImageElement | null) => {
      if (!element) return;
      return handleMediaFallbacks(element, getBlossomServers, author);
    },
    [image, author],
  );

  return (
    <div className="relative flex size-14 shrink-0 items-center justify-center rounded-lg bg-base-200">
      <Award className="size-6 text-base-content/40" aria-hidden="true" />
      {image && (
        <img
          key={`${author}:${image}`}
          ref={attachFallbacks}
          src={image}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full rounded-lg bg-base-200 object-contain opacity-0"
          onLoad={(event) => {
            event.currentTarget.style.opacity = "1";
          }}
          onError={(event) => {
            event.currentTarget.style.opacity = "0";
          }}
        />
      )}
    </div>
  );
}

function Account({ user, busy }: { user: User; busy: boolean }) {
  const profile = use$(user.profile$);

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{getDisplayName(profile, "Your account")}</div>
      </div>
      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function PinnedBadgeRow({
  profileBadges,
  index,
  busy,
  dragState,
  onDrag,
  onMove,
  onRemove,
}: {
  profileBadges: ProfileBadges;
  index: number;
  busy: boolean;
  dragState: DragState | null;
  onDrag: (state: DragState | null) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const resolved = use$(() => profileBadges.slot$(index), [profileBadges, index]);
  const badge = resolved?.badge;
  const name = badge?.name || badge?.identifier || profileBadges.slots[index].badge.identifier || "Unnamed badge";
  const isDragging = dragState?.dragging === index;
  const isOver = dragState?.over === index && !isDragging;

  return (
    <div
      draggable={!busy}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        onDrag({ dragging: index, over: null });
      }}
      onDragOver={(event) => {
        if (busy || !dragState) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDrag({ ...dragState, over: index });
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy && dragState) onMove(dragState.dragging, index);
        onDrag(null);
      }}
      onDragEnd={() => onDrag(null)}
      className={`border-b border-base-300 p-3 ${isDragging ? "opacity-40" : ""} ${isOver ? "bg-primary/10" : ""}`}
    >
      <div className="flex items-center gap-3">
        <BadgeImage badge={badge} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={name}>
            {name}
          </div>
          <div className="text-sm text-base-content/50">Position {index + 1}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <GripVertical className="me-auto size-4 cursor-grab text-base-content/40" aria-label="Drag to reorder" />
        <button
          className="btn btn-sm btn-ghost btn-square"
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move ${name} up`}
          title="Move up"
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          className="btn btn-sm btn-ghost btn-square"
          disabled={busy || index === profileBadges.count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move ${name} down`}
          title="Move down"
        >
          <ArrowDown className="size-4" />
        </button>
        <button
          className="btn btn-sm btn-ghost btn-square text-error"
          disabled={busy}
          onClick={() => onRemove(index)}
          aria-label={`Unpin ${name}`}
          title="Unpin badge"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function AwardRow({
  award,
  pinned,
  busy,
  onAdd,
}: {
  award: BadgeAward;
  pinned: boolean;
  busy: boolean;
  onAdd: (award: BadgeAward) => void;
}) {
  const badge = use$(award.badge$);
  const issuer = use$(award.issuer.profile$);
  const name = badge?.name || badge?.identifier || award.pointer.identifier || "Unnamed badge";

  return (
    <div className="flex items-center gap-4 border-b border-base-300 p-4">
      <BadgeImage badge={badge} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={name}>
          {name}
        </div>
        {badge?.description && <div className="line-clamp-2 text-sm text-base-content/70">{badge.description}</div>}
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-base-content/50">
          <span>{getDisplayName(issuer, "Unknown issuer")}</span>
          <time dateTime={award.createdAt.toISOString()}>{award.createdAt.toLocaleDateString()}</time>
        </div>
      </div>
      <button
        className={`btn btn-sm shrink-0 ${pinned ? "btn-ghost" : "btn-primary"}`}
        disabled={busy || pinned}
        onClick={() => onAdd(award)}
      >
        {pinned ? "Pinned" : "Pin badge"}
      </button>
    </div>
  );
}

function EditorView({ user }: { user: User }) {
  const profileBadges = use$(user.profileBadges$);
  const awards = use$(user.badgeAwards$);
  const outboxes = use$(user.outboxes$);
  const [retry, setRetry] = useState(0);
  const sync = use$(() => badgeSync$(user), [user, retry]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [notice, setNotice] = useState<string>();
  const [filter, setFilter] = useState<"all" | "available">("all");

  const slots = profileBadges?.slots ?? [];
  const publishRelays = outboxes?.length ? outboxes : FALLBACK_RELAYS;
  const pinnedAddresses = new Set(slots.map((slot) => getReplaceableAddressFromPointer(slot.badge)));
  const availableAwards = awards?.filter(
    (award) => !pinnedAddresses.has(getReplaceableAddressFromPointer(award.pointer)),
  );
  const visibleAwards = filter === "available" ? availableAwards : awards;
  const loading = !sync || sync.loading;
  const editingDisabled = busy || loading || !!sync?.error;

  async function runAction(action: string, factory: ProfileBadgesFactory) {
    const signer = signer$.value;
    if (!signer || editingDisabled) return;

    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const signed = await factory.sign(signer);
      const responses = await pool.publish(publishRelays, signed);

      if (!responses.some((response) => response.ok)) throw new Error("Couldn't save your badges. Please try again.");
      eventStore.add(signed);
      setNotice(action);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function moveBadge(from: number, to: number) {
    if (from === to || !slots[from] || !slots[to]) return;
    void runAction("Reordered badges", getFactory(profileBadges?.event).slots(reorder(slots, from, to)));
  }

  function removeBadge(index: number) {
    const slot = slots[index];
    if (slot) void runAction("Unpinned badge", getFactory(profileBadges?.event).removeByBadge(slot.badge));
  }

  function addBadge(award: BadgeAward) {
    void runAction(
      "Pinned badge",
      getFactory(profileBadges?.event).addSlot({
        badge: award.pointer,
        award: { id: award.id, relays: publishRelays },
      }),
    );
  }

  return (
    <div className="flex min-h-0 grow flex-col md:flex-row">
      <aside className="flex min-h-0 shrink-0 flex-col border-b border-base-300 md:w-72 md:border-e md:border-b-0">
        <div className="flex items-center justify-between border-b border-base-300 p-4">
          <h2 className="font-semibold">Pinned badges</h2>
          <span className="badge badge-ghost">{slots.length}</span>
        </div>
        <div className="max-h-72 min-h-0 flex-1 overflow-y-auto md:max-h-none">
          {profileBadges &&
            slots.map((slot, index) => (
              <PinnedBadgeRow
                key={`${getReplaceableAddressFromPointer(slot.badge)}:${slot.award.id}`}
                profileBadges={profileBadges}
                index={index}
                busy={editingDisabled}
                dragState={dragState}
                onDrag={setDragState}
                onMove={moveBadge}
                onRemove={removeBadge}
              />
            ))}
          {!loading && !sync?.error && slots.length === 0 && (
            <div className="p-6 text-center text-sm text-base-content/50">No pinned badges</div>
          )}
        </div>
        <Account user={user} busy={busy} />
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-100 p-4">
          <h2 className="font-semibold">Your awards</h2>
          <div className="join" role="group" aria-label="Filter awards">
            <button
              className={`btn btn-sm join-item ${filter === "all" ? "btn-active" : ""}`}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All {awards?.length ?? 0}
            </button>
            <button
              className={`btn btn-sm join-item ${filter === "available" ? "btn-active" : ""}`}
              aria-pressed={filter === "available"}
              onClick={() => setFilter("available")}
            >
              Unpinned {availableAwards?.length ?? 0}
            </button>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {busy && (
              <span role="status" className="flex items-center gap-2 text-sm">
                <span className="loading loading-spinner loading-sm" />
                Publishing
              </span>
            )}
            {!busy && notice && (
              <span role="status" className="text-sm text-success">
                {notice}
              </span>
            )}
          </div>
        </div>

        {(error || sync?.error) && (
          <div role="alert" className="flex items-center gap-3 border-b border-base-300 p-4 text-error">
            <span className="min-w-0 flex-1 break-words">{error || sync?.error}</span>
            {sync?.error && (
              <button className="btn btn-sm btn-ghost" onClick={() => setRetry((value) => value + 1)}>
                Retry loading
              </button>
            )}
            {error && (
              <button className="btn btn-sm btn-ghost" onClick={() => setError(undefined)} aria-label="Dismiss error">
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        {loading && (
          <div role="status" className="flex items-center justify-center gap-2 p-6 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            Loading badges
          </div>
        )}
        {visibleAwards?.map((award) => (
          <AwardRow
            key={award.id}
            award={award}
            pinned={pinnedAddresses.has(getReplaceableAddressFromPointer(award.pointer))}
            busy={editingDisabled}
            onAdd={addBadge}
          />
        ))}
        {!loading && !sync?.error && !visibleAwards?.length && (
          <div className="p-12 text-center text-base-content/50">
            {awards?.length ? "All your awards are pinned" : "No badge awards found"}
          </div>
        )}
      </main>
    </div>
  );
}

export default function BadgeEditorExample() {
  const signer = use$(signer$);
  const user = use$(user$);

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  return <EditorView key={user.pubkey} user={user} />;
}
