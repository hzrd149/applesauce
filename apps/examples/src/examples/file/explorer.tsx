/**
 * Browse kind 1063 file metadata events with reactive filters and cast-driven UI
 * @tags nip-94, files, feed, filtering, relay
 * @related feed/relay-timeline, hashtags/explore, torrent/feed
 */
import { castTimelineStream } from "applesauce-common/observable";

import { relayTimeline } from "../../extra/relay-timeline";
import { useMemo, useState } from "react";

import { FileMetadata } from "applesauce-common/casts";

import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, kinds } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { map, switchMap, of } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const DEFAULT_RELAY = "wss://relay.primal.net/";
const CURATED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "application/pdf",
];

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: [DEFAULT_RELAY] });

function formatBytes(size?: number) {
  if (size === undefined || Number.isNaN(size)) return "Unknown size";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function getPreviewUrl(file: FileMetadata) {
  return file.thumbnail || file.image || file.url;
}

function FilePreview({ file }: { file: FileMetadata }) {
  const preview = getPreviewUrl(file);
  if (!preview || !file.type) return null;

  if (file.type.startsWith("image/")) {
    return (
      <img
        src={preview}
        alt={file.alt || file.summary || "File preview"}
        className="h-40 w-full rounded-xl object-cover"
      />
    );
  }

  if (file.type.startsWith("video/")) {
    return <video src={preview} controls className="h-40 w-full rounded-xl object-cover" />;
  }

  if (file.type.startsWith("audio/")) {
    return <audio src={preview} controls className="w-full" />;
  }

  return (
    <div className="flex h-40 items-center justify-center rounded-xl border border-base-300 bg-base-200 text-sm text-base-content/60">
      No inline preview for {file.type}
    </div>
  );
}

function MimeTypeFilter({
  availableMimeTypes,
  selectedMimeTypes,
  onChange,
}: {
  availableMimeTypes: string[];
  selectedMimeTypes: string[];
  onChange: (types: string[]) => void;
}) {
  const toggleMimeType = (type: string, checked: boolean) => {
    const current = selectedMimeTypes;
    const next = checked ? Array.from(new Set([...current, type])) : current.filter((value) => value !== type);
    onChange(next);
  };

  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">MIME Types</div>
          <div className="text-sm text-base-content/60">Select one or more types to narrow the feed.</div>
        </div>
        <button className="btn btn-sm" onClick={() => onChange([])} disabled={selectedMimeTypes.length === 0}>
          Clear
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {availableMimeTypes.map((type) => {
          const checked = selectedMimeTypes.includes(type);
          return (
            <label
              key={type}
              className={[
                "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors",
                checked ? "border-primary bg-primary/10" : "border-base-300 bg-base-100",
              ].join(" ")}
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={checked}
                onChange={(event) => toggleMimeType(type, event.target.checked)}
              />
              <span className="min-w-0 truncate font-mono text-sm">{type}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function FileMetaRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-base-300 py-2 last:border-b-0">
      <div className="text-sm text-base-content/60">{label}</div>
      <div className="max-w-[70%] break-all text-right text-sm">{value}</div>
    </div>
  );
}

function FileMetadataDialog({ file, onClose }: { file: FileMetadata | null; onClose: () => void }) {
  const profile = use$(() => file?.author.profile$, [file?.author.pubkey]);

  if (!file) return null;

  const displayName = getDisplayName(profile, file.author.pubkey.slice(0, 8) + "...");
  const avatar = getProfilePicture(profile, `https://robohash.org/${file.author.pubkey}.png`);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-3xl border border-base-300 p-0">
        <div className="border-b border-base-300 p-5">
          <button className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onClick={onClose}>
            ✕
          </button>

          <div className="flex items-start gap-4">
            <img
              src={avatar}
              alt={displayName}
              className="h-12 w-12 rounded-full border border-base-300 object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{file.summary || file.alt || file.type || "File metadata"}</div>
              <div className="mt-1 text-sm text-base-content/70">Shared by {displayName}</div>
              <div className="mt-1 text-sm text-base-content/60">{file.createdAt.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <FilePreview file={file} />
            <div className="rounded-2xl border border-base-300 bg-base-100 p-4">
              <div className="text-sm font-semibold">Description</div>
              <div className="mt-3 space-y-2 text-sm text-base-content/80">
                <p>{file.summary || "No summary provided."}</p>
                {file.alt && <p>{file.alt}</p>}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-100 p-4">
            <div className="mb-3 text-sm font-semibold">Metadata</div>
            <FileMetaRow label="URL" value={file.url} />
            <FileMetaRow label="MIME type" value={file.type} />
            <FileMetaRow label="Size" value={formatBytes(file.size)} />
            <FileMetaRow label="Dimensions" value={file.dimensions} />
            <FileMetaRow label="SHA-256" value={file.sha256} />
            <FileMetaRow label="Original hash" value={file.originalSha256} />
            <FileMetaRow label="Magnet" value={file.magnet} />
            <FileMetaRow label="Info hash" value={file.infohash} />
            <FileMetaRow label="Blurhash" value={file.blurhash} />
            <FileMetaRow label="Thumbnail" value={file.thumbnail} />
            <FileMetaRow label="Preview image" value={file.image} />
            {file.fallback && file.fallback.length > 0 && (
              <FileMetaRow label="Fallbacks" value={file.fallback.join(", ")} />
            )}
          </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}

function FileCard({ file, onSelect }: { file: FileMetadata; onSelect: () => void }) {
  const profile = use$(() => file.author.profile$, [file.author.pubkey]);
  const displayName = getDisplayName(profile, file.author.pubkey.slice(0, 8) + "...");
  const avatar = getProfilePicture(profile, `https://robohash.org/${file.author.pubkey}.png`);
  const preview = getPreviewUrl(file);

  return (
    <article className="rounded-2xl border border-base-300 bg-base-100 p-4">
      <div className="flex items-start gap-3">
        <img src={avatar} alt={displayName} className="h-11 w-11 rounded-full border border-base-300 object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate font-semibold">{displayName}</div>
            <div className="text-sm text-base-content/60">{file.createdAt.toLocaleString()}</div>
          </div>
          <div className="truncate text-sm text-base-content/60">{file.author.pubkey}</div>
        </div>
        {file.type && (
          <div className="rounded-full border border-base-300 px-2 py-1 text-sm font-mono">{file.type}</div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[12rem_1fr]">
        <div className="overflow-hidden rounded-xl border border-base-300 bg-base-200">
          {preview && file.type?.startsWith("image/") ? (
            <img src={preview} alt={file.alt || file.summary || "File preview"} className="h-40 w-full object-cover" />
          ) : (
            <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-base-content/60">
              {file.type || "Unknown type"}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-lg font-semibold">{file.summary || file.alt || file.type || "Untitled file"}</div>
          <a href={file.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm link">
            {file.url}
          </a>

          <div className="mt-4 flex flex-wrap gap-2 text-sm text-base-content/70">
            <div className="rounded-full border border-base-300 px-2 py-1">{formatBytes(file.size)}</div>
            {file.dimensions && <div className="rounded-full border border-base-300 px-2 py-1">{file.dimensions}</div>}
            {file.blurhash && <div className="rounded-full border border-base-300 px-2 py-1">blurhash</div>}
            {file.fallback && file.fallback.length > 0 && (
              <div className="rounded-full border border-base-300 px-2 py-1">{file.fallback.length} fallback URLs</div>
            )}
          </div>

          {(file.summary || file.alt) && (
            <div className="mt-4 space-y-2 text-sm text-base-content/80">
              {file.summary && <p>{file.summary}</p>}
              {file.alt && file.alt !== file.summary && <p>{file.alt}</p>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href={file.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">
              Open File
            </a>
            <button className="btn btn-sm" onClick={onSelect}>
              View Metadata
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function FileExplorerExample() {
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [search, setSearch] = useState("");
  const [selectedMimeTypes, setSelectedMimeTypes] = useState<string[]>([]);
  const [selected, setSelected] = useState<FileMetadata | null>(null);
  const feed = use$(
    () =>
      relayTimeline(eventStore, pool, relay ? [relay] : [], {
        kinds: [kinds.FileMetadata],
        limit: 500,
        ...(selectedMimeTypes.length ? { "#m": selectedMimeTypes } : {}),
      }).pipe(
        switchMap((result) =>
          of(result.events).pipe(
            castTimelineStream(FileMetadata, eventStore),
            map((events) => ({ ...result, events })),
          ),
        ),
      ),
    [relay, selectedMimeTypes.join(",")],
  );
  const result = useMemo(() => {
    if (!feed) return undefined;
    const allFiles = feed.events;
    const query = search.trim().toLowerCase();
    return {
      ...feed,
      files: allFiles.filter(
        (file) =>
          !query ||
          [file.url, file.type, file.summary, file.alt, file.author.pubkey, file.sha256]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
      ),
      availableMimeTypes: [
        ...new Set([...CURATED_MIME_TYPES, ...allFiles.flatMap((file) => (file.type ? [file.type] : []))]),
      ].sort(),
    };
  }, [feed, search]);
  const files = result?.files ?? [];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <section className="rounded-2xl border border-base-300 bg-base-100 p-4">
        <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
          <div>
            <div className="text-sm font-semibold">Relay</div>
            <div className="mt-2">
              <RelayPicker
                value={relay}
                onChange={(relay) => {
                  setRelay(relay);
                  setSelected(null);
                }}
              />
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold">Search</div>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by URL, summary, alt text, hash, or author"
              className="input input-bordered mt-2 w-full"
            />
            <div className="mt-2 text-sm text-base-content/60">
              {selectedMimeTypes.length > 0
                ? `Filtering ${selectedMimeTypes.length} MIME type${selectedMimeTypes.length === 1 ? "" : "s"}`
                : "Showing every MIME type from the current relay feed."}
            </div>
          </div>
        </div>
      </section>

      <MimeTypeFilter
        availableMimeTypes={result?.availableMimeTypes ?? CURATED_MIME_TYPES}
        selectedMimeTypes={selectedMimeTypes}
        onChange={setSelectedMimeTypes}
      />

      <section className="space-y-4">
        {result?.errors.map((error) => (
          <p role="alert" className="text-error" key={error}>
            {error}
          </p>
        ))}
        {result?.status === "loading" ? (
          <p role="status">Loading files…</p>
        ) : files.length === 0 ? (
          <div className="rounded-2xl border border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/60">
            No file events match the current relay and filters.
          </div>
        ) : (
          files.map((file: FileMetadata) => <FileCard key={file.uid} file={file} onSelect={() => setSelected(file)} />)
        )}
      </section>

      <FileMetadataDialog file={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
