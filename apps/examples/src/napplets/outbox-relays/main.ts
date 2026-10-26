import type { NappletGlobal, OutboxRelayPlan } from "@napplet/core";
import "./style.css";

const DEFAULT_OWNER = "npub1klkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qulx3vt";
const CONCURRENCY = 8;
const MAX_AVATARS = 24;

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
const ownerInput = $("owner") as HTMLInputElement;
const recomputeButton = $("recompute") as HTMLButtonElement;

const names = new Map<string, string>();
let run = 0;

/** Picks a stable hue for a relay or pubkey so it reads the same everywhere */
function colorFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 45%)`;
}

/** Renders a user as a coloured initial, filling in the name from the shell's profile cache */
function avatar(pubkey: string) {
  const element = document.createElement("span");
  element.className = "avatar";
  element.style.setProperty("--author-color", colorFor(pubkey));

  const show = (name: string) => {
    element.textContent = name[0]?.toUpperCase() ?? "?";
    element.title = name;
  };
  show(names.get(pubkey) ?? pubkey.slice(0, 8));

  if (!names.has(pubkey)) {
    common.getProfile(pubkey).then((result) => {
      const name = result.profile?.displayName || result.profile?.name;
      if (!name) return;
      names.set(pubkey, name);
      show(name);
    });
  }
  return element;
}

function avatars(pubkeys: string[]) {
  const elements: HTMLElement[] = pubkeys.slice(0, MAX_AVATARS).map(avatar);
  if (pubkeys.length > MAX_AVATARS) {
    const more = document.createElement("span");
    more.className = "muted";
    more.textContent = `+${pubkeys.length - MAX_AVATARS}`;
    elements.push(more);
  }
  return elements;
}

function tableRow(label: HTMLElement, count: number, total: number, color: string) {
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.style.width = `${total ? (count / total) * 100 : 0}%`;
  bar.style.setProperty("--bar-color", color);

  const value = document.createElement("span");
  value.textContent = String(count);

  const row = document.createElement("div");
  row.className = "table-row";
  row.append(label, value, bar);
  return row;
}

/** Reads the owner's contact list from their outboxes */
async function loadContacts(pubkey: string) {
  const { events } = await outbox.query([{ kinds: [3], authors: [pubkey], limit: 1 }], { authors: [pubkey] });
  const latest = events.map((result) => result.event).sort((a, b) => b.created_at - a.created_at)[0];
  const contacts = latest?.tags.filter((tag) => tag[0] === "p" && /^[0-9a-f]{64}$/.test(tag[1])).map((tag) => tag[1]);
  return [...new Set(contacts ?? [])];
}

/** Resolves each author's own relay plan a few at a time */
async function resolveEach(authors: string[], onProgress: (done: number) => void) {
  const plans = new Map<string, OutboxRelayPlan>();
  let next = 0;

  const worker = async () => {
    while (next < authors.length) {
      const pubkey = authors[next++];
      plans.set(pubkey, await outbox.resolveRelays({ authors: [pubkey] }));
      onProgress(plans.size);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return plans;
}

function renderSelection(authors: string[], combined: OutboxRelayPlan, plans: Map<string, OutboxRelayPlan>) {
  const selected = new Set(combined.relays);
  const missing = new Set(combined.missingAuthors ?? []);
  const usersByRelay = new Map<string, string[]>(combined.relays.map((relay) => [relay, []]));
  const usersByCount = new Map<number, string[]>();
  const orphaned: string[] = [];

  for (const pubkey of authors) {
    if (missing.has(pubkey)) continue;

    // A user is covered by each selected relay that is also in their own plan
    const covering = (plans.get(pubkey)?.relays ?? []).filter((relay) => selected.has(relay));
    for (const relay of covering) usersByRelay.get(relay)!.push(pubkey);
    usersByCount.set(covering.length, [...(usersByCount.get(covering.length) ?? []), pubkey]);
    if (covering.length === 0) orphaned.push(pubkey);
  }

  $("relay-count").textContent = String(combined.relays.length);
  $("source").textContent = combined.source;
  $("covered").textContent = String(authors.length - missing.size - orphaned.length);
  $("missing").textContent = String(missing.size);
  $("orphaned").textContent = String(orphaned.length);

  const relayRows = [...usersByRelay].sort((a, b) => b[1].length - a[1].length);
  $("relays").replaceChildren(
    ...relayRows.map(([relay, users]) => {
      const label = document.createElement("span");
      label.className = "relay";
      label.style.setProperty("--relay-color", colorFor(relay));
      label.textContent = relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
      label.title = relay;
      return tableRow(label, users.length, authors.length, colorFor(relay));
    }),
  );

  const counts = [...usersByCount.keys()].sort((a, b) => a - b);
  $("distribution").replaceChildren(
    ...counts.map((count) => {
      const label = document.createElement("span");
      label.textContent = count === 1 ? "1 relay" : `${count} relays`;
      const color = count === 0 ? "#ef4444" : count === 1 ? "#f59e0b" : "#22c55e";
      return tableRow(label, usersByCount.get(count)!.length, authors.length, color);
    }),
  );

  $("missing-users").replaceChildren(...avatars([...missing]));
  $("orphaned-users").replaceChildren(...avatars(orphaned));
}

/** Plans relays for the owner's contacts, then checks each contact against the combined selection */
async function compute() {
  const current = ++run;
  const decoded = await common.decodeNip19(ownerInput.value.trim());
  const owner = decoded.ok ? (decoded.pubkey ?? decoded.hex) : undefined;
  if (!owner) return;

  recomputeButton.disabled = true;
  const authors = await loadContacts(owner);
  if (current !== run) return;
  $("authors").textContent = String(authors.length);

  const combined = await outbox.resolveRelays({ authors });
  if (current !== run) return;

  const known = authors.filter((pubkey) => !combined.missingAuthors?.includes(pubkey));
  const plans = await resolveEach(known, (done) => {
    if (current === run) $("progress").textContent = `Resolved ${done}/${known.length}`;
  });
  if (current !== run) return;

  renderSelection(authors, combined, plans);
  recomputeButton.disabled = false;
}

recomputeButton.addEventListener("click", compute);
ownerInput.addEventListener("change", compute);

async function useCurrentUser() {
  const pubkey = await identity.getPublicKey();
  const npub = pubkey ? (await common.encodeNip19({ type: "npub", hex: pubkey })).value : undefined;
  ownerInput.value = npub ?? DEFAULT_OWNER;
  compute();
}

shell.ready().then(() => {
  identity.onChanged(useCurrentUser);
  useCurrentUser();
});
