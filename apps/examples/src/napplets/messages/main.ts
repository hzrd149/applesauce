import type { DmConversation, DmMessage, DmSendRequest, DmStatus, NappletGlobal } from "@napplet/core";
import "./style.css";

/** Gets a NAP domain this napplet cannot work without */
function requireDomain<Domain extends keyof NappletGlobal>(domain: Domain): NonNullable<NappletGlobal[Domain]> {
  const api = window.napplet[domain];
  if (!api) throw new Error(`The host did not grant the ${domain} domain`);
  return api;
}

const shell = requireDomain("shell");
const dm = requireDomain("dm");
const identity = requireDomain("identity");
const common = requireDomain("common");
const resource = requireDomain("resource");

const PROTOCOL_LABELS: Record<string, string> = { nip17: "🎁 NIP-17", nip04: "✉️ NIP-04" };
const STATUS_ICONS: Record<Bubble["status"], string> = {
  pending: "⏳",
  sent: "✓",
  delivered: "✓✓",
  received: "",
  failed: "⚠️",
};

/** A conversation the user is looking at, a new conversation has no id until its first message is sent */
type Selection = { id?: string; participants: string[] };

/** A rendered message, including sends that are still pending or failed and can be retried */
type Bubble = Omit<DmMessage, "conversationId" | "status"> & {
  status: DmMessage["status"] | "pending";
  error?: string;
  request?: DmSendRequest;
};

type Profile = { name: string; picture?: string };

const $ = (id: string) => document.getElementById(id)!;
const recipientsInput = $("recipients") as HTMLInputElement;
const contentInput = $("content") as HTMLInputElement;
const sendButton = $("send") as HTMLButtonElement;

let owner = "";
// Bumped whenever the account changes so responses for the previous account are dropped
let generation = 0;
let subscriptionId: string | undefined;
let conversations: DmConversation[] | Error | undefined;
let selected: Selection | undefined;
let bubbles: Bubble[] | Error | undefined;

// The host firewall limits how many requests a napplet makes, so refreshes are coalesced and profiles cached
const PROFILE_RETRY = 15_000;
const REFRESH_DELAY = 1000;

const profiles = new Map<string, Promise<Profile>>();
let refreshing: Promise<void> | undefined;
let refreshAgain = false;

/** Gets a display name and picture through the common domain, the DM domain only returns pubkeys */
function getProfile(pubkey: string): Promise<Profile> {
  let profile = profiles.get(pubkey);
  if (!profile) {
    profile = common
      .getProfile(pubkey)
      .catch(() => undefined)
      .then((result) => {
        // Forget a missing profile after a while so it is asked for again once the host has loaded it
        if (!result?.profile) setTimeout(() => profiles.delete(pubkey), PROFILE_RETRY);

        return {
          name: result?.profile?.displayName || result?.profile?.name || pubkey.slice(0, 8) + "…",
          picture: result?.profile?.picture,
        };
      });
    profiles.set(pubkey, profile);
  }

  return profile;
}

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function avatar(pubkeys: string[]) {
  const node = element("span", "avatar", pubkeys.length === 0 ? "✎" : pubkeys.length > 1 ? "👥" : "");
  if (pubkeys.length === 1) {
    getProfile(pubkeys[0])
      .then(async (profile) => {
        if (!profile.picture) return;

        // Remote images go through the host because the iframe only allows blob and data URLs
        const picture = await resource.bytes(profile.picture);
        const pictureUrl = URL.createObjectURL(picture);
        const image = element("img", "avatar");
        image.onload = () => {
          URL.revokeObjectURL(pictureUrl);
          node.replaceWith(image);
        };
        image.onerror = () => URL.revokeObjectURL(pictureUrl);
        image.src = pictureUrl;
      })
      .catch(() => {
        // Keep the placeholder when the host cannot fetch the picture
      });
  }
  return node;
}

function names(pubkeys: string[]) {
  const node = element("span", "names", pubkeys.length ? "…" : "Notes to self");
  if (pubkeys.length) {
    Promise.all(pubkeys.map(getProfile)).then((list) => {
      node.textContent = list.map((profile) => profile.name).join(", ");
    });
  }
  return node;
}

function formatTime(seconds: number) {
  const date = new Date(seconds * 1000);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { timeStyle: "short" })
    : date.toLocaleDateString();
}

/** Throws the host's error, the shell resolves failed DM requests as { error } instead of rejecting */
async function unwrap<Result extends object>(request: Promise<Result>): Promise<Result> {
  const result = await request;
  const { error } = result as { error?: unknown };
  if (typeof error === "string") throw new Error(error);
  return result;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function errorElement(error: Error) {
  const node = element("div", "center", "⚠️");
  node.title = error.message;
  return node;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Returns the participants other than the current user */
function others(participants: string[]) {
  return participants.filter((pubkey) => pubkey !== owner);
}

function sameParticipants(a: string[], b: string[]) {
  const set = new Set(a);
  return a.length === b.length && b.every((pubkey) => set.has(pubkey));
}

// ---- Loading

/** Loads every page of conversations, the host pages by offset */
async function loadConversations() {
  const all: DmConversation[] = [];
  let cursor: string | undefined;
  do {
    const page = await unwrap(dm.conversations({ cursor, limit: 50 }));
    all.push(...page.conversations);
    cursor = page.cursor;
  } while (cursor);

  return all;
}

/** Loads every page of a conversation's messages, oldest first */
async function loadMessages(conversationId: string) {
  const all: DmMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await unwrap(dm.messages({ conversationId, cursor, limit: 100 }));
    all.push(...page.messages);
    cursor = page.cursor;
  } while (cursor);

  return all;
}

async function refreshConversations() {
  const run = generation;
  const list = await loadConversations().catch((error) => toError(error));
  if (run !== generation) return;

  // Keep the last good list when a refresh fails
  if (list instanceof Error) {
    if (!Array.isArray(conversations)) conversations = list;
  } else {
    conversations = list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  renderConversations();
}

/** Refreshes the conversation list, coalescing bursts into one request at a time */
function scheduleRefresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }

  refreshing = refreshConversations().finally(() => {
    refreshing = undefined;
    if (!refreshAgain) return;

    refreshAgain = false;
    setTimeout(scheduleRefresh, REFRESH_DELAY);
  });
}

/** Moves a conversation to the top for a new message, or refreshes the list for a conversation it hasn't seen */
function trackMessage(message: DmMessage) {
  const known = Array.isArray(conversations)
    ? conversations.find((conversation) => conversation.id === message.conversationId)
    : undefined;
  if (!known || !Array.isArray(conversations)) return scheduleRefresh();
  if (message.createdAt <= (known.updatedAt ?? 0)) return;

  conversations = conversations
    .map((conversation) => (conversation === known ? { ...known, updatedAt: message.createdAt } : conversation))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  renderConversations();
}

async function select(selection: Selection) {
  const run = generation;
  selected = selection;
  bubbles = selection.id ? undefined : [];
  renderConversations();
  renderMessages();
  contentInput.focus();

  if (!selection.id) return;
  const messages = await loadMessages(selection.id).catch((error) => toError(error));
  if (run !== generation || selected !== selection) return;

  bubbles = messages;
  renderMessages();
}

/** Adds or replaces a message, keeping the list ordered by time */
function upsertBubble(bubble: Bubble) {
  if (!Array.isArray(bubbles)) return;
  bubbles = [...bubbles.filter((existing) => existing.id !== bubble.id), bubble].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  renderMessages();
}

function removeBubble(id: string) {
  if (!Array.isArray(bubbles)) return;
  bubbles = bubbles.filter((bubble) => bubble.id !== id);
}

// ---- Sending

/** Sends a message and shows it as pending until the host signs and publishes it */
async function deliver(request: DmSendRequest) {
  const run = generation;
  const draft = selected;
  const pendingId = request.clientMessageId!;
  upsertBubble({
    id: pendingId,
    senderPubkey: owner,
    createdAt: Math.floor(Date.now() / 1000),
    content: request.content,
    status: "pending",
    request,
  });

  try {
    const result = await unwrap(dm.send(request));
    if (!result.ok) throw new Error("The host could not send the message");
    if (run !== generation) return;

    // The first message of a new conversation tells us its id
    if (draft && selected === draft && !draft.id) draft.id = result.message.conversationId;

    removeBubble(pendingId);
    upsertBubble(result.message);
    trackMessage(result.message);
  } catch (error) {
    if (run !== generation) return;
    const pending = Array.isArray(bubbles) ? bubbles.find((bubble) => bubble.id === pendingId) : undefined;
    if (pending) upsertBubble({ ...pending, status: "failed", error: toError(error).message });
  }
}

/** Sends the composer text to the selected conversation */
function sendComposer() {
  const content = contentInput.value.trim();
  if (!selected || !content) return;

  // Notes to self are sent with the current user as the only recipient
  const recipients = others(selected.participants);
  contentInput.value = "";

  deliver({
    conversationId: selected.id,
    recipients: recipients.length ? recipients : [owner],
    content,
    // Retrying with the same id lets the host republish the same message instead of creating a new one
    clientMessageId: randomId(),
  });
}

/** Opens the conversation with the entered npubs, or a new one if none exists */
async function startConversation() {
  const values = recipientsInput.value.split(/[\s,]+/).filter(Boolean);
  if (!values.length || !owner) return;

  const decoded = await Promise.all(values.map((value) => common.decodeNip19(value)));
  const pubkeys = decoded.map((result) => (result.ok ? (result.pubkey ?? result.hex) : undefined));
  if (pubkeys.some((pubkey) => !pubkey || !/^[0-9a-f]{64}$/.test(pubkey))) {
    recipientsInput.setCustomValidity("Enter npubs or nprofiles");
    recipientsInput.reportValidity();
    return;
  }

  recipientsInput.value = "";
  const participants = [...new Set([owner, ...(pubkeys as string[])])];
  const existing = (Array.isArray(conversations) ? conversations : []).find((conversation) =>
    sameParticipants(
      conversation.participants.map((peer) => peer.pubkey),
      participants,
    ),
  );
  select({ id: existing?.id, participants });
}

/** Runs an action on Enter, sandboxed napplets can't submit forms */
function onEnter(input: HTMLInputElement, action: () => void) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") action();
  });
}

sendButton.addEventListener("click", sendComposer);
onEnter(contentInput, sendComposer);
$("start").addEventListener("click", startConversation);
onEnter(recipientsInput, startConversation);
recipientsInput.addEventListener("input", () => recipientsInput.setCustomValidity(""));

// ---- Rendering

function renderStatus(status?: DmStatus) {
  const protocols = $("protocols");
  protocols.replaceChildren(
    ...(status?.implementations ?? []).map((id) => element("span", "badge", PROTOCOL_LABELS[id] ?? id)),
  );

  const ownerName = $("owner");
  if (!status?.available || !owner) {
    ownerName.textContent = "🔒";
    return;
  }

  ownerName.textContent = "…";
  getProfile(owner).then((profile) => {
    ownerName.textContent = profile.name;
  });
}

type ConversationRow = {
  node: HTMLButtonElement;
  selection: Selection;
  participantsKey: string;
  timestamp: HTMLSpanElement;
};

const conversationRows = new Map<string, ConversationRow>();

function updateConversationRow(key: string, selection: Selection, updatedAt?: number) {
  const participantsKey = JSON.stringify(selection.participants);
  let row = conversationRows.get(key);

  if (!row || row.participantsKey !== participantsKey) {
    const node = element("button", "conversation");
    const timestamp = element("span", "muted");
    const peers = others(selection.participants);
    node.append(avatar(peers), names(peers), timestamp);

    const createdRow = { node, selection, participantsKey, timestamp };
    node.addEventListener("click", () => select(createdRow.selection));
    row = createdRow;
    conversationRows.set(key, row);
  }

  row.selection = selection;
  const isSelected = selected === selection || (!!selection.id && selected?.id === selection.id);
  row.node.classList.toggle("selected", isSelected);
  row.timestamp.textContent = updatedAt ? formatTime(updatedAt) : "";
  row.timestamp.hidden = !updatedAt;
  return row.node;
}

function renderConversations() {
  const nav = $("conversations");
  if (!owner) return nav.replaceChildren();
  if (!conversations) return nav.replaceChildren(element("div", "bar muted", "⏳"));
  if (conversations instanceof Error) return nav.replaceChildren(errorElement(conversations));

  type Row = { selection: Selection; updatedAt?: number };
  const rows: Row[] = conversations.map((conversation) => ({
    selection:
      selected?.id === conversation.id
        ? selected
        : { id: conversation.id, participants: conversation.participants.map((peer) => peer.pubkey) },
    updatedAt: conversation.updatedAt,
  }));

  // A conversation with only yourself is the notes to self channel, pinned to the top even before it exists
  const notesIndex = rows.findIndex((row) => others(row.selection.participants).length === 0);
  const notes: Row = notesIndex >= 0 ? rows.splice(notesIndex, 1)[0] : { selection: { participants: [owner] } };
  if (!notes.selection.id && selected && !selected.id && others(selected.participants).length === 0)
    notes.selection = selected;

  // A new conversation stays visible until its first message gives it an id
  const draft: Row[] =
    selected && !selected.id && others(selected.participants).length ? [{ selection: selected }] : [];

  const activeKeys = new Set<string>();
  const nodes = [notes, ...draft, ...rows].map(({ selection, updatedAt }) => {
    const key = selection.id ?? `draft:${JSON.stringify([...selection.participants].sort())}`;
    activeKeys.add(key);
    return updateConversationRow(key, selection, updatedAt);
  });

  for (const [key, row] of conversationRows) {
    if (activeKeys.has(key)) continue;
    row.node.remove();
    conversationRows.delete(key);
  }

  // Leave unchanged rows attached, moving only rows whose position changed
  nodes.forEach((node, index) => {
    if (nav.children[index] !== node) nav.insertBefore(node, nav.children[index] ?? null);
  });
  while (nav.children.length > nodes.length) nav.lastElementChild?.remove();
}

function messageBubble(bubble: Bubble, group: boolean) {
  const own = bubble.senderPubkey === owner;
  const node = element("div", `message${own ? " own" : ""}${bubble.status === "failed" ? " failed" : ""}`);

  if (group && !own) {
    const sender = element("div", "sender", "…");
    getProfile(bubble.senderPubkey).then((profile) => (sender.textContent = profile.name));
    node.append(sender);
  }

  node.append(document.createTextNode(bubble.content));

  const meta = element("div", "meta");
  meta.append(element("span", "", formatTime(bubble.createdAt)));
  const icon = element("span", "", STATUS_ICONS[bubble.status]);
  icon.title = bubble.error ?? bubble.status;
  meta.append(icon);

  const request = bubble.request;
  if (bubble.status === "failed" && request) {
    const retry = element("button", "", "↻");
    retry.title = "Retry";
    retry.addEventListener("click", () => deliver(request));
    meta.append(retry);
  }

  node.append(meta);
  return node;
}

function renderMessages() {
  const title = $("title");
  const list = $("messages");
  const enabled = !!selected && !!owner;
  contentInput.disabled = !enabled;
  sendButton.disabled = !enabled;

  if (!selected) {
    title.replaceChildren();
    list.replaceChildren(element("div", "center muted", owner ? "💬" : "🔒"));
    return;
  }

  const peers = others(selected.participants);
  title.replaceChildren(avatar(peers), names(peers));

  if (!bubbles) return list.replaceChildren(element("div", "center muted", "⏳"));
  if (bubbles instanceof Error) return list.replaceChildren(errorElement(bubbles));
  if (!bubbles.length) return list.replaceChildren(element("div", "center muted", peers.length ? "👋" : "✎"));

  const group = peers.length > 1;
  list.replaceChildren(...bubbles.map((bubble) => messageBubble(bubble, group)));
  list.scrollTop = list.scrollHeight;
}

// ---- Lifecycle

/** Resets the napplet for the current account and starts live delivery */
async function start() {
  const run = ++generation;
  const previous = subscriptionId;
  subscriptionId = undefined;
  if (previous) dm.unsubscribe(previous).catch(() => {});

  conversationRows.clear();
  $("conversations").replaceChildren();

  owner = "";
  refreshAgain = false;
  conversations = undefined;
  selected = undefined;
  bubbles = undefined;

  const status = await unwrap(dm.status()).catch(() => undefined);
  if (run !== generation) return;

  owner = status?.available ? (status.ownerPubkey ?? (await identity.getPublicKey())) : "";
  if (run !== generation) return;
  renderStatus(status);
  renderConversations();
  renderMessages();
  if (!owner) return;

  // Subscribe before loading the list so messages decrypted in the meantime stream in
  const subscription = await unwrap(dm.subscribe()).catch(() => undefined);
  if (run !== generation) {
    if (subscription) dm.unsubscribe(subscription.subscriptionId).catch(() => {});
    return;
  }

  subscriptionId = subscription?.subscriptionId;
  scheduleRefresh();
}

// Messages stream in here as the host decrypts them, from every conversation and protocol
dm.onMessage((message, id) => {
  if (id !== subscriptionId) return;
  if (selected?.id === message.conversationId) upsertBubble(message);
  trackMessage(message);
});

shell.ready().then(() => {
  identity.onChanged(() => start());
  start();
});
