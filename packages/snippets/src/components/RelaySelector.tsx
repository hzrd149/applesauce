interface RelaySelectorProps {
  relays: string[];
  selectedRelay: string;
  onRelayChange: (relay: string) => void;
}

export default function RelaySelector({ relays, selectedRelay, onRelayChange }: RelaySelectorProps) {
  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text">Select Relay</span>
      </label>
      <select
        className="select select-bordered w-full max-w-xs"
        value={selectedRelay}
        onChange={(e) => onRelayChange(e.target.value)}
      >
        {relays.map((relay) => (
          <option key={relay} value={relay}>
            {relay.split("/")[2]}
          </option>
        ))}
      </select>
    </div>
  );
}
