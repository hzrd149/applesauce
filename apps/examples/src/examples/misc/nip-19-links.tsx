/**
 * Parse and display NIP-19 encoded links (npub, nprofile, note, nevent, etc.)
 * @tags nip-19, nip-89, misc, links, encoding
 * @related misc/app-data
 */
import {
  createHandlerLink,
  getHandlerDescription,
  getHandlerName,
  getHandlerPicture,
  getHandlerSupportedKinds,
} from "applesauce-common/helpers";
import { EventStore, mapEventsToStore, mapEventsToTimeline, Models } from "applesauce-core";
import { isAddressPointer, isEventPointer } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { Filter, kinds, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer, decodePointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { useRef, useMemo, useState } from "react";
import { map } from "rxjs";

import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Create stores and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

function PointerPreview({ pointer }: { pointer: AddressPointer | EventPointer | ProfilePointer }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Load event for event pointers or address pointers
  const event = use$(() => {
    if (isEventPointer(pointer)) {
      return eventStore.model(Models.EventModel, pointer);
    } else if (isAddressPointer(pointer)) {
      return eventStore.model(Models.ReplaceableModel, pointer);
    }
    return undefined;
  }, [pointer]);

  return (
    <div className="my-4">
      <div className="bg-base-200 p-4 rounded-box">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Decoded Data</h2>
          {(isEventPointer(pointer) || isAddressPointer(pointer)) && (
            <button className="btn btn-sm" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? "Hide" : "Show"} Event Preview
            </button>
          )}
        </div>
        <div className="overflow-auto">
          <pre>{JSON.stringify(pointer, null, 2)}</pre>
        </div>
      </div>

      {isExpanded && (isEventPointer(pointer) || isAddressPointer(pointer)) && (
        <div className="mt-4 bg-base-200 p-4 rounded-box">
          <h3 className="text-lg font-semibold mb-2">Event Preview</h3>
          {event ? (
            <div className="overflow-auto">
              <pre className="text-sm">{JSON.stringify(event, null, 2)}</pre>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="loading loading-spinner loading-sm"></div>
              <span className="text-sm">Loading event...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HandlerCard({
  handler,
  pointer,
}: {
  handler: NostrEvent;
  pointer: AddressPointer | EventPointer | ProfilePointer;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const link = createHandlerLink(handler, pointer);

  return (
    <div key={handler.id} className="border border-base-300 bg-base-100 ">
      <figure className="px-4 pt-4">
        <img
          src={getHandlerPicture(handler, `https://robohash.org/${handler.pubkey}.png`)}
          alt={getHandlerName(handler)}
          className="rounded-xl w-24 h-24 object-cover"
        />
      </figure>
      <div className="p-4">
        <h2 className="font-semibold">{getHandlerName(handler)}</h2>

        <p className="text-sm">{getHandlerDescription(handler)}</p>

        <div>
          <p className="text-sm font-bold">Supported kinds:</p>
          <p className="text-sm text-secondary ">{getHandlerSupportedKinds(handler).join(", ")}</p>
        </div>

        <div className="flex gap-2 mt-2 items-center">
          {!link && <p className="text-sm text-red-500">Missing NIP-89 "web" link</p>}

          <div className="join ms-auto">
            <button className="btn btn-sm join-item" onClick={() => modal.current?.showModal()}>
              View event
            </button>
            <a className="btn btn-primary btn-sm join-item" href={link} target="_blank" aria-disabled={!link}>
              Open with App
            </a>
          </div>
        </div>
      </div>

      {/* Open the modal using document.getElementById('ID').showModal() method */}
      <dialog className="modal" ref={modal}>
        <div className="modal-box w-11/12 max-w-5xl">
          <pre>{JSON.stringify(handler, null, 2)}</pre>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

export default function LinkHandlerExample() {
  const [relay, setRelay] = useState<string>("wss://relay.damus.io/");

  const [input, setInput] = useState<string>("");

  const { pointer, error } = useMemo(() => {
    if (!input.trim()) return { pointer: null, error: null };
    try {
      const decoded = decodePointer(input.trim().replace(/^nostr:/, ""));
      switch (decoded.type) {
        case "nprofile":
        case "naddr":
        case "nevent":
          return { pointer: decoded.data, error: null };
        case "note":
          return { pointer: { id: decoded.data }, error: null };
        case "npub":
          return { pointer: { pubkey: decoded.data }, error: null };
        default:
          throw new Error(`Unknown NIP-19 entity type: ${decoded.type}`);
      }
    } catch (error) {
      return { pointer: null, error: String(error) };
    }
  }, [input]);

  // Second step: Fetch app handlers based on the entity type
  // This observable only runs after parsing is complete
  const handlers = use$(() => {
    if (!pointer) return undefined;

    // Get the handler kind for the link
    let filter: Filter = {
      kinds: [kinds.Handlerinformation],
    };

    // Set kind filter
    if (isEventPointer(pointer)) filter["#k"] = [String(pointer.kind ?? 1)];
    else if (isAddressPointer(pointer)) filter["#k"] = [String(pointer.kind)];

    // Create an observable that requests NIP-89 application handlers
    return pool.request([relay], filter).pipe(
      // Collect all handlers into an array
      mapEventsToStore(eventStore),
      // Accumulate handlers
      mapEventsToTimeline(),
      // Hack to recreate the array for react
      map((t) => [...t]),
    );
  }, [pointer, relay]);

  // Subscribe to the handlers observable
  const isLoading = !!pointer && !handlers;

  return (
    <div className="container mx-auto my-8 p-4">
      <h1 className="text-2xl font-bold mb-4">NIP-89 Application Handlers</h1>
      <p className="mb-4">
        Enter a NIP-19 entity (naddr1, npub1, nprofile1, note1, or nevent1) to find compatible applications
      </p>

      <div className="flex gap-2 flex-wrap">
        <div className="join flex-1">
          <input
            type="text"
            className="input input-bordered w-full join-item min-w-xs"
            placeholder="Enter NIP-19 entity (e.g., npub1, note1, nevent1, naddr1, nprofile1)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="btn join-item" onClick={() => setInput("")}>
            Reset
          </div>
        </div>

        <RelayPicker value={relay} onChange={(value: typeof relay) => setRelay(value)} />
      </div>

      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center my-4">
          <div className="loading loading-spinner loading-lg"></div>
        </div>
      )}

      {pointer && <PointerPreview pointer={pointer} />}

      {pointer && handlers && handlers.length > 0 ? (
        <div>
          <h2 className="text-xl font-semibold mb-2">Compatible Applications</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {handlers.map((handler) => (
              <HandlerCard key={handler.id} handler={handler} pointer={pointer} />
            ))}
          </div>
        </div>
      ) : (
        !isLoading &&
        pointer && (
          <div className="alert alert-info">
            <span>No compatible application handlers found</span>
          </div>
        )
      )}
    </div>
  );
}
