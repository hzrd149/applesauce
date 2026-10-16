import { RelayDiscovery } from "applesauce-common/casts";
import { getOrComputeCachedValue, normalizeURL, type NostrEvent } from "applesauce-core/helpers";

/** The relay properties the directory can be filtered by */
export type Facet =
  "network" | "software" | "country" | "host" | "requirement" | "nip" | "type" | "topic" | "attribute";

/** Facets in display order. "any" matches a relay with one of the picked values, "all" needs every picked value */
export const FACETS: { key: Facet; label: string; match: "any" | "all" }[] = [
  { key: "network", label: "Network", match: "any" },
  { key: "requirement", label: "Requirements", match: "all" },
  { key: "nip", label: "Supported NIPs", match: "all" },
  { key: "software", label: "Software", match: "any" },
  { key: "country", label: "Country", match: "any" },
  { key: "host", label: "Host", match: "any" },
  { key: "type", label: "Relay type", match: "all" },
  { key: "topic", label: "Topics", match: "all" },
  { key: "attribute", label: "Attributes", match: "all" },
];

/** A relay merged from the latest report of every monitor that checked it */
export type RelaySummary = {
  url: string;
  name?: string;
  description?: string;
  monitors: Set<string>;
  lastSeen: number;
  rttOpen?: number;
  rttRead?: number;
  rttWrite?: number;
} & Record<Facet, Set<string>>;

export type FacetFilters = Partial<Record<Facet, string[]>>;
export type SortKey = "url" | "rttOpen" | "rttRead" | "rttWrite" | "nips" | "monitors" | "lastSeen";

type Info = { name?: string; description?: string };
const InfoSymbol = Symbol("relay-directory-info");

/** Parses the optional NIP-11 document monitors put in the report content */
function getInfo(event: NostrEvent): Info {
  return getOrComputeCachedValue(event, InfoSymbol, () => {
    try {
      const info = JSON.parse(event.content);
      return { name: info?.name || undefined, description: info?.description || undefined };
    } catch {
      return {};
    }
  });
}

/** Gets the first value of a NIP-32 label, nostr.watch puts geo and host data in labels */
function getLabel(event: NostrEvent, namespace: string) {
  return event.tags.find((t) => t[0] === "l" && t[2] === namespace)?.[1];
}

/** Shortens a software URL like git+https://github.com/hoytech/strfry.git to strfry */
function softwareName(software: string) {
  return (
    software
      .replace(/\.git$/, "")
      .replace(/\/$/, "")
      .split("/")
      .pop()
      ?.toLowerCase() || software
  );
}

// Monitors don't all format the d tag the same way, non-URL relays are identified by a pubkey
function relayKey(url: string) {
  try {
    return normalizeURL(url);
  } catch {
    return url;
  }
}

function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Merges the latest report from each monitor into one summary per relay */
export function aggregateRelays(reports: RelayDiscovery[]): RelaySummary[] {
  const relays = new Map<string, RelaySummary & { rtts: [number[], number[], number[]] }>();

  for (const report of reports) {
    if (!report.url) continue;
    const url = relayKey(report.url);
    const event = report.event;

    let relay = relays.get(url);
    if (!relay) {
      relay = { url, monitors: new Set(), lastSeen: 0, rtts: [[], [], []] } as any;
      for (const { key } of FACETS) relay![key] = new Set();
      relays.set(url, relay!);
    }
    const r = relay!;

    // The newest report wins for the NIP-11 name and description
    if (event.created_at >= r.lastSeen) Object.assign(r, getInfo(event));
    r.monitors.add(event.pubkey);
    r.lastSeen = Math.max(r.lastSeen, event.created_at);

    if (report.networkType) r.network.add(report.networkType);
    for (const value of report.requirements) r.requirement.add(value);
    for (const value of report.supportedNIPs) r.nip.add(value);
    for (const value of report.types) r.type.add(value);
    for (const value of report.topics) r.topic.add(value);
    for (const value of report.attributes) r.attribute.add(value);

    // Not part of NIP-66, but published by nostr.watch monitors
    const software = event.tags.find((t) => t[0] === "s")?.[1];
    if (software) r.software.add(softwareName(software));
    const country = getLabel(event, "countryName") ?? getLabel(event, "countryCode");
    if (country) r.country.add(country);
    const host = getLabel(event, "host.isp");
    if (host) r.host.add(host);

    if (report.rttOpen !== undefined) r.rtts[0].push(report.rttOpen);
    if (report.rttRead !== undefined) r.rtts[1].push(report.rttRead);
    if (report.rttWrite !== undefined) r.rtts[2].push(report.rttWrite);
  }

  return Array.from(relays.values(), ({ rtts, ...relay }) => ({
    ...relay,
    rttOpen: median(rtts[0]),
    rttRead: median(rtts[1]),
    rttWrite: median(rtts[2]),
  }));
}

/** Checks a relay against the picked facet values, optionally ignoring one facet */
export function matchesFacets(relay: RelaySummary, filters: FacetFilters, ignore?: Facet) {
  return FACETS.every(({ key, match }) => {
    const picked = filters[key];
    if (key === ignore || !picked?.length) return true;
    return match === "any" ? picked.some((v) => relay[key].has(v)) : picked.every((v) => relay[key].has(v));
  });
}

/** Counts how many relays have each value of a facet, sorted by count */
export function countFacet(relays: RelaySummary[], facet: Facet): [string, number][] {
  const counts = new Map<string, number>();
  for (const relay of relays) for (const value of relay[facet]) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
}

const sortValue = (relay: RelaySummary, key: SortKey) =>
  key === "nips" ? relay.nip.size : key === "monitors" ? relay.monitors.size : relay[key];

/** Compares two relays by a column, relays missing the value always sort last */
export function compareRelays(a: RelaySummary, b: RelaySummary, key: SortKey, dir: 1 | -1) {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x === undefined) return y === undefined ? 0 : 1;
  if (y === undefined) return -1;
  return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * dir;
}

/** Shows `!auth` style negated values as `no auth` */
export const facetLabel = (value: string) => (value.startsWith("!") ? `no ${value.slice(1)}` : value);
