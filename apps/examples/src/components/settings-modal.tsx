import { use$ } from "applesauce-react/hooks";
import { useState } from "react";
import { createPortal } from "react-dom";
import { relayTrust$, resetRelayTrust } from "../extra/verifier";
import { DEFAULT_LOOKUP_RELAYS, lookupRelays$ } from "../settings";
import RelayAddForm from "./add-relay-form";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A bar per relay showing its signature trust and the chance a new signature is still checked */
function RelayTrustGraph() {
  const relays = use$(relayTrust$);
  const sorted = [...(relays ?? [])].sort((a, b) => b.trust - a.trust);
  const [resetting, setResetting] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-semibold">Relay trust</h4>
        <button
          className="btn btn-sm btn-ghost text-error"
          disabled={resetting || sorted.length === 0}
          onClick={() => {
            setResetting(true);
            resetRelayTrust();
          }}
        >
          Reset all
        </button>
      </div>
      <p className="text-sm text-base-content/70 mb-3">
        Signatures from trusted relays are only spot checked. Hover a bar to see how often they are still checked.
      </p>

      <ul className="border border-base-300 rounded-box divide-y divide-base-300 max-h-64 overflow-y-auto">
        {sorted.map((r) => (
          <li
            key={r.relay}
            className="grid grid-cols-[minmax(0,1fr)_6rem_3rem] items-center gap-3 px-3 py-2"
            title={`${r.verified} verified, checks ${pct(r.verificationProbability)} of new signatures`}
          >
            <span className="font-mono text-sm truncate">{r.relay}</span>
            <div className="h-3 border border-base-300">
              <div className="h-full bg-success" style={{ width: pct(r.trust) }} />
            </div>
            <span className="text-sm tabular-nums text-right">{pct(r.trust)}</span>
          </li>
        ))}
        {sorted.length === 0 && <li className="px-3 py-2 text-sm text-base-content/50">No relays seen yet</li>}
      </ul>
    </>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const lookupRelays = use$(lookupRelays$);

  const addRelay = (relay: string) => {
    if (!lookupRelays$.value.includes(relay)) lookupRelays$.next([...lookupRelays$.value, relay]);
  };
  const removeRelay = (relay: string) => lookupRelays$.next(lookupRelays$.value.filter((r) => r !== relay));

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={onClose}>
          ✕
        </button>
        <h3 className="font-bold text-lg mb-4">Settings</h3>

        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold">Lookup relays</h4>
          <button className="btn btn-xs btn-ghost" onClick={() => lookupRelays$.next(DEFAULT_LOOKUP_RELAYS)}>
            Reset
          </button>
        </div>
        <p className="text-sm text-base-content/70 mb-3">Used by all examples to find profiles and relay lists.</p>

        <ul className="border border-base-300 rounded-box divide-y divide-base-300 mb-3">
          {lookupRelays?.map((relay) => (
            <li key={relay} className="flex items-center justify-between px-3 py-2">
              <span className="font-mono text-sm truncate">{relay}</span>
              <button className="btn btn-xs btn-ghost text-error" onClick={() => removeRelay(relay)}>
                Remove
              </button>
            </li>
          ))}
          {lookupRelays?.length === 0 && <li className="px-3 py-2 text-sm text-base-content/50">No lookup relays</li>}
        </ul>

        <RelayAddForm onSubmit={addRelay} />

        <div className="divider" />
        <RelayTrustGraph />
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
}

/** A button that opens the general settings modal */
export default function SettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="btn btn-square btn-ghost flex-none" title="Settings" onClick={() => setOpen(true)}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
          className="w-5 h-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      </button>
      {open && createPortal(<SettingsModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
