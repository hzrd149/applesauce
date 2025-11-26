import { normalizeURL } from "nostr-tools/utils";
import { useState } from "react";

// Component for relay add form
export default function RelayAddForm({ onSubmit }: { onSubmit: (relay: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const handleAddRelay = (e: React.FormEvent) => {
    e.preventDefault();
    let relay = url.trim();

    if (!relay) return setError("Please enter a relay URL");

    // Basic URL validation
    if (!relay.startsWith("wss://") && !relay.startsWith("ws://")) relay = `wss://${relay}`;

    // Add relay to the BehaviorSubject
    onSubmit(normalizeURL(relay));
    setUrl("");
    setError("");
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
            setUrl(e.target.value);
            setError("");
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
