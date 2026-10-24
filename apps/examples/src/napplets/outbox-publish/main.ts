import type { NappletGlobal, OutboxRelayPlan } from "@napplet/core";
import "./style.css";

const DEFAULT_RECIPIENT = "npub1klkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qulx3vt";

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
const contentInput = $("content") as HTMLTextAreaElement;
const recipientInput = $("recipient") as HTMLInputElement;
const toOutboxInput = $("to-outbox") as HTMLInputElement;
const extraRelaysInput = $("extra-relays") as HTMLInputElement;
const publishButton = $("publish") as HTMLButtonElement;

let userPubkey = "";
let recipients: string[] = [];
const names = new Map<string, string>();

/** Picks a stable hue for a relay or pubkey so it reads the same everywhere */
function colorFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 45%)`;
}

function relayChip(relay: string, prefix = "") {
  const chip = document.createElement("span");
  chip.className = "relay";
  chip.style.setProperty("--relay-color", colorFor(relay));
  chip.textContent = prefix + relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
  chip.title = relay;
  return chip;
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

function planRow(icon: string, relays: string[], plan?: OutboxRelayPlan, pubkey?: string) {
  const row = document.createElement("div");
  row.className = "plan-row";
  if (pubkey) row.append(avatar(pubkey));
  row.append(icon);

  if (plan) {
    const source = document.createElement("span");
    source.className = "badge";
    source.title = "outbox.resolveRelays source";
    source.textContent = plan.missingAuthors?.length ? `${plan.source}, missing` : plan.source;
    row.append(source);
  }
  row.append(...relays.map((relay) => relayChip(relay)));
  return row;
}

function extraRelays() {
  return extraRelaysInput.value.split(/[\s,]+/).filter((relay) => /^wss?:\/\//.test(relay));
}

let planRequest = 0;
/** Shows where a publish would go: the user's outboxes, each recipient's inboxes, and any extra relays */
async function renderPlan() {
  const request = ++planRequest;
  const toOutbox = toOutboxInput.checked;

  const [ownPlan, ...recipientPlans] = await Promise.all([
    toOutbox ? outbox.resolveRelays({ direction: "write" }) : undefined,
    ...recipients.map((pubkey) => outbox.resolveRelays({ pubkey, direction: "write" })),
  ]);
  if (request !== planRequest) return;

  const rows: HTMLElement[] = [];
  if (ownPlan) rows.push(planRow("Outboxes", ownPlan.relays, ownPlan, userPubkey || undefined));
  recipients.forEach((pubkey, index) => {
    const row = planRow("Inboxes", recipientPlans[index].relays, recipientPlans[index], pubkey);
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.title = "Remove mention";
    remove.addEventListener("click", () => {
      recipients = recipients.filter((recipient) => recipient !== pubkey);
      renderPlan();
    });
    row.append(remove);
    rows.push(row);
  });
  if (extraRelays().length) rows.push(planRow("Extra", extraRelays()));
  $("plan").replaceChildren(...rows);

  const total = new Set([
    ...(ownPlan?.relays ?? []),
    ...recipientPlans.flatMap((plan) => plan.relays),
    ...extraRelays(),
  ]);
  $("relay-total").textContent = String(total.size);
}

async function addRecipient() {
  const decoded = await common.decodeNip19(recipientInput.value.trim());
  const pubkey = decoded.ok ? (decoded.pubkey ?? decoded.hex) : undefined;
  if (!pubkey || recipients.includes(pubkey)) return;

  recipients = [...recipients, pubkey];
  recipientInput.value = "";
  renderPlan();
}

/** Publishes the note through the shell, then reads it back through outbox routing */
async function publish() {
  publishButton.disabled = true;
  $("results").replaceChildren("Publishing…");
  $("readback").replaceChildren();

  const template = {
    kind: 1,
    content: contentInput.value,
    tags: recipients.map((pubkey) => ["p", pubkey]),
    created_at: Math.floor(Date.now() / 1000),
  };
  const result = await outbox.publish(template, {
    toOutbox: toOutboxInput.checked,
    toInboxes: recipients,
    relays: extraRelays(),
  });
  publishButton.disabled = !userPubkey;

  if (!result.ok || !result.eventId) {
    $("results").replaceChildren(`Failed: ${result.error ?? "unknown"}`);
    return;
  }
  const verdicts = Object.entries(result.relays ?? {});
  $("results").replaceChildren(...verdicts.map(([relay, ok]) => relayChip(relay, ok ? "ok " : "failed ")));

  const readBack = await outbox.getEvent(result.eventId, { author: userPubkey });
  $("readback").replaceChildren(
    readBack.result ? "Read back" : `Read back failed: ${readBack.error ?? "not found"}`,
    ...(readBack.result?.sidecar?.relayHints ?? []).map((relay) => relayChip(relay)),
  );
}

async function refreshUser() {
  userPubkey = await identity.getPublicKey();
  publishButton.disabled = !userPubkey;

  $("user").textContent = userPubkey ? userPubkey.slice(0, 12) + "…" : "Logged out";
  renderPlan();

  if (!userPubkey) return;
  const pubkey = userPubkey;
  const profile = await identity.getProfile().catch(() => null);
  const name = profile?.displayName || profile?.name;
  if (name && pubkey === userPubkey) $("user").textContent = name;
}

$("add-recipient").addEventListener("click", addRecipient);
recipientInput.addEventListener("change", addRecipient);
toOutboxInput.addEventListener("change", renderPlan);
extraRelaysInput.addEventListener("change", renderPlan);
publishButton.addEventListener("click", publish);

shell.ready().then(() => {
  identity.onChanged(refreshUser);
  recipientInput.value = DEFAULT_RECIPIENT;
  addRecipient();
  refreshUser();
});
