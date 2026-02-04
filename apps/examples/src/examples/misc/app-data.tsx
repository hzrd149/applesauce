/**
 * Store and retrieve application-specific data using NIP-78 app-specific events
 * @tags misc, app-data, nip-78, storage
 * @related misc/nip-19-links
 */
import { DeleteBlueprint } from "applesauce-common/blueprints/delete";
import {
  APP_DATA_KIND,
  getAppDataContent,
  getAppDataEncryption,
  isAppDataUnlocked,
  unlockAppData,
} from "applesauce-common/helpers/app-data";
import * as AppData from "applesauce-common/operations/app-data";
import { EventFactory, EventStore, mapEventsToStore, watchEventUpdates } from "applesauce-core";
import { EncryptionMethod, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionMissingError, ExtensionSigner } from "applesauce-signers";
import { useCallback, useEffect, useState } from "react";
import { map, NEVER } from "rxjs";
import RelayPicker from "../../components/relay-picker";

// Create stores and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();
const signer = new ExtensionSigner();
const factory = new EventFactory({ signer });

// Component for displaying event details
const EventDetails = ({
  event,
  onEdit,
  onDelete,
}: {
  event: NostrEvent;
  onEdit: (event: NostrEvent) => void;
  onDelete: (event: NostrEvent) => void;
}) => {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encryption = getAppDataEncryption(event);
  const unlocked = isAppDataUnlocked(event);
  const contentSize = event.content.length;
  const tagCount = event.tags.length;
  const createdAt = new Date(event.created_at * 1000).toLocaleString();

  const content = use$(
    () =>
      eventStore.event(event.id).pipe(
        watchEventUpdates(eventStore),
        map((event) => event && getAppDataContent<any>(event)),
      ),
    [event.id],
  );

  // Decrypt encrypted content
  const handleDecrypt = useCallback(async () => {
    if (!encryption || unlocked) return;

    try {
      setIsDecrypting(true);
      setError(null);

      await unlockAppData(event, signer);
    } catch (err) {
      console.error("Decryption failed:", err);
      setError(err instanceof Error ? err.message : "Decryption failed");
    } finally {
      setIsDecrypting(false);
    }
  }, [event, encryption, unlocked]);

  return (
    <div className="card bg-base-100">
      <div className="card-body">
        <div className="flex justify-between items-start mb-4">
          <h3 className="card-title text-lg">Event Details</h3>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-outline btn-primary" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button className="btn btn-sm btn-outline btn-error" onClick={() => onDelete(event)}>
              Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <span className="font-semibold">Content Size:</span> {contentSize} chars
          </div>
          <div>
            <span className="font-semibold">Tags:</span> {tagCount}
          </div>
          <div>
            <span className="font-semibold">Encrypted:</span>
            <span className={`ml-2 badge ${encryption ? "badge-warning" : "badge-success"}`}>
              {encryption ?? "None"}
            </span>
          </div>
          <div>
            <span className="font-semibold">Created:</span> {createdAt}
          </div>
        </div>

        {/* Tags Display */}
        {tagCount > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold mb-2">Tags:</h4>
            <div className="space-y-2">
              {event.tags.map((tag, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <span className="badge badge-outline badge-sm font-mono">{tag[0]}</span>
                  <span className="text-base-content/70">→</span>
                  <span className="font-mono bg-base-200 px-2 py-1 rounded text-xs break-all">{tag[1] || ""}</span>
                  {tag[2] && (
                    <>
                      <span className="text-base-content/70">→</span>
                      <span className="font-mono bg-base-200 px-2 py-1 rounded text-xs break-all">{tag[2]}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {encryption !== undefined && !unlocked && (
          <div className="mb-4">
            <button
              className={`btn btn-sm ${isDecrypting ? "btn-disabled" : "btn-primary"}`}
              onClick={handleDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : "Decrypt Content"}
            </button>
            {error && (
              <div className="alert alert-error mt-2">
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {content && (
          <div className="mb-4">
            <h4 className="font-semibold mb-2">Content:</h4>
            <pre className="bg-base-200 p-3 rounded-lg overflow-x-auto text-sm">{JSON.stringify(content, null, 2)}</pre>
          </div>
        )}

        <div className="text-xs text-base-content/60">
          <div>ID: {event.id}</div>
          <div>Pubkey: {event.pubkey}</div>
        </div>
      </div>
    </div>
  );
};

// Component for editing events
const EventEditor = ({
  event,
  onSave,
  onCancel,
}: {
  event: NostrEvent;
  onSave: (event: NostrEvent) => void;
  onCancel: () => void;
}) => {
  const [content, setContent] = useState(() => {
    try {
      const data = getAppDataContent(event);
      return JSON.stringify(data, null, 2);
    } catch {
      return event.content;
    }
  });
  const [encryption, setEncryption] = useState(getAppDataEncryption(event));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Validate JSON
      let parsedContent;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        throw new Error("Invalid JSON content");
      }

      // Create new event using factory
      const draft = await factory.modify(event, AppData.setContent(parsedContent, encryption));
      const signed = await factory.sign(draft);

      onSave(signed);
    } catch (err) {
      console.error("Save failed:", err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [content, encryption, event, onSave]);

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <h3 className="card-title text-lg mb-4">Edit Event</h3>

        <label className="label">
          <span className="label-text">Content (JSON)</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-32 font-mono text-sm w-full h-sm"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder='{"key": "value"}'
        />

        <label className="label cursor-pointer">
          <span className="label-text">Encrypt Content</span>
          <select
            className="select select-bordered"
            value={encryption || ""}
            onChange={(e) => setEncryption(e.target.value ? (e.target.value as EncryptionMethod) : undefined)}
          >
            <option value="">None</option>
            <option value="nip44">NIP-44</option>
            <option value="nip04">NIP-04</option>
          </select>
        </label>

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            className={`btn btn-primary ${isSaving ? "btn-disabled" : ""}`}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button className="btn btn-outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// Main component
export default function AppDataExample() {
  const [selectedEvent, setSelectedEvent] = useState<NostrEvent | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [relayUrl, setRelayUrl] = useState("wss://relay.damus.io/");
  const [pubkey, setPubkey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Get all NIP-78 events from the store
  const appDataEvents = use$(
    () =>
      pubkey
        ? eventStore.timeline({ kinds: [APP_DATA_KIND], authors: [pubkey] }).pipe(map((events) => [...events]))
        : NEVER,
    [pubkey],
  );

  // Subscribe to relay when relay URL and pubkey are available
  useEffect(() => {
    if (relayUrl && pubkey) {
      try {
        setError(null);

        // Subscribe to NIP-78 events
        const subscription = pool
          .subscription([relayUrl], { kinds: [APP_DATA_KIND], authors: [pubkey] })
          .pipe(mapEventsToStore(eventStore))
          .subscribe({
            error: (err) => {
              console.error("Subscription error:", err);
              setError("Subscription error: " + err.message);
            },
          });

        // Cleanup subscription on unmount or when relay/pubkey changes
        return () => subscription.unsubscribe();
      } catch (err) {
        console.error("Connection failed:", err);
        setError("Connection failed: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    }
  }, [relayUrl, pubkey]);

  // Check if extension is available and get pubkey
  useEffect(() => {
    const checkExtension = async () => {
      try {
        const pk = await signer.getPublicKey();
        setPubkey(pk);
      } catch (err) {
        if (err instanceof ExtensionMissingError) {
          setError("Nostr extension not found. Please install a browser extension like nos2x or Alby.");
        } else {
          setError("Failed to get public key: " + (err instanceof Error ? err.message : "Unknown error"));
        }
      }
    };

    checkExtension();
  }, []);

  // Handle editing events
  const handleEdit = useCallback((event: NostrEvent) => {
    setSelectedEvent(event);
    setIsEditing(true);
  }, []);

  // Handle saving edited events
  const handleSave = useCallback(
    async (updatedEvent: NostrEvent) => {
      try {
        // Add the updated event to the store
        eventStore.add(updatedEvent);

        // Publish to relay
        await pool.publish([relayUrl], updatedEvent);

        setIsEditing(false);
        setSelectedEvent(null);
      } catch (err) {
        console.error("Failed to save event:", err);
        setError("Failed to save event: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    },
    [relayUrl],
  );

  const handleDelete = useCallback(
    async (event: NostrEvent) => {
      if (!confirm("Are you sure you want to delete this event?")) return;

      try {
        // Create deletion event manually
        const draft = await factory.create(DeleteBlueprint, [event]);
        const signed = await factory.sign(draft);

        // Sign and publish deletion
        await pool.publish([relayUrl], signed);

        // Remove from store
        eventStore.remove(event.id);

        if (selectedEvent?.id === event.id) {
          setSelectedEvent(null);
          setIsEditing(false);
        }
      } catch (err) {
        console.error("Failed to delete event:", err);
        setError("Failed to delete event: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    },
    [relayUrl, selectedEvent],
  );

  // Handle canceling edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSelectedEvent(null);
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-4">NIP-78 App Data Manager</h1>
        <p className="text-base-content/70">
          View and edit your NIP-78 application data events. Connect to a relay to start syncing events.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4 w-full">
        <RelayPicker value={relayUrl} onChange={setRelayUrl} />

        <div className="flex items-center">
          <input
            className="input input-bordered flex-1"
            type="text"
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
          />
          <button
            className="btn btn-primary shrink-0"
            onClick={async () => {
              try {
                const signer = new ExtensionSigner();
                const pk = await signer.getPublicKey();
                setPubkey(pk);
              } catch (err) {
                if (err instanceof ExtensionMissingError) {
                  setError("Nostr extension not found. Please install a browser extension like nos2x or Alby.");
                } else {
                  setError("Failed to get public key: " + (err instanceof Error ? err.message : "Unknown error"));
                }
              }
            }}
          >
            From extension
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="alert alert-error mb-6">
          <span>{error}</span>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Events List */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Your App Data Events ({appDataEvents ? appDataEvents.length : 0})</h2>

          {!relayUrl || !pubkey ? (
            <div className="text-center py-8 text-base-content/60">
              Select a relay and ensure your Nostr extension is connected to view your events
            </div>
          ) : !appDataEvents || appDataEvents.length === 0 ? (
            <div className="text-center py-8 text-base-content/60">No app data events found</div>
          ) : (
            <div className="space-y-4">
              {appDataEvents.map((event: NostrEvent) => (
                <div
                  key={event.id}
                  className={`card bg-base-100 border-1 cursor-pointer ${
                    selectedEvent?.id === event.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div className="card-body p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm truncate">{getReplaceableIdentifier(event)}</h3>
                        <p className="text-xs text-base-content/60 mt-1">
                          {new Date(event.created_at * 1000).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {getAppDataEncryption(event) && (
                          <span className="badge badge-warning badge-sm">{getAppDataEncryption(event)}</span>
                        )}
                        <span className="badge badge-outline badge-sm">{event.content.length} chars</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event Details/Editor */}
        <div>
          {selectedEvent ? (
            isEditing ? (
              <EventEditor event={selectedEvent} onSave={handleSave} onCancel={handleCancelEdit} />
            ) : (
              <EventDetails event={selectedEvent} onEdit={handleEdit} onDelete={handleDelete} />
            )
          ) : (
            <div className="text-center py-8 text-base-content/60">Select an event to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}
