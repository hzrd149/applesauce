/**
 * Browse recent user statuses on a relay, filter by type, and resolve their links
 * @tags user-status, feed, relay, casts, expiration
 * @related user-status/manager, user-status/timeline, user-status/now-playing
 */
import { User, UserStatus } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, kinds, unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useEffect, useMemo, useState } from "react";
import { map } from "rxjs";

import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Read statuses from the store so expired ones disappear when the store removes them
const statuses$ = eventStore.timeline({ kinds: [kinds.UserStatuses] }).pipe(
  castTimelineStream(UserStatus, eventStore),
  map((statuses) => statuses.filter((s) => !s.cleared)),
);

const TABS = ["all", "general", "music", "other"] as const;
type Tab = (typeof TABS)[number];

function matchesTab(status: UserStatus, tab: Tab) {
  if (tab === "all") return true;
  if (tab === "other") return status.type !== "general" && status.type !== "music";
  return status.type === tab;
}

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="inline h-5 w-5 align-text-bottom" />,
};

function timeAgo(seconds: number) {
  const diff = unixNow() - seconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function LinkedUser({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="text-primary">@{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>;
}

function StatusLink({ status }: { status: UserStatus }) {
  const linked = use$(status.linkedEvent$);

  if (status.url)
    return (
      <a href={status.url} target="_blank" className="link truncate text-xs">
        {status.url}
      </a>
    );
  if (status.user) return <LinkedUser user={status.user} />;
  if (linked)
    return <div className="truncate border-l-2 border-base-300 pl-2 text-xs opacity-60">{linked.content}</div>;
  return null;
}

function StatusRow({ status, now }: { status: UserStatus; now: number }) {
  const profile = use$(status.author.profile$);
  const content = useRenderedContent(status.event, components);

  return (
    <div className="flex gap-3 border-b border-base-300 p-3 last:border-b-0">
      <img
        src={getProfilePicture(profile, `https://robohash.org/${status.author.pubkey}.png`)}
        className="h-10 w-10 shrink-0 rounded-full"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{getDisplayName(profile, status.author.pubkey.slice(0, 8))}</span>
          <span className="badge badge-outline badge-sm">{status.type}</span>
          <span className="opacity-50">{timeAgo(status.event.created_at)}</span>
          {status.expiration && (
            <span className="ml-auto text-xs opacity-50">expires in {Math.max(0, status.expiration - now)}s</span>
          )}
        </div>
        <div>{content}</div>
        <StatusLink status={status} />
      </div>
    </div>
  );
}

export default function StatusExplorer() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [tab, setTab] = useState<Tab>("all");
  const [now, setNow] = useState(unixNow());
  const statuses = use$(statuses$);

  // Load recent statuses from the relay into the store
  useEffect(() => {
    const sub = pool
      .relay(relay)
      .subscription({ kinds: [kinds.UserStatuses], limit: 200 })
      .pipe(mapEventsToStore(eventStore))
      .subscribe();
    return () => sub.unsubscribe();
  }, [relay]);

  useEffect(() => {
    const id = setInterval(() => setNow(unixNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t, statuses?.filter((s) => matchesTab(s, t)).length ?? 0])),
    [statuses],
  );
  const visible = statuses?.filter((s) => matchesTab(s, tab));

  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-3 p-4">
      <RelayPicker value={relay} onChange={setRelay} />
      <div role="tablist" className="tabs tabs-bordered">
        {TABS.map((t) => (
          <button key={t} role="tab" className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t} ({counts[t]})
          </button>
        ))}
      </div>
      <p className="text-xs opacity-50">
        Statuses with an expiration are removed from the event store when they expire.
      </p>
      <div className="flex flex-col border border-base-300">
        {visible?.map((status) => (
          <StatusRow key={status.id} status={status} now={now} />
        ))}
      </div>
    </div>
  );
}
