/**
 * Render profile badges via casts and inspect who issued each award
 * @tags casting, nip-58, profile, badges
 * @related casting/thread, simple/profile-editor
 */
import { BadgeAward, BadgeDefinition, ProfileBadges, castUser } from "applesauce-common/casts";
import { ProfileBadgeSlot, LEGACY_PROFILE_BADGES_IDENTIFIER, PROFILE_BADGES_KIND } from "applesauce-common/helpers";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { nip19 } from "nostr-tools";
import { useMemo, useState } from "react";
import { map } from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];
const DEFAULT_USER = "npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr"; // Ditto profile

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: RELAYS,
});

function formatPubkey(pk: string) {
  try {
    return nip19.npubEncode(pk).slice(0, 12) + "…";
  } catch {
    return pk.slice(0, 8) + "…";
  }
}

function BadgeSlotCard({ badge, slot, viewer }: { badge: ProfileBadges; slot: ProfileBadgeSlot; viewer: string }) {
  const definition = use$<BadgeDefinition | undefined>(
    () => badge.definition$(slot),
    [badge.uid, slot.definition.identifier],
  );
  const award = use$<BadgeAward | undefined>(() => badge.award$(slot), [badge.uid, slot.award.id]);
  const issuerProfile = use$(() => award?.author.profile$, [award?.id]);

  const title = definition?.name || definition?.identifier || slot.definition.identifier || "Badge";
  const description = definition?.description;
  const image = definition?.image?.url;
  const isRecipient = award?.recipients.includes(viewer);

  return (
    <div className="card border border-base-300">
      <div className="card-body p-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-14 rounded-xl bg-base-200">
              {image ? (
                <img src={image} alt={title} />
              ) : (
                <span className="flex items-center justify-center h-full text-2xl">🏅</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="mb-1">
              <span className="badge badge-ghost badge-sm">{isRecipient ? "Pinned" : "Award"}</span>
            </div>
            <h3 className="card-title text-base truncate">{title}</h3>
          </div>
        </div>
        {description && <p className="text-sm text-base-content/80">{description}</p>}
        {award ? (
          <div className="text-sm text-base-content/70 space-y-1">
            <div>
              Issuer: <span className="font-medium">{issuerProfile?.displayName || formatPubkey(award.issuer)}</span>
            </div>
            <div className="text-xs">
              {award.recipients.length} recipient tag{award.recipients.length === 1 ? "" : "s"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-base-content/50">Waiting for award details…</p>
        )}
      </div>
    </div>
  );
}

function AwardRow({ award }: { award: BadgeAward }) {
  const definition = use$(
    () => eventStore.event(award.definition).pipe(castEventStream(BadgeDefinition, eventStore)),
    [award.id],
  );
  const issuerProfile = use$(() => award.author.profile$, [award.id]);
  const published = new Date(award.event.created_at * 1000).toLocaleDateString();

  return (
    <div className="card border border-base-300">
      <div className="card-body p-3 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            Issuer: <span className="font-medium">{issuerProfile?.displayName || formatPubkey(award.issuer)}</span>
          </div>
          <span className="badge badge-ghost badge-sm">{published}</span>
        </div>
        <div className="font-semibold">
          {definition?.name || definition?.identifier || `${award.definition.kind}:${award.definition.identifier}`}
        </div>
        <div className="text-sm text-base-content/70">Recipients: {award.recipients.map(formatPubkey).join(", ")}</div>
      </div>
    </div>
  );
}

export default function ProfileBadgesExample() {
  const [pubkey, setPubkey] = useState<string | null>(null);

  const user = useMemo(() => (pubkey ? castUser(pubkey, eventStore) : undefined), [pubkey]);
  const profile = use$(() => (user ? user.profile$ : undefined), [user?.pubkey]);
  const profileBadges = use$(() => profile?.badges$, [profile?.id]);
  const awards = use$(() => {
    if (!pubkey) return undefined;
    return eventStore.timeline({ kinds: [kinds.BadgeAward], "#p": [pubkey] }).pipe(
      map((events) => events.sort((a, b) => b.created_at - a.created_at)),
      castTimelineStream(BadgeAward, eventStore),
    );
  }, [pubkey]);

  use$(() => {
    if (!pubkey) return undefined;
    return pool.subscription(
      RELAYS,
      [
        { kinds: [kinds.Metadata, PROFILE_BADGES_KIND], authors: [pubkey] },
        { kinds: [kinds.ProfileBadges], authors: [pubkey], "#d": [LEGACY_PROFILE_BADGES_IDENTIFIER] },
        { kinds: [kinds.BadgeAward], "#p": [pubkey] },
      ],
      { eventStore },
    );
  }, [pubkey]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Profile Badge Gallery</h1>
        <p className="text-base-content/70 max-w-3xl">
          Enter an npub (or hex pubkey) to inspect profile badges published via kind 10008 events. Everything is parsed
          via casts only: <code>Profile</code> → <code>ProfileBadges</code> for slots plus <code>BadgeDefinition</code>{" "}
          and <code>BadgeAward</code> for the supporting metadata.
        </p>
      </div>

      <PubkeyPicker value={DEFAULT_USER} onChange={setPubkey} placeholder="npub1…" />

      {profile ? (
        <div className="card border border-base-300">
          <div className="card-body p-4 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title">
                {profile.displayName || profile.name || formatPubkey(profile.event.pubkey)}
              </h2>
              <span className="badge badge-ghost badge-sm font-mono">{formatPubkey(profile.event.pubkey)}</span>
            </div>
            {profile.metadata.about && <p className="text-sm text-base-content/70">{profile.metadata.about}</p>}
          </div>
        </div>
      ) : (
        <div className="alert">
          <span>Provide a pubkey to load profile metadata and badges.</span>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Pinned Badges</h2>
          {profileBadges && <span className="badge badge-neutral">{profileBadges.count}</span>}
        </div>
        {profile && !profileBadges && (
          <div className="flex justify-center py-4">
            <span className="loading loading-spinner loading-md" />
          </div>
        )}
        {profileBadges && profileBadges.slots.length === 0 && (
          <div className="alert">
            <span>This profile has not selected any badges yet.</span>
          </div>
        )}
        {profileBadges && profileBadges.slots.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profileBadges.slots.map((slot) => (
              <BadgeSlotCard
                key={`${slot.definition.kind}:${slot.definition.identifier}:${slot.award.id}`}
                badge={profileBadges}
                slot={slot}
                viewer={pubkey ?? ""}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Awards referencing you</h2>
          {awards && <span className="badge badge-neutral">{awards.length}</span>}
        </div>
        {pubkey && !awards && (
          <div className="flex justify-center py-4">
            <span className="loading loading-spinner loading-md" />
          </div>
        )}
        {awards && awards.length === 0 && (
          <div className="alert">
            <span>No badge award events referencing this pubkey were found during this session.</span>
          </div>
        )}
        {awards && awards.length > 0 && (
          <div className="space-y-3">
            {awards.map((award) => (
              <AwardRow key={award.uid} award={award} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
