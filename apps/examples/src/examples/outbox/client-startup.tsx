/**
 * Boot a social client by discovering outboxes and syncing lists and metadata
 * @tags nip-51, nip-65, nip-77, outbox, sync
 * @related loader/sync-loader, app-data/manager, outbox/social-feed
 */
import { getRelaysFromList, PROFILE_BADGES_KIND, LOOKUP_RELAY_LIST_KIND } from "applesauce-common/helpers";
import { castEvent, castUser, Profile } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { isValidProfile, getOutboxes, mergeRelaySets, kinds, type NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";
import { concat, defer, ignoreElements } from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Bootstrap NIP-65 through the ordinary lookup loader; metadata is synced from outboxes below.
// A persistent client should hydrate this same store before starting network work.
const loadEvent = createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });
const sync = createSyncLoader({ eventStore, pool });

// An explicit application scope: extend this for the features your client supports.
// No public kind constant is available for picture curation sets yet.
const PICTURE_CURATION_SET_KIND = 30006;

const metadataKinds: Record<number, string> = {
  [kinds.Metadata]: "Profile",
  [kinds.Contacts]: "Contacts",
  [kinds.Mutelist]: "Mutes",
  [kinds.Pinlist]: "Pinned notes",
  [kinds.RelayList]: "Outbox / inbox relays",
  [kinds.BookmarkList]: "Bookmarks",
  [kinds.CommunitiesList]: "Communities",
  [kinds.PublicChatsList]: "Public chats",
  [kinds.BlockedRelaysList]: "Blocked relays",
  [kinds.SearchRelaysList]: "Search relays",
  [PROFILE_BADGES_KIND]: "Profile badges",
  [kinds.SimpleGroupList]: "User groups",
  [kinds.FavoriteRelays]: "Favorite relays",
  [kinds.PrivateEventRelayList]: "Private relays",
  [kinds.InterestsList]: "Interests",
  [kinds.MediaFollows]: "Media follows",
  [kinds.FavoriteFollowSets]: "Favorite follow sets",
  [kinds.UserEmojiList]: "Emoji lists",
  [kinds.DirectMessageRelaysList]: "Messaging relays",
  [kinds.BlossomServerList]: "Blossom servers",
  [LOOKUP_RELAY_LIST_KIND]: "Lookup relays",
  [kinds.FileServerPreference]: "File storage servers",
  [kinds.Followsets]: "Follow sets",
  [kinds.Genericlists]: "Legacy lists",
  [kinds.Relaysets]: "Relay sets",
  [kinds.Bookmarksets]: "Bookmark sets",
  [kinds.Curationsets]: "Curation sets",
  [kinds.CuratedVideoSets]: "Video sets",
  [PICTURE_CURATION_SET_KIND]: "Picture sets",
  [kinds.MuteSets]: "Kind mute sets",
  [kinds.ProfileBadges]: "Badge sets",
  [kinds.Interestsets]: "Interest sets",
  [kinds.Emojisets]: "Emoji sets",
  [kinds.StarterPacks]: "Starter packs",
  [kinds.MediaStarterPacks]: "Media starter packs",
};
const clientKinds = Object.keys(metadataKinds).map(Number);

function startup(pubkey: string) {
  return concat(
    // Finish the ordinary address lookup before selecting relays for metadata sync.
    loadEvent({ kind: kinds.RelayList, pubkey }).pipe(ignoreElements()),
    defer(() => {
      const mailboxes = eventStore.getReplaceable(kinds.RelayList, pubkey);
      const blocked = eventStore.getReplaceable(kinds.BlockedRelaysList, pubkey);
      const excluded = new Set(mergeRelaySets(blocked ? getRelaysFromList(blocked) : []));
      const relays = mergeRelaySets(mailboxes ? getOutboxes(mailboxes) : []).filter((url) => !excluded.has(url));
      // No advertised outboxes means no metadata sync; lookup relays only discover NIP-65.
      const run = sync({
        relays,
        filter: { authors: [pubkey], kinds: clientKinds },
        concurrency: 4,
        waitForAuth: false,
      });
      return run.status$;
    }),
  );
}

const groups: { name: string; color: string; kinds: number[] }[] = [
  { name: "Identity", color: "#38bdf8", kinds: [kinds.Metadata, PROFILE_BADGES_KIND, kinds.ProfileBadges] },
  {
    name: "Social graph",
    color: "#a78bfa",
    kinds: [
      kinds.Contacts,
      kinds.CommunitiesList,
      kinds.PublicChatsList,
      kinds.SimpleGroupList,
      kinds.MediaFollows,
      kinds.FavoriteFollowSets,
      kinds.Followsets,
      kinds.StarterPacks,
      kinds.MediaStarterPacks,
    ],
  },
  {
    name: "Moderation",
    color: "#fb7185",
    kinds: [kinds.Mutelist, kinds.BlockedRelaysList, kinds.MuteSets],
  },
  {
    name: "Saved content",
    color: "#fbbf24",
    kinds: [
      kinds.Pinlist,
      kinds.BookmarkList,
      kinds.Genericlists,
      kinds.Bookmarksets,
      kinds.Curationsets,
      kinds.CuratedVideoSets,
      PICTURE_CURATION_SET_KIND,
    ],
  },
  {
    name: "Preferences",
    color: "#34d399",
    kinds: [
      kinds.RelayList,
      kinds.SearchRelaysList,
      kinds.FavoriteRelays,
      kinds.PrivateEventRelayList,
      kinds.InterestsList,
      kinds.UserEmojiList,
      kinds.DirectMessageRelaysList,
      kinds.BlossomServerList,
      LOOKUP_RELAY_LIST_KIND,
      kinds.FileServerPreference,
      kinds.Relaysets,
      kinds.Interestsets,
      kinds.Emojisets,
    ],
  },
];

const stateColors = {
  pending: "#94a3b8",
  checking: "#38bdf8",
  loading: "#a78bfa",
  complete: "#34d399",
  error: "#fb7185",
};

function StartupMap({
  status,
  events,
  selected,
  onSelect,
}: {
  status?: SyncLoaderStatus;
  events: NostrEvent[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const relays = Object.values(status?.relays ?? {});
  const height = Math.max(540, relays.length * 78 + 100);
  const cy = height / 2;
  const total = events.length;
  const counts = groups.map((group) => events.filter((event) => group.kinds.includes(event.kind)).length);
  let offset = 0;

  return (
    <div className="shrink-0 border-y border-base-300">
      <svg
        viewBox={`0 0 1000 ${height}`}
        className="block h-auto w-full"
        role="group"
        aria-label="Startup map: relay sources, stored events, and metadata groups"
      >
        <text x="35" y="35" fill="currentColor" fontSize="16">
          RELAY SOURCES
        </text>
        <text x="710" y="35" fill="currentColor" fontSize="16">
          CLIENT DATA
        </text>
        {relays.map((relay, index) => {
          const y = cy - (relays.length - 1) * 39 + index * 78;
          const color = stateColors[relay.state];
          return (
            <g key={relay.relay}>
              <path
                d={`M 235 ${y} C 310 ${y}, 310 ${cy}, 360 ${cy}`}
                stroke={color}
                strokeWidth="1.5"
                fill="none"
                opacity="0.4"
              />
              <circle
                cx="235"
                cy={y}
                r="5"
                fill={color}
                className={
                  relay.state === "loading" || relay.state === "checking" ? "motion-safe:animate-pulse" : undefined
                }
              />
              <text x="35" y={y - 14} fill="currentColor" fontSize="16">
                {new URL(relay.relay).hostname.slice(0, 25)}
              </text>
              <text x="35" y={y + 10} fill={color} fontSize="14">
                {relay.state} · {relay.count} received
              </text>
              <text x="35" y={y + 31} fill="currentColor" opacity="0.6" fontSize="14">
                Outbox ·{" "}
                {relay.method === "negentropy" ? "NIP-77" : relay.method === "request" ? "Paginated REQ" : "Connecting"}
              </text>
              {relay.error && (
                <title>
                  {relay.relay}: {relay.error.message}
                </title>
              )}
            </g>
          );
        })}
        {!relays.length && (
          <text x="35" y={cy} fill="currentColor" fontSize="16">
            Finding NIP-65 through lookup relays…
          </text>
        )}
        <circle cx="470" cy={cy} r="104" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="14" />
        {groups.map((group, index) => {
          const fraction = counts[index] / Math.max(total, 1);
          const dashOffset = -offset * 2 * Math.PI * 104;
          offset += fraction;
          return (
            <circle
              key={group.name}
              cx="470"
              cy={cy}
              r="104"
              fill="none"
              stroke={group.color}
              strokeWidth={selected === index ? 20 : 14}
              strokeDasharray={`${fraction * 2 * Math.PI * 104} ${2 * Math.PI * 104}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 470 ${cy})`}
            />
          );
        })}
        <text x="470" y={cy - 4} textAnchor="middle" fill="currentColor" fontSize="52" fontWeight="600">
          {total}
        </text>
        <text x="470" y={cy + 27} textAnchor="middle" fill="currentColor" fontSize="16">
          stored events
        </text>
        <text x="470" y={cy + 154} textAnchor="middle" fill="currentColor" opacity="0.6" fontSize="14">
          Current versions · deduplicated
        </text>
        {groups.map((group, index) => {
          const y = cy - 156 + index * 78;
          return (
            <g
              key={group.name}
              role="button"
              tabIndex={0}
              aria-label={`${group.name}: ${counts[index]} events`}
              aria-pressed={selected === index}
              className="cursor-pointer outline-offset-4"
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(index);
                }
              }}
            >
              <path
                d={`M 580 ${cy} C 635 ${cy}, 635 ${y}, 700 ${y}`}
                stroke={group.color}
                strokeWidth={selected === index ? 2 : 1}
                opacity={selected === index ? 0.8 : 0.25}
                fill="none"
              />
              <rect
                x="700"
                y={y - 28}
                width="275"
                height="58"
                rx="6"
                fill="currentColor"
                fillOpacity={selected === index ? 0.06 : 0.015}
              />
              <circle cx="718" cy={y} r="5" fill={group.color} />
              <text x="736" y={y + 6} fill="currentColor" fontSize="18">
                {group.name}
              </text>
              <text x="954" y={y + 6} textAnchor="end" fill={group.color} fontSize="23" fontWeight="600">
                {counts[index]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function UserMetadata({ pubkey }: { pubkey: string }) {
  const status = use$(() => startup(pubkey), [pubkey]);
  const outboxes = use$(() => castUser(pubkey, eventStore).outboxes$, [pubkey]);
  const events = use$(() => eventStore.timeline({ authors: [pubkey], kinds: clientKinds }), [pubkey]) ?? [];
  const profileEvent = events.find((event) => event.kind === kinds.Metadata);
  const profile =
    profileEvent && isValidProfile(profileEvent) ? castEvent(profileEvent, Profile, eventStore) : undefined;
  const [selected, setSelected] = useState(0);
  const relays = Object.values(status?.relays ?? {});
  const failures = relays.filter((relay) => relay.state === "error");
  const completed = relays.filter((relay) => relay.state === "complete").length;
  const stages = [
    {
      name: "Discover",
      detail: outboxes?.length
        ? `${outboxes.length} advertised outboxes`
        : status?.done
          ? "No advertised outboxes found"
          : "Finding NIP-65 on lookup relays",
      ready: outboxes !== undefined || (!!status?.done && relays.length > 0),
    },
    {
      name: "Reconcile",
      detail: `${completed} of ${relays.length} relays synced`,
      ready: !!status?.done && relays.length > 0 && failures.length === 0,
    },
    {
      name: "Ready",
      detail: status?.done ? (failures.length ? "Review relay failures" : "Metadata loaded") : "Waiting for sync",
      ready: !!status?.done && relays.length > 0 && failures.length === 0,
    },
  ];

  return (
    <div className="flex shrink-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-base-content/60">CLIENT STARTUP</p>
          <h2 className="text-3xl font-semibold">{profile?.displayName || pubkey.slice(0, 12)}</h2>
        </div>
        <p className="text-base-content/70">
          {!status
            ? "Discovering relays…"
            : !relays.length
              ? "No eligible relays"
              : !status.done
                ? "Building your client’s context…"
                : failures.length
                  ? "Ready with relay failures"
                  : "Metadata ready"}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-4" aria-label="Startup stages">
        {stages.map((stage, index) => (
          <div key={stage.name} className="flex items-center gap-3">
            <span
              className={`flex size-10 items-center justify-center rounded-full border ${stage.ready ? "border-success text-success" : "border-base-300"}`}
            >
              {stage.ready ? "✓" : index + 1}
            </span>
            <div>
              <p className="font-medium">{stage.name}</p>
              <p className="text-sm text-base-content/60">{stage.detail}</p>
            </div>
            {index < stages.length - 1 && (
              <span className="ml-4 text-base-content/30" aria-hidden="true">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <StartupMap status={status} events={events} selected={selected} onSelect={setSelected} />
      <section aria-label={`${groups[selected].name} details`}>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-xl font-medium">{groups[selected].name}</h3>
          <span className="text-sm text-base-content/60">Current stored metadata · select a group in the map</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 py-4">
          {groups[selected].kinds.map((kind) => {
            const count = events.filter((event) => event.kind === kind).length;
            return (
              <p key={kind} className={count ? "" : "text-base-content/50"}>
                <strong
                  style={{ color: count ? groups[selected].color : undefined }}
                  className="mr-2 text-xl tabular-nums"
                >
                  {count}
                </strong>
                {metadataKinds[kind]}
              </p>
            );
          })}
        </div>
        {!events.length && (
          <p className="text-sm">
            {status?.done ? "No metadata found on the eligible relays." : "Waiting for the first metadata events…"}
          </p>
        )}
      </section>
      {failures.length > 0 && (
        <div role="alert" className="border-l-2 border-error pl-4">
          {failures.map((relay) => (
            <p key={relay.relay} className="text-sm">
              {relay.relay}: {relay.error?.message}
            </p>
          ))}
        </div>
      )}
      <p className="text-sm text-base-content/60">
        The ring shows the mix of current stored metadata, not a completion percentage. Lookup relays use the example
        shell’s shared settings to find NIP-65 first. Metadata then syncs only from advertised outboxes and stops when
        those relays finish. Encrypted contents stay locked in this read-only demo. Feeds and messages load separately
        when their views need them.
      </p>
    </div>
  );
}

export default function ClientStartupExample() {
  const [pubkey, setPubkey] = useState("");
  return (
    <div className="flex min-h-0 grow flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <PubkeyPicker value={pubkey} onChange={setPubkey} />
      {pubkey ? (
        <UserMetadata key={pubkey} pubkey={pubkey} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
          <div className="size-24 rounded-full border-2 border-dashed border-base-300" />
          <p className="text-2xl font-medium">Bring a client to life</p>
          <p className="text-base-content/60">Choose a user to discover their relays and assemble their metadata.</p>
        </div>
      )}
    </div>
  );
}
