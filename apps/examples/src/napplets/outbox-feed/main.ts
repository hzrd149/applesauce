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
const resource = requireDomain("resource");

const $ = (id: string) => document.getElementById(id)!;
const authorInput = $("author") as HTMLInputElement;
const followsButton = $("follows-mode") as HTMLButtonElement;
const olderButton = $("older") as HTMLButtonElement;

type Note = { event: NostrEvent };

let authors: string[] = [];
let plan: OutboxRelayPlan | undefined;
let subscription: OutboxSubscription | undefined;
let planTimer: ReturnType<typeof setInterval> | undefined;
let followsMode = false;
const notes = new Map<string, Note>();
let feedVersion = 0;
let identityVersion = 0;
let activePubkey: string | null | undefined;
const pictures = new Map<string, string>();
const names = new Map<string, string>();

/** Picks a stable hue for a relay or pubkey so it reads the same everywhere */
function colorFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 45%)`;
}

/** Loads an author's name once through the shell's profile cache */
function nameFor(pubkey: string) {
  if (!names.has(pubkey)) {
    names.set(pubkey, pubkey.slice(0, 8));
    common
      .getProfile(pubkey)
      .then((result) => {
        const name = result.profile?.displayName || result.profile?.name;
        if (name) names.set(pubkey, name);
        scheduleRender();
        if (result.profile?.picture) {
          resource
            .bytes(result.profile.picture)
            .then((blob) => {
              pictures.set(pubkey, URL.createObjectURL(blob));
              scheduleRender();
            })
            .catch(() => {
              /* Keep the initial when the avatar cannot be loaded */
            });
        }
      })
      .catch(() => {
        /* Keep the public key when the profile cannot be loaded */
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

function renderFeed() {
  const sorted = [...notes.values()].sort((a, b) => b.event.created_at - a.event.created_at).slice(0, MAX_NOTES);

  $("feed").replaceChildren(
    ...sorted.map(({ event }) => {
      const name = nameFor(event.pubkey);

      const avatar = document.createElement("button");
      avatar.type = "button";
      avatar.title = `Read ${name}’s feed`;
      avatar.onclick = () => selectAuthor(event.pubkey);
      avatar.className = "avatar";
      avatar.style.setProperty("--author-color", colorFor(event.pubkey));
      avatar.textContent = name[0]?.toUpperCase() ?? "?";

      const picture = pictures.get(event.pubkey);
      if (picture) {
        const image = document.createElement("img");
        image.src = picture;
        image.alt = "";
        image.onerror = () => avatar.replaceChildren(document.createTextNode(name[0]?.toUpperCase() ?? "?"));
        avatar.replaceChildren(image);
      }

      const header = document.createElement("div");
      header.className = "row";
      const author = document.createElement("button");
      author.type = "button";
      author.className = "author";
      author.onclick = () => selectAuthor(event.pubkey);
      author.textContent = name;
      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = new Date(event.created_at * 1000).toLocaleString();
      header.append(author, time);

      const content = document.createElement("div");
      content.className = "content";
      content.textContent = event.content;

      const body = document.createElement("div");
      body.className = "note-body";
      body.append(header, content);

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
    renderFeed();
  });
}

/** Records a note delivered through the authors' outboxes */
function addResult({ event }: RelayEventResult) {
  notes.set(event.id, { event });
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
  ++feedVersion;
  ++planRequest;
  subscription?.close();
  clearInterval(planTimer);
  authors = nextAuthors;
  plan = undefined;
  notes.clear();
  olderButton.disabled = false;
  olderButton.textContent = "Load older";
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

  const version = feedVersion;
  olderButton.disabled = true;
  const result = await outbox.query([{ kinds: [1], authors, until, limit: PAGE_SIZE }], {
    authors,
    limit: PAGE_SIZE,
  });
  if (version !== feedVersion) return;
  for (const item of result.events) addResult(item);
  olderButton.textContent = result.error
    ? `Failed: ${result.error}`
    : `Load older${result.incomplete ? " (incomplete)" : ""}`;
  olderButton.disabled = false;
}

async function startFollows() {
  if (!activePubkey) return;
  const version = ++feedVersion;
  const follows = await common.follows();
  if (version !== feedVersion || !activePubkey) return;
  followsMode = true;
  authorInput.value = "";
  start(follows.ok ? follows.pubkeys : []);
}

async function startAuthor(value: string) {
  const decoded = value ? await common.decodeNip19(value) : undefined;
  const pubkey = decoded?.ok && (decoded.pubkey ?? decoded.hex);
  if (!pubkey) return;
  selectAuthor(pubkey);
}

function selectAuthor(pubkey: string) {
  followsMode = false;
  authorInput.value = pubkey;
  start([pubkey]);
}

async function refreshIdentity() {
  const version = ++identityVersion;
  const pubkey = await identity.getPublicKey();
  if (version !== identityVersion) return;
  const previous = activePubkey;
  activePubkey = pubkey;
  followsButton.disabled = !pubkey;
  if (pubkey && (!previous || followsMode)) return startFollows();
  if (!pubkey && (followsMode || authors.length === 0)) {
    followsMode = false;
    authorInput.value = DEFAULT_AUTHOR;
    await startAuthor(DEFAULT_AUTHOR);
  }
}

followsButton.addEventListener("click", startFollows);
authorInput.addEventListener("change", () => startAuthor(authorInput.value.trim()));
olderButton.addEventListener("click", loadOlder);
$("refresh-plan").addEventListener("click", refreshPlan);
window.addEventListener("pagehide", () => {
  subscription?.close();
  clearInterval(planTimer);
  for (const url of pictures.values()) URL.revokeObjectURL(url);
});

shell.ready().then(async () => {
  identity.onChanged(refreshIdentity);
  await refreshIdentity();
});
