/**
 * A double-ratchet NdrMessagesClient with direct chats, groups, reactions, receipts, typing, and app-key device management
 * @tags messages, ndr, double-ratchet, app-keys, multi-device, groups, dm, receipts, typing, storage
 * @related messages/legacy, messages/gift-wrap, napplet/messages
 */
import { castUser, User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import {
  createNdrStorage,
  getNdrGroupId,
  NdrConversation,
  NdrMessagesClient,
  type NdrConversationSummary,
  type NdrDevice,
  type NdrGroupConversation,
  type NdrMessage,
} from "applesauce-extra/messages/ndr";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { PanelLeft, PanelRight, X } from "lucide-react";
import type { PreparedRegistration } from "nostr-double-ratchet";
import { type ReactNode, useCallback, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  EMPTY,
  finalize,
  ignoreElements,
  merge,
  NEVER,
  of,
  shareReplay,
  switchMap,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

// NDR device keys have no NIP-65 mailboxes, so invites and envelopes use one explicit relay set.
const NDR_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const REACTIONS = ["👍", "❤️", "😂", "🎉"];
const TTL_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Keep messages", seconds: null },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 7 * 86400 },
];
const DELIVERY_LABELS: Record<NdrMessage["delivery"], string> = {
  queued: "Queued",
  published: "Sent",
  delivered: "Delivered",
  seen: "Seen",
  received: "",
};
const DELIVERY_TITLES: Record<NdrMessage["delivery"], string> = {
  queued: "Encrypted and saved locally, waiting for a relay to accept it",
  published: "A relay accepted the encrypted envelope",
  delivered: "The recipient's device decrypted it",
  seen: "The recipient opened the conversation",
  received: "",
};

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
const storage$ = new BehaviorSubject<SecureStorage | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// The stream owns the client; a signer is optional so another device can link this one
const client$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!user || !storage) return of(undefined);

    return defer(() => {
      // Ratchet state, the outbox, and decrypted history live in one encrypted store per account.
      const secure = storage.createInstance({ name: "ndr-messages", storeName: `account_${user.pubkey}` });
      const client = new NdrMessagesClient({
        pubkey: user.pubkey,
        signer,
        eventStore,
        pool,
        relays: NDR_RELAYS,
        storage: createNdrStorage(secure),
      });

      return merge(
        of(client),
        defer(() => client.start()).pipe(
          ignoreElements(),
          // Startup failures are reported by the client's lifecycle$ and errors$ streams.
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

/** Formats a timestamp as a time for today and a date otherwise */
function formatShortTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

/** Shortens a device key, which is not a user and has no profile */
function shortKey(pubkey: string | null | undefined) {
  return pubkey ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : "unknown";
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <span className="text-sm opacity-60">{title}</span>
      {children}
    </div>
  );
}

/** Runs an async action with busy and error flags for a button */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run };
}

function ThisDevice({ client }: { client: NdrMessagesClient }) {
  const state = use$(client.state$);
  const [label, setLabel] = useState("This browser");
  const [prepared, setPrepared] = useState<PreparedRegistration>();
  const { busy, error, run } = useAction();

  const registered = !!state?.isCurrentDeviceRegistered;

  return (
    <Section title="This device">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm" title={state?.currentDevicePubkey ?? undefined}>
          {shortKey(state?.currentDevicePubkey)}
        </code>
        <span className={`badge ${registered ? "badge-success" : "badge-warning"}`}>
          {registered ? "Registered" : "Not registered"}
        </span>
      </div>

      {client.signer && !registered && !prepared && (
        <div className="flex gap-2">
          <input
            className="input input-sm min-w-0 flex-1"
            aria-label="Device label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => run(async () => setPrepared(await client.prepareRegistration(label)))}
          >
            {busy && <span className="loading loading-spinner loading-sm" />}
            Register
          </button>
        </div>
      )}

      {prepared && (
        <div className="flex flex-col gap-2">
          <span className="text-sm" title={prepared.devices.map((device) => device.identityPubkey).join("\n")}>
            New roster: {prepared.baseDevices.length} → {prepared.devices.length} devices
          </span>
          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await client.publishRegistration(prepared, label);
                  setPrepared(undefined);
                })
              }
            >
              {busy && <span className="loading loading-spinner loading-sm" />}
              Sign and publish
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPrepared(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </Section>
  );
}

function DeviceRow({ client, device }: { client: NdrMessagesClient; device: NdrDevice }) {
  const [label, setLabel] = useState(device.label ?? "");
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col gap-1 border-b border-base-300 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <input
          className="input input-sm input-ghost min-w-0 flex-1 px-1"
          aria-label="Device label"
          placeholder="Add label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => {
            if (label !== (device.label ?? "")) void run(() => client.setDeviceLabel(device.identityPubkey, label));
          }}
        />
        {device.current && <span className="badge badge-primary">Current</span>}
      </div>
      <div className="flex items-center gap-2 text-sm opacity-60">
        <code title={device.identityPubkey}>{shortKey(device.identityPubkey)}</code>
        <span>{new Date(device.createdAt * 1000).toLocaleDateString()}</span>
        {client.signer && !device.current && (
          <button
            className={`btn btn-sm ms-auto ${confirming ? "btn-error" : "btn-ghost"}`}
            disabled={busy}
            onClick={() => {
              if (!confirming) return setConfirming(true);
              void run(() => client.revokeDevice(device.identityPubkey));
            }}
            onBlur={() => setConfirming(false)}
          >
            {busy && <span className="loading loading-spinner loading-sm" />}
            {confirming ? "Confirm revoke" : "Revoke"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </div>
  );
}

function AppKeys({ client }: { client: NdrMessagesClient }) {
  const devices = use$(client.devices$) ?? [];

  return (
    <Section title={`App keys (${devices.length})`}>
      {devices.length === 0 ? (
        <span className="text-sm opacity-60">No devices registered</span>
      ) : (
        <div className="flex flex-col">
          {devices.map((device) => (
            <DeviceRow key={`${device.identityPubkey}:${device.label}`} client={client} device={device} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ApproveDevice({ client }: { client: NdrMessagesClient }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const { busy, error, run } = useAction();

  return (
    <Section title="Link a device">
      <input
        className="input input-sm"
        placeholder="Paste the link from the new device"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="input input-sm min-w-0 flex-1"
          placeholder="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <button
          className="btn btn-sm"
          disabled={busy || !url.trim()}
          onClick={() =>
            run(async () => {
              await client.approveLink(url.trim(), label.trim() || undefined);
              setUrl("");
              setLabel("");
            })
          }
        >
          {busy && <span className="loading loading-spinner loading-sm" />}
          Approve
        </button>
      </div>
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </Section>
  );
}

function LinkThisDevice({ client }: { client: NdrMessagesClient }) {
  const state = use$(client.state$);
  const [url, setUrl] = useState<string>();
  const { busy, error, run } = useAction();

  if (state?.isCurrentDeviceRegistered) return null;

  return (
    <Section title="Link this device">
      {url ? (
        <>
          <div className="flex gap-2">
            <input className="input input-sm min-w-0 flex-1" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(url)}>
              Copy
            </button>
          </div>
          <span
            className="flex items-center gap-2 text-sm opacity-60"
            title="Paste the link into Link a device on a signed-in device"
          >
            <span className="loading loading-dots loading-sm" /> Waiting for approval
          </span>
        </>
      ) : (
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={() => run(async () => setUrl(await client.createLinkInvite()))}
        >
          Create link
        </button>
      )}
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </Section>
  );
}

function InviteControls({ client }: { client: NdrMessagesClient }) {
  const state = use$(client.state$);
  const { busy, error, run } = useAction();
  if (!state?.isCurrentDeviceRegistered) return null;

  return (
    <Section title="Invite">
      <div className="flex gap-2">
        <button
          className="btn btn-sm flex-1"
          title="Publish this device's invite again"
          disabled={busy}
          onClick={() => run(() => client.republishInvite())}
        >
          Republish
        </button>
        <button
          className="btn btn-sm flex-1"
          title="Replace the invite keys used to start new sessions"
          disabled={busy}
          onClick={() => run(() => client.rotateInvite())}
        >
          Rotate
        </button>
      </div>
      {error && <p className="text-sm text-error [overflow-wrap:anywhere]">{error}</p>}
    </Section>
  );
}

function ClientStatus({ client }: { client: NdrMessagesClient }) {
  const lifecycle = use$(client.lifecycle$);
  const pending = use$(client.pendingPublications$) ?? 0;
  const failure = use$(client.errors$);
  const { busy, run } = useAction();

  return (
    <Section title="Status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-ghost">{lifecycle}</span>
        <span className="badge badge-ghost" title={client.relays.join("\n")}>
          {client.relays.length} relays
        </span>
        <span className={`badge ${pending ? "badge-warning" : "badge-ghost"}`}>{pending} pending</span>
        {pending > 0 && (
          <button className="btn btn-sm ms-auto" disabled={busy} onClick={() => run(() => client.retryPublications())}>
            Retry
          </button>
        )}
      </div>
      {failure && (
        <p className="text-sm text-error [overflow-wrap:anywhere]">
          {failure.operation}: {failure.error instanceof Error ? failure.error.message : String(failure.error)}
        </p>
      )}
    </Section>
  );
}

function DevicesPanel({ client }: { client: NdrMessagesClient }) {
  return (
    <>
      <ThisDevice client={client} />
      {!client.signer && <LinkThisDevice client={client} />}
      <AppKeys client={client} />
      {client.signer && <ApproveDevice client={client} />}
      <InviteControls client={client} />
      <ClientStatus client={client} />
    </>
  );
}

function ReactionChips({ message }: { message: NdrMessage }) {
  const entries = Object.entries(message.reactions);
  if (!entries.length) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([content, senders]) => (
        <span key={content} className="badge badge-ghost" title={senders.map((s) => shortKey(s)).join("\n")}>
          {content} {senders.length}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  parent,
  own,
  showName,
  onReply,
  onReact,
}: {
  message: NdrMessage;
  parent?: NdrMessage;
  own: boolean;
  showName: boolean;
  onReply: () => void;
  onReact: (content: string) => Promise<void>;
}) {
  const author = castUser(message.sender, eventStore);
  const [picking, setPicking] = useState(false);
  const { error, run } = useAction();

  return (
    <div className={`chat min-w-0 ${own ? "chat-end" : "chat-start"}`}>
      <div className="chat-image">
        <Avatar user={author} size="h-10 w-10" />
      </div>
      <div className="chat-header flex min-w-0 flex-wrap gap-2 text-sm">
        {showName && <Name user={author} />}
        <time className="opacity-60">{formatShortTime(message.createdAt)}</time>
        {message.expiresAt && (
          <span className="opacity-60" title={new Date(message.expiresAt * 1000).toLocaleString()}>
            Disappears
          </span>
        )}
      </div>
      {message.replyTo && (
        <div className="max-w-xs truncate border-s-2 border-base-300 ps-2 text-sm opacity-60">
          {parent?.content ?? "Earlier message"}
        </div>
      )}
      <div
        className={`chat-bubble min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${own ? "chat-bubble-primary" : ""}`}
      >
        {message.content}
      </div>
      <div className="chat-footer flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <ReactionChips message={message} />
        {own && (
          <span className="opacity-60" title={DELIVERY_TITLES[message.delivery]}>
            {DELIVERY_LABELS[message.delivery]}
          </span>
        )}
        <button className="link opacity-60" onClick={onReply}>
          Reply
        </button>
        {picking ? (
          REACTIONS.map((content) => (
            <button
              key={content}
              className="btn btn-ghost btn-sm btn-square"
              onClick={() => {
                setPicking(false);
                void run(() => onReact(content));
              }}
            >
              {content}
            </button>
          ))
        ) : (
          <button className="link opacity-60" onClick={() => setPicking(true)}>
            React
          </button>
        )}
        {error && <span className="text-error">{error}</span>}
      </div>
    </div>
  );
}

function Composer({
  conversation,
  messages,
  canSend,
  disabledReason,
}: {
  conversation: NdrConversation | NdrGroupConversation;
  messages: NdrMessage[];
  canSend: boolean;
  disabledReason?: string;
}) {
  const draft = use$(conversation.draft$);
  const sending = use$(conversation.sending$) ?? false;
  const [error, setError] = useState<string>();
  const text = draft?.content ?? "";
  const replyTarget = draft?.replyTo ? messages.find((message) => message.id === draft.replyTo) : undefined;

  const send = async () => {
    setError(undefined);
    try {
      await conversation.sendDraft();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-base-300 p-3">
      {draft?.replyTo && (
        <div className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate border-s-2 border-base-300 ps-2 opacity-60">
            {replyTarget?.content ?? "Earlier message"}
          </span>
          <button
            className="btn btn-ghost btn-sm btn-square"
            title="Cancel reply"
            onClick={() => conversation.setDraft({ content: text }).catch((error) => setError(String(error)))}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="input min-w-0 flex-1"
          placeholder={disabledReason ?? "Message"}
          value={text}
          disabled={!canSend}
          onChange={(event) => {
            conversation.setDraft({ ...draft, content: event.target.value }).catch((error) => setError(String(error)));
            if (conversation instanceof NdrConversation) conversation.sendTyping();
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !canSend || !text.trim()}>
          {sending ? <span className="loading loading-spinner loading-sm" /> : "Send"}
        </button>
      </form>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function MessageList({
  conversation,
  messages,
  ownPubkey,
  showNames,
  typing,
}: {
  conversation: NdrConversation | NdrGroupConversation;
  messages: NdrMessage[];
  ownPubkey: string;
  showNames: boolean;
  typing?: boolean;
}) {
  const draft = use$(conversation.draft$);
  const [error, setError] = useState<string>();

  // Recreated as messages arrive, so a visible conversation keeps marking new messages as seen.
  const watchNewest = useCallback(
    (edge: HTMLDivElement | null) => {
      if (!edge) return;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && document.visibilityState === "visible") {
          conversation.markSeen().catch((error) => setError(String(error)));
        }
      });
      observer.observe(edge);
      return () => observer.disconnect();
    },
    [conversation, messages],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-x-hidden overflow-y-auto p-4">
      <div ref={watchNewest} className="min-h-6 shrink-0 text-sm opacity-60">
        {typing && "Typing…"}
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          parent={message.replyTo ? messages.find((m) => m.id === message.replyTo) : undefined}
          own={message.sender === ownPubkey}
          showName={showNames}
          onReply={() =>
            conversation
              .setDraft({ content: draft?.content ?? "", replyTo: message.id })
              .catch((error) => setError(String(error)))
          }
          onReact={(content) => conversation.react(message.id, content)}
        />
      ))}
      {messages.length === 0 && <p className="m-auto opacity-60">No messages</p>}
    </div>
  );
}

function DirectConversation({ client, conversation }: { client: NdrMessagesClient; conversation: NdrConversation }) {
  const messages = use$(conversation.messages$) ?? [];
  const typing = use$(conversation.typing$) ?? false;
  const peerDevices = use$(conversation.peerDevices$);
  const canSend = use$(conversation.canSend$) ?? false;
  const state = use$(client.state$);
  const ttl = use$(conversation.ttl$) ?? null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAction();

  const peer = castUser(conversation.peer, eventStore);
  const disabledReason = !state?.canSendPrivateMessages
    ? "Register or link this device to send"
    : !peerDevices?.length
      ? "Looking for the peer's NDR devices"
      : undefined;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-3">
        <Avatar user={peer} size="h-8 w-8" />
        <Name user={peer} />
        <span
          className={`badge ${peerDevices?.length ? "badge-ghost" : "badge-warning"}`}
          title={peerDevices?.map((device) => device.identityPubkey).join("\n")}
        >
          {peerDevices === undefined
            ? "Looking for devices"
            : peerDevices.length === 0
              ? "No devices"
              : `${peerDevices.length} ${peerDevices.length === 1 ? "device" : "devices"}`}
        </span>
        <span className="badge badge-ghost ms-auto">{messages.length} messages</span>
        <select
          aria-label="Disappearing messages"
          className="select select-sm w-auto"
          value={String(ttl)}
          disabled={busy || !canSend}
          onChange={(event) => {
            const seconds = event.target.value === "null" ? null : Number(event.target.value);
            void run(() => conversation.setTtl(seconds));
          }}
        >
          {TTL_OPTIONS.map((option) => (
            <option key={option.label} value={String(option.seconds)}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className={`btn btn-sm ${confirmDelete ? "btn-error" : "btn-ghost"}`}
          disabled={busy}
          title="Delete the sessions with this peer and the local history"
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            void run(() => conversation.delete());
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? "Confirm delete" : "Delete chat"}
        </button>
      </div>
      {error && <p className="border-b border-base-300 p-3 text-sm text-error">{error}</p>}

      <MessageList
        conversation={conversation}
        messages={messages}
        ownPubkey={client.pubkey}
        showNames={false}
        typing={typing}
      />
      <Composer conversation={conversation} messages={messages} canSend={canSend} disabledReason={disabledReason} />
    </main>
  );
}

function MemberRow({
  member,
  admin,
  canRemove,
  onRemove,
}: {
  member: string;
  admin: boolean;
  canRemove: boolean;
  onRemove: () => Promise<void>;
}) {
  const user = castUser(member, eventStore);
  const { busy, error, run } = useAction();

  return (
    <div className="flex items-center gap-2 border-b border-base-300 py-2 last:border-b-0">
      <Avatar user={user} />
      <Name user={user} />
      {admin && <span className="badge badge-ghost">Admin</span>}
      {canRemove && (
        <button className="btn btn-ghost btn-sm ms-auto" disabled={busy} onClick={() => run(onRemove)}>
          Remove
        </button>
      )}
      {error && <span className="text-sm text-error">{error}</span>}
    </div>
  );
}

function GroupConversation({ client, group }: { client: NdrMessagesClient; group: NdrGroupConversation }) {
  const record = use$(group.group$);
  const messages = use$(group.messages$) ?? [];
  const admin = use$(group.admin$) ?? false;
  const pending = use$(group.pending$) ?? false;
  const canSend = use$(group.canSend$) ?? false;
  const [membersOpen, setMembersOpen] = useState(false);
  const [name, setName] = useState<string>();
  const { busy, error, run } = useAction();

  if (!record) return <main className="flex min-w-0 flex-1 items-center justify-center opacity-60">Group left</main>;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-3">
        {admin && name !== undefined ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await group.rename(name);
                setName(undefined);
              });
            }}
          >
            <input className="input input-sm" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="btn btn-sm" type="submit" disabled={busy || !name.trim()}>
              Save
            </button>
          </form>
        ) : (
          <button
            className="font-medium"
            disabled={!admin}
            title={admin ? "Rename group" : undefined}
            onClick={() => setName(record.data.name)}
          >
            {record.data.name}
          </button>
        )}
        <button
          className="badge badge-ghost"
          title={record.data.members.map((member) => shortKey(member)).join("\n")}
          onClick={() => setMembersOpen(!membersOpen)}
        >
          {record.data.members.length} members
        </button>
        <span className="badge badge-ghost ms-auto">{messages.length} messages</span>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => group.leave())}>
          Leave
        </button>
      </div>

      {pending && (
        <div className="flex items-center gap-2 border-b border-base-300 p-3">
          <span className="text-sm">Group invitation</span>
          <button className="btn btn-sm btn-primary ms-auto" disabled={busy} onClick={() => run(() => group.accept())}>
            Accept
          </button>
        </div>
      )}
      {record.removed && <p className="border-b border-base-300 p-3 text-sm text-warning">Removed from this group</p>}

      {membersOpen && (
        <div className="flex max-h-72 flex-col overflow-y-auto border-b border-base-300 p-3">
          {record.data.members.map((member) => (
            <MemberRow
              key={member}
              member={member}
              admin={record.data.admins.includes(member)}
              canRemove={admin && member !== client.pubkey}
              onRemove={() => group.removeMember(member)}
            />
          ))}
          {admin && (
            <div className="pt-2">
              <PubkeyPicker
                value=""
                placeholder="Add a member"
                onChange={(pubkey) => pubkey && run(() => group.addMember(pubkey))}
              />
            </div>
          )}
        </div>
      )}
      {error && <p className="border-b border-base-300 p-3 text-sm text-error">{error}</p>}

      <MessageList conversation={group} messages={messages} ownPubkey={client.pubkey} showNames />
      <Composer
        conversation={group}
        messages={messages}
        canSend={canSend}
        disabledReason={pending ? "Accept the invitation to send" : undefined}
      />
    </main>
  );
}

function NewGroupDialog({
  client,
  onCreated,
  onClose,
}: {
  client: NdrMessagesClient;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const { busy, error, run } = useAction();

  const openDialog = useCallback((dialog: HTMLDialogElement | null) => {
    dialog?.showModal();
  }, []);

  return (
    <dialog ref={openDialog} className="modal" onClose={onClose}>
      <div className="modal-box flex flex-col gap-3">
        <h3 className="font-medium">New group</h3>
        <input
          className="input"
          placeholder="Group name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <PubkeyPicker
          value=""
          placeholder="Add a member"
          onChange={(pubkey) => pubkey && setMembers(new Set(members).add(pubkey))}
        />
        <div className="flex flex-col">
          {[...members].map((member) => (
            <MemberRow
              key={member}
              member={member}
              admin={false}
              canRemove
              onRemove={async () => {
                const next = new Set(members);
                next.delete(member);
                setMembers(next);
              }}
            />
          ))}
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim() || members.size === 0}
            onClick={() =>
              run(async () => {
                const group = await client.createGroup(name.trim(), [...members]);
                onCreated(group.id);
              })
            }
          >
            {busy && <span className="loading loading-spinner loading-sm" />}
            Create
          </button>
        </div>
      </div>
    </dialog>
  );
}

function RowShell({
  active,
  onSelect,
  image,
  title,
  summary,
  preview,
  badge,
}: {
  active: boolean;
  onSelect: () => void;
  image: ReactNode;
  title: ReactNode;
  summary: NdrConversationSummary;
  preview?: string;
  badge?: ReactNode;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      {image}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="flex items-center gap-2">
          {title}
          {badge}
          {summary.lastMessage && (
            <span className="ms-auto shrink-0 text-sm opacity-60">
              {formatShortTime(summary.lastMessage.createdAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm opacity-60">
            {preview ?? summary.lastMessage?.content ?? "No messages"}
          </span>
          {summary.unread > 0 && <span className="badge badge-primary">{summary.unread}</span>}
        </div>
      </div>
    </button>
  );
}

function DirectRow({
  summary,
  active,
  onSelect,
}: {
  summary: NdrConversationSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const peer = castUser(summary.id, eventStore);
  return (
    <RowShell
      active={active}
      onSelect={onSelect}
      image={<Avatar user={peer} size="h-10 w-10" />}
      title={<Name user={peer} />}
      summary={summary}
    />
  );
}

function GroupRow({
  client,
  summary,
  active,
  onSelect,
}: {
  client: NdrMessagesClient;
  summary: NdrConversationSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const record = use$(() => client.group(summary.groupId!).group$, [client, summary.groupId]);

  return (
    <RowShell
      active={active}
      onSelect={onSelect}
      image={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-300 font-medium">
          {record?.data.name.slice(0, 1).toUpperCase()}
        </span>
      }
      title={<span className="min-w-0 truncate font-medium">{record?.data.name ?? "Group"}</span>}
      badge={<span className="badge badge-ghost">{record?.data.accepted === false ? "Invite" : "Group"}</span>}
      summary={summary}
    />
  );
}

function Account({ user, linked }: { user: User; linked: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      {linked && (
        <span className="badge badge-ghost" title="This device has no account signer">
          Linked
        </span>
      )}
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function Inbox({ client, user }: { client: NdrMessagesClient; user: User }) {
  const lifecycle = use$(client.lifecycle$);
  const conversations = use$(client.conversations$);
  const [selected, setSelected] = useState<string>();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [devicesOpen, setDevicesOpen] = useState(true);

  if (lifecycle === "locked") return <p className="m-auto opacity-60">This account is open in another tab</p>;
  if (lifecycle === "error") return <p className="m-auto text-error">The NDR client failed to start</p>;
  if (lifecycle !== "ready") return <span className="loading loading-spinner m-auto" />;

  const selectedGroup = selected ? getNdrGroupId(selected) : undefined;

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col overflow-x-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-base-300 px-3 py-2">
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle conversations drawer"
          aria-expanded={conversationsOpen}
          onClick={() => setConversationsOpen(!conversationsOpen)}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle devices drawer"
          aria-expanded={devicesOpen}
          onClick={() => setDevicesOpen(!devicesOpen)}
        >
          <PanelRight className="h-5 w-5" />
        </button>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <aside
          aria-label="Conversations"
          hidden={!conversationsOpen}
          className="flex w-72 shrink-0 flex-col border-e border-base-300"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 border-b border-base-300 p-3">
              <PubkeyPicker
                value=""
                placeholder="Open a conversation"
                onChange={(pubkey) => pubkey && setSelected(pubkey)}
              />
              <button className="btn btn-sm" onClick={() => setCreatingGroup(true)}>
                New group
              </button>
            </div>

            {conversations?.length === 0 && <p className="p-6 text-center opacity-60">No conversations</p>}
            {conversations?.map((summary) =>
              summary.type === "group" ? (
                <GroupRow
                  key={summary.id}
                  client={client}
                  summary={summary}
                  active={selected === summary.id}
                  onSelect={() => setSelected(summary.id)}
                />
              ) : (
                <DirectRow
                  key={summary.id}
                  summary={summary}
                  active={selected === summary.id}
                  onSelect={() => setSelected(summary.id)}
                />
              ),
            )}
          </div>
          <Account user={user} linked={!client.signer} />
        </aside>

        {selectedGroup ? (
          <GroupConversation key={selected} client={client} group={client.group(selectedGroup)} />
        ) : selected ? (
          <DirectConversation key={selected} client={client} conversation={client.conversation(selected)} />
        ) : (
          <main className="flex min-w-0 flex-1 items-center justify-center opacity-60">Select a conversation</main>
        )}

        <aside
          aria-label="Devices"
          hidden={!devicesOpen}
          className="w-80 shrink-0 overflow-x-hidden overflow-y-auto border-s border-base-300"
        >
          <DevicesPanel client={client} />
        </aside>
      </div>

      {creatingGroup && (
        <NewGroupDialog
          client={client}
          onClose={() => setCreatingGroup(false)}
          onCreated={(id) => {
            setCreatingGroup(false);
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

export default function NdrMessagesExample() {
  const user = use$(user$);
  const storage = use$(storage$);
  const client = use$(client$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  // A device without the account signer can still run NDR once another device approves it.
  const linkDevice = (pubkey: string) => {
    if (pubkey) user$.next(castUser(pubkey, eventStore));
  };

  if (!user)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <div className="border-b border-base-300 p-3">
          <PubkeyPicker
            value=""
            placeholder="Link this device to an account without signing in"
            onChange={linkDevice}
          />
        </div>
        <LoginView onLogin={handleLogin} />
      </div>
    );
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!client) return <span className="loading loading-spinner m-auto" />;

  return <Inbox key={user.pubkey} client={client} user={user} />;
}
