/**
 * Compose and publish notes with @ mentions and media uploads to configured Blossom servers.
 * @tags nip-01, nip-65, compose, editor, nostr-editor, blossom, file-upload, mentions, open-ranking
 * @related notes/rendering, notes/simple-composer, search/open-ranking, blossom/server-manager
 */
import type { Editor } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { castUser, User } from "applesauce-common/casts";
import { NoteFactory, type NoteTemplate } from "applesauce-common/factories";
import { EventStore } from "applesauce-core";

import { relaySet } from "applesauce-core/helpers";
import { DEFAULT_OPEN_RANKING_PROVIDER, OpenRanking } from "applesauce-extra/open-ranking";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { multiServerMediaUpload, multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import { createUploadAuth } from "blossom-client-sdk/auth";
import type { FileAttributes, FileUploadStorage, NostrStorage, UploadTask } from "nostr-editor";
import { NostrExtension } from "nostr-editor";
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

/** Editor and unsigned kind 1 draft being reviewed before publishing */
const draft$ = new BehaviorSubject<{ editor: Editor; template: NoteTemplate } | null>(null);

// Known public Open Ranking providers used to search for @ mentions
const PROVIDERS = [
  { name: "Vertex", url: "https://ranking.vertexlab.io" },
  { name: "Brainstorm", url: DEFAULT_OPEN_RANKING_PROVIDER },
];

const DEFAULT_BLOSSOM_SERVERS = [new URL("https://blossom.primal.net")];

/** Create a blossom upload handler for nostr-editor's fileUpload extension */
function createBlossomUploader(signer: ISigner, blossomServers: URL[] | undefined, useMediaOptimization: boolean) {
  return async (attrs: FileAttributes): Promise<UploadTask> => {
    const file = attrs.file;
    if (!file) return { error: "No file provided" };

    const servers = blossomServers?.length ? blossomServers : DEFAULT_BLOSSOM_SERVERS;
    const isImageOrVideo = file.type.startsWith("image/") || file.type.startsWith("video/");
    const isMedia = useMediaOptimization && isImageOrVideo;

    try {
      const results = await (isMedia ? multiServerMediaUpload : multiServerUpload)(servers, file, {
        onAuth: (_server, sha256, type) => createUploadAuth((draft) => signer.signEvent(draft), sha256, { type }),
      });

      // Use the first successful result (primary server)
      const [, blob] = results.entries().next().value!;

      return {
        result: {
          url: blob.url,
          sha256: blob.sha256,
          tags: [
            ["url", blob.url],
            ["x", blob.sha256],
            ...(blob.size ? [["size", String(blob.size)]] : []),
            ...(blob.type ? [["m", blob.type]] : []),
          ],
        },
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Upload failed" };
    }
  };
}

/** Favicon avatar for a blossom server */
function ServerFavicon({ server }: { server: URL }) {
  const [error, setError] = useState(false);

  const faviconUrl = new URL("/favicon.ico", server).href;

  if (error) {
    return (
      <div
        className="w-6 h-6 rounded-full bg-base-200 flex items-center justify-center text-sm font-bold"
        title={server.hostname}
      >
        {server.hostname[0].toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={faviconUrl}
      alt={server.hostname}
      title={server.hostname}
      className="w-6 h-6 rounded-full bg-base-200"
      onError={() => setError(true)}
    />
  );
}

/** Avatar stack showing blossom servers */
function ServerAvatarStack({ servers }: { servers: URL[] }) {
  return (
    <div className="flex -space-x-2">
      {servers.map((server) => (
        <div key={server.href} className="ring-2 ring-base-100 rounded-full">
          <ServerFavicon server={server} />
        </div>
      ))}
    </div>
  );
}

function nostrStorage(editor: Editor): NostrStorage {
  return (editor.storage as unknown as { nostr: NostrStorage }).nostr;
}

function fileUploader(editor: Editor) {
  return (editor.storage as unknown as { fileUpload: FileUploadStorage }).fileUpload.uploader!;
}

/** Attached files that are still local blobs waiting to be uploaded */
function pendingFiles(editor: Editor): FileAttributes[] {
  return fileUploader(editor)
    .getFiles()
    .filter((f) => f.src.startsWith("blob:"));
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
function PendingThumb({ file, src, uploading }: { file: File; src: string; uploading?: boolean }) {
  return (
    <div className="relative h-20 w-20 border border-base-300 rounded overflow-hidden" title={file.name}>
      {file.type.startsWith("image/") ? (
        <img src={src} alt={file.name} className="h-full w-full object-cover" />
      ) : file.type.startsWith("video/") ? (
        <video src={src} className="h-full w-full object-cover" />
      ) : (
        <span className="block p-2 text-sm font-mono break-all">{file.name}</span>
      )}
      <span className="absolute right-1 top-1 rounded-full bg-base-100 border border-base-300 p-1">
        {uploading ? <span className="loading loading-spinner loading-xs block" /> : <UploadIcon />}
      </span>
    </div>
  );
}

/** Renders nostr-editor's nprofile nodes as "@name" chips */
function MentionChip({ node }: NodeViewProps) {
  const profile = use$(() => castUser(node.attrs.pubkey, eventStore).profile$, [node.attrs.pubkey]);
  return (
    <NodeViewWrapper as="span" className="text-primary">
      @{profile?.displayName ?? node.attrs.bech32.slice(0, 12) + "…"}
    </NodeViewWrapper>
  );
}

type MentionMatch = { query: string; from: number; to: number; left: number; top: number };

/** Finds an "@query" being typed directly before the cursor */
function findMention(editor: Editor): MentionMatch | null {
  const { $from, empty } = editor.state.selection;
  if (!empty) return null;
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 40),
    $from.parentOffset,
    undefined,
    "\ufffc",
  );
  const match = before.match(/(?:^|\s)@([\w.-]{1,30})$/);
  if (!match) return null;

  const from = $from.pos - match[1].length - 1;
  const coords = editor.view.coordsAtPos(from);
  return { query: match[1], from, to: $from.pos, left: coords.left, top: coords.bottom };
}

function MentionOption({ pubkey, active, onSelect }: { pubkey: string; active: boolean; onSelect: () => void }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${active ? "bg-base-200" : ""}`}
      // Prevent the editor from losing focus before the mention is inserted
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

async function noteTemplateFromEditor(editor: Editor): Promise<NoteTemplate> {
  const content = editor.getText({ blockSeparator: "\n\n" }).trim();
  if (!content) throw new Error("Write something before continuing.");

  let factory = NoteFactory.create().text(content);
  const imeta = nostrStorage(editor).getImetaTags();
  if (imeta.length > 0) {
    factory = factory.modifyPublicTags((tags) => [...tags, ...imeta]);
  }
  return factory;
}

function ComposerBody({ user, signer }: { user: User; signer: ISigner }) {
  const [buildError, setBuildError] = useState<string | null>(null);
  const [mediaOptimization, setMediaOptimization] = useState(true);
  const [provider, setProvider] = useState(PROVIDERS[0].url);
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [active, setActive] = useState(0);

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

  const blossomServers = use$(() => user.blossomServers$, [user.pubkey]);

  // Keep refs so the editor upload closure always sees the latest values
  const blossomServersRef = useRef(blossomServers);
  blossomServersRef.current = blossomServers;
  const mediaOptimizationRef = useRef(mediaOptimization);
  mediaOptimizationRef.current = mediaOptimization;

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        NostrExtension.configure({
          extend: { nprofile: { addNodeView: () => ReactNodeViewRenderer(MentionChip) } },
          fileUpload: {
            // Files stay local until the note is published
            immediateUpload: false,
            allowedMimeTypes: [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp",
              "image/svg+xml",
              "video/mp4",
              "video/webm",
              "video/quicktime",
              "audio/mpeg",
              "audio/ogg",
              "audio/wav",
              "audio/webm",
            ],
            upload: (attrs) =>
              createBlossomUploader(signer, blossomServersRef.current, mediaOptimizationRef.current)(attrs),
          },
          link: { autolink: true },
        }),
      ],
      content: "",
      autofocus: true,
      onUpdate: ({ editor }) => {
        setMention(findMention(editor));
        setActive(0);
      },
      onSelectionUpdate: ({ editor }) => setMention(findMention(editor)),
      editorProps: {
        handleKeyDown: (_view, event) => mentionKeysRef.current(event),
        attributes: {
          class: "min-h-[220px] px-3 py-2 outline-none focus:outline-none max-w-none text-base leading-relaxed",
        },
      },
    },
    [],
  );

  const insertMention = (pubkey: string) => {
    if (!editor || !mention) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: mention.from, to: mention.to }, [
        { type: "nprofile", attrs: { type: "npub", bech32: npubEncode(pubkey), pubkey, relays: [] } },
        { type: "text", text: " " },
      ])
      .run();
    setMention(null);
  };

  // Keep a ref so the editor's keydown handler always sees the latest suggestions
  const mentionKeysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  mentionKeysRef.current = (e) => {
    if (!suggestions.length) return false;
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % suggestions.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    else if (e.key === "Enter" || e.key === "Tab")
      insertMention(suggestions[Math.min(active, suggestions.length - 1)].pubkey);
    else if (e.key === "Escape") setMention(null);
    else return false;
    return true;
  };

  const handleContinue = useCallback(async () => {
    if (!editor) return;
    setBuildError(null);
    try {
      const template = await noteTemplateFromEditor(editor);
      draft$.next({ editor, template });
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Could not build note");
    }
  }, [editor]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {buildError && <div className="text-error text-sm">{buildError}</div>}
      <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="min-h-[220px] p-4 text-base-content/50">Loading…</div>
        )}
        {editor && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-base-300">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              onClick={() => editor.commands.selectFiles()}
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
                onChange={() => setMediaOptimization((value) => !value)}
              />
              Optimize
            </label>
            <div className="ml-auto">
              <ServerAvatarStack servers={blossomServers?.length ? blossomServers : DEFAULT_BLOSSOM_SERVERS} />
            </div>
          </div>
        )}
      </div>
      {mention && suggestions.length > 0 && (
        <ul
          className="fixed z-50 w-64 border border-base-300 rounded-lg bg-base-100 overflow-hidden"
          style={{ left: mention.left, top: mention.top + 4 }}
        >
          {suggestions.map((s, i) => (
            <li key={s.pubkey}>
              <MentionOption pubkey={s.pubkey} active={i === active} onSelect={() => insertMention(s.pubkey)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={handleContinue} disabled={!editor}>
          Review & publish
        </button>
      </div>
    </div>
  );
}

function PublishBody({
  user,
  signer,
  editor,
  draft,
}: {
  user: User;
  signer: ISigner;
  editor: Editor;
  draft: NoteTemplate;
}) {
  const mailboxes = use$(() => user.mailboxes$, [user.pubkey]);
  const publishRelays = useMemo(
    () => (mailboxes?.outboxes?.length ? relaySet(FALLBACK_RELAYS, mailboxes.outboxes) : FALLBACK_RELAYS),
    [mailboxes],
  );

  const [status, setStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<{ relay: string; ok: boolean; message?: string }[] | null>(null);

  const pending = pendingFiles(editor);

  // Hide local blob URLs from the text, the pending files are shown as thumbnails instead
  const content = pending.reduce((text, f) => text.split(f.src).join(""), draft.content).trim();

  const handleBack = useCallback(() => {
    setLastResults(null);
    setPublishError(null);
    draft$.next(null);
  }, []);

  const handlePublish = useCallback(async () => {
    setPublishError(null);
    setLastResults(null);
    try {
      // Upload attachments only now that the draft has been reviewed
      if (pendingFiles(editor).length > 0) {
        setStatus("Uploading…");
        await fileUploader(editor).start();
      }

      // Rebuild the draft so it contains the uploaded URLs and imeta tags
      const template = await noteTemplateFromEditor(editor);
      draft$.next({ editor, template });

      setStatus("Signing…");
      const toSign = { ...template, created_at: Math.floor(Date.now() / 1000) };
      const signed = await new NoteFactory((resolve) => resolve(toSign)).sign(signer);

      setStatus("Publishing…");
      const responses = await pool.publish(publishRelays, signed);
      setLastResults(responses.map((r) => ({ relay: r.from, ok: r.ok, message: r.message })));
      if (responses.some((r) => r.ok)) eventStore.add(signed);
      else setPublishError("No relay accepted the note");
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setStatus(null);
    }
  }, [editor, publishRelays, signer]);

  const publishing = status !== null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <section className="border border-base-300 rounded-lg p-4 space-y-2">
        <h2 className="font-semibold text-sm text-base-content/60">Content</h2>
        <pre className="whitespace-pre-wrap text-sm font-sans">{content}</pre>
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pending.map((f) => (
              <PendingThumb key={f.src} file={f.file} src={f.src} uploading={status === "Uploading…"} />
            ))}
          </div>
        )}
      </section>
      <section className="border border-base-300 rounded-lg p-4 space-y-2">
        <h2 className="font-semibold text-sm text-base-content/60">Tags ({draft.tags.length})</h2>
        <ul className="text-sm font-mono space-y-1 max-h-40 overflow-y-auto">
          {draft.tags.map((t, i) => (
            <li key={i} className="text-base-content/80">
              [{t.map((c) => JSON.stringify(c)).join(", ")}]
            </li>
          ))}
        </ul>
      </section>
      <section className="border border-base-300 rounded-lg p-4 space-y-2">
        <h2 className="font-semibold text-sm text-base-content/60">Relays</h2>
        <ul className="flex flex-wrap gap-2">
          {publishRelays.map((r) => (
            <li key={r} className="badge badge-outline badge-md font-mono">
              {r.replace(/^wss:\/\//, "")}
            </li>
          ))}
        </ul>
      </section>
      {publishError && <div className="text-error text-sm">{publishError}</div>}
      {lastResults && (
        <div className="border border-base-300 rounded-lg p-4 space-y-2">
          <h2 className="font-semibold text-sm text-base-content/60">Relay responses</h2>
          <ul className="space-y-1 text-sm font-mono">
            {lastResults.map((r) => (
              <li key={r.relay} className="flex gap-2 items-center">
                <span className={r.ok ? "text-success" : "text-error"}>{r.ok ? "ok" : "fail"}</span>
                <span>{r.relay.replace(/^wss:\/\//, "")}</span>
                {r.message && <span className="text-base-content/50 truncate">{r.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={handleBack} disabled={publishing}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !!lastResults}
        >
          {publishing ? (
            <>
              <span className="loading loading-spinner loading-sm" /> {status}
            </>
          ) : (
            "Sign & publish"
          )}
        </button>
      </div>
    </div>
  );
}

function SignedInFlow({ user, signer }: { user: User; signer: ISigner }) {
  const draft = use$(draft$);

  // Keep the editor mounted while reviewing so its pending files can be uploaded on publish
  return (
    <>
      <div className={draft ? "hidden" : ""}>
        <ComposerBody user={user} signer={signer} />
      </div>
      {draft && <PublishBody user={user} signer={signer} editor={draft.editor} draft={draft.template} />}
    </>
  );
}

export default function NoteComposingExample() {
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
    <div className="container mx-auto p-4 min-h-xl">
      <SignedInFlow user={user} signer={signer} />
    </div>
  );
}
