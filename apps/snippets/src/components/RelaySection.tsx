import { Controller } from "react-hook-form";
import type { Control, FieldArrayWithId, UseFormHandleSubmit } from "react-hook-form";

interface RelaySectionProps {
  isLoggedIn: boolean;
  outboxRelays: string[];
  loadingOutbox: boolean;
  relayFields: FieldArrayWithId<any, "relays", "id">[];
  control: Control<any>;
  onLogin?: () => void;
  appendRelay: (relay: { value: string }) => void;
  removeRelay: (index: number) => void;
  handleSubmit: UseFormHandleSubmit<any>;
  onSubmit: (data: any) => void;
}

export default function RelaySection({
  isLoggedIn,
  outboxRelays,
  loadingOutbox,
  relayFields,
  control,
  onLogin,
  appendRelay,
  removeRelay,
  handleSubmit,
  onSubmit,
}: RelaySectionProps) {
  if (!isLoggedIn) {
    return (
      <div className="bg-base-200 p-3 rounded-lg text-center">
        <p className="text-base opacity-70 mb-2">Activate an account to see your outbox relays</p>
        {onLogin && (
          <button onClick={onLogin} className="btn btn-primary btn-sm" disabled={loadingOutbox}>
            {loadingOutbox ? "Connecting..." : "Login with Extension"}
          </button>
        )}
      </div>
    );
  }

  if (outboxRelays.length > 0) {
    return (
      <div className="bg-base-200 p-3 rounded-lg">
        <p className="opacity-70 mb-2">Your NIP-65 outbox relays:</p>
        {outboxRelays.map((relay, idx) => (
          <div key={idx} className="font-mono opacity-80 py-1 flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
            {relay.replace("wss://", "")}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="opacity-70">No outbox relays found. Add manual relays:</p>
      {relayFields.map((field, index) => (
        <div key={field.id} className="flex gap-1">
          <Controller
            name={`relays.${index}.value`}
            control={control}
            render={({ field: inputField }) => (
              <input
                {...inputField}
                type="url"
                placeholder="wss://relay.example.com"
                className="input input-bordered flex-1 font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // If this is the last field and it has content, add a new one
                    if (index === relayFields.length - 1 && inputField.value.trim()) {
                      appendRelay({ value: "" });
                    } else {
                      // Otherwise submit the form
                      handleSubmit(onSubmit)();
                    }
                  }
                }}
              />
            )}
          />
          {relayFields.length > 1 && (
            <button type="button" onClick={() => removeRelay(index)} className="btn btn-error btn-outline btn-square">
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => appendRelay({ value: "" })} className="btn btn-outline w-full">
        + Add Relay
      </button>
    </div>
  );
}
