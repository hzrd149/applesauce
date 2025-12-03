import { relaySet } from "applesauce-core/helpers";
import { ChangeEvent, useMemo, useState } from "react";

// Common relay URLs that users might want to use
export const COMMON_RELAYS = relaySet([
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nostr.wine",
  "wss://nostr-pub.wellorder.net/",
]);

function RelayPickerModal({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (relay: string) => void;
}) {
  const [customRelayUrl, setCustomRelayUrl] = useState("");

  const handleCustomRelaySubmit = () => {
    if (customRelayUrl) {
      onSelect(customRelayUrl);
      setCustomRelayUrl("");
    }
  };

  return (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box">
        <h3 className="font-bold text-lg mb-4">Custom Relay</h3>

        <div className="form-control">
          <label className="label">
            <span className="label-text">Custom Relay URL</span>
          </label>
          <div className="join w-full mb-4">
            <input
              type="text"
              placeholder="wss://your-relay.com"
              className="input input-bordered join-item flex-1"
              value={customRelayUrl}
              onChange={(e) => setCustomRelayUrl(e.target.value)}
            />
            <button className="btn btn-primary join-item" onClick={handleCustomRelaySubmit} disabled={!customRelayUrl}>
              Set
            </button>
          </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}

export default function RelayPicker({
  value,
  onChange,
  common = COMMON_RELAYS,
  className,
}: {
  value: string;
  onChange: (relay: string) => void;
  common?: string[];
  className?: string;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allRelayOptions = useMemo(() => {
    if (!value || common.includes(value)) return common;
    else return [value, ...(common || [])];
  }, [value, common]);

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  const handleModalSelect = (relay: string) => {
    onChange(relay);
    setIsModalOpen(false);
  };

  return (
    <>
      <div className={`join ${className}`}>
        <select className="select select-bordered join-item" value={value} onChange={handleSelectChange}>
          <option value="" disabled>
            Select a relay
          </option>
          {allRelayOptions.map((relay) => (
            <option key={relay} value={relay}>
              {relay}
            </option>
          ))}
        </select>
        <button className="btn join-item" onClick={() => setIsModalOpen(true)}>
          Custom
        </button>
      </div>

      <RelayPickerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSelect={handleModalSelect} />
    </>
  );
}
