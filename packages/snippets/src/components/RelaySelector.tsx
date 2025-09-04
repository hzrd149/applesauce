import { useState } from "react";

interface RelaySelectorProps {
  relays: string[];
  onAddRelay: (relay: string) => void;
  onRemoveRelay: (relay: string) => void;
}

export default function RelaySelector({ relays, onAddRelay, onRemoveRelay }: RelaySelectorProps) {
  const [newRelayInput, setNewRelayInput] = useState("");

  const handleAddRelay = () => {
    if (newRelayInput.trim()) {
      onAddRelay(newRelayInput);
      setNewRelayInput("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddRelay();
    }
  };

  const formatRelayName = (relay: string) => {
    try {
      return new URL(relay).hostname;
    } catch {
      return relay.split("/")[2] || relay;
    }
  };

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-outline">
        <span className="hidden sm:inline">Relays:</span>
        <span className="text-sm">{relays.length}</span>
        <svg className="fill-current" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
          <path d="m7,10l5,5l5,-5z" />
        </svg>
      </div>
      <div tabIndex={0} className="dropdown-content z-[1] shadow bg-base-100 w-80">
        <div>
          <h3 className="font-semibold text-sm mb-2 px-2 py-1">Manage Relays</h3>

          {/* Relay List */}
          <div className="max-h-48 overflow-y-auto">
            {relays.map((relay) => (
              <div key={relay} className="flex items-center justify-between px-2 py-2 hover:bg-base-200">
                <div className="avatar">
                  <div className="w-6 h-6 rounded-full mr-2">
                    <img
                      src={new URL(
                        "/favicon.ico",
                        relay.replace("wss://", "https://").replace("ws://", "http://"),
                      ).toString()}
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">{formatRelayName(relay)}</div>
                  <div className="text-xs opacity-60 truncate">{relay}</div>
                </div>
                {relays.length > 1 && (
                  <button
                    className="btn btn-ghost btn-xs text-error hover:bg-error/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRelay(relay);
                    }}
                    title="Remove relay"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add New Relay */}
          <div className="px-2 py-2 bg-base-200/50">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="wss://relay.example.com"
                className="input input-sm flex-1 font-mono text-xs bg-transparent border-0 focus:border-0 focus:outline-0"
                value={newRelayInput}
                onChange={(e) => setNewRelayInput(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button className="btn btn-sm btn-primary" onClick={handleAddRelay} disabled={!newRelayInput.trim()}>
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
