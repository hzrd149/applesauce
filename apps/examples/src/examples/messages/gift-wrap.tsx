/**
 * A NIP-17 inbox with local WrappedConversation views, encrypted file messages, cached history and retryable publication
 * @tags nip-17, nip-44, nip-59, nip-77, messages, gift-wrap, encryption, dm, sync, files, blossom
 * @related messages/personal-notes, messages/legacy, messages/ndr, loader/sync-loader
 */
import { castUser, User } from "applesauce-common/casts";
import {
  createConversationIdentifier,
  getMessageAttachments,
  getRumorGiftWraps,
  getRumorSeals,
  isEncryptedFile,
  type FileMetadataFields,
  type Rumor,
} from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  kinds,
  persistEventsToCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  loadAttachment,
  WrappedMessagesClient,
  type MessageAuthRequest,
  type MessageFileUploader,
  type WrappedConversation,
  type PreparedWrappedMessage,
} from "applesauce-extra/messages";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import { createUploadAuth } from "blossom-client-sdk/auth";
import { PanelLeft, PanelRight, Paperclip, X } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type ClipboardEvent, type ReactNode, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  EMPTY,
  finalize,
  firstValueFrom,
  from,
  ignoreElements,
  map,
  merge,
  NEVER,
  type Observable,
  of,
  shareReplay,
  switchMap,
  timeout,
} from "rxjs";

import JsonBlock from "../../components/json-block";
import LoginView, { forgetActiveAccount } from "../../components/login-view";
import NoteContent from "../../components/note-content";
import PubkeyPicker from "../../components/pubkey-picker";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

type HistoryRange = "recent" | "year" | "all";

const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

// Used when the user has not published a Blossom server list
const FALLBACK_BLOSSOM_SERVERS = [new URL("https://blossom.band"), new URL("https://nostr.download")];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
const storage$ = new BehaviorSubject<SecureStorage | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

const db = await openDB();
const cacheRequest = async (filters: Parameters<typeof getEventsForFilters>[1]) =>
  (await getEventsForFilters(db, filters)) as NostrEvent[];

persistEventsToCache(eventStore, (events) => addEvents(db, events));
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, cacheRequest });

/** Creates an uploader that stores encrypted blobs on the user's Blossom servers */
function createBlossomUploader(signer: ISigner, user: User): MessageFileUploader {
  return async (blob, { signal }) => {
    const servers = await firstValueFrom(
      user.blossomServers$.pipe(timeout({ first: 4000, with: () => of(undefined) })),
    );

    // Plain uploads only: media optimization would re-encode the ciphertext and break decryption.
    const results = await multiServerUpload(servers?.length ? servers : FALLBACK_BLOSSOM_SERVERS, blob, {
      signal,
      onAuth: (_server, sha256, type) => createUploadAuth((draft) => signer.signEvent(draft), sha256, { type }),
    });

    const uploads = [...results.values()];
    if (!uploads[0]) throw new Error("No Blossom server accepted the file");
    return { url: uploads[0].url, fallback: uploads.slice(1).map((upload) => upload.url) };
  };
}

// The stream owns the client; switching accounts or leaving the page disposes it
const client$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!signer || !user || !storage) return of(undefined);

    return defer(() => {
      const drafts = storage.createInstance({ name: `gift-wrap:${user.pubkey}`, storeName: "drafts" });
      const client = new WrappedMessagesClient({
        pubkey: user.pubkey,
        signer,
        pool,
        eventStore,
        cacheRequest,
        decryptionCache: storage,
        draftStorage: {
          getItem: (key) => drafts.getItem(key),
          setItem: async (key, value) => {
            if (!(await drafts.setItem(key, value))) throw new Error("Failed to save draft");
          },
          removeItem: (key) => drafts.removeItem(key),
        },
        authTimeout: false,
        upload: createBlossomUploader(signer, user),
      });

      return merge(
        of(client),
        defer(() => client.start()).pipe(
          ignoreElements(),
          // Startup failures are reported by the client's errors$ stream.
          catchError(() => EMPTY),
        ),
        NEVER,
      ).pipe(
        finalize(() => {
          client.dispose();
        }),
      );
    });
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Creates an object URL for a blob that is revoked when the subscription ends */
function objectUrl$(blob: Blob): Observable<string> {
  return defer(() => {
    const url = URL.createObjectURL(blob);
    return merge(of(url), NEVER).pipe(finalize(() => URL.revokeObjectURL(url)));
  });
}

/** Downloads and decrypts an attachment into an object URL */
function attachmentSource$(file: FileMetadataFields): Observable<{ url?: string; error?: string }> {
  if (!isEncryptedFile(file)) return of({ url: file.url });

  return defer(() => {
    const controller = new AbortController();

    return from(loadAttachment(file, { signal: controller.signal })).pipe(
      switchMap((blob) => objectUrl$(blob).pipe(map((url) => ({ url })))),
      catchError((error) => of({ error: error instanceof Error ? error.message : String(error) })),
      finalize(() => controller.abort()),
    );
  });
}

/** Returns the start of a history range, or undefined for the client's recent sync */
function getHistorySince(range: HistoryRange) {
  if (range === "year") return unixNow() - 365 * 86400;
  if (range === "all") return 0;
  return undefined;
}

/** Formats a timestamp as a time for today and a date otherwise */
function formatShortTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
  storage$.next(undefined);
}

function Avatar({ user, size = "h-6 w-6" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
      className={`${size} shrink-0 rounded-full`}
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="min-w-0 truncate font-medium">{getDisplayName(profile, user.npub.slice(0, 12))}</span>;
}

/** Lists the other participants of a group conversation as comma separated names */
function Names({ users }: { users: User[] }) {
  return (
    <span className="flex min-w-0 gap-1 truncate">
      {users.map((user, index) => (
        <span key={user.pubkey} className="flex min-w-0">
          <Name user={user} />
          {index < users.length - 1 && ","}
        </span>
      ))}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <span className="text-sm opacity-60">{title}</span>
      {children}
    </div>
  );
}

function AuthenticationRelay({ request, onAuthenticate }: { request: MessageAuthRequest; onAuthenticate: () => void }) {
  const relay = pool.relay(request.url);
  const name = use$(relay.name$);
  const icon = use$(relay.icon$);

  return (
    <button
      className="flex min-w-0 items-center gap-2 rounded p-2 text-left hover:bg-base-200 disabled:opacity-60"
      disabled={request.state === "authenticating"}
      title={request.error ? String(request.error) : request.url}
      onClick={onAuthenticate}
    >
      <img src={icon} alt="" className="h-6 w-6 shrink-0 rounded" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name ?? new URL(request.url).hostname}</span>
        {request.state === "failed" && (
          <span className="block text-sm text-error [overflow-wrap:anywhere]">{String(request.error)}</span>
        )}
      </span>
      {request.state === "authenticating" && <span className="loading loading-spinner loading-sm" />}
      {request.state === "failed" && <span className="text-sm text-error">Retry</span>}
    </button>
  );
}

function InboxStatus({ client }: { client: WrappedMessagesClient }) {
  const lifecycle = use$(client.status$);
  const sync = use$(client.syncStatus$);
  const stats = use$(client.decryptionState$);
  const relays = use$(client.relays$);
  const auth = use$(client.authRequests$) ?? [];
  const failure = use$(() => client.errors$.pipe(map((failure) => String(failure.error))), [client]);

  const [autoUnlock, setAutoUnlock] = useState(false);
  const [range, setRange] = useState<HistoryRange>("recent");
  const [authenticatingAll, setAuthenticatingAll] = useState(false);
  const [error, setError] = useState<string>();

  // Reconcile older history on top of the client's recent sync while a range is selected
  const history = use$(
    () => (range === "recent" ? undefined : client.sync$({ since: getHistorySince(range) })),
    [client, range],
  );
  const progress = history ?? sync;

  const relayErrors = (progress?.mailboxes ?? [])
    .flatMap((mailbox) => Object.values(mailbox.relays))
    .filter((relay) => relay.error);

  const toggleAutoUnlock = (enabled: boolean) => {
    client.setAutoUnlock(enabled);
    setAutoUnlock(enabled);
  };

  const retryFailed = async () => {
    setError(undefined);

    for (const id of stats?.failed ?? []) {
      const event = eventStore.getEvent(id);
      if (event) await client.retryDecryption(event).catch((error) => setError(String(error)));
    }
  };

  const authenticate = (url: string) => {
    setError(undefined);
    client.authenticate(url).catch((error) => setError(String(error)));
  };

  const authenticateAll = async () => {
    setAuthenticatingAll(true);
    setError(undefined);

    try {
      await client.authenticateAll();
    } catch (error) {
      setError(String(error));
    } finally {
      setAuthenticatingAll(false);
    }
  };

  return (
    <>
      <Section title="Decryption">
        <label className="flex items-center justify-between gap-3 text-sm">
          Auto-decrypt messages
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={autoUnlock}
            onChange={(event) => toggleAutoUnlock(event.target.checked)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost">{stats?.unlocked ?? 0} unlocked</span>
          <span className="badge badge-ghost">{stats?.locked ?? 0} locked</span>
          {!!stats?.failed.length && <span className="badge badge-error">{stats.failed.length} failed</span>}
          {!!stats?.failed.length && (
            <button className="btn btn-sm ms-auto" title="Retry decrypting failed messages" onClick={retryFailed}>
              Retry
            </button>
          )}
        </div>
      </Section>

      <Section title="Inbox">
        <div className="join">
          {HISTORY_RANGES.map((option) => (
            <button
              key={option.value}
              className={`btn btn-sm join-item flex-1 ${range === option.value ? "btn-active" : ""}`}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm opacity-60">
          <span>{lifecycle ?? "idle"}</span>
          <span title={relays?.join("\n")}>{relays?.length ?? 0} relays</span>
          <span className="flex items-center gap-1">
            {progress && !progress.done && <span className="loading loading-spinner loading-sm" />}
            {progress?.loaded ?? 0} events
          </span>
          {relayErrors.length > 0 && (
            <span
              className="text-error"
              title={relayErrors.map((relay) => `${relay.relay}: ${relay.error?.message}`).join("\n")}
            >
              {relayErrors.length} failed
            </span>
          )}
        </div>
      </Section>

      {auth.length > 0 && (
        <Section title="Authentication">
          {auth.map((request) => (
            <AuthenticationRelay key={request.url} request={request} onAuthenticate={() => authenticate(request.url)} />
          ))}
          <button
            className="btn btn-sm"
            disabled={authenticatingAll || auth.every((request) => request.state === "authenticating")}
            onClick={authenticateAll}
          >
            {authenticatingAll && <span className="loading loading-spinner loading-sm" />}
            Auth all
          </button>
        </Section>
      )}

      {(error ?? failure) && <p className="p-3 text-sm text-error [overflow-wrap:anywhere]">{error ?? failure}</p>}
    </>
  );
}

/** Shows the rumor, seals and gift wraps behind a message */
function MessageDetails({
  conversation,
  id,
  onClose,
}: {
  conversation: WrappedConversation;
  id: string;
  onClose: () => void;
}) {
  const message = use$(() => conversation.eventStore.event(id), [conversation, id]);

  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm opacity-60">Message</span>
        <button className="btn btn-sm btn-square btn-ghost" title="Close message details" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {message ? (
        <div className="text-sm">
          <JsonBlock value={{ rumor: message, seals: getRumorSeals(message), wraps: getRumorGiftWraps(message) }} />
        </div>
      ) : (
        <p className="text-sm opacity-60">Message unavailable</p>
      )}
    </div>
  );
}

function ConversationRow({
  group,
  self,
  active,
  onSelect,
}: {
  group: { id: string; participants: string[]; lastMessage: Rumor };
  self: User;
  active: boolean;
  onSelect: () => void;
}) {
  const others = group.participants
    .filter((pubkey) => pubkey !== self.pubkey)
    .map((pubkey) => castUser(pubkey, eventStore));
  const isSelf = others.length === 0;

  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <Avatar user={others[0] ?? self} size="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          {isSelf ? <span className="font-medium">Notes to self</span> : <Names users={others} />}
          {others.length > 1 && <span className="badge badge-ghost">{others.length}</span>}
          <span className="ms-auto shrink-0 text-sm opacity-60">{formatShortTime(group.lastMessage.created_at)}</span>
        </div>
        <span className="truncate text-sm opacity-60">
          {group.lastMessage.kind === kinds.FileMessage ? "Attachment" : group.lastMessage.content}
        </span>
      </div>
    </button>
  );
}

function Account({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function StagedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const preview = use$(() => (file.type.startsWith("image/") ? objectUrl$(file) : of(undefined)), [file]);

  return (
    <div className="flex items-center gap-2 rounded border border-base-300 p-1 pe-2 text-sm" title={file.type}>
      {preview ? (
        <img src={preview} alt={file.name} className="h-10 w-10 rounded object-cover" />
      ) : (
        <Paperclip className="h-4 w-4" />
      )}
      <span className="max-w-40 truncate">{file.name}</span>
      <button className="btn btn-ghost btn-sm btn-square" title="Remove file" onClick={onRemove}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Composer({ conversation, expiration }: { conversation: WrappedConversation; expiration: number }) {
  const draft = use$(conversation.draft$);
  // The input stays uncontrolled, and `values` follows the saved draft without overwriting unsaved typing.
  // Picked files stay in the form, in memory, until the message is sent.
  const { register, getValues, setValue, control } = useForm<{ content: string; files: File[] }>({
    values: { content: draft?.content ?? "", files: [] },
    resetOptions: { keepDirtyValues: true },
  });
  const text = useWatch({ control, name: "content" });
  const files = useWatch({ control, name: "files" });
  const [prepared, setPrepared] = useState<PreparedWrappedMessage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const setFiles = (next: File[]) => setValue("files", next, { shouldDirty: true });

  // Picked and pasted files are only kept in memory until Send encrypts and uploads them
  const stageFiles = (picked: File[]) => {
    if (picked.length > 0) setFiles([...getValues("files"), ...picked]);
  };

  const pasteFiles = (event: ClipboardEvent) => {
    const pasted = [...event.clipboardData.files];
    if (pasted.length === 0) return;

    // Keep the pasted file out of the text, but let plain text paste normally
    event.preventDefault();
    stageFiles(pasted);
  };

  // Saves the draft when the input loses focus or a message is sent, not on every keystroke
  const saveDraft = async () => {
    const content = getValues("content");
    if (content !== (draft?.content ?? "")) await conversation.setDraft({ ...draft, content });
  };

  // Keep the prepared gift wraps so a retry only republishes to recipients that were not accepted
  const publish = async (delivery: PreparedWrappedMessage) => {
    setPrepared(delivery);
    await delivery.publish();
    setPrepared(undefined);
    if (delivery.message.kind === kinds.PrivateDirectMessage) await conversation.clearDraft();
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      // Save first so clearing the draft also resets the input
      await saveDraft();
      if (prepared) return await publish(prepared);

      const expires = expiration ? unixNow() + expiration : undefined;

      // NIP-17 sends each file as its own kind 15 message, encrypted and uploaded only now
      for (const file of getValues("files")) {
        const uploaded = await conversation.uploadFile(file);
        const delivery = await conversation.prepareSend({
          content: "",
          file: uploaded,
          expiration: expires,
          envelopeExpiration: expires,
        });
        setFiles(getValues("files").filter((staged) => staged !== file));
        await publish(delivery);
      }

      const content = getValues("content");
      if (content.trim()) {
        await publish(await conversation.prepareSend({ content, expiration: expires, envelopeExpiration: expires }));
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-base-300 p-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <StagedFile
              key={`${index}:${file.name}`}
              file={file}
              onRemove={() => setFiles(files.filter((staged) => staged !== file))}
            />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          className="textarea flex-1"
          rows={1}
          placeholder="Message"
          disabled={!!prepared || busy}
          onPaste={pasteFiles}
          {...register("content", { onBlur: () => saveDraft().catch((error) => setError(String(error))) })}
        />
        <label
          className={`btn btn-square btn-ghost ${busy || prepared ? "btn-disabled" : ""}`}
          title="Attach encrypted files"
        >
          <Paperclip className="h-5 w-5" />
          <input
            type="file"
            multiple
            className="hidden"
            disabled={busy || !!prepared}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = "";
              stageFiles(picked);
            }}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={busy || (!text.trim() && files.length === 0 && !prepared)}
          onClick={send}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : prepared ? "Retry" : "Send"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function Attachment({ file }: { file: FileMetadataFields }) {
  const source = use$(() => attachmentSource$(file), [file]);
  const type = file.type ?? "";

  if (!source) return <span className="loading loading-spinner loading-sm" title="Decrypting" />;
  if (source.error || !source.url)
    return (
      <span className="text-sm text-error" title={file.url}>
        {source.error ?? "Missing file"}
      </span>
    );

  if (type.startsWith("image/")) return <img src={source.url} alt={file.alt} className="max-h-72 rounded" />;
  if (type.startsWith("video/")) return <video src={source.url} controls className="max-h-72 rounded" />;
  if (type.startsWith("audio/")) return <audio src={source.url} controls />;
  return (
    <a href={source.url} download className="link" title={type}>
      Download file
    </a>
  );
}

function MessageBubble({
  message,
  self,
  status,
  onInspect,
}: {
  message: Rumor;
  self: string;
  status?: string;
  onInspect: () => void;
}) {
  const author = castUser(message.pubkey, eventStore);
  const isOwn = message.pubkey === self;
  const attachments = getMessageAttachments(message);

  return (
    <div className={`chat ${isOwn ? "chat-end" : "chat-start"}`}>
      <div className="chat-image">
        <Avatar user={author} size="h-10 w-10" />
      </div>
      <div className="chat-header flex gap-2 text-sm">
        <Name user={author} />
        <time className="opacity-60">{formatShortTime(message.created_at)}</time>
      </div>
      <div className={`chat-bubble flex flex-col gap-2 ${isOwn ? "chat-bubble-primary" : ""}`}>
        {/* A file message's content is only the encrypted file URL */}
        {message.kind !== kinds.FileMessage && <NoteContent event={message} />}
        {attachments.map((file) => (
          <Attachment key={file.url} file={file} />
        ))}
      </div>
      <div className="chat-footer gap-2 text-sm">
        {status && <span className="opacity-60">{status}</span>}
        <button className="link opacity-60" onClick={onInspect}>
          Details
        </button>
      </div>
    </div>
  );
}

function Conversation({
  conversation,
  onInspect,
}: {
  conversation: WrappedConversation;
  onInspect: (id: string) => void;
}) {
  const messages = use$(conversation.messages$);
  const publications = use$(conversation.client.publications$);
  const [expiration, setExpiration] = useState(0);

  const others = conversation.participants
    .filter((pubkey) => pubkey !== conversation.client.pubkey)
    .map((pubkey) => castUser(pubkey, eventStore));

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
      <div className="flex items-center gap-3 border-b border-base-300 p-3">
        {others.length === 0 ? (
          <span className="font-medium">Notes to self</span>
        ) : (
          <>
            <div className="flex -space-x-3">
              {others.map((user) => (
                <Avatar key={user.pubkey} user={user} size="h-8 w-8" />
              ))}
            </div>
            <Names users={others} />
          </>
        )}
        <span className="badge badge-ghost ms-auto">{messages?.length ?? 0} messages</span>
        <select
          aria-label="Message expiration"
          className="select select-sm w-36"
          value={expiration}
          onChange={(event) => setExpiration(Number(event.target.value))}
        >
          <option value={0}>Never expire</option>
          <option value={3600}>1 hour</option>
          <option value={86400}>1 day</option>
          <option value={7 * 86400}>1 week</option>
        </select>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-x-hidden overflow-y-auto p-4">
        {messages === undefined ? (
          <span className="loading loading-dots mx-auto" />
        ) : messages.length === 0 ? (
          <p className="text-center opacity-60">No messages</p>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              self={conversation.client.pubkey}
              status={publications?.[message.id]}
              onInspect={() => onInspect(message.id)}
            />
          ))
        )}
      </div>

      <Composer conversation={conversation} expiration={expiration} />
    </main>
  );
}

function Inbox({ client, user }: { client: WrappedMessagesClient; user: User }) {
  const groups = use$(client.conversations$);
  const [selected, setSelected] = useState(client.pubkey);
  const [inspecting, setInspecting] = useState<string>();
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const conversation = client.conversation(selected);

  // Message details belong to the open conversation, so close them when switching
  const selectConversation = (id: string) => {
    setSelected(id);
    setInspecting(undefined);
  };

  const startConversation = (pubkey: string) => {
    if (pubkey) selectConversation(createConversationIdentifier(client.pubkey, [pubkey]));
  };

  const inspectMessage = (id: string) => {
    setInspecting(id);
    setDrawerOpen(true);
  };

  // Keep notes to self pinned at the top even before it has any messages
  const selfGroup = groups?.find((group) => group.id === client.pubkey);
  const otherGroups = groups?.filter((group) => group.id !== client.pubkey) ?? [];

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col overflow-x-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-base-300 px-3 py-2">
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle conversations drawer"
          title={conversationsOpen ? "Hide conversations" : "Show conversations"}
          aria-expanded={conversationsOpen}
          aria-controls="conversations-drawer"
          onClick={() => setConversationsOpen(!conversationsOpen)}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle inbox status drawer"
          title={drawerOpen ? "Hide inbox status" : "Show inbox status"}
          aria-expanded={drawerOpen}
          aria-controls="inbox-drawer"
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          <PanelRight className="h-5 w-5" />
        </button>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <aside
          id="conversations-drawer"
          aria-label="Conversations"
          hidden={!conversationsOpen}
          className="flex w-72 shrink-0 flex-col border-e border-base-300"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-base-300 p-3">
              <PubkeyPicker value="" placeholder="Start a conversation" onChange={startConversation} />
            </div>

            {selfGroup ? (
              <ConversationRow
                group={selfGroup}
                self={user}
                active={selected === selfGroup.id}
                onSelect={() => selectConversation(selfGroup.id)}
              />
            ) : (
              <button
                className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${selected === client.pubkey ? "bg-base-200" : ""}`}
                onClick={() => selectConversation(client.pubkey)}
              >
                <Avatar user={user} size="h-10 w-10" />
                <span className="font-medium">Notes to self</span>
              </button>
            )}

            {groups === undefined ? (
              <div className="flex justify-center p-6">
                <span className="loading loading-dots" />
              </div>
            ) : otherGroups.length === 0 ? (
              <p className="p-6 text-center opacity-60">No conversations</p>
            ) : (
              otherGroups.map((group) => (
                <ConversationRow
                  key={group.id}
                  group={group}
                  self={user}
                  active={selected === group.id}
                  onSelect={() => selectConversation(group.id)}
                />
              ))
            )}
          </div>
          <Account user={user} />
        </aside>

        <Conversation key={conversation.id} conversation={conversation} onInspect={inspectMessage} />

        <aside
          id="inbox-drawer"
          aria-label="Inbox status"
          hidden={!drawerOpen}
          className="w-80 shrink-0 overflow-x-hidden overflow-y-auto border-s border-base-300 bg-base-100"
        >
          {inspecting && (
            <MessageDetails
              key={inspecting}
              conversation={conversation}
              id={inspecting}
              onClose={() => setInspecting(undefined)}
            />
          )}
          <InboxStatus client={client} />
        </aside>
      </div>
    </div>
  );
}

export default function WrappedMessagesExample() {
  const signer = use$(signer$);
  const user = use$(user$);
  const storage = use$(storage$);
  const client = use$(client$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!client) return <span className="loading loading-spinner m-auto" />;

  return <Inbox key={user.pubkey} client={client} user={user} />;
}
