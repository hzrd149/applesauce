/**
 * Graph a user's contacts connected to the outbox relays they publish to
 * @tags nip-65, nip-66, relay-discovery, contacts, relays, force-graph, visualization
 * @related relay-discovery/attributes, relay-discovery/monitor-feed, relay-discovery/relay-directory
 */
import { combineLatest, defer, map, of, startWith, switchMap, timer } from "rxjs";

import { castUser, RelayDiscovery, RelayMonitor } from "applesauce-common/casts";
import { RELAY_MONITOR_ANNOUNCEMENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { combineLatestByValue, EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import { useCallback, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";

import PubkeyPicker from "../../components/pubkey-picker";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Create stores and relay pool
const eventStore = new EventStore();
const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

// Default discovery monitor pubkey
const DEFAULT_DISCOVERY_MONITOR = "9ba046db56b8e6682c48af8d6425ffe80430a3cd0854d95381af27c5d27ca0f7";
const DEFAULT_DISCOVERY_RELAY = "wss://relay.nostr.watch/";

type RelayStatus = "online" | "offline" | "unknown";

const STATUS_COLORS: Record<RelayStatus, string> = {
  online: "#22c55e",
  offline: "#ef4444",
  unknown: "#a3a3a3",
};

type UserNode = { kind: "user"; id: string; name: string; picture?: string; image?: HTMLImageElement };
type RelayNode = { kind: "relay"; id: string; users: number };
type GraphNode = NodeObject<UserNode | RelayNode>;
type GraphLink = LinkObject<GraphNode> & { source: string | GraphNode; target: string | GraphNode };

/** Relay nodes grow with the number of contacts publishing to them */
function nodeRadius(node: GraphNode): number {
  return node.kind === "user" ? 6 : 4 + Math.sqrt(node.users) * 2;
}

/** Strips the protocol and trailing slash from a relay URL for labels */
function short(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

/** Online when the monitor's latest discovery event is newer than its publish frequency */
function getRelayStatus(monitor: RelayMonitor | undefined, discovery: RelayDiscovery | undefined): RelayStatus {
  const frequency = monitor?.frequency;
  if (!discovery || !frequency) return "unknown";
  return Date.now() / 1000 - discovery.event.created_at > frequency ? "offline" : "online";
}

function MonitorOption({ monitor }: { monitor: RelayMonitor }) {
  const profile = use$(() => monitor.author.profile$, [monitor.author.pubkey]);

  return (
    <option value={monitor.author.pubkey}>{profile?.displayName ?? monitor.author.pubkey.slice(0, 8) + "..."}</option>
  );
}

function MonitorPicker({
  monitors,
  onChange,
  value,
}: {
  monitors: RelayMonitor[];
  onChange: (monitor: string) => void;
  value: string;
}) {
  return (
    <select className="select select-bordered" value={value} onChange={(e) => onChange(e.target.value)}>
      {monitors.map((m) => (
        <MonitorOption key={m.uid} monitor={m} />
      ))}
    </select>
  );
}

export default function ContactsRelays() {
  const [relay, setRelay] = useState<string>(DEFAULT_DISCOVERY_RELAY);
  const [selectedMonitor, setSelectedMonitor] = useState<string>(DEFAULT_DISCOVERY_MONITOR);
  const [selectedPubkey, setSelectedPubkey] = useState<string>("");
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Get the monitor announcements from the discovery relay
  const monitors = use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND] })
        .pipe(mapEventsToStore(eventStore), mapEventsToTimeline(), castTimelineStream(RelayMonitor, eventStore)),
    [relay],
  );

  const monitor = useMemo(
    () => monitors?.find((m) => m.author.pubkey === selectedMonitor),
    [monitors, selectedMonitor],
  );

  // Build the graph from each contact's outboxes and profile, reusing node objects so positions survive updates
  const graph = use$(() => {
    if (!selectedPubkey) return undefined;

    return defer(() => {
      const nodes = new Map<string, GraphNode>();

      return castUser(selectedPubkey, eventStore).contacts$.pipe(
        map((contacts) => contacts ?? []),
        combineLatestByValue((contact) =>
          combineLatest([contact.outboxes$.pipe(startWith(undefined)), contact.profile$.pipe(startWith(undefined))]),
        ),
        map((contacts) => {
          const links: GraphLink[] = [];
          const relayUsers = new Map<string, number>();

          for (const [contact, [outboxes, profile]] of contacts) {
            if (!outboxes?.length) continue;

            let user = nodes.get(contact.pubkey) as UserNode | undefined;
            if (!user) {
              user = { kind: "user", id: contact.pubkey, name: contact.pubkey.slice(0, 8) };
              nodes.set(contact.pubkey, user);
            }
            user.name = getDisplayName(profile, contact.pubkey.slice(0, 8));

            const picture = getProfilePicture(profile, `https://robohash.org/${contact.pubkey}.png?size=64x64`);
            if (picture !== user.picture) {
              user.picture = picture;
              user.image = new Image();
              user.image.referrerPolicy = "no-referrer";
              user.image.src = picture;
            }

            for (const url of new Set(outboxes)) {
              links.push({ source: contact.pubkey, target: url });
              relayUsers.set(url, (relayUsers.get(url) ?? 0) + 1);
            }
          }

          for (const [url, users] of relayUsers) {
            const node = nodes.get(url) as RelayNode | undefined;
            if (node) node.users = users;
            else nodes.set(url, { kind: "relay", id: url, users });
          }

          const linked = new Set([...links.map((l) => l.source as string), ...relayUsers.keys()]);
          return { nodes: [...nodes.values()].filter((n) => linked.has(n.id)), links, contacts: contacts.size };
        }),
      );
    });
  }, [selectedPubkey]);

  // Join relay URLs into a stable key so status subscriptions only change when the relay set does
  const relayKey = useMemo(
    () =>
      graph?.nodes
        .filter((n) => n.kind === "relay")
        .map((n) => n.id)
        .sort()
        .join(",") ?? "",
    [graph],
  );

  // Resolve each relay's status from the selected monitor, re-checking ages every 10 seconds
  const statuses = use$(() => {
    const urls = relayKey ? relayKey.split(",") : [];
    if (!monitor || urls.length === 0) return of(new Map<string, RelayStatus>());

    return of(urls).pipe(
      combineLatestByValue((url) => monitor.relayStatus(url).pipe(startWith(undefined))),
      switchMap((discoveries) =>
        timer(0, 10_000).pipe(
          map(() => new Map([...discoveries].map(([url, d]) => [url, getRelayStatus(monitor, d)] as const))),
        ),
      ),
    );
  }, [monitor, relayKey]);

  // Highlight the hovered node and its direct neighbors
  const neighbors = useMemo(() => {
    if (!hovered || !graph) return null;
    const ids = new Set([hovered.id]);
    for (const link of graph.links) {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      if (source === hovered.id) ids.add(target);
      if (target === hovered.id) ids.add(source);
    }
    return ids;
  }, [hovered, graph]);

  // Read the latest render state from refs so the canvas painters stay stable
  const statusRef = useRef(statuses);
  statusRef.current = statuses;
  const neighborsRef = useRef(neighbors);
  neighborsRef.current = neighbors;

  // Follow the container size, React 19 runs the returned cleanup on unmount
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Push relays apart harder than users so each relay gets its own cluster
  const tune = useCallback((fg: ForceGraphMethods<GraphNode, GraphLink> | null) => {
    if (!fg) return;
    fg.d3Force("charge")?.strength((n: GraphNode) => (n.kind === "relay" ? -120 : -30));
  }, []);

  const paintNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = nodeRadius(node);
    ctx.globalAlpha = !neighborsRef.current || neighborsRef.current.has(node.id) ? 1 : 0.15;

    if (node.kind === "user") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.clip();
      if (node.image?.complete && node.image.naturalWidth > 0) ctx.drawImage(node.image, x - r, y - r, r * 2, r * 2);
      else {
        ctx.fillStyle = "#737373";
        ctx.fill();
      }
      ctx.restore();
    } else {
      const status = statusRef.current?.get(node.id) ?? "unknown";
      ctx.fillStyle = STATUS_COLORS[status];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();

      // Label relays once they are large enough or zoomed in
      if (r * scale > 8) {
        ctx.font = `${12 / scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#a3a3a3";
        ctx.fillText(short(node.id), x, y + r + 12 / scale);
      }
    }

    ctx.globalAlpha = 1;
  }, []);

  const paintPointerArea = useCallback((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node), 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback((link: GraphLink) => {
    const ids = neighborsRef.current;
    if (!ids) return "rgba(127,127,127,0.2)";
    const source = typeof link.source === "string" ? link.source : link.source.id;
    const target = typeof link.target === "string" ? link.target : link.target.id;
    return ids.has(source) && ids.has(target) ? "rgba(127,127,127,0.8)" : "rgba(127,127,127,0.05)";
  }, []);

  const relayCount = graph?.nodes.filter((n) => n.kind === "relay").length ?? 0;
  const userCount = (graph?.nodes.length ?? 0) - relayCount;

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-col gap-2 border-b border-base-300 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-64 flex-1">
            <PubkeyPicker value={selectedPubkey} onChange={setSelectedPubkey} />
          </div>
          <RelayPicker value={relay} onChange={setRelay} />
          {monitors && <MonitorPicker monitors={monitors} onChange={setSelectedMonitor} value={selectedMonitor} />}
        </div>

        <div className="flex flex-wrap gap-x-4 text-sm text-base-content/70">
          {graph && (
            <span>
              {userCount} of {graph.contacts} contacts · {relayCount} outbox relays · {graph.links.length} links
            </span>
          )}
          <span style={{ color: STATUS_COLORS.online }}>online</span>
          <span style={{ color: STATUS_COLORS.offline }}>offline</span>
          <span style={{ color: STATUS_COLORS.unknown }}>unknown</span>
          {!monitor && <span>Select a monitor to color relays by status</span>}
        </div>
      </div>

      <div ref={measure} className="relative min-h-0 flex-1 overflow-hidden">
        {graph && graph.nodes.length > 0 ? (
          <ForceGraph2D<GraphNode, GraphLink>
            ref={tune as never}
            graphData={graph}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintPointerArea}
            nodeLabel={(n) => (n.kind === "user" ? n.name : `${n.id} (${n.users} users)`)}
            linkColor={linkColor}
            onNodeHover={setHovered}
            cooldownTime={15_000}
          />
        ) : (
          <p className="p-4 text-base-content/60">
            {!selectedPubkey
              ? "Pick a user to graph their contacts' outbox relays"
              : graph?.contacts === 0
                ? "This user has no contacts"
                : "Loading contacts and their outbox relays..."}
          </p>
        )}
      </div>
    </div>
  );
}
