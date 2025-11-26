import { randomBytes } from "@noble/hashes/utils";
import { defined, EventFactory, EventStore } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableState } from "applesauce-react/hooks";
import { PublishResponse, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { useState } from "react";
import { BehaviorSubject, switchMap } from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";

const pubkey$ = new BehaviorSubject<string | null>(null);
const pool = new RelayPool();
const eventStore = new EventStore();
const signer = new ExtensionSigner();

// Create an address loader to load user profiles and replaceable events
const addressLoader = createAddressLoader(pool, {
  // Pass all events to the store
  eventStore,
  // Fallback to lookup relays if events can't be found
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

const mailboxes$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.mailboxes(pubkey)),
);

/** Generates random base64 encoded data of random length */
function generateRandomBase64Data(): string {
  // Random length between 10 and 1000 bytes
  const length = Math.floor(Math.random() * 9990) + 10;
  const randomData = randomBytes(length);

  // Convert Uint8Array to base64 using browser's btoa
  // Convert bytes to binary string first
  let binary = "";
  for (let i = 0; i < randomData.length; i++) {
    binary += String.fromCharCode(randomData[i]);
  }
  return btoa(binary);
}

type EventStatus = {
  event: NostrEvent;
  relayStatuses: Map<string, { ok: boolean; message?: string }>;
  index: number;
};

type DelayConfigProps = {
  minDelay: number;
  maxDelay: number;
  onMinDelayChange: (value: number) => void;
  onMaxDelayChange: (value: number) => void;
};

function DelayConfigInput({ minDelay, maxDelay, onMinDelayChange, onMaxDelayChange }: DelayConfigProps) {
  return (
    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text">Min Delay (ms)</span>
        </label>
        <input
          type="number"
          min="0"
          max="10000"
          className="input input-bordered w-full"
          value={minDelay}
          onChange={(e) => onMinDelayChange(Math.max(0, parseInt(e.target.value) || 0))}
        />
        <label className="label">
          <span className="label-text-alt">Minimum delay between events</span>
        </label>
      </div>
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text">Max Delay (ms)</span>
        </label>
        <input
          type="number"
          min="0"
          max="10000"
          className="input input-bordered w-full"
          value={maxDelay}
          onChange={(e) => onMaxDelayChange(Math.max(0, parseInt(e.target.value) || 0))}
        />
        <label className="label">
          <span className="label-text-alt">Maximum delay between events</span>
        </label>
      </div>
    </div>
  );
}

type RelayStatusItemProps = {
  relay: string;
  status: { ok: boolean; message?: string };
};

function RelayStatusItem({ relay, status }: RelayStatusItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-xs font-mono ${
          status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        }`}
      >
        {status.ok ? "✓" : "✗"}
      </span>
      <span className="text-xs text-base-content/70 truncate flex-1">{relay}</span>
      {status.message && <span className="text-xs text-base-content/50">{status.message}</span>}
    </div>
  );
}

type RelayStatusListProps = {
  relayStatuses: Map<string, { ok: boolean; message?: string }>;
};

function RelayStatusList({ relayStatuses }: RelayStatusListProps) {
  return (
    <div className="mt-2 space-y-1">
      <div className="text-xs font-semibold text-base-content/70 mb-1">Relay Status:</div>
      {Array.from(relayStatuses.entries()).map(([relay, status]) => (
        <RelayStatusItem key={relay} relay={relay} status={status} />
      ))}
    </div>
  );
}

type EventStatusCardProps = {
  status: EventStatus;
  isPublishing: boolean;
};

function EventStatusCard({ status, isPublishing }: EventStatusCardProps) {
  return (
    <div className="bg-base-200 p-3 rounded">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-mono text-base-content/70">
          Event #{status.index + 1}
          {isPublishing && <span className="ml-2 text-primary">(Publishing...)</span>}
        </span>
        <span className="text-xs text-base-content/50">{status.event.id.slice(0, 16)}...</span>
      </div>
      <div className="text-xs font-mono break-all mb-2">
        <div className="mb-1">
          <span className="text-base-content/70">Content length: </span>
          <span className="text-base-content">{status.event.content.length} chars</span>
        </div>
        <div className="text-base-content/50 break-all">{status.event.content.slice(0, 100)}...</div>
      </div>
      <RelayStatusList relayStatuses={status.relayStatuses} />
    </div>
  );
}

type EventStatusListProps = {
  eventStatuses: EventStatus[];
  currentEventIndex: number | null;
  totalCount: number;
};

function EventStatusList({ eventStatuses, currentEventIndex, totalCount }: EventStatusListProps) {
  if (eventStatuses.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-2">
        Published Events ({eventStatuses.length}/{totalCount})
      </h3>
      <div className="flex flex-col-reverse gap-2 max-h-lg overflow-y-auto">
        {eventStatuses.map((status) => (
          <EventStatusCard key={status.event.id} status={status} isPublishing={currentEventIndex === status.index} />
        ))}
      </div>
    </div>
  );
}

type InboxRelayInfoProps = {
  pubkey: string | null;
  inboxCount: number | null;
  inboxes: string[] | null;
};

function InboxRelayInfo({ pubkey, inboxCount, inboxes }: InboxRelayInfoProps) {
  if (!pubkey || pubkey.length !== 64) return null;

  return (
    <div className="alert mb-4">
      <span>
        {inboxes && inboxCount
          ? `Found ${inboxCount} inbox relay(s): ${inboxes.join(", ")}`
          : "Loading inbox relays..."}
      </span>
    </div>
  );
}

type GenerateButtonProps = {
  generating: boolean;
  currentEventIndex: number | null;
  totalCount: number;
  disabled: boolean;
  onClick: () => void;
};

function GenerateButton({ generating, currentEventIndex, totalCount, disabled, onClick }: GenerateButtonProps) {
  const buttonText = generating
    ? currentEventIndex !== null
      ? `Publishing event ${currentEventIndex + 1}/${totalCount}...`
      : "Generating..."
    : `Generate ${totalCount} Broken Event${totalCount !== 1 ? "s" : ""}`;

  return (
    <div className="card-actions justify-end">
      <button className="btn btn-primary" onClick={onClick} disabled={disabled}>
        {buttonText}
      </button>
    </div>
  );
}

export default function BrokenGiftWrapGenerator() {
  const pubkey = useObservableState(pubkey$);
  const [count, setCount] = useState<number>(100);
  const [minDelay, setMinDelay] = useState<number>(100);
  const [maxDelay, setMaxDelay] = useState<number>(1000);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [eventStatuses, setEventStatuses] = useState<EventStatus[]>([]);
  const [currentEventIndex, setCurrentEventIndex] = useState<number | null>(null);

  const factory = new EventFactory({ signer });
  const mailboxes = useObservableState(mailboxes$);

  const handleGenerate = async () => {
    if (!pubkey) return;
    if (!mailboxes?.inboxes?.length) {
      setError("No inbox relays found for this pubkey. The user may not have published a relay list (kind 10002).");
      return;
    }

    try {
      setGenerating(true);
      setError(null);
      setSuccess(null);
      setEventStatuses([]);
      setCurrentEventIndex(null);

      const statuses: EventStatus[] = [];
      // Track failed relays - once a relay fails, don't try it again
      const failedRelays = new Set<string>();
      // Start with all inbox relays as available
      let availableRelays = [...mailboxes.inboxes];

      for (let i = 0; i < count; i++) {
        // Filter out failed relays
        availableRelays = availableRelays.filter((relay) => !failedRelays.has(relay));

        // If no relays are available, stop publishing
        if (availableRelays.length === 0) {
          setError(`All relays have failed. Stopped publishing after ${i} event(s).`);
          break;
        }

        setCurrentEventIndex(i);

        // Generate random base64 data
        const randomContent = generateRandomBase64Data();

        // Create a broken gift wrap event with random base64 content
        // This will stress test the gift wrapping system by trying to decrypt invalid data
        const event = await factory.build(
          {
            kind: kinds.GiftWrap,
            created_at: unixNow(),
            content: randomContent, // Broken: random base64 data instead of valid encrypted content
            tags: [["p", pubkey]],
          },
          // No operations - just create the broken event as-is
        );

        const signed = await factory.sign(event);

        // Initialize relay statuses for this event (only for available relays)
        const relayStatuses = new Map<string, { ok: boolean; message?: string }>();
        availableRelays.forEach((relay) => {
          relayStatuses.set(relay, { ok: false });
        });
        // Also show failed relays as skipped
        failedRelays.forEach((relay) => {
          relayStatuses.set(relay, { ok: false, message: "Skipped (previously failed)" });
        });

        const eventStatus: EventStatus = {
          event: signed,
          relayStatuses,
          index: i,
        };

        statuses.push(eventStatus);
        setEventStatuses([...statuses]);

        // Publish event to available relays only
        // Collect all responses and update status as they come in
        const responses: PublishResponse[] = [];
        await new Promise<void>((resolve) => {
          const subscription = pool.event(availableRelays, signed).subscribe({
            next: (response) => {
              // Update status for this relay
              relayStatuses.set(response.from, {
                ok: response.ok,
                message: response.message,
              });
              responses.push(response);

              // If the relay failed, add it to the failed set
              if (!response.ok) {
                failedRelays.add(response.from);
              }

              // Update state to trigger re-render
              setEventStatuses([...statuses]);

              // Check if we've received responses from all available relays
              if (responses.length >= availableRelays.length) {
                subscription.unsubscribe();
                resolve();
              }
            },
            error: (err) => {
              console.error("Error publishing event:", err);
              // Mark all remaining relays as failed and add them to failed set
              availableRelays.forEach((relay) => {
                if (!responses.some((r) => r.from === relay)) {
                  relayStatuses.set(relay, {
                    ok: false,
                    message: err instanceof Error ? err.message : "Unknown error",
                  });
                  failedRelays.add(relay);
                }
              });
              setEventStatuses([...statuses]);
              subscription.unsubscribe();
              resolve(); // Resolve instead of reject to continue with next event
            },
            complete: () => {
              // If complete is called but we haven't received all responses,
              // mark remaining relays as failed and add them to failed set
              availableRelays.forEach((relay) => {
                if (!responses.some((r) => r.from === relay)) {
                  relayStatuses.set(relay, {
                    ok: false,
                    message: "No response received",
                  });
                  failedRelays.add(relay);
                }
              });
              setEventStatuses([...statuses]);
              resolve();
            },
          });
        });

        // Random delay between events (except for the last one)
        if (i < count - 1) {
          const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setCurrentEventIndex(null);
      const successCount = statuses.reduce(
        (sum, status) => sum + Array.from(status.relayStatuses.values()).filter((s) => s.ok).length,
        0,
      );
      const totalAttempts = statuses.reduce((sum, status) => sum + Array.from(status.relayStatuses.values()).length, 0);
      setSuccess(
        `Successfully published ${successCount} out of ${totalAttempts} event(s) to ${mailboxes.inboxes.length} inbox relay(s)`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to generate broken gift wrap events";
      setError(errorMessage);
      console.error("Failed to generate broken gift wrap events:", err);
    } finally {
      setGenerating(false);
      setCurrentEventIndex(null);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-4">
      <div className="card bg-base-100">
        <div className="card-body">
          <h2 className="card-title text-2xl mb-4">Broken Gift Wrap Generator</h2>
          <p className="text-sm text-base-content/70 mb-4">
            Generate broken gift wrap events with random base64 data to stress test the gift wrapping system. These
            events will fail to decrypt, testing error handling and resilience. Events will be published to the target
            user's inbox relays.
          </p>

          <div className="form-control w-full mb-4">
            <label className="label">
              <span className="label-text">Target Pubkey</span>
            </label>
            <PubkeyPicker
              value={pubkey ?? ""}
              onChange={(pubkey) => pubkey$.next(pubkey)}
              placeholder="Enter pubkey or nostr identifier..."
            />
            <label className="label">
              <span className="label-text-alt">
                The pubkey that will receive the broken gift wrap events. Inbox relays will be loaded automatically.
              </span>
            </label>
          </div>

          <InboxRelayInfo
            pubkey={pubkey}
            inboxCount={mailboxes?.inboxes?.length ?? null}
            inboxes={mailboxes?.inboxes ?? null}
          />

          <div className="form-control w-full mb-4">
            <label className="label">
              <span className="label-text">Number of Events</span>
            </label>
            <input
              type="number"
              min="1"
              max="100"
              className="input input-bordered w-full"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            />
            <label className="label">
              <span className="label-text-alt">Generate between 1 and 100 broken events</span>
            </label>
          </div>

          <DelayConfigInput
            minDelay={minDelay}
            maxDelay={maxDelay}
            onMinDelayChange={setMinDelay}
            onMaxDelayChange={setMaxDelay}
          />

          {error && (
            <div className="alert alert-error mb-4">
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="alert alert-success mb-4">
              <span>{success}</span>
            </div>
          )}

          <GenerateButton
            generating={generating}
            currentEventIndex={currentEventIndex}
            totalCount={count}
            disabled={generating || !pubkey || !mailboxes?.inboxes?.length}
            onClick={handleGenerate}
          />

          <EventStatusList eventStatuses={eventStatuses} currentEventIndex={currentEventIndex} totalCount={count} />
        </div>
      </div>
    </div>
  );
}
