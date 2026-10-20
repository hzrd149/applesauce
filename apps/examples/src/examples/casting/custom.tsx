/**
 * Define a custom cast class for NIP-34 repository announcements.
 * Ordinary clients should use the built-in GitRepository cast; this example teaches cast construction.
 * @tags casting, nip-34, git
 * @related casting/contacts, casting/thread
 */
import { castTimelineStream } from "applesauce-common/observable";

import { relayTimeline } from "../../extra/relay-timeline";

import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";

import { EventStore, withImmediateValueOrDefault } from "applesauce-core";
import { addRelayHintsToPointer, getAddressPointerForEvent, naddrEncode } from "applesauce-core/helpers";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";
import { map, switchMap, of } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

/**
 * STEP 1: Define your event kind and type
 *
 * For NIP-34 Git Repository announcements, the kind is 30617.
 * This is a parameterized replaceable event (30000-39999 range).
 */
const REPOSITORY_KIND = 30617;
type RepositoryEvent = KnownEvent<typeof REPOSITORY_KIND>;

/**
 * STEP 2: Create helper functions to extract data from events
 *
 * These functions parse the event tags and content to extract structured data.
 * Using Symbols for caching ensures expensive operations only run once per event.
 */

// Cache symbols for memoization
const RepositoryNameSymbol = Symbol.for("repository-name");
const RepositoryDescriptionSymbol = Symbol.for("repository-description");
const RepositoryCloneSymbol = Symbol.for("repository-clone");
const RepositoryWebSymbol = Symbol.for("repository-web");
const RepositoryTagsSymbol = Symbol.for("repository-tags");

/** Get repository identifier (d tag) - required for addressable events */
function getRepositoryIdentifier(repo: NostrEvent): string | undefined {
  return getTagValue(repo, "d");
}

/** Get repository name */
function getRepositoryName(repo: RepositoryEvent): string;
function getRepositoryName(repo: NostrEvent): string | undefined;
function getRepositoryName(repo: NostrEvent): string | undefined {
  if (repo.kind !== REPOSITORY_KIND) return undefined;

  return getOrComputeCachedValue(repo, RepositoryNameSymbol, () => {
    return getTagValue(repo, "name");
  });
}

/** Get repository description */
function getRepositoryDescription(repo: NostrEvent): string | undefined {
  if (repo.kind !== REPOSITORY_KIND) return undefined;

  return getOrComputeCachedValue(repo, RepositoryDescriptionSymbol, () => {
    return getTagValue(repo, "description");
  });
}

/** Get clone URLs - returns array since there can be multiple */
function getRepositoryClone(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_KIND) return [];

  return getOrComputeCachedValue(repo, RepositoryCloneSymbol, () => {
    const urls: string[] = [];
    for (const tag of repo.tags) {
      if (tag[0] === "clone" && tag[1]) urls.push(tag[1]);
    }
    return urls;
  });
}

/** Get web URLs for browsing */
function getRepositoryWeb(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_KIND) return [];

  return getOrComputeCachedValue(repo, RepositoryWebSymbol, () => {
    const urls: string[] = [];
    for (const tag of repo.tags) {
      if (tag[0] === "web" && tag[1]) urls.push(tag[1]);
    }
    return urls;
  });
}

/** Get repository tags/hashtags */
function getRepositoryTags(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_KIND) return [];

  return getOrComputeCachedValue(repo, RepositoryTagsSymbol, () => {
    return repo.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]);
  });
}

/** Validate that an event is a valid repository */
function isValidRepository(repo: NostrEvent): repo is RepositoryEvent {
  return (
    repo.kind === REPOSITORY_KIND &&
    getRepositoryIdentifier(repo) !== undefined &&
    getRepositoryName(repo) !== undefined
  );
}

/**
 * STEP 3: Create your custom Cast class
 *
 * Cast classes extend EventCast and provide:
 * - Type-safe access to event data
 * - Synchronous properties for immediate values
 * - Observable properties for reactive data
 * - Integration with the EventStore
 */
class Repository extends EventCast<RepositoryEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    // Always validate the event in the constructor
    if (!isValidRepository(event)) throw new Error("Invalid repository");
    super(event, store);
  }

  // Synchronous properties - direct access to parsed event data
  // These use the helper functions we defined above

  get identifier() {
    return getRepositoryIdentifier(this.event)!;
  }
  get name() {
    return getRepositoryName(this.event)!;
  }
  get description() {
    return getRepositoryDescription(this.event);
  }
  get clone() {
    return getRepositoryClone(this.event);
  }
  get web() {
    return getRepositoryWeb(this.event);
  }
  get tags() {
    return getRepositoryTags(this.event);
  }

  // For addressable events (30000-39999), provide pointer and address
  // These allow other events to reference this repository
  get pointer() {
    return getAddressPointerForEvent(this.event)!;
  }

  /** Observable that adds relay hints from the author's outboxes */
  get pointer$() {
    return this.author.outboxes$.pipe(
      withImmediateValueOrDefault(undefined),
      map((outboxes) => (outboxes ? addRelayHintsToPointer(this.pointer, outboxes.slice(0, 3)) : this.pointer)),
    );
  }

  get address() {
    return naddrEncode(this.pointer);
  }
  get address$() {
    return this.pointer$.pipe(map((pointer) => naddrEncode(pointer)));
  }

  // Observable properties - for reactive data
  // The base EventCast class provides: author, createdAt, id, uid, seen, etc.
  // You can add custom observables using $$ref() for lazy evaluation and caching
}

// Setup EventStore and RelayPool
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Create an event loader for the store to load profiles
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

/** Component to display a single repository */
function RepositoryCard({ repo }: { repo: Repository }) {
  const profile = use$(repo.author.profile$);
  const displayName = profile?.displayName || repo.author.npub;
  const picture = profile?.picture || `https://robohash.org/${repo.author.pubkey}.png`;

  return (
    <div className="border border-base-300 bg-base-100 p-4">
      {/* Author info - from base EventCast */}
      <div className="flex items-center gap-3 mb-3">
        <div className="avatar">
          <div className="w-10 rounded-full">
            <img src={picture} alt={displayName} />
          </div>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{displayName}</h3>
          <p className="text-sm text-base-content/60">{repo.author.npub.slice(0, 20)}...</p>
        </div>
        <time className="text-sm text-base-content/60">{repo.createdAt.toLocaleDateString()}</time>
      </div>

      {/* Repository data - from our custom properties */}
      <div className="mb-3">
        <h4 className="font-bold text-lg mb-1">{repo.name}</h4>
        {repo.description && <p className="text-sm text-base-content/80 mb-2">{repo.description}</p>}

        {/* Tags */}
        {repo.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {repo.tags.map((tag) => (
              <span key={tag} className="badge  badge-outline">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Clone URL */}
        {repo.clone.length > 0 && (
          <div className="text-sm mb-2">
            <span className="font-medium">Clone: </span>
            <code className="text-sm bg-base-200 px-2 py-1 rounded">{repo.clone[0]}</code>
            <button className="btn btn-sm btn-ghost ml-2" onClick={() => navigator.clipboard.writeText(repo.clone[0])}>
              Copy
            </button>
          </div>
        )}

        {/* Web URL */}
        {repo.web.length > 0 && (
          <div className="text-sm">
            <a href={repo.web[0]} target="_blank" rel="noopener noreferrer" className="link link-primary">
              View on web →
            </a>
          </div>
        )}
      </div>

      {/* Addressable event info */}
      <div className="pt-2 border-t border-base-300/50 text-sm text-base-content/60">
        <div className="mb-1">
          <span className="font-medium">Address: </span>
          <code className="bg-base-200 px-1 rounded">{repo.address}</code>
        </div>
        <div>
          <span className="font-medium">Identifier: </span>
          <code className="bg-base-200 px-1 rounded">{repo.identifier}</code>
        </div>
      </div>
    </div>
  );
}

/** Main example component */
export default function CustomCastExample() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");

  const feed = use$(
    () =>
      relayTimeline(eventStore, pool, [relay], { kinds: [REPOSITORY_KIND], limit: 50 }).pipe(
        switchMap((result) =>
          of(result.events).pipe(
            castTimelineStream(Repository, eventStore),
            map((events) => ({ ...result, events })),
          ),
        ),
      ),
    [relay],
  );
  const repositories = feed?.events;

  return (
    <div className="max-w-6xl w-full mx-auto my-8 px-4 gap-2 flex flex-col">
      <RelayPicker value={relay} onChange={setRelay} />
      {feed?.status === "loading" && <p role="status">Loading events…</p>}
      {feed?.errors.map((error) => (
        <p role="alert" className="text-error" key={error}>
          {error}
        </p>
      ))}
      {feed?.status !== "loading" && repositories?.length === 0 && <p>No events found.</p>}

      {repositories?.map((repo) => (
        <RepositoryCard key={repo.uid} repo={repo} />
      ))}
    </div>
  );
}
