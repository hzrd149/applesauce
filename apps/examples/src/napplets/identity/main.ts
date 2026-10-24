import type { CommonActionResult, CommonReportTarget, NappletGlobal } from "@napplet/core";
import "./style.css";

const DEFAULT_TARGET = "npub1klkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qulx3vt";

type Target = { type: "profile"; pubkey: string } | { type: "event"; id: string; pubkey?: string };
type Action = "follow" | "unfollow" | "like" | "dislike" | "report";

/** Gets a NAP domain this napplet cannot work without */
function requireDomain<Domain extends keyof NappletGlobal>(domain: Domain): NonNullable<NappletGlobal[Domain]> {
  const api = window.napplet[domain];
  if (!api) throw new Error(`The host did not grant the ${domain} domain`);
  return api;
}

const shell = requireDomain("shell");
const identity = requireDomain("identity");
const common = requireDomain("common");

const $ = (id: string) => document.getElementById(id)!;
const targetInput = $("target") as HTMLInputElement;
const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-action]");

let target: Target | null = null;
let changes = 0;
let currentPubkey = "";

/** Renders the current user, filling in the profile and follows as the shell loads them */
async function refresh() {
  const pubkey = await identity.getPublicKey();
  currentPubkey = pubkey;
  $("follows").textContent = "–";

  if (!pubkey) {
    $("name").textContent = "🔒 Logged out";
    $("npub").textContent = "";
    return;
  }

  const npub = (await common.encodeNip19({ type: "npub", hex: pubkey })).value ?? pubkey;
  if (currentPubkey !== pubkey) return;
  $("npub").textContent = npub;
  $("name").textContent = npub.slice(0, 12) + "…";

  identity.getProfile().then(
    (profile) => {
      const name = profile?.displayName || profile?.name;
      if (currentPubkey === pubkey && name) $("name").textContent = name;
    },
    () => {},
  );

  common.follows().then((follows) => {
    if (currentPubkey === pubkey && follows.ok) $("follows").textContent = String(follows.pubkeys.length);
  });
}

/** Decodes the target input and enables the actions that apply to it */
async function decodeTarget() {
  const value = targetInput.value.trim();
  const decoded = value ? await common.decodeNip19(value) : undefined;

  if (decoded?.ok && (decoded.nip19Type === "npub" || decoded.nip19Type === "nprofile")) {
    target = { type: "profile", pubkey: (decoded.pubkey ?? decoded.hex)! };
  } else if (decoded?.ok && (decoded.nip19Type === "note" || decoded.nip19Type === "nevent")) {
    target = { type: "event", id: (decoded.eventId ?? decoded.hex)!, pubkey: decoded.pubkey };
  } else {
    target = null;
  }

  $("target-type").textContent = target ? (target.type === "profile" ? "👤" : "📝") : "?";
  for (const button of buttons) {
    const accepts = button.dataset.for;
    button.disabled = !target || (accepts !== "any" && accepts !== target.type);
  }

  $("target-name").textContent = "";
  if (target?.type === "profile") {
    const result = await common.getProfile(target.pubkey);
    if (result.ok && result.profile)
      $("target-name").textContent = result.profile.displayName || result.profile.name || "";
  }
}

function runAction(action: Action, target: Target): Promise<CommonActionResult> {
  if (target.type === "profile") {
    if (action === "follow") return common.follow(target.pubkey);
    if (action === "unfollow") return common.unfollow(target.pubkey);
  } else {
    if (action === "like") return common.react(target.id, "+");
    if (action === "dislike") return common.react(target.id, "-");
  }

  const reportTarget: CommonReportTarget =
    target.type === "profile"
      ? { type: "pubkey", pubkey: target.pubkey }
      : { type: "event", id: target.id, pubkey: target.pubkey };
  return common.report(reportTarget, "spam", "");
}

function showResult(action: Action, result: CommonActionResult) {
  const line = document.createElement("div");
  line.textContent = result.ok
    ? `✅ ${action} ${(result.eventId ?? "").slice(0, 12)}`
    : `❌ ${action} ${result.error ?? "failed"}`;
  $("results").prepend(line);
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    if (!target) return;
    const action = button.dataset.action as Action;

    button.disabled = true;
    try {
      showResult(action, await runAction(action, target));
    } catch (error) {
      showResult(action, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    button.disabled = false;

    refresh();
  });
}

targetInput.addEventListener("input", decodeTarget);
targetInput.value = DEFAULT_TARGET;

shell.ready().then(() => {
  identity.onChanged(() => {
    changes++;
    $("changes").textContent = String(changes);
    refresh();
  });

  refresh();
  decodeTarget();
});
