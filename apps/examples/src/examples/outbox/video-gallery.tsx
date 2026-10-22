/**
 * Sync a creator's notes and NIP-71 video events from their outboxes, then browse every video as a grid built from the imeta posters, blurhashes, durations, resolutions and fallback sources
 * @tags nip-65, nip-71, nip-92, nip-77, nip-b7, sync, negentropy, gallery, video, imeta
 * @related outbox/photo-gallery, loader/sync-loader, notes/rendering
 */
import { castUser, type User } from "applesauce-common/casts";
import { type FileMetadataFields, getContentWarning, getFileMetadataFromImetaTag } from "applesauce-common/helpers";
import { defined, EventStore } from "applesauce-core";
import {
  getEventUID,
  getOrComputeCachedValue,
  getTagValue,
  isStreamURL,
  isVideoURL,
  kinds,
  type NostrEvent,
  normalizeToPubkey,
  Tokens,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import Hls from "hls.js";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
  type VideoHTMLAttributes,
} from "react";
import { Blurhash } from "react-blurhash";
import { auditTime, map, type Observable, of, timeout } from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Loads profiles, relay lists and blossom server lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

// NIP-71 normal and short videos, regular and addressable
const VIDEO_KIND = 21;
const SHORT_VIDEO_KIND = 22;
const ADDRESSABLE_VIDEO_KIND = 34235;
const ADDRESSABLE_SHORT_VIDEO_KIND = 34236;
const VIDEO_KINDS = [VIDEO_KIND, SHORT_VIDEO_KIND, ADDRESSABLE_VIDEO_KIND, ADDRESSABLE_SHORT_VIDEO_KIND];
const SHORT_KINDS = [SHORT_VIDEO_KIND, ADDRESSABLE_SHORT_VIDEO_KIND];

const DEFAULT_CREATOR = normalizeToPubkey("npub10wzfa7jkqj6c65xyr93hhxrns37ml9tss82jvymv8fymwdtu6cts3h6pvr");

const DAY = 86400;
const RANGES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "All time", days: 0 },
];

type Format = "video" | "short" | "note";
type Sort = "recent" | "longest" | "shortest" | "resolution";

/** One imeta variant of a video, with the NIP-71 fields that FileMetadataFields doesn't parse */
type Variant = FileMetadataFields & {
  url: string;
  /** Every preview image, thumb first since it is the smallest */
  images: string[];
  duration?: number;
  bitrate?: number;
  width?: number;
  height?: number;
};
type Chapter = { start: number; title?: string; image?: string };
type Video = {
  key: string;
  event: NostrEvent;
  format: Format;
  title?: string;
  published: number;
  /** Playable variants first, then the highest resolution */
  variants: Variant[];
  images: string[];
  blurhash?: string;
  width?: number;
  height?: number;
  duration?: number;
  warning: string | boolean;
  alt?: string;
  chapters: Chapter[];
  hashtags: string[];
};

const FORMATS: { value: Format | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Videos" },
  { value: "short", label: "Shorts" },
  { value: "note", label: "Notes" },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "longest", label: "Longest" },
  { value: "shortest", label: "Shortest" },
  { value: "resolution", label: "Resolution" },
];

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** Syncs the creator's notes and video events in the range from their outboxes */
function syncPosts$(user: User, since?: number): Observable<SyncLoaderStatus> {
  // Fall back to popular relays when the creator has no relay list
  const relays = user.outboxes$.pipe(defined(), timeout({ first: 5_000, with: () => of(FALLBACK_RELAYS) }));
  return syncLoader({ relays, filter: { kinds: [kinds.ShortTextNote, ...VIDEO_KINDS], authors: [user.pubkey], since } })
    .status$;
}

// ---------------------------------------------------------------------------
// Videos from imeta tags
// ---------------------------------------------------------------------------

// Probe element for checking which MIME types the browser can decode
const probe = document.createElement("video");
const nativeHls = probe.canPlayType("application/vnd.apple.mpegurl") !== "";

function isHls(variant: Variant) {
  const type = variant.type?.toLowerCase();
  return type === "application/x-mpegurl" || type === "application/vnd.apple.mpegurl" || isStreamURL(variant.url);
}

function isVideo(variant: Variant) {
  if (isHls(variant)) return true;
  if (variant.type) return variant.type.startsWith("video/");
  return isVideoURL(variant.url);
}

/** Checks the imeta MIME type against the browser so unplayable variants are never picked */
function canPlay(variant: Variant) {
  if (isHls(variant)) return nativeHls || Hls.isSupported();
  // Many hosts serve H.264 in .mov files that browsers play even though they report no support
  return !variant.type || variant.type === "video/quicktime" || probe.canPlayType(variant.type) !== "";
}

const pixels = (v: { width?: number; height?: number }) => (v.width ?? 0) * (v.height ?? 0);

/** Parses an imeta tag, keeping the NIP-71 duration and bitrate and every repeated preview image */
function parseVariant(tag: string[]): Variant | undefined {
  const meta = getFileMetadataFromImetaTag(tag);
  if (!meta.url) return undefined;

  const thumbs: string[] = [];
  const images: string[] = [];
  let duration: number | undefined;
  let bitrate: number | undefined;
  for (const part of tag.slice(1)) {
    const space = part.indexOf(" ");
    const [name, value] = [part.slice(0, space), part.slice(space + 1).trim()];
    if (name === "thumb") thumbs.push(value);
    else if (name === "image") images.push(value);
    else if (name === "duration") duration = parseFloat(value) || undefined;
    else if (name === "bitrate") bitrate = parseInt(value) || undefined;
  }

  const [width, height] = meta.dimensions?.split("x").map(Number) ?? [];
  return { ...meta, url: meta.url, images: [...new Set([...thumbs, ...images])], duration, bitrate, width, height };
}

/** Parses a NIP-71 "HH:MM:SS.sss" timestamp into seconds */
const parseTimestamp = (time: string) => time.split(":").reduce((total, part) => total * 60 + parseFloat(part), 0);

/** Builds a video from one or more imeta variants of the same file */
function createVideo(key: string, event: NostrEvent, format: Format, variants: Variant[]): Video {
  variants = [...variants].sort((a, b) => Number(canPlay(b)) - Number(canPlay(a)) || pixels(b) - pixels(a));
  const best = variants[0];
  const tagDuration = parseFloat(getTagValue(event, "duration") ?? "");

  return {
    key,
    event,
    format,
    title: getTagValue(event, "title"),
    published: parseInt(getTagValue(event, "published_at") ?? "") || event.created_at,
    variants,
    images: [...new Set(variants.flatMap((v) => v.images))],
    blurhash: variants.find((v) => v.blurhash)?.blurhash,
    width: best.width,
    height: best.height,
    duration: variants.find((v) => v.duration)?.duration ?? (tagDuration || undefined),
    warning: getContentWarning(event),
    alt: best.alt ?? getTagValue(event, "alt"),
    chapters: event.tags
      .filter((t) => t[0] === "segment" && t[1])
      .map(([, start, , title, image]) => ({ start: parseTimestamp(start), title, image })),
    hashtags: event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]),
  };
}

const VideosSymbol = Symbol("video-gallery-videos");

/** Gets the videos from a NIP-71 event's imeta variants, or each video attached to a note */
function getVideos(event: NostrEvent): Video[] {
  return getOrComputeCachedValue(event, VideosSymbol, () => {
    const variants = event.tags
      .filter((t) => t[0] === "imeta")
      .map(parseVariant)
      .filter((v): v is Variant => !!v && isVideo(v));

    // Every imeta tag of a video event is a resolution or format of the same video
    if (VIDEO_KINDS.includes(event.kind)) {
      const format = SHORT_KINDS.includes(event.kind) ? "short" : "video";
      return variants.length ? [createVideo(getEventUID(event), event, format, variants)] : [];
    }

    // Notes attach one imeta per file, plus bare video links without metadata
    const urls = new Set(variants.map((v) => v.url));
    for (const [url] of event.content.matchAll(Tokens.link))
      if (!urls.has(url) && (isVideoURL(url) || isStreamURL(url))) {
        urls.add(url);
        variants.push({ url, images: [] });
      }

    return variants.map((v) => createVideo(`${event.id}:${v.url}`, event, "note", [v]));
  });
}

/** Drops copies of the same file posted in several events, keeping the video event since it has the most metadata */
function dedupe(videos: Video[]): Video[] {
  const unique = new Map<string, Video>();
  for (const video of videos) {
    // The imeta sha256 identifies the file even when it is hosted on different servers
    const id = video.variants.find((v) => v.sha256)?.sha256 ?? video.variants[0].url;
    const existing = unique.get(id);
    if (!existing || (existing.format === "note" && video.format !== "note")) unique.set(id, video);
  }
  return [...unique.values()];
}

/** Every unique video in the creator's notes and video events in the range */
function videos$(pubkey: string, since?: number): Observable<Video[]> {
  return eventStore.timeline({ kinds: [kinds.ShortTextNote, ...VIDEO_KINDS], authors: [pubkey], since }).pipe(
    auditTime(250),
    map((events) => dedupe(events.flatMap(getVideos))),
  );
}

function arrange(videos: Video[], format: Format | "all", sort: Sort) {
  const list = format === "all" ? [...videos] : videos.filter((v) => v.format === format);
  // Videos without a duration in their imeta go last
  const duration = (v: Video, missing: number) => v.duration ?? missing;

  switch (sort) {
    case "recent":
      return list.sort((a, b) => b.published - a.published);
    case "longest":
      return list.sort((a, b) => duration(b, -1) - duration(a, -1));
    case "shortest":
      return list.sort((a, b) => duration(a, Infinity) - duration(b, Infinity));
    case "resolution":
      return list.sort((a, b) => pixels(b) - pixels(a));
  }
}

/** The smallest playable variant, used for the hover preview */
const previewVariant = (video: Video) => video.variants.filter(canPlay).at(-1);

/** The largest playable variant up to 1080p, or the smallest if they are all larger */
function defaultVariant(video: Video) {
  const playable = video.variants.filter(canPlay);
  return playable.find((v) => Math.min(v.width ?? 0, v.height ?? 0) <= 1080) ?? playable.at(-1) ?? video.variants[0];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const sizeFormat = new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
const bitrateFormat = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "megabit-per-second",
  maximumFractionDigits: 1,
});

function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A resolution label like 1080p from the shorter side, so portrait shorts are labelled the same way */
function formatQuality(v: { width?: number; height?: number }) {
  if (!v.width || !v.height) return undefined;
  const p = Math.min(v.width, v.height);
  return p >= 2160 ? "4K" : `${p}p`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const contentCache = Symbol("video-gallery-content");
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a href={node.href} target="_blank" className="link link-primary break-all">
      {node.value}
    </a>
  ),
  mention: ({ node }) => <span className="text-primary">nostr:{node.encoded.slice(0, 16)}…</span>,
  hashtag: ({ node }) => <span className="text-primary">#{node.name}</span>,
  emoji: ({ node }) => <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" />,
  gallery: () => null,
};

function Content({ event }: { event: NostrEvent }) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache });
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

type PlayerProps = VideoHTMLAttributes<HTMLVideoElement> & {
  variant: Variant;
  /** Extra copies of the file, tried after the imeta fallbacks */
  mirrors?: string[];
  videoRef?: RefObject<HTMLVideoElement | null>;
};

/** Plays a variant from its url and fallbacks, using hls.js for HLS where the browser has no native support */
function Player({ variant, mirrors = [], videoRef, ...props }: PlayerProps) {
  const useHlsJs = isHls(variant) && !nativeHls;
  const ref = useCallback(
    (el: HTMLVideoElement | null) => {
      if (videoRef) videoRef.current = el;
      if (!el || !useHlsJs) return;
      const hls = new Hls();
      hls.loadSource(variant.url);
      hls.attachMedia(el);
      return () => hls.destroy();
    },
    [variant.url, useHlsJs, videoRef],
  );

  // The browser tries each <source> in order until one loads
  const urls = [...new Set([variant.url, ...(variant.fallback ?? []), ...mirrors])];
  return (
    <video ref={ref} {...props}>
      {useHlsJs ? null : urls.map((url) => <source key={url} src={url} type={variant.type} />)}
    </video>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="px-1.5 bg-black/70 text-white text-sm rounded">{children}</span>;
}

function Tile({ video, onOpen }: { video: Video; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  // Index into the preview images, moves to the next mirror when one fails
  const [image, setImage] = useState(0);
  const poster = video.images[image];
  const preview = previewVariant(video);
  const blur = video.warning ? "blur-xl" : "";

  return (
    <button
      className="flex flex-col gap-1 min-w-0 text-left"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative w-full aspect-video overflow-hidden border border-base-300 bg-base-200">
        {video.blurhash ? (
          <div className="absolute inset-0">
            <Blurhash hash={video.blurhash} width="100%" height="100%" punch={1} />
          </div>
        ) : null}

        {poster ? (
          <img
            src={poster}
            alt={video.alt}
            loading="lazy"
            className={`absolute inset-0 size-full object-cover ${blur}`}
            onError={() => setImage(image + 1)}
          />
        ) : preview ? (
          // No preview image in the imeta, show the first frame instead
          <Player
            variant={preview}
            preload="metadata"
            muted
            className={`absolute inset-0 size-full object-cover ${blur}`}
          />
        ) : null}

        {hover && preview && !video.warning ? (
          <Player
            variant={preview}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-contain bg-black"
          />
        ) : null}

        <div className="absolute top-1 left-1 flex gap-1">
          {video.format === "short" ? <Badge>Short</Badge> : null}
          {formatQuality(video) ? <Badge>{formatQuality(video)}</Badge> : null}
          {isHls(video.variants[0]) ? <Badge>HLS</Badge> : null}
        </div>
        {video.warning ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Badge>⚠ {typeof video.warning === "string" ? video.warning : "Sensitive"}</Badge>
          </div>
        ) : null}
        {video.duration ? (
          <div className="absolute bottom-1 right-1">
            <Badge>{formatDuration(video.duration)}</Badge>
          </div>
        ) : null}
      </div>
      <div className="truncate">{video.title ?? dateFormat.format(video.published * 1000)}</div>
    </button>
  );
}

const GAP = 12;
const TILE_WIDTH = 300;
const TITLE_HEIGHT = 28;

/** Renders only the rows of tiles near the viewport so long video histories stay smooth */
function VideoGrid({ videos, onOpen }: { videos: Video[]; onOpen: (key: string) => void }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Track the grid width to pick the number of columns
  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    setScroller(el);
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.round(width / TILE_WIDTH));
  const tileWidth = (width - GAP * (columns - 1)) / columns;
  const virtualizer = useVirtualizer({
    count: Math.ceil(videos.length / columns),
    getScrollElement: () => scroller,
    estimateSize: () => (tileWidth * 9) / 16 + TITLE_HEIGHT + GAP,
    overscan: 2,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 grid"
            style={{
              gap: GAP,
              paddingBottom: GAP,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              transform: `translateY(${row.start}px)`,
            }}
          >
            {videos.slice(row.index * columns, (row.index + 1) * columns).map((video) => (
              <Tile key={video.key} video={video} onOpen={() => onOpen(video.key)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-base-content/60">{label}</dt>
      <dd className="truncate">{children}</dd>
    </>
  );
}

function Lightbox({
  video,
  user,
  onClose,
  onPrev,
  onNext,
}: {
  video: Video;
  user: User;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [selected, setSelected] = useState(() => defaultVariant(video));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Playback position carried over when switching variants
  const resumeAt = useRef(0);

  // BUD-03: the creator's blossom servers may hold a copy of the file by its imeta sha256
  const servers = use$(user.blossomServers$);
  const mirrors = selected.sha256 ? (servers ?? []).map((server) => new URL(selected.sha256!, server).toString()) : [];

  const select = (variant: Variant) => {
    resumeAt.current = videoRef.current?.currentTime ?? 0;
    setSelected(variant);
  };
  const seek = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    void videoRef.current.play();
  };

  return (
    <dialog
      className="modal"
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      onClose={onClose}
      onKeyDown={(e) => {
        // Leave arrow keys to the video controls for seeking
        if (e.target instanceof HTMLVideoElement) return;
        if (e.key === "ArrowLeft") onPrev?.();
        if (e.key === "ArrowRight") onNext?.();
      }}
    >
      <div className="modal-box max-w-6xl w-full p-0 border border-base-300 grid md:grid-cols-[1fr_22rem]">
        <div className="relative bg-black flex items-center justify-center min-h-64">
          <Player
            key={selected.url}
            variant={selected}
            mirrors={mirrors}
            videoRef={videoRef}
            poster={selected.images[0] ?? video.images[0]}
            aria-label={video.alt}
            controls
            autoPlay
            playsInline
            className="max-h-[80vh] w-full"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = resumeAt.current;
            }}
          />
          <button className="btn btn-circle btn-sm absolute left-2 top-2" disabled={!onPrev} onClick={onPrev}>
            ‹
          </button>
          <button className="btn btn-circle btn-sm absolute right-2 top-2" disabled={!onNext} onClick={onNext}>
            ›
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[80vh]">
          {video.title ? <h3 className="text-lg font-semibold">{video.title}</h3> : null}

          {video.variants.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {video.variants.map((v) => (
                <button
                  key={v.url}
                  className={`btn btn-sm ${v === selected ? "btn-primary" : ""}`}
                  disabled={!canPlay(v)}
                  onClick={() => select(v)}
                  title={v.type}
                >
                  {formatQuality(v) ?? v.type ?? "Original"}
                  {isHls(v) ? " HLS" : ""}
                </button>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <Detail label="Published">{dateFormat.format(video.published * 1000)}</Detail>
            {video.duration ? <Detail label="Duration">{formatDuration(video.duration)}</Detail> : null}
            {selected.dimensions ? (
              <Detail label="Resolution">
                {selected.dimensions} ({formatQuality(selected)})
              </Detail>
            ) : null}
            {selected.type ? <Detail label="Type">{selected.type}</Detail> : null}
            {selected.size ? <Detail label="Size">{sizeFormat.format(selected.size / 1e6)}</Detail> : null}
            {selected.bitrate ? <Detail label="Bitrate">{bitrateFormat.format(selected.bitrate / 1e6)}</Detail> : null}
            {selected.sha256 ? (
              <Detail label="sha256">
                <span title={selected.sha256}>{selected.sha256.slice(0, 16)}…</span>
              </Detail>
            ) : null}
            <Detail label="Sources">
              {numberFormat.format(new Set([selected.url, ...(selected.fallback ?? []), ...mirrors]).size)}
            </Detail>
          </dl>

          {video.chapters.length > 0 ? (
            <div className="border border-base-300 rounded-box divide-y divide-base-300">
              {video.chapters.map((chapter) => (
                <button
                  key={chapter.start}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-base-200"
                  onClick={() => seek(chapter.start)}
                >
                  {chapter.image ? <img src={chapter.image} className="h-9 aspect-video object-cover" /> : null}
                  <span className="text-base-content/60">{formatDuration(chapter.start)}</span>
                  <span className="truncate">{chapter.title}</span>
                </button>
              ))}
            </div>
          ) : null}

          {video.hashtags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {video.hashtags.map((tag) => (
                <span key={tag} className="badge badge-ghost">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          <a className="btn btn-sm btn-ghost" href={selected.url} target="_blank">
            Open original
          </a>
          <Content event={video.event} />
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function SyncStatus({ status }: { status?: SyncLoaderStatus }) {
  const relays = Object.values(status?.relays ?? {});
  const finished = relays.filter((r) => r.state === "complete" || r.state === "error").length;
  return (
    <span className="flex items-center gap-2 text-base-content/60" title={relays.map((r) => r.relay).join("\n")}>
      {status?.done ? <span className="text-success">✓</span> : <span className="loading loading-spinner loading-sm" />}
      {numberFormat.format(status?.loaded ?? 0)} events · {finished}/{relays.length} relays
    </span>
  );
}

/** A labelled group of header controls */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-base-content/60">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Gallery({ user }: { user: User }) {
  const [days, setDays] = useState(30);
  const [format, setFormat] = useState<Format | "all">("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [selected, setSelected] = useState<string>();

  const since = useMemo(() => (days ? unixNow() - days * DAY : undefined), [days]);

  // The sync writes into the store while the gallery renders purely from a store query
  const status = use$(() => syncPosts$(user, since), [user.pubkey, since]);
  const videos = use$(() => videos$(user.pubkey, since), [user.pubkey, since]);

  const arranged = useMemo(() => arrange(videos ?? [], format, sort), [videos, format, sort]);
  const counts = useMemo(() => {
    const counts: Record<string, number> = { all: videos?.length ?? 0 };
    for (const v of videos ?? []) counts[v.format] = (counts[v.format] ?? 0) + 1;
    return counts;
  }, [videos]);

  const index = arranged.findIndex((v) => v.key === selected);

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 p-3 border-b border-base-300">
        <Field label="Range">
          <select className="select select-sm w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Format">
          <div className="join">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                className={`btn btn-sm join-item ${format === f.value ? "btn-active" : ""}`}
                onClick={() => setFormat(f.value)}
              >
                {f.label} ({counts[f.value] ?? 0})
              </button>
            ))}
          </div>
        </Field>

        <Field label="Sort">
          <select className="select select-sm w-36" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="ms-auto">
          <SyncStatus status={status} />
        </div>
      </div>

      {!videos || (videos.length === 0 && !status?.done) ? (
        <div className="p-6">
          <span className="loading loading-dots" />
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center text-base-content/60 py-12">No videos found in this range</div>
      ) : arranged.length === 0 ? (
        <div className="text-center text-base-content/60 py-12">No videos match the filter</div>
      ) : (
        <VideoGrid videos={arranged} onOpen={setSelected} />
      )}

      {index >= 0 ? (
        <Lightbox
          key={arranged[index].key}
          video={arranged[index]}
          user={user}
          onClose={() => setSelected(undefined)}
          onPrev={index > 0 ? () => setSelected(arranged[index - 1].key) : undefined}
          onNext={index < arranged.length - 1 ? () => setSelected(arranged[index + 1].key) : undefined}
        />
      ) : null}
    </div>
  );
}

export default function VideoGallery() {
  const [pubkey, setPubkey] = useState(DEFAULT_CREATOR);
  const user = useMemo(() => (pubkey ? castUser(pubkey, eventStore) : undefined), [pubkey]);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300">
        <PubkeyPicker value={pubkey} onChange={setPubkey} placeholder="Any npub, hex pubkey or NIP-05" />
      </div>
      {user ? (
        <Gallery key={user.pubkey} user={user} />
      ) : (
        <div className="p-6 text-center text-base-content/60">Pick a creator to browse their videos</div>
      )}
    </div>
  );
}
