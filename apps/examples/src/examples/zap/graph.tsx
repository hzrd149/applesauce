/**
 * Visualize zap (Lightning payment) relationships as a graph
 * @tags nip-57, zap, graph, lightning, visualization, chart.js, react-chartjs-2
 * @related zap/timeline
 */
import { getZapAmount, getZapRecipient, isValidZap } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LogarithmicScale,
  Title,
  Tooltip,
} from "chart.js";
import { Filter, kinds, NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { EMPTY } from "rxjs";

import { normalizeToPubkey } from "applesauce-core/helpers";
import RelayPicker from "../../components/relay-picker";

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend);

// Setup stores and pool
const eventStore = new EventStore();
const pool = new RelayPool();

type ChartMode = "amount" | "count";
type ScaleType = "linear" | "logarithmic";

function prepareChartData(events: NostrEvent[], userPubkey: string, mode: ChartMode) {
  // Filter valid zap events and get their amounts
  const zaps = events
    .filter(isValidZap)
    .map((event) => {
      try {
        const amount = getZapAmount(event);

        return {
          timestamp: event.created_at,
          amount: Math.round(amount / 1000), // Convert msats to sats or use 1 for counting
          isIncoming: getZapRecipient(event) === userPubkey,
        };
      } catch (error) {
        return null;
      }
    })
    .filter((zap) => zap !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Group by day for better visualization
  const dailyZaps = zaps.reduce<Record<string, { incoming: number; outgoing: number }>>((acc, zap) => {
    const date = new Date(zap.timestamp * 1000).toLocaleDateString();
    if (!acc[date]) acc[date] = { incoming: 0, outgoing: 0 };

    if (zap.isIncoming) acc[date].incoming += mode === "amount" ? zap.amount : 1;
    else acc[date].outgoing += mode === "amount" ? zap.amount : 1;

    return acc;
  }, {});

  return {
    labels: Object.keys(dailyZaps),
    datasets: [
      {
        label: `Incoming Zaps (${mode === "amount" ? "sats" : "count"})`,
        data: Object.values(dailyZaps).map((d) => d.incoming),
        backgroundColor: "rgba(75, 192, 192, 0.5)",
        borderColor: "rgba(75, 192, 192, 1)",
        borderWidth: 1,
      },
      {
        label: `Outgoing Zaps (${mode === "amount" ? "sats" : "count"})`,
        data: Object.values(dailyZaps).map((d) => d.outgoing),
        backgroundColor: "rgba(255, 99, 132, 0.5)",
        borderColor: "rgba(255, 99, 132, 1)",
        borderWidth: 1,
      },
    ],
  };
}

export default function ZapGraph() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");
  const [pubkey, setPubkey] = useState<string>("5c508c34f58866ec7341aaf10cc1af52e9232bb9f859c8103ca5ecf2aa93bf78");
  const [loading, setLoading] = useState(false);
  const [limit] = useState(50);
  const [chartMode, setChartMode] = useState<ChartMode>("amount");
  const [scaleType, setScaleType] = useState<ScaleType>("linear");

  const filters = useMemo<Filter[] | null>(() => {
    if (!pubkey) return null;

    return [
      { kinds: [kinds.Zap], "#p": [pubkey], limit }, // Incoming zaps
      { kinds: [kinds.Zap], "#P": [pubkey], limit }, // Outgoing zaps
    ];
  }, [pubkey, limit]);

  const loader = useMemo(() => {
    if (!filters) return null;
    return createTimelineLoader(pool, [relay], filters, { eventStore });
  }, [relay, filters]);

  const events = use$(() => (filters ? eventStore.timeline(filters) : EMPTY), [filters]);

  const loadMore = useCallback(() => {
    if (!loader) return;

    setLoading(true);
    loader().subscribe({ complete: () => setLoading(false) });
  }, [loader]);

  // Load initial data when relay or pubkey changes
  useEffect(() => {
    if (loader) loadMore();
  }, [loader]);

  const chartData = useMemo(() => {
    if (!pubkey || !events || events.length === 0) return null;
    return prepareChartData(events, pubkey, chartMode);
  }, [events, pubkey, chartMode]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        legend: { position: "top" as const },
        title: { text: `Zap Activity Over Time (${chartMode === "amount" ? "Amount" : "Count"})` },
      },
      scales: {
        y: {
          type: scaleType,
          min: 1,
          title: { text: chartMode === "amount" ? "Amount (sats)" : "Number of Zaps" },
        },
        x: { title: { text: "Date" } },
      },
    }),
    [chartMode, scaleType],
  );

  return (
    <div className="container mx-auto my-8 p-4">
      <div className="flex gap-4 mb-6">
        <RelayPicker value={relay} onChange={setRelay} />
        <form
          className="flex gap-4 w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const value = formData.get("pubkey") as string;

            try {
              // Only update if we can normalize to a valid pubkey
              const pubkey = normalizeToPubkey(value);
              if (!pubkey) throw new Error("Invalid pubkey");
              setPubkey(pubkey);
            } catch (error) {
              // Optionally, you could show an error message here
              console.error("Invalid pubkey or nostr identifier");
            }
          }}
        >
          <input
            type="text"
            name="pubkey"
            placeholder="Enter hex pubkey or nostr identifier (npub/nprofile)"
            className="input input-bordered flex-1"
            defaultValue={npubEncode(pubkey)} // Use defaultValue instead of value for uncontrolled input
          />
          <button type="submit" className="btn btn-primary">
            Set
          </button>
        </form>
      </div>

      {pubkey ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 justify-end">
            <div className="join">
              <button
                className={`btn join-item ${chartMode === "amount" ? "btn-active" : ""}`}
                onClick={() => setChartMode("amount")}
              >
                Amount
              </button>
              <button
                className={`btn join-item ${chartMode === "count" ? "btn-active" : ""}`}
                onClick={() => setChartMode("count")}
              >
                Count
              </button>
            </div>
            <div className="join">
              <button
                className={`btn join-item ${scaleType === "linear" ? "btn-active" : ""}`}
                onClick={() => setScaleType("linear")}
              >
                Linear
              </button>
              <button
                className={`btn join-item ${scaleType === "logarithmic" ? "btn-active" : ""}`}
                onClick={() => setScaleType("logarithmic")}
              >
                Log
              </button>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              {chartData ? (
                <Bar data={chartData} options={chartOptions} />
              ) : (
                <div className="text-center">No zap data available</div>
              )}
            </div>
          </div>

          <div className="flex justify-center">
            {loading ? (
              <span className="loading loading-dots loading-xl"></span>
            ) : (
              <button className="btn btn-primary" onClick={loadMore}>
                Load more
              </button>
            )}
          </div>

          <div className="text-center text-sm text-gray-500">Loaded {events?.length ?? 0} events</div>
        </div>
      ) : (
        <div className="alert alert-info">Please enter a pubkey to view zap activity</div>
      )}
    </div>
  );
}
