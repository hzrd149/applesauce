/**
 * Compose notes with @ mentions, live previews, and Blossom file uploads.
 * @tags nip-01, nip-65, compose, preview, rendering, blossom, file-upload, mentions, open-ranking
 * @related notes/composing, notes/rendering, search/open-ranking, blossom/server-manager
 */
import { castUser, User } from "applesauce-common/casts";
import { NoteFactory } from "applesauce-common/factories";
import { Link } from "applesauce-content/nast";
import "applesauce-content/text/cashu";
import "applesauce-content/text/lightning";
import { EventStore } from "applesauce-core";
import { isAudioURL, isImageURL, isVideoURL, relaySet } from "applesauce-core/helpers";
import { DEFAULT_OPEN_RANKING_PROVIDER, OpenRanking } from "applesauce-extra/open-ranking";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { multiServerMediaUpload, multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import { createUploadAuth } from "blossom-client-sdk/auth";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { useCallback, useMemo, useRef, useState } from "react";
import { BehaviorSubject, catchError, map, of, switchMap, timer } from "rxjs";

import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: FALLBACK_RELAYS,
});

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

const DEFAULT_BLOSSOM_SERVERS = [new URL("https://blossom.primal.net")];

// Known public Open Ranking providers used to search for @ mentions
const PROVIDERS = [
  { name: "Vertex", url: "https://ranking.vertexlab.io" },
  { name: "Brainstorm", url: DEFAULT_OPEN_RANKING_PROVIDER },
];

/** A file attached to the note that has not been uploaded yet */
type Attachment = { file: File; preview: string };

type MentionMatch = { query: string; start: number; end: number };

/** Finds an "@query" being typed directly before the textarea cursor */
function findMention(textarea: HTMLTextAreaElement): MentionMatch | null {
  const end = textarea.selectionStart;
  if (end !== textarea.selectionEnd) return null;
  const match = textarea.value.slice(0, end).match(/(?:^|\s)@([\w.-]{1,30})$/);
  return match ? { query: match[1], start: end - match[1].length - 1, end } : null;
}

function MentionOption({ pubkey, active, onSelect }: { pubkey: string; active: boolean; onSelect: () => void }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${active ? "bg-base-200" : ""}`}
      // Prevent the textarea from losing focus before the mention is inserted
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
    >
      <img
        src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
        className="w-6 h-6 rounded-full object-cover"
        alt=""
      />
      <span className="truncate">{profile?.displayName ?? npubEncode(pubkey).slice(0, 16) + "…"}</span>
    </button>
  );
}

/** Upload a file to the user's blossom servers and return the URL */
async function uploadToBlossom(
  file: File,
  signer: ISigner,
  blossomServers: URL[] | undefined,
  useMediaOptimization: boolean,
): Promise<string> {
  const servers = blossomServers?.length ? blossomServers : DEFAULT_BLOSSOM_SERVERS;
  const isImageOrVideo = file.type.startsWith("image/") || file.type.startsWith("video/");
  const isMedia = useMediaOptimization && isImageOrVideo;

  const results = await (isMedia ? multiServerMediaUpload : multiServerUpload)(servers, file, {
    onAuth: (_server, sha256, type) => createUploadAuth((draft) => signer.signEvent(draft), sha256, { type }),
  });

  const [, blob] = results.entries().next().value!;
  return blob.url;
}

/** Favicon avatar for a server URL */
function ServerFavicon({ url, size = "w-6 h-6" }: { url: string; size?: string }) {
  const [error, setError] = useState(false);

  let hostname: string;
  let faviconUrl: string;
  try {
    const parsed = new URL(url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://"));
    hostname = parsed.hostname;
    faviconUrl = new URL("/favicon.ico", parsed).href;
  } catch {
    hostname = url;
    faviconUrl = "";
  }

  if (error || !faviconUrl) {
    return (
      <div
        className={`${size} rounded-full bg-base-200 flex items-center justify-center text-sm font-bold`}
        title={hostname}
      >
        {hostname[0]?.toUpperCase() ?? "?"}
      </div>
    );
  }

  return (
    <img
      src={faviconUrl}
      alt={hostname}
      title={hostname}
      className={`${size} rounded-full bg-base-200`}
      onError={() => setError(true)}
    />
  );
}

/** Avatar stack showing servers */
function AvatarStack({ urls }: { urls: string[] }) {
  return (
    <div className="flex -space-x-2">
      {urls.map((url) => (
        <div key={url} className="ring-2 ring-base-100 rounded-full">
          <ServerFavicon url={url} />
        </div>
      ))}
    </div>
  );
}

// Reuse the same component map from the rendering example
function LinkRenderer({ node: link }: { node: Link }) {
  if (isImageURL(link.href))
    return (
      <a href={link.href} target="_blank">
        <img src={link.href} className="max-h-64 rounded" alt="" />
      </a>
    );
  else if (isVideoURL(link.href)) return <video src={link.href} className="max-h-64 rounded" controls />;
  else if (isAudioURL(link.href)) return <audio src={link.href} className="max-h-64 rounded" controls />;
  else
    return (
      <a href={link.href} target="_blank" className="text-blue-500 hover:underline">
        {link.value}
      </a>
    );
}

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: LinkRenderer,
  mention: ({ node }) => (
    <a href={`https://njump.me/${node.encoded}`} target="_blank" className="text-purple-500 hover:underline">
      @{node.encoded.slice(0, 12)}...
    </a>
  ),
  hashtag: ({ node }) => <span className="text-orange-500">#{node.hashtag}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="w-6 h-6 inline" />,
  cashu: ({ node }) => (
    <span className="text-pink-500">
      {node.raw.slice(0, 10)}...{node.raw.slice(-5)}
    </span>
  ),
  lightning: ({ node }) => (
    <span className="text-yellow-400">
      {node.invoice.slice(0, 10)}...{node.invoice.slice(-5)}
    </span>
  ),
};

/** Preview rendered content from a plain text string */
function NotePreview({ content }: { content: string }) {
  const rendered = useRenderedContent(content || undefined, components);

  if (!content.trim()) {
    return <p className="text-base-content/40 italic">Start typing to see a preview...</p>;
  }

  return <div className="whitespace-pre-wrap">{rendered}</div>;
}

function PaperclipIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
    </svg>
  );
}

/** Thumbnail of a local file with a badge marking it as waiting to upload */
function PendingThumb({
  attachment: { file, preview },
  uploading,
  onRemove,
}: {
  attachment: Attachment;
  uploading: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="relative h-20 w-20 border border-base-300 rounded overflow-hidden" title={file.name}>
      {file.type.startsWith("image/") ? (
        <img src={preview} alt={file.name} className="h-full w-full object-cover" />
      ) : file.type.startsWith("video/") ? (
        <video src={preview} className="h-full w-full object-cover" />
      ) : (
        <span className="block p-2 text-sm font-mono break-all">{file.name}</span>
      )}
      <span className="absolute left-1 top-1 rounded-full bg-base-100 border border-base-300 p-1">
        {uploading ? <span className="loading loading-spinner loading-xs block" /> : <UploadIcon />}
      </span>
      {onRemove && (
        <button
          type="button"
          className="btn btn-circle btn-sm absolute right-1 top-1 h-6 min-h-6 w-6"
          onClick={onRemove}
          title="Remove"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Previews a local attachment the same way the uploaded media will render */
function AttachmentPreview({ attachment: { file, preview } }: { attachment: Attachment }) {
  if (file.type.startsWith("image/")) return <img src={preview} className="max-h-64 rounded" alt={file.name} />;
  if (file.type.startsWith("video/")) return <video src={preview} className="max-h-64 rounded" controls />;
  if (file.type.startsWith("audio/")) return <audio src={preview} controls />;
  return <div className="text-sm font-mono">{file.name}</div>;
}

function Composer({ user, signer }: { user: User; signer: ISigner }) {
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [status, setStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [provider, setProvider] = useState(PROVIDERS[0].url);
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [active, setActive] = useState(0);
  const [mediaOptimization, setMediaOptimization] = useState(true);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mailboxes = use$(() => user.mailboxes$, [user.pubkey]);
  const blossomServers = use$(() => user.blossomServers$, [user.pubkey]);
  const publishRelays = useMemo(
    () => (mailboxes?.outboxes?.length ? relaySet(FALLBACK_RELAYS, mailboxes.outboxes) : FALLBACK_RELAYS),
    [mailboxes],
  );

  // The signer authenticates point-of-view searches with Nostr Web Tokens
  const ranking = useMemo(() => new OpenRanking(provider, { signer }), [provider, signer]);
  const query = mention?.query;

  // Search for the mention as the user types, debounced by restarting the timer whenever the query changes
  const results = use$(() => {
    if (!query) return undefined;
    return timer(250).pipe(
      switchMap(() => ranking.discover()),
      switchMap((caps) => {
        // Use the provider's first search algorithm, personalized to the user when it supports a point of view
        const algorithm = caps["/search/pubkeys"]?.[0];
        return ranking.userSearch(query, 8, {
          algorithm: algorithm?.id,
          pov: algorithm?.pov ? user.pubkey : undefined,
        });
      }),
      catchError(() => of([])),
    );
  }, [ranking, query, user.pubkey]);
  const suggestions = mention ? (results ?? []) : [];

  const updateMention = () => {
    if (textareaRef.current) setMention(findMention(textareaRef.current));
  };

  const insertMention = (pubkey: string) => {
    if (!mention) return;
    const text = `nostr:${npubEncode(pubkey)} `;
    setContent(content.slice(0, mention.start) + text + content.slice(mention.end));
    setMention(null);

    // Move the cursor after the inserted mention once React has updated the textarea
    const cursor = mention.start + text.length;
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(cursor, cursor));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % suggestions.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    else if (e.key === "Enter" || e.key === "Tab")
      insertMention(suggestions[Math.min(active, suggestions.length - 1)].pubkey);
    else if (e.key === "Escape") setMention(null);
    else return;
    e.preventDefault();
  };

  // Files stay local with a preview URL until the note is published
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setAttachments((list) => [...list, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    setPublished(false);
    e.target.value = "";
  };

  const removeAttachment = (attachment: Attachment) => {
    URL.revokeObjectURL(attachment.preview);
    setAttachments((list) => list.filter((a) => a !== attachment));
  };

  const handlePublish = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;

    setPublishError(null);
    try {
      // Upload attachments only once publishing starts
      const urls: string[] = [];
      for (const [i, { file }] of attachments.entries()) {
        setStatus(`Uploading ${i + 1}/${attachments.length}…`);
        urls.push(await uploadToBlossom(file, signer, blossomServers, mediaOptimization));
      }

      setStatus("Publishing…");
      const signed = await NoteFactory.create([trimmed, ...urls].filter(Boolean).join("\n")).sign(signer);
      const responses = await pool.publish(publishRelays, signed);
      if (!responses.some((r) => r.ok))
        throw new Error(responses.map((r) => `${r.from}: ${r.message ?? "rejected"}`).join("; "));
      eventStore.add(signed);
      setPublished(true);
      setContent("");
      for (const a of attachments) URL.revokeObjectURL(a.preview);
      setAttachments([]);
      setTab("write");
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setStatus(null);
    }
  }, [content, attachments, publishRelays, signer, blossomServers, mediaOptimization]);

  const publishing = status !== null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Tabs */}
      <div role="tablist" className="tabs tabs-bordered">
        <button
          role="tab"
          type="button"
          className={`tab ${tab === "write" ? "tab-active" : ""}`}
          onClick={() => setTab("write")}
        >
          Write
        </button>
        <button
          role="tab"
          type="button"
          className={`tab ${tab === "preview" ? "tab-active" : ""}`}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
      </div>

      {/* Content area */}
      {tab === "write" ? (
        <div className="relative">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[220px] border border-base-300 rounded-lg bg-base-100 p-4 outline-none resize-y text-base leading-relaxed"
            placeholder="What's on your mind?"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setMention(findMention(e.target));
              setActive(0);
              setPublished(false);
            }}
            onSelect={updateMention}
            onKeyDown={handleKeyDown}
            onBlur={() => setMention(null)}
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-4 top-full z-10 -mt-2 w-64 border border-base-300 rounded-lg bg-base-100 overflow-hidden">
              {suggestions.map((s, i) => (
                <li key={s.pubkey}>
                  <MentionOption pubkey={s.pubkey} active={i === active} onSelect={() => insertMention(s.pubkey)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="border border-base-300 rounded-lg bg-base-100 p-4 min-h-[220px] space-y-2">
          <NotePreview content={content} />
          {attachments.map((a) => (
            <AttachmentPreview key={a.preview} attachment={a} />
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <PendingThumb
              key={a.preview}
              attachment={a}
              uploading={!!status?.startsWith("Uploading")}
              onRemove={publishing ? undefined : () => removeAttachment(a)}
            />
          ))}
        </div>
      )}

      {publishError && <div className="text-error text-sm">{publishError}</div>}
      {published && <div className="text-success text-sm">Published</div>}

      {/* Footer */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={() => fileInputRef.current?.click()}
            disabled={publishing}
            title="Attach file"
          >
            <PaperclipIcon />
          </button>
          <label className="select select-bordered select-sm w-36" title="Open Ranking provider for @ mentions">
            <span className="text-base font-bold text-base-content">@</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm" title="BUD-05 media optimization">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={mediaOptimization}
              onChange={() => setMediaOptimization((v) => !v)}
            />
            Optimize
          </label>
          <AvatarStack urls={(blossomServers ?? DEFAULT_BLOSSOM_SERVERS).map((s) => s.href)} />
        </div>
        <div className="flex items-center gap-3">
          <AvatarStack urls={publishRelays} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={publishing || (!content.trim() && attachments.length === 0)}
          >
            {publishing ? (
              <>
                <span className="loading loading-spinner loading-sm" /> {status}
              </>
            ) : (
              "Publish"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SimpleComposerExample() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  if (!signer || !pubkey || !user) {
    return (
      <LoginView
        onLogin={(s, pk) => {
          signer$.next(s);
          pubkey$.next(pk);
        }}
      />
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-screen">
      <Composer user={user} signer={signer} />
    </div>
  );
}
