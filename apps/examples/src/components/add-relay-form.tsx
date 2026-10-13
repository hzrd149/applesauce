import { normalizeURL } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useMemo } from "react";
import { BehaviorSubject } from "rxjs";

// Component for relay add form
export default function RelayAddForm({ onSubmit }: { onSubmit: (relay: string) => void }) {
  const state$ = useMemo(() => new BehaviorSubject({ url: "", error: "" }), []);
  const { url, error } = use$(state$);

  const handleAddRelay = (e: React.FormEvent) => {
    e.preventDefault();
    let relay = url.trim();

    if (!relay) return state$.next({ url, error: "Please enter a relay URL" });

    // Basic URL validation
    if (!relay.startsWith("wss://") && !relay.startsWith("ws://")) relay = `wss://${relay}`;

    // Add relay to the BehaviorSubject
    try {
      onSubmit(normalizeURL(relay));
      state$.next({ url: "", error: "" });
    } catch (error) {
      state$.next({ url, error: error instanceof Error ? error.message : "Invalid relay URL" });
    }
  };

  return (
    <>
      <form onSubmit={handleAddRelay} className="flex gap-2">
        <input
          type="text"
          placeholder="wss://relay.example.com"
          className="input input-bordered flex-1"
          value={url}
          onChange={(e) => {
            state$.next({ url: e.target.value, error: "" });
          }}
        />
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>
      {error && (
        <div className="bg-error/10 border-l-4 border-error p-2">
          <span className="text-error text-sm">{error}</span>
        </div>
      )}
    </>
  );
}
