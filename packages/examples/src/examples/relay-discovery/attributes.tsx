import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  Filter,
  getRelayDiscoveryAttributes,
  getRelayDiscoveryURL,
  isValidRelayDiscovery,
  RELAY_DISCOVERY_KIND,
} from "applesauce-core/helpers";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { BubbleController, Chart as ChartJS, LinearScale, PointElement, Title, Tooltip } from "chart.js";
import { NostrEvent } from "nostr-tools";
import { useMemo, useState } from "react";
import { Bubble } from "react-chartjs-2";
import { useThrottle } from "react-use";
import { of } from "rxjs";

import RelayPicker from "../../components/relay-picker";

// Register ChartJS components
ChartJS.register(BubbleController, PointElement, LinearScale, Title, Tooltip);

// Create stores and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

interface AttributeData {
  attribute: string;
  relayCount: number;
}

interface BubbleDataPoint {
  x: number;
  y: number;
  r: number;
  label: string;
}

/**
 * Counts the number of unique relays that have each attribute
 */
function countRelaysPerAttribute(events: NostrEvent[]): AttributeData[] {
  // Map of relay URL -> set of attributes
  const relayAttributes = new Map<string, Set<string>>();

  // Process each event
  for (const event of events) {
    if (!isValidRelayDiscovery(event)) continue;

    const relayUrl = getRelayDiscoveryURL(event);
    if (!relayUrl) continue;

    const attributes = getRelayDiscoveryAttributes(event);
    if (attributes.length === 0) continue;

    // Get or create the set of attributes for this relay
    if (!relayAttributes.has(relayUrl)) {
      relayAttributes.set(relayUrl, new Set());
    }

    // Add all attributes for this relay
    const attributeSet = relayAttributes.get(relayUrl)!;
    for (const attr of attributes) {
      attributeSet.add(attr);
    }
  }

  // Count how many relays have each attribute
  const attributeCounts = new Map<string, number>();

  for (const [_, attributes] of relayAttributes.entries()) {
    for (const attr of attributes) {
      attributeCounts.set(attr, (attributeCounts.get(attr) || 0) + 1);
    }
  }

  // Convert to array and sort by count (descending)
  return Array.from(attributeCounts.entries())
    .map(([attribute, relayCount]) => ({ attribute, relayCount }))
    .sort((a, b) => b.relayCount - a.relayCount);
}

/**
 * Converts attribute data to bubble chart format
 */
function prepareBubbleChartData(attributeData: AttributeData[]): BubbleDataPoint[] {
  if (attributeData.length === 0) return [];

  const maxCount = Math.max(...attributeData.map((d) => d.relayCount));
  const minRadius = 10;
  const maxRadius = 50;

  // Use a simple grid layout for positioning
  const cols = Math.ceil(Math.sqrt(attributeData.length));
  const spacing = 100;

  return attributeData.map((data, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const normalizedCount = data.relayCount / maxCount;
    const radius = minRadius + (maxRadius - minRadius) * normalizedCount;

    return {
      x: col * spacing + spacing / 2,
      y: row * spacing + spacing / 2,
      r: radius,
      label: data.attribute,
    };
  });
}

export default function RelayDiscoveryAttributes() {
  const [relayUrl, setRelayUrl] = useState<string>("wss://relay.nostr.watch/");
  const [attributeInput, setAttributeInput] = useState<string>("");

  // Get relay instance and check NIP-91 support
  const relay = useMemo(() => (relayUrl ? pool.relay(relayUrl) : null), [relayUrl]);
  const supportedNips = useObservableMemo(() => relay?.supported$ ?? of(null), [relay]);
  const supportsNip91 = supportedNips?.includes(91) ?? false;

  // Parse attributes from input (split by space/comma and filter empty)
  const attributeFilters = useMemo(() => {
    return attributeInput
      .split(/[\s,]+/)
      .map((a) => a)
      .filter((a) => a.length > 0);
  }, [attributeInput]);

  const attributes = useThrottle(attributeFilters, 1000);

  // Create filter for relay subscription
  const relayFilter: Filter = useMemo(() => {
    const base: Filter = {
      kinds: [RELAY_DISCOVERY_KIND],
      limit: 1000, // Load many events to get comprehensive data
    };

    if (attributes.length > 0) {
      if (supportsNip91) {
        base["&W"] = attributes;
      } else {
        // fallback to OR filtering
        base["#W"] = attributes;
      }
    }

    return base;
  }, [attributes, supportsNip91, relay]);

  // Subscribe to events from relay
  useObservableMemo(
    () => (relay ? relay.subscription(relayFilter).pipe(onlyEvents(), mapEventsToStore(eventStore)) : undefined),
    [relay, relayFilter],
  );

  // Get events from the event store so & tags always work
  const events = useObservableMemo(
    () =>
      eventStore.timeline(
        attributes.length > 0
          ? {
              kinds: [RELAY_DISCOVERY_KIND],
              "&W": attributes,
            }
          : {
              kinds: [RELAY_DISCOVERY_KIND],
            },
      ),
    [attributes],
  );

  // Count relays per attribute
  const attributeData = useMemo(() => {
    if (!events || events.length === 0) return [];
    return countRelaysPerAttribute(events);
  }, [events]);

  // Get all unique attributes for buttons
  const allAttributes = useMemo(() => {
    if (!events || events.length === 0) return [];
    const attributeSet = new Set<string>();
    for (const event of events) {
      if (!isValidRelayDiscovery(event)) continue;
      const attrs = getRelayDiscoveryAttributes(event);
      for (const attr of attrs) attributeSet.add(attr);
    }
    return Array.from(attributeSet).sort();
  }, [events]);

  // Prepare bubble chart data
  const bubbleData = useMemo(() => {
    const points = prepareBubbleChartData(attributeData);
    if (points.length === 0) return null;

    return {
      datasets: [
        {
          label: "Relay Attributes",
          data: points,
          backgroundColor: "rgba(54, 162, 235, 0.5)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [attributeData]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Relay Attributes (bubble size = number of relays)",
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const point = context.raw as BubbleDataPoint;
              return `${point.label}: ${attributeData.find((d) => d.attribute === point.label)?.relayCount || 0} relays`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: "",
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "",
          },
        },
      },
    }),
    [attributeData],
  );

  // Count total unique relays
  const totalRelays = useMemo(() => {
    if (!events || events.length === 0) return 0;
    const relaySet = new Set<string>();
    for (const event of events) {
      if (!isValidRelayDiscovery(event)) continue;
      const relayUrl = getRelayDiscoveryURL(event);
      if (relayUrl) relaySet.add(relayUrl);
    }
    return relaySet.size;
  }, [events]);

  // Handle attribute button click - add to input
  const handleAttributeClick = (attribute: string) => {
    if (!attributeInput.includes(attribute)) {
      setAttributeInput((prev) => (prev.trim() ? `${prev.trim()} ${attribute}` : attribute));
    }
  };

  return (
    <div className="container mx-auto p-2 h-full">
      <div className="flex gap-2 justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Relay Discovery Attributes</h1>
        <RelayPicker value={relayUrl} onChange={setRelayUrl} />
      </div>

      {/* Warning if relay doesn't support NIP-91 */}
      {relayUrl && !supportsNip91 && supportedNips !== null && (
        <div className="alert alert-warning mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            This relay does not support NIP-91 (AND tag filters). Multiple attribute filtering may not work as expected.
          </span>
        </div>
      )}

      {/* Attribute input */}
      <div className="mb-4">
        <label className="label">
          <span className="label-text">Filter by attributes (space or comma separated)</span>
        </label>
        <input
          type="text"
          placeholder="attribute1 attribute2"
          className="input input-bordered w-full"
          value={attributeInput}
          onChange={(e) => setAttributeInput(e.target.value)}
        />
        {attributeFilters.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {attributeFilters.map((attr) => (
              <span key={attr} className="badge badge-primary">
                {attr}
                <button
                  className="ml-1 hover:font-bold"
                  onClick={() => {
                    const newFilters = attributeFilters.filter((a) => a !== attr);
                    setAttributeInput(newFilters.join(" "));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Attribute buttons */}
      {allAttributes.length > 0 && (
        <div className="mb-4">
          <label className="label">
            <span className="label-text">Available attributes (click to add)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {allAttributes.map((attr) => (
              <button
                key={attr}
                className="btn btn-sm btn-outline"
                onClick={() => handleAttributeClick(attr)}
                disabled={attributeFilters.includes(attr)}
              >
                {attr}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      {relayUrl && (
        <div className="mb-4 text-sm text-base-content/70">
          Loaded {events?.length || 0} events from {totalRelays} unique relay{totalRelays !== 1 ? "s" : ""}
        </div>
      )}

      {/* Bubble chart */}
      {relayUrl ? (
        bubbleData ? (
          <div className="card bg-base-100">
            <div className="card-body">
              <div style={{ height: "600px" }}>
                <Bubble data={bubbleData} options={chartOptions} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-base-content/70 py-8">
            No relay discovery events found. Try selecting a different relay.
          </div>
        )
      ) : (
        <div className="text-center text-base-content/70 py-8">
          Please select a relay to start exploring relay attributes.
        </div>
      )}
    </div>
  );
}
