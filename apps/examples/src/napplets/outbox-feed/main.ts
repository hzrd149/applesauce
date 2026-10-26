import type { NappletGlobal, NostrEvent, OutboxRelayPlan, OutboxSubscription, RelayEventResult } from "@napplet/core";
import "./style.css";

const DEFAULT_AUTHOR = "npub1klkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qulx3vt";
const PAGE_SIZE = 20;
const PLAN_INTERVAL = 3000;
const MAX_NOTES = 300;

/** Gets a NAP domain this napplet cannot work without */
function requireDomain<Domain extends keyof NappletGlobal>(domain: Domain): NonNullable<NappletGlobal[Domain]> {
  const api = window.napplet[domain];
  if (!api) throw new Error(`The host did not grant the ${domain} domain`);
  return api;
}

const shell = requireDomain("shell");
const identity = requireDomain("identity");
const common = requireDomain("common");
const outbox = requireDomain("outbox");

const $ = (id: string) => document.getElementById(id)!;
const authorInput = $("author") as HTMLInputElement;
const followsButton = $("follows-mode") as HTMLButtonElement;
const olderButton = $("older") as HTMLButtonElement;

type Note = { event: NostrEvent; relays: Set<string> };

let authors: string[] = [];
let plan: OutboxRelayPlan | undefined;
let subscription: OutboxSubscription | undefined;
let planTimer: ReturnType<typeof setInterval> | undefined;
let followsMode = false;
const notes = new Map<string, Note>();
const relayCounts = new Map<string, number>();
const names = new Map<string, string>();

/** Picks a stable hue for a relay or pubkey so it reads the same everywhere */
function colorFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 45%)`;
}

function relayLabel(relay: string) {
  return relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

function relayChip(relay: string, text: string) {
  const chip = document.createElement("span");
  chip.className = plan?.relays.includes(relay) ? "relay planned" : "relay";
  chip.style.setProperty("--relay-color", colorFor(relay));
  chip.textContent = text;
  chip.title = relay;
  return chip;
}

/** Loads an author's name once through the shell's profile cache */
function nameFor(pubkey: string) {
  if (!names.has(pubkey)) {
    names.set(pubkey, pubkey.slice(0, 8));
    common.getProfile(pubkey).then((result) => {
      const name = result.profile?.displayName || result.profile?.name;
      if (!name) return;
      names.set(pubkey, name);
      scheduleRender();
    });
  }
  return names.get(pubkey)!;
}

function renderPlan() {
  $("authors").textContent = String(authors.length);
  $("plan-count").textContent = plan ? String(plan.relays.length) : "–";
  $("plan-source").textContent = plan?.source ?? "?";
  $("missing").textContent = String(plan?.missingAuthors?.length ?? 0);
  followsButton.classList.toggle("active", followsMode);
}

function renderRelays() {
  // Show the planned relays first, then any relay the shell actually delivered events from
  const relays = new Set([...(plan?.relays ?? []), ...relayCounts.keys()]);
  const sorted = [...relays].sort((a, b) => (relayCounts.get(b) ?? 0) - (relayCounts.get(a) ?? 0));

  $("relays").replaceChildren(
    ...sorted.map((relay) => relayChip(relay, `${relayLabel(relay)} ${relayCounts.get(relay) ?? 0}`)),
  );
}

function renderFeed() {
  const sorted = [...notes.values()].sort((a, b) => b.event.created_at - a.event.created_at).slice(0, MAX_NOTES);

  $("feed").replaceChildren(
    ...sorted.map(({ event, relays }) => {
      const name = nameFor(event.pubkey);

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.setProperty("--author-color", colorFor(event.pubkey));
      avatar.textContent = name[0]?.toUpperCase() ?? "?";

      const header = document.createElement("div");
      header.className = "row";
      const author = document.createElement("strong");
      author.textContent = name;
      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = new Date(event.created_at * 1000).toLocaleString();
      header.append(author, time);

      const content = document.createElement("div");
      content.className = "content";
      content.textContent = event.content;

      const seen = document.createElement("div");
      seen.className = "row";
      seen.append(...[...relays].map((relay) => relayChip(relay, relayLabel(relay))));

      const body = document.createElement("div");
      body.className = "note-body";
      body.append(header, content, seen);

      const note = document.createElement("div");
      note.className = "note";
      note.append(avatar, body);
      return note;
    }),
  );
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPlan();
    renderRelays();
    renderFeed();
  });
}

/** Records a note and the relays the shell saw it on */
function addResult({ event, sidecar }: RelayEventResult) {
  const note = notes.get(event.id) ?? { event, relays: new Set<string>() };
  notes.set(event.id, note);

  let rerouted = false;
  for (const relay of sidecar?.relayHints ?? []) {
    if (note.relays.has(relay)) continue;
    note.relays.add(relay);
    relayCounts.set(relay, (relayCounts.get(relay) ?? 0) + 1);
    if (plan && !plan.relays.includes(relay)) rerouted = true;
  }

  // A relay outside the last plan means the shell rerouted the live subscription
  if (rerouted) refreshPlan();
  scheduleRender();
}

let planRequest = 0;
async function refreshPlan() {
  const request = ++planRequest;
  const nextPlan = await outbox.resolveRelays({ authors, direction: "read" });
  if (request !== planRequest) return;
  plan = nextPlan;
  scheduleRender();
}

/** Restarts the live outbox subscription for a new set of authors */
function start(nextAuthors: string[]) {
  subscription?.close();
  clearInterval(planTimer);
  authors = nextAuthors;
  plan = undefined;
  notes.clear();
  relayCounts.clear();
  scheduleRender();
  if (authors.length === 0) return;

  // The shell doesn't announce reroutes, so re-read the plan to follow host setting changes
  refreshPlan();
  planTimer = setInterval(refreshPlan, PLAN_INTERVAL);
  subscription = outbox.subscribe([{ kinds: [1], authors, limit: PAGE_SIZE }], { authors });
  subscription.on("event", addResult);
  subscription.on("closed", (reason) => {
    $("plan-source").textContent = `Closed: ${reason ?? "unknown"}`;
  });
}

/** Pages back through the authors' outboxes with a one-shot query */
async function loadOlder() {
  if (authors.length === 0) return;
  const oldest = Math.min(...[...notes.values()].map((note) => note.event.created_at));
  const until = Number.isFinite(oldest) ? oldest - 1 : undefined;

  olderButton.disabled = true;
  const result = await outbox.query([{ kinds: [1], authors, until, limit: PAGE_SIZE }], {
    authors,
    limit: PAGE_SIZE,
  });
  for (const item of result.events) addResult(item);
  olderButton.textContent = result.error
    ? `Failed: ${result.error}`
    : `Load older${result.incomplete ? " (incomplete)" : ""}`;
  olderButton.disabled = false;
}

async function startFollows() {
  const follows = await common.follows();
  followsMode = true;
  authorInput.value = "";
  start(follows.ok ? follows.pubkeys : []);
}

async function startAuthor(value: string) {
  const decoded = value ? await common.decodeNip19(value) : undefined;
  const pubkey = decoded?.ok && (decoded.pubkey ?? decoded.hex);
  if (!pubkey) return;
  followsMode = false;
  start([pubkey]);
}

followsButton.addEventListener("click", startFollows);
authorInput.addEventListener("change", () => startAuthor(authorInput.value.trim()));
olderButton.addEventListener("click", loadOlder);
$("refresh-plan").addEventListener("click", refreshPlan);

shell.ready().then(async () => {
  identity.onChanged(() => {
    if (followsMode) startFollows();
  });

  // Logged in users see their follows, everyone else reads one author from their outboxes
  if (await identity.getPublicKey()) return startFollows();
  authorInput.value = DEFAULT_AUTHOR;
  startAuthor(DEFAULT_AUTHOR);
});
