import React, { useState, useCallback, useMemo } from "react";
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
  defined,
  Model,
} from "applesauce-core";
import { ProxySigner } from "applesauce-accounts";
import {
  getBookmarks,
  getDisplayName,
  getProfilePicture,
  ProfileContent,
} from "applesauce-core/helpers";
import { useObservableMemo, useObservableState } from "applesauce-react/hooks";
import { NostrEvent } from "applesauce-core/core";
import { kinds } from "nostr-tools";
import { addressPointerLoader } from "applesauce-loaders/loaders";
import { map, take, filter, mergeMap, distinctUntilChanged, switchMap, ignoreElements } from "rxjs/operators";
import { BehaviorSubject, of, merge, defer, EMPTY } from "rxjs";
import { ProfilePointer } from "nostr-tools/nip19";

type SignerType = "extension" | "nostrconnect" | "password";

// Create event store for caching
const eventStore = new EventStore();

// Create relay pool
const pool = new RelayPool();

// Create signer subject and factory
const signer$ = new BehaviorSubject<AbstractSigner | null>(null);
const factory = new EventFactory({ signer: new ProxySigner(signer$.pipe(defined())) });

// Default relays to use
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
];

// Create address loader
const addressLoader = addressPointerLoader(pool.request.bind(pool), {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});

/** A model that loads the profile if its not found in the event store */
function ProfileQuery(user: ProfilePointer): Model<ProfileContent | undefined> {
  return (events) =>
    merge(
      // Load the profile if its not found in the event store
      defer(() => {
        if (events.hasReplaceable(kinds.Metadata, user.pubkey)) return EMPTY;
        else return addressLoader({ kind: kinds.Metadata, ...user }).pipe(ignoreElements());
      }),
      // Subscribe to the profile content
      events.profile(user.pubkey),
    );
}

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return useObservableMemo(() => eventStore.model(ProfileQuery, user), [user.pubkey, user.relays?.join("|")]);
}

// Signer selection component
function SignerSelection({ onSelect }: { onSelect: (type: SignerType) => void }) {
  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6 text-center">Nostr Bookmark Manager</h1>
      <div className="flex flex-col gap-4">
        <button
          onClick={() => onSelect("extension")}
          className="btn btn-primary w-full"
        >
          Use Browser Extension
        </button>
        <button
          onClick={() => onSelect("nostrconnect")}
          className="btn btn-secondary w-full"
        >
          Use Nostr Connect
        </button>
        <button
          onClick={() => onSelect("password")}
          className="btn btn-accent w-full"
        >
          Use Password Login
        </button>
      </div>
    </div>
  );
}

// Extension login component
function ExtensionLogin({ onLogin, onBack }: { onLogin: (signer: AbstractSigner, pubkey: string) => void; onBack: () => void }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>("");

  const handleConnect = async () => {
    setIsConnecting(true);
    setError("");
    
    try {
      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();
      onLogin(signer, pubkey);
    } catch (err) {
      setError("No Nostr extension found. Please install Alby or nos2x.");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6 text-center">Connect to Nostr</h1>
      <div className="card bg-base-200 shadow-md">
        <div className="card-body">
          <h2 className="card-title mb-4">Browser Extension</h2>
          <p className="text-sm mb-4">Click below to connect with your browser extension</p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn btn-primary w-full"
          >
            {isConnecting ? "Connecting..." : "Connect Extension"}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
      
      <button onClick={onBack} className="btn btn-outline mt-4">
        Back
      </button>
    </div>
  );
}

// Nostr Connect login component
function NostrConnectLogin({ onLogin, onBack }: { onLogin: (signer: AbstractSigner, pubkey: string) => void; onBack: () => void }) {
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [connectUri, setConnectUri] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>("");

  const handleConnect = async () => {
    setIsConnecting(true);
    setError("");
    
    try {
      NostrConnectSigner.subscriptionMethod = (relays, filters, opts) => 
        pool.subscription(relays, filters, opts);
      NostrConnectSigner.publishMethod = (relays, event, opts) => 
        pool.publish(relays, event, opts);
      
      if (bunkerUrl) {
        const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
        const pubkey = await signer.getPublicKey();
        onLogin(signer, pubkey);
      } else {
        const signer = new NostrConnectSigner();
        const uri = signer.getNostrConnectURI({ name: "Bookmark Manager" });
        setConnectUri(uri);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        
        try {
          await signer.waitForSigner(controller.signal);
          clearTimeout(timeout);
          const pubkey = await signer.getPublicKey();
          onLogin(signer, pubkey);
        } catch (err) {
          clearTimeout(timeout);
          if (err instanceof Error && err.message === "Aborted") {
            throw new Error("Connection timeout");
          }
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6 text-center">Connect to Nostr</h1>
      <div className="card bg-base-200 shadow-md">
        <div className="card-body">
          <h2 className="card-title mb-4">Nostr Connect</h2>
          
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
                onClick={handleConnect}
                disabled={isConnecting || !bunkerUrl}
                className="btn btn-secondary w-full mb-2"
              >
                {isConnecting ? "Connecting..." : "Connect with Bunker URL"}
              </button>
              
              <div className="divider">OR</div>
              
              <button
                onClick={() => {
                  setBunkerUrl("");
                  handleConnect();
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
      
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
      
      <button onClick={onBack} className="btn btn-outline mt-4">
        Back
      </button>
    </div>
  );
}

// Password login component
function PasswordLogin({ onLogin, onBack }: { onLogin: (signer: AbstractSigner, pubkey: string) => void; onBack: () => void }) {
  const [ncryptsec, setNcryptsec] = useState("");
  const [password, setPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>("");

  const handleConnect = async () => {
    if (!ncryptsec || !password) {
      setError("Please provide encrypted key and password");
      return;
    }
    
    setIsConnecting(true);
    setError("");
    
    try {
      const signer = new PasswordSigner(ncryptsec, password);
      const pubkey = await signer.getPublicKey();
      onLogin(signer, pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6 text-center">Connect to Nostr</h1>
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
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn btn-accent w-full"
          >
            {isConnecting ? "Connecting..." : "Unlock"}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
      
      <button onClick={onBack} className="btn btn-outline mt-4">
        Back
      </button>
    </div>
  );
}

// Profile component
function UserProfile({ pubkey }: { pubkey: string }) {
  const profile = useProfile({ pubkey, relays: DEFAULT_RELAYS });

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
  const [error, setError] = useState<string>("");
  
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

  // Handle login callback
  const handleLogin = useCallback((newSigner: AbstractSigner, newPubkey: string) => {
    setSigner(newSigner);
    setPubkey(newPubkey);
    signer$.next(newSigner);
    setSignerType(null); // Clear signer type to show main view
  }, []);

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
  }, [signer, pubkey]);

  // Remove bookmark
  const removeBookmark = useCallback((event: NostrEvent) => {
    if (!signer) return;
    
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
  }, [signer, pubkey]);

  // Handle logout
  const handleLogout = useCallback(() => {
    setSigner(null);
    setPubkey("");
    setSignerType(null);
    signer$.next(null);
  }, []);

  // Render signer selection
  if (!signer && !signerType) {
    return <SignerSelection onSelect={setSignerType} />;
  }

  // Render login forms
  if (!signer && signerType) {
    switch (signerType) {
      case "extension":
        return <ExtensionLogin onLogin={handleLogin} onBack={() => setSignerType(null)} />;
      case "nostrconnect":
        return <NostrConnectLogin onLogin={handleLogin} onBack={() => setSignerType(null)} />;
      case "password":
        return <PasswordLogin onLogin={handleLogin} onBack={() => setSignerType(null)} />;
    }
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
                onClick={handleLogout}
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