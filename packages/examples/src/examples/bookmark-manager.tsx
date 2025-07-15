import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PasswordSigner,
  AbstractSigner,
} from "applesauce-signers";
import { EventFactory } from "applesauce-factory";
import { RelayPool, onlyEvents } from "applesauce-relay";
import {
  EventStore,
  mapEventsToStore,
  mapEventsToTimeline,
} from "applesauce-core";
import {
  getBookmarks,
  parseBookmarkTags,
  Bookmarks,
  EventPointer,
  AddressPointer,
  getDisplayName,
  getProfilePicture,
  ProfileContent,
} from "applesauce-core/helpers";
import { useObservableMemo, useObservableState } from "applesauce-react/hooks";
import { NostrEvent } from "applesauce-core/core";
import { kinds } from "nostr-tools";
import { profilePointerLoader } from "applesauce-loaders/loaders";
import { map, toArray, take, filter, mergeMap, distinctUntilChanged, switchMap } from "rxjs/operators";
import { firstValueFrom, BehaviorSubject, Observable, of, merge } from "rxjs";

type SignerType = "extension" | "nostrconnect" | "password";

// Create event store for caching
const eventStore = new EventStore();

// Create relay pool
const pool = new RelayPool();

// Default relays to use
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
];

// Profile component
function UserProfile({ pubkey }: { pubkey: string }) {
  const profile = useObservableMemo(
    () => profilePointerLoader(pool.request.bind(pool))({ pubkey, relays: DEFAULT_RELAYS }),
    [pubkey]
  );

  const displayName = profile ? getDisplayName(profile as ProfileContent, pubkey) : null;
  const picture = profile ? getProfilePicture(profile as ProfileContent) : null;

  return (
    <div className="flex items-center gap-2">
      {picture && (
        <img src={picture} alt={displayName || ''} className="w-8 h-8 rounded-full" />
      )}
      {displayName && <span className="font-semibold">{displayName}</span>}
    </div>
  );
}

// Note component with bookmark button
function NoteCard({ 
  event, 
  isBookmarked, 
  onBookmark, 
  onUnbookmark 
}: { 
  event: NostrEvent;
  isBookmarked: boolean;
  onBookmark: (event: NostrEvent) => void;
  onUnbookmark: (event: NostrEvent) => void;
}) {
  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body">
        <div className="flex justify-between items-start mb-2">
          <UserProfile pubkey={event.pubkey} />
          <time className="text-sm opacity-70">
            {new Date(event.created_at * 1000).toLocaleString()}
          </time>
        </div>
        <p className="whitespace-pre-wrap break-words">{event.content}</p>
        <div className="card-actions justify-end mt-4">
          <button
            onClick={() => isBookmarked ? onUnbookmark(event) : onBookmark(event)}
            className={`btn btn-sm ${isBookmarked ? 'btn-warning' : 'btn-outline'}`}
          >
            {isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookmarkManager() {
  const [signerType, setSignerType] = useState<SignerType | null>(null);
  const [signer, setSigner] = useState<AbstractSigner | null>(null);
  const [pubkey, setPubkey] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>("");
  
  // Nostr Connect specific state
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [connectUri, setConnectUri] = useState("");
  
  // Password signer specific state
  const [password, setPassword] = useState("");
  const [ncryptsec, setNcryptsec] = useState("");
  
  // Bookmark state
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [selectedRelay, setSelectedRelay] = useState<string>(DEFAULT_RELAYS[0]);
  
  // Create reactive bookmark observable
  const bookmarksObservable = useMemo(() => {
    if (!pubkey) return of(new Set<string>());
    
    return pool.request(DEFAULT_RELAYS, [{
      kinds: [kinds.BookmarkList],
      authors: [pubkey],
    }]).pipe(
      onlyEvents(),
      mapEventsToStore(eventStore),
      map((event: NostrEvent) => {
        const bookmarks = getBookmarks(event);
        const noteIds = new Set<string>();
        bookmarks.notes.forEach(note => noteIds.add(note.id));
        return noteIds;
      }),
      distinctUntilChanged((prev, curr) => {
        if (prev.size !== curr.size) return false;
        for (const id of prev) {
          if (!curr.has(id)) return false;
        }
        return true;
      })
    );
  }, [pubkey]);
  
  // Subscribe to bookmarks observable
  const bookmarkedEventIds = useObservableState(bookmarksObservable, new Set<string>());

  // Initialize signer based on type
  const initializeSigner = useCallback(async () => {
    setIsConnecting(true);
    setError("");
    
    try {
      let newSigner: AbstractSigner | null = null;
      
      switch (signerType) {
        case "extension":
          try {
            newSigner = new ExtensionSigner();
            const pk = await newSigner.getPublicKey();
            setPubkey(pk);
          } catch (err) {
            throw new Error("No Nostr extension found. Please install Alby or nos2x.");
          }
          break;
          
        case "nostrconnect":
          if (!bunkerUrl) {
            // Generate connect URI for QR code
            NostrConnectSigner.subscriptionMethod = (relays, filters, opts) => 
              pool.subscription(relays, filters, opts);
            NostrConnectSigner.publishMethod = (relays, event, opts) => 
              pool.publish(relays, event, opts);
            
            const signer = new NostrConnectSigner();
            const uri = signer.getNostrConnectURI({
              name: "Bookmark Manager",
            });
            setConnectUri(uri);
            
            // Wait for connection
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            
            try {
              await signer.waitForSigner(controller.signal);
              clearTimeout(timeout);
            } catch (err) {
              clearTimeout(timeout);
              if (err instanceof Error && err.message === "Aborted") {
                throw new Error("Connection timeout");
              }
              throw err;
            }
            
            newSigner = signer;
            const pk = await newSigner.getPublicKey();
            setPubkey(pk);
          } else {
            // Connect via bunker URL
            NostrConnectSigner.subscriptionMethod = (relays, filters, opts) => 
              pool.subscription(relays, filters, opts);
            NostrConnectSigner.publishMethod = (relays, event, opts) => 
              pool.publish(relays, event, opts);
            
            newSigner = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
            const pk = await newSigner.getPublicKey();
            setPubkey(pk);
          }
          break;
          
        case "password":
          if (!ncryptsec || !password) {
            throw new Error("Please provide encrypted key and password");
          }
          newSigner = new PasswordSigner(ncryptsec, password);
          const pk = await newSigner.getPublicKey();
          setPubkey(pk);
          break;
      }
      
      if (newSigner) {
        setSigner(newSigner);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize signer");
    } finally {
      setIsConnecting(false);
    }
  }, [signerType, bunkerUrl, password, ncryptsec, pool]);

  // Load timeline feed
  const timelineEvents = useObservableMemo(
    () => {
      if (!selectedRelay) return [];
      
      return pool
        .relay(selectedRelay)
        .subscription({ kinds: [kinds.ShortTextNote], limit: 50 })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((events) => [...events].reverse())
        );
    },
    [selectedRelay]
  );


  // Add bookmark
  const addBookmark = useCallback((event: NostrEvent) => {
    if (!signer) return;
    
    const factory = new EventFactory({ signer });
    
    // Get current bookmark list from event store
    const currentBookmarks$ = eventStore.timeline([{
      kinds: [kinds.BookmarkList],
      authors: [pubkey],
    }]).pipe(
      take(1),
      map(events => events.length > 0 ? events[0] : null)
    );
    
    currentBookmarks$.pipe(
      switchMap(existingBookmarks => {
        // Build bookmark tags
        const bookmarkTags = existingBookmarks ? [...existingBookmarks.tags] : [];
        
        // Add the "d" tag if not present
        if (!bookmarkTags.find(tag => tag[0] === "d")) {
          bookmarkTags.push(["d", ""]);
        }
        
        // Add the event bookmark tag if not already bookmarked
        const eventTag = ["e", event.id];
        if (!bookmarkTags.find(tag => tag[0] === "e" && tag[1] === event.id)) {
          bookmarkTags.push(eventTag);
        }
        
        // Create bookmark list event
        return factory.build({
          kind: kinds.BookmarkList,
          content: "",
          tags: bookmarkTags,
        });
      }),
      switchMap(draft => factory.sign(draft)),
      mergeMap(signed => pool.publish(DEFAULT_RELAYS, signed))
    ).subscribe({
      error: (err) => {
        setError(err instanceof Error ? err.message : "Failed to add bookmark");
      }
    });
  }, [signer, pubkey, eventStore]);

  // Remove bookmark
  const removeBookmark = useCallback((event: NostrEvent) => {
    if (!signer) return;
    
    const factory = new EventFactory({ signer });
    
    // Get current bookmark list from event store
    const currentBookmarks$ = eventStore.timeline([{
      kinds: [kinds.BookmarkList],
      authors: [pubkey],
    }]).pipe(
      take(1),
      map(events => events.length > 0 ? events[0] : null)
    );
    
    currentBookmarks$.pipe(
      filter(existingBookmarks => existingBookmarks !== null),
      switchMap(existingBookmarks => {
        // Remove the event tag
        const bookmarkTags = existingBookmarks!.tags.filter(
          tag => !(tag[0] === "e" && tag[1] === event.id)
        );
        
        // Create updated bookmark list
        return factory.build({
          kind: kinds.BookmarkList,
          content: "",
          tags: bookmarkTags,
        });
      }),
      switchMap(draft => factory.sign(draft)),
      mergeMap(signed => pool.publish(DEFAULT_RELAYS, signed))
    ).subscribe({
      error: (err) => {
        setError(err instanceof Error ? err.message : "Failed to remove bookmark");
      }
    });
  }, [signer, pubkey, eventStore]);


  // Render signer selection
  if (!signerType) {
    return (
      <div className="container mx-auto my-8 px-4 py-8 max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Nostr Bookmark Manager</h1>
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setSignerType("extension")}
            className="btn btn-primary w-full"
          >
            Use Browser Extension
          </button>
          <button
            onClick={() => setSignerType("nostrconnect")}
            className="btn btn-secondary w-full"
          >
            Use Nostr Connect
          </button>
          <button
            onClick={() => setSignerType("password")}
            className="btn btn-accent w-full"
          >
            Use Password Login
          </button>
        </div>
      </div>
    );
  }

  // Render login forms
  if (!signer) {
    return (
      <div className="container mx-auto my-8 px-4 py-8 max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Connect to Nostr</h1>
        
        {signerType === "extension" && (
          <div className="card bg-base-200 shadow-md">
            <div className="card-body">
              <h2 className="card-title mb-4">Browser Extension</h2>
              <p className="text-sm mb-4">Click below to connect with your browser extension</p>
              <button
                onClick={initializeSigner}
                disabled={isConnecting}
                className="btn btn-primary w-full"
              >
                {isConnecting ? "Connecting..." : "Connect Extension"}
              </button>
            </div>
          </div>
        )}
        
        {signerType === "nostrconnect" && (
          <div className="card bg-base-200 shadow-md">
            <div className="card-body">
              <h2 className="card-title mb-4">Nostr Connect</h2>
              
              {/* Show input field OR QR code, not both */}
              {!connectUri ? (
                <>
                  <div className="form-control mb-4">
                    <label className="label">
                      <span className="label-text">Bunker URL</span>
                    </label>
                    <input
                      type="text"
                      value={bunkerUrl}
                      onChange={(e) => setBunkerUrl(e.target.value)}
                      placeholder="bunker://..."
                      className="input input-bordered w-full"
                    />
                  </div>
                  
                  <button
                    onClick={initializeSigner}
                    disabled={isConnecting || !bunkerUrl}
                    className="btn btn-secondary w-full mb-2"
                  >
                    {isConnecting ? "Connecting..." : "Connect with Bunker URL"}
                  </button>
                  
                  <div className="divider">OR</div>
                  
                  <button
                    onClick={() => {
                      setBunkerUrl(""); // Clear bunker URL
                      initializeSigner();
                    }}
                    disabled={isConnecting}
                    className="btn btn-outline btn-secondary w-full"
                  >
                    {isConnecting ? "Generating..." : "Generate QR Code"}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center mb-4">
                    <p className="text-sm mb-2">Scan with your signer app:</p>
                    <div className="bg-white p-4 rounded-lg">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(connectUri)}`}
                        alt="QR Code"
                        className="w-48 h-48"
                      />
                    </div>
                    <p className="text-xs opacity-70 mt-2">Waiting for connection...</p>
                  </div>
                  
                  <button
                    onClick={() => {
                      setConnectUri("");
                      setIsConnecting(false);
                    }}
                    className="btn btn-outline w-full"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        
        {signerType === "password" && (
          <div className="card bg-base-200 shadow-md">
            <div className="card-body">
              <h2 className="card-title mb-4">Password Login</h2>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Encrypted Key (ncryptsec)</span>
                </label>
                <input
                  type="text"
                  value={ncryptsec}
                  onChange={(e) => setNcryptsec(e.target.value)}
                  placeholder="ncryptsec1..."
                  className="input input-bordered w-full"
                />
              </div>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Password</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>
              <button
                onClick={initializeSigner}
                disabled={isConnecting}
                className="btn btn-accent w-full"
              >
                {isConnecting ? "Connecting..." : "Unlock"}
              </button>
            </div>
          </div>
        )}
        
        {error && (
          <div className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        )}
        
        <button
          onClick={() => {
            setSignerType(null);
            setError("");
          }}
          className="btn btn-outline mt-4"
        >
          Back
        </button>
      </div>
    );
  }

  // Filter events based on bookmark state
  const displayEvents = useMemo(() => {
    if (!timelineEvents) return [];
    if (!showBookmarksOnly) return timelineEvents;
    return timelineEvents.filter(event => bookmarkedEventIds.has(event.id));
  }, [timelineEvents, showBookmarksOnly, bookmarkedEventIds]);

  // Render bookmark manager
  return (
    <div className="container mx-auto my-8">
      {/* Header */}
      <div className="card bg-base-100 shadow-md mb-6">
        <div className="card-body">
          <div className="flex justify-between items-center mb-4">
            <h1 className="card-title">Nostr Bookmark Manager</h1>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setSigner(null);
                  setPubkey("");
                  setSignerType(null);
                }}
                className="btn btn-outline btn-sm"
              >
                Logout
              </button>
            </div>
          </div>
          
          <div className="text-sm opacity-70 mb-4">
            Connected as: {pubkey.slice(0, 8)}...{pubkey.slice(-8)}
          </div>
          
          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center">
            <select 
              className="select select-bordered select-sm"
              value={selectedRelay}
              onChange={(e) => setSelectedRelay(e.target.value)}
            >
              {DEFAULT_RELAYS.map(relay => (
                <option key={relay} value={relay}>{relay}</option>
              ))}
            </select>
            
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text mr-2">Show bookmarks only</span>
                <input
                  type="checkbox"
                  checked={showBookmarksOnly}
                  onChange={(e) => setShowBookmarksOnly(e.target.checked)}
                  className="checkbox checkbox-sm"
                />
              </label>
            </div>
            
            <div className="text-sm opacity-70 ml-auto">
              {bookmarkedEventIds.size} bookmarked
            </div>
          </div>
        </div>
      </div>
      
      {/* Feed */}
      <div className="flex flex-col gap-4">
        {displayEvents.length === 0 && (
          <div className="card bg-base-200">
            <div className="card-body text-center opacity-70">
              {showBookmarksOnly ? "No bookmarked notes yet" : "No notes found"}
            </div>
          </div>
        )}
        
        {displayEvents.map((event) => (
          <NoteCard
            key={event.id}
            event={event}
            isBookmarked={bookmarkedEventIds.has(event.id)}
            onBookmark={addBookmark}
            onUnbookmark={removeBookmark}
          />
        ))}
      </div>
      
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export default BookmarkManager;