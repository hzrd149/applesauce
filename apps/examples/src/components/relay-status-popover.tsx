import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";

interface RelayStatusModalProps {
  pool: RelayPool;
  isOpen: boolean;
  onClose: () => void;
}

export function RelayStatusModal({ pool, isOpen, onClose }: RelayStatusModalProps) {
  const statuses = use$(pool.status$);

  const statusArray = Object.values(statuses || {});
  const totalRelays = statusArray.length;
  const connectedCount = statusArray.filter((s) => s.connected).length;
  const readyCount = statusArray.filter((s) => s.ready).length;
  const authenticatedCount = statusArray.filter((s) => s.authenticated).length;

  const getStatusIcon = (status: { connected: boolean; ready: boolean }) => {
    if (!status.connected) return "🔴"; // Disconnected
    if (!status.ready) return "🟡"; // Connected but not ready
    return "🟢"; // Ready
  };

  const getStatusText = (status: { connected: boolean; ready: boolean; authenticated: boolean }) => {
    if (!status.connected) return "Disconnected";
    if (!status.ready) return "Reconnecting";
    if (status.authenticated) return "Authenticated";
    return "Connected";
  };

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <form method="dialog">
          <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={onClose}>
            ✕
          </button>
        </form>

        <h3 className="font-bold text-lg mb-4">Relay Pool Status</h3>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-title text-xs">Total</div>
            <div className="stat-value text-3xl">{totalRelays}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-title text-xs">Ready</div>
            <div className="stat-value text-3xl text-success">{readyCount}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-title text-xs">Connected</div>
            <div className="stat-value text-3xl text-info">{connectedCount}</div>
          </div>
        </div>

        {/* Relay List */}
        <div className="divider my-4">Relays</div>
        <div className="max-h-96 overflow-y-auto space-y-2">
          {statusArray.length === 0 ? (
            <div className="text-center py-8 text-base-content/60">No relays in pool</div>
          ) : (
            statusArray.map((status) => (
              <div
                key={status.url}
                className="flex items-center gap-3 p-3 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
              >
                <div className="text-2xl" title={getStatusText(status)}>
                  {getStatusIcon(status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate font-mono">
                    {status.url.replace("wss://", "").replace("ws://", "")}
                  </div>
                  <div className="text-xs text-base-content/60">{getStatusText(status)}</div>
                </div>
                <div className="flex gap-1">
                  {status.connected && (
                    <div className="badge badge-xs badge-success" title="WebSocket connected">
                      WS
                    </div>
                  )}
                  {status.ready && (
                    <div className="badge badge-xs badge-primary" title="Ready for operations">
                      RDY
                    </div>
                  )}
                  {status.authenticated && (
                    <div className="badge badge-xs badge-secondary" title="Authenticated (NIP-42)">
                      AUTH
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {authenticatedCount > 0 && (
          <div className="mt-4 text-xs text-base-content/60 text-center">
            {authenticatedCount} relay{authenticatedCount !== 1 ? "s" : ""} authenticated
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
}

export function RelayStatusPopover({ pool }: { pool: RelayPool }) {
  const [isOpen, setIsOpen] = useState(false);
  const statuses = use$(pool.status$);

  const statusArray = Object.values(statuses || {});
  const totalRelays = statusArray.length;
  const connectedCount = statusArray.filter((s) => s.connected).length;
  const readyCount = statusArray.filter((s) => s.ready).length;
  const authenticatedCount = statusArray.filter((s) => s.authenticated).length;

  const getStatusIcon = (status: { connected: boolean; ready: boolean }) => {
    if (!status.connected) return "🔴"; // Disconnected
    if (!status.ready) return "🟡"; // Connected but not ready
    return "🟢"; // Ready
  };

  const getStatusText = (status: { connected: boolean; ready: boolean; authenticated: boolean }) => {
    if (!status.connected) return "Disconnected";
    if (!status.ready) return "Reconnecting";
    if (status.authenticated) return "Authenticated";
    return "Connected";
  };

  return (
    <div className="dropdown dropdown-end">
      {/* Trigger Button */}
      <div tabIndex={0} role="button" className="btn btn-sm btn-ghost gap-2" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex items-center gap-1">
          <span className="text-xs">Status:</span>
          <div className="badge badge-sm badge-primary">
            {readyCount}/{totalRelays}
          </div>
        </div>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      {/* Dropdown Content */}
      {isOpen && (
        <div
          tabIndex={0}
          className="dropdown-content z-[1] card card-compact w-96 p-4 shadow bg-base-100 border border-base-300 mt-2"
        >
          <div className="card-body">
            <h3 className="card-title text-base">Relay Pool Status</h3>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="stat bg-base-200 rounded-lg p-3">
                <div className="stat-title text-xs">Total</div>
                <div className="stat-value text-2xl">{totalRelays}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg p-3">
                <div className="stat-title text-xs">Ready</div>
                <div className="stat-value text-2xl text-success">{readyCount}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg p-3">
                <div className="stat-title text-xs">Connected</div>
                <div className="stat-value text-2xl text-info">{connectedCount}</div>
              </div>
            </div>

            {/* Relay List */}
            <div className="divider my-2">Relays</div>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {statusArray.length === 0 ? (
                <div className="text-center py-4 text-base-content/60">No relays in pool</div>
              ) : (
                statusArray.map((status) => (
                  <div
                    key={status.url}
                    className="flex items-center gap-2 p-2 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <div className="text-lg" title={getStatusText(status)}>
                      {getStatusIcon(status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {status.url.replace("wss://", "").replace("ws://", "")}
                      </div>
                      <div className="text-xs text-base-content/60">{getStatusText(status)}</div>
                    </div>
                    <div className="flex gap-1">
                      {status.connected && (
                        <div className="badge badge-xs badge-success" title="WebSocket connected">
                          WS
                        </div>
                      )}
                      {status.ready && (
                        <div className="badge badge-xs badge-primary" title="Ready for operations">
                          RDY
                        </div>
                      )}
                      {status.authenticated && (
                        <div className="badge badge-xs badge-secondary" title="Authenticated (NIP-42)">
                          AUTH
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="divider my-2"></div>
            <div className="text-xs text-base-content/60 text-center">
              {authenticatedCount > 0 && (
                <div>
                  {authenticatedCount} relay{authenticatedCount !== 1 ? "s" : ""} authenticated
                </div>
              )}
              <div className="mt-1">Click outside to close</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
