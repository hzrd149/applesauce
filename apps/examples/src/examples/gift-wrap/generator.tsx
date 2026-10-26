/**
 * Stress-test a recipient's NIP-59 inbox with valid messages and faults at every encryption layer
 * @tags gift-wrap, generator, encryption, nip-59, nip-17, stress-test
 * @related gift-wrap/dashboard, messages/gift-wrap
 */
import { randomBytes } from "@noble/hashes/utils.js";
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { nip44 } from "applesauce-core/helpers/encryption";
import { finalizeEvent, getEventHash, kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { unixNow } from "applesauce-core/helpers/time";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayEventVerdictError, RelayPool } from "applesauce-relay";
import { useCallback, useRef, useState } from "react";
import { catchError, combineLatest, of, startWith, map, timeout } from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

const SCENARIOS = [
  { id: "valid", label: "Valid message", layer: "Control", hint: "Valid kind 14 message, seal, and gift wrap" },
  {
    id: "ciphertext",
    label: "Broken wrap encryption",
    layer: "Wrap",
    hint: "Random base64 instead of NIP-44 ciphertext",
  },
  { id: "seal-json", label: "Invalid seal JSON", layer: "Wrap", hint: "Valid wrap decrypts to non-JSON text" },
  { id: "seal-kind", label: "Wrong seal kind", layer: "Seal", hint: "Signed kind 1 event instead of kind 13" },
  {
    id: "seal-signature",
    label: "Invalid seal signature",
    layer: "Seal",
    hint: "Seal signature is replaced after signing",
  },
  {
    id: "seal-ciphertext",
    label: "Broken seal encryption",
    layer: "Seal",
    hint: "Signed seal contains random base64 instead of NIP-44 ciphertext",
  },
  { id: "rumor-json", label: "Invalid rumor JSON", layer: "Rumor", hint: "Seal decrypts to non-JSON text" },
  {
    id: "rumor-kind",
    label: "Wrong rumor kind",
    layer: "Rumor",
    hint: "Rumor kind 1 instead of kind 14; valid for NIP-59, unexpected for NIP-17",
  },
  { id: "rumor-id", label: "Invalid rumor ID", layer: "Rumor", hint: "Rumor ID does not match its contents" },
  {
    id: "rumor-author",
    label: "Mismatched rumor author",
    layer: "Rumor",
    hint: "Rumor author differs from the signing seal author",
  },
  {
    id: "base64",
    label: "Base64 message",
    layer: "Control",
    hint: "Valid NIP-17 message containing random base64 text",
  },
] as const;
type Scenario = (typeof SCENARIOS)[number]["id"];
type Verdict = { relay: string; status: "accepted" | "rejected" | "error"; message: string };
type Result = {
  index: number;
  scenario: Scenario;
  event?: NostrEvent;
  verdicts: Verdict[];
  error?: string;
  ms: number;
};
type Run = {
  status: "idle" | "running" | "stopping" | "stopped" | "complete";
  target: string;
  total: number;
  completed: number;
  accepted: number;
  rejected: number;
  errors: number;
  started: number;
  elapsed: number;
  results: Result[];
  relays: Record<string, { accepted: number; rejected: number; errors: number }>;
};
const INITIAL: Run = {
  status: "idle",
  target: "",
  total: 0,
  completed: 0,
  accepted: 0,
  rejected: 0,
  errors: 0,
  started: 0,
  elapsed: 0,
  results: [],
  relays: {},
};
const pool = new RelayPool();
const eventStore = new EventStore({ verifyEvent });
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

/** Resolves inboxes while keeping loading, missing data, and discovery failures distinct */
function inboxes$(pubkey: string) {
  const user = castUser(pubkey, eventStore);
  return combineLatest([user.directMessageRelays$, user.inboxes$]).pipe(
    map(([dmRelays, inboxes]) => ({
      status: "ready",
      relays: dmRelays?.length ? dmRelays : (inboxes ?? []),
      error: "",
    })),
    timeout({ first: 15_000 }),
    catchError((error) => of({ status: "error", relays: [] as string[], error: String(error.message ?? error) })),
    startWith({ status: "loading", relays: [] as string[], error: "" }),
  );
}

function randomBase64(bytes: number) {
  return btoa(Array.from(randomBytes(bytes), (byte) => String.fromCharCode(byte)).join(""));
}

// Manual construction is deliberate: typed factories prevent the malformed structures under test.
function generate(pubkey: string, scenario: Scenario, bytes: number, sender: Uint8Array, message: string): NostrEvent {
  const wrapKey = generateSecretKey();
  const encrypt = (key: Uint8Array, text: string) => nip44.encrypt(text, nip44.getConversationKey(key, pubkey));
  const wrap = (content: string) =>
    finalizeEvent({ kind: kinds.GiftWrap, created_at: unixNow(), tags: [["p", pubkey]], content }, wrapKey);
  if (scenario === "ciphertext") return wrap(randomBase64(bytes));
  if (scenario === "seal-json") return wrap(encrypt(wrapKey, randomBase64(bytes)));

  const rumor = {
    pubkey: scenario === "rumor-author" ? getPublicKey(generateSecretKey()) : getPublicKey(sender),
    kind: scenario === "rumor-kind" ? 1 : kinds.PrivateDirectMessage,
    created_at: unixNow(),
    tags: [["p", pubkey]],
    content: scenario === "base64" ? randomBase64(bytes) : message,
  };
  const rumorJSON =
    scenario === "rumor-json"
      ? randomBase64(bytes)
      : JSON.stringify({
          ...rumor,
          id: scenario === "rumor-id" ? "0".repeat(64) : getEventHash(rumor),
        });
  const seal = finalizeEvent(
    {
      kind: scenario === "seal-kind" ? 1 : kinds.Seal,
      created_at: unixNow(),
      tags: [],
      content: scenario === "seal-ciphertext" ? randomBase64(bytes) : encrypt(sender, rumorJSON),
    },
    sender,
  );
  const sealed = scenario === "seal-signature" ? { ...seal, sig: "0".repeat(128) } : seal;
  return wrap(encrypt(wrapKey, JSON.stringify(sealed)));
}

/** Waits between jobs and removes timers immediately when the run stops */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        className="input w-full"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
      />
    </label>
  );
}

export default function BrokenGiftWrapGenerator() {
  const [pubkey, setPubkey] = useState("");
  const [custom, setCustom] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<Scenario>>(new Set(["ciphertext"]));
  const [count, setCount] = useState(10);
  const [concurrency, setConcurrency] = useState(1);
  const [minDelay, setMinDelay] = useState(100);
  const [maxDelay, setMaxDelay] = useState(1000);
  const [bytes, setBytes] = useState(256);
  const [message, setMessage] = useState("Gift wrap test message");
  const [freshSender, setFreshSender] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [run, setRun] = useState<Run>(INITIAL);
  const [filter, setFilter] = useState("all");
  const controller = useRef<AbortController | null>(null);
  const cleanup = useCallback(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const inboxes = use$(() => (pubkey ? inboxes$(pubkey) : undefined), [pubkey]);
  const customRelays: string[] = [];
  let relayError = "";
  for (const input of custom.split(/[\s,]+/).filter(Boolean)) {
    try {
      const url = new URL(input);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
      customRelays.push(url.href);
    } catch {
      relayError = `Invalid relay: ${input}`;
    }
  }
  const available = [...new Set([...(inboxes?.relays ?? []), ...customRelays])];
  const relays = available.filter((relay) => !excluded.has(relay));
  const busy = run.status === "running" || run.status === "stopping";
  const scenarios = SCENARIOS.filter((item) => selected.has(item.id));
  const canRun =
    /^[a-f0-9]{64}$/i.test(pubkey) &&
    scenarios.length > 0 &&
    minDelay <= maxDelay &&
    (dryRun || (relays.length > 0 && !relayError));

  async function start() {
    if (!canRun || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const sender = generateSecretKey();
    const started = Date.now();
    setRun({ ...INITIAL, status: "running", target: pubkey, total: count, started });
    let next = 0;
    async function worker() {
      while (!abort.signal.aborted) {
        const index = next++;
        if (index >= count) return;
        if (index >= concurrency)
          await pause(minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1)), abort.signal);
        if (abort.signal.aborted) return;
        const scenario = scenarios[index % scenarios.length].id;
        const began = Date.now();
        const result: Result = { index, scenario, verdicts: [], ms: 0 };
        try {
          result.event = generate(
            pubkey,
            scenario,
            bytes,
            freshSender ? generateSecretKey() : sender,
            `${message} #${index + 1}`,
          );
          if (!dryRun && !abort.signal.aborted) {
            // Settle each relay independently; a transport failure must not hide other relay verdicts.
            result.verdicts = await Promise.all(
              relays.map(async (relay): Promise<Verdict> => {
                try {
                  const responses = await pool.publish([relay], result.event!, {
                    retries: 0,
                    timeout: 10_000,
                    authTimeout: 10_000,
                  });
                  const response = responses[0];
                  if (!response) return { relay, status: "error", message: "No response" };
                  return {
                    relay,
                    status: response.ok
                      ? "accepted"
                      : response.error && !(response.error instanceof RelayEventVerdictError)
                        ? "error"
                        : "rejected",
                    message: response.message ?? "",
                  };
                } catch (error) {
                  return { relay, status: "error", message: String(error) };
                }
              }),
            );
          }
        } catch (error) {
          result.error = String(error);
        }
        result.ms = Date.now() - began;
        setRun((previous) => {
          const totals = { ...previous.relays };
          for (const verdict of result.verdicts) {
            const old = totals[verdict.relay] ?? { accepted: 0, rejected: 0, errors: 0 };
            const key = verdict.status === "error" ? "errors" : verdict.status;
            totals[verdict.relay] = { ...old, [key]: old[key] + 1 };
          }
          return {
            ...previous,
            completed: previous.completed + 1,
            elapsed: Date.now() - started,
            accepted: previous.accepted + result.verdicts.filter((v) => v.status === "accepted").length,
            rejected: previous.rejected + result.verdicts.filter((v) => v.status === "rejected").length,
            errors:
              previous.errors + result.verdicts.filter((v) => v.status === "error").length + (result.error ? 1 : 0),
            relays: totals,
            results: [result, ...previous.results].slice(0, 200),
          };
        });
      }
    }
    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      setRun((previous) => ({
        ...previous,
        status: abort.signal.aborted ? "stopped" : "complete",
        elapsed: Date.now() - started,
      }));
      controller.current = null;
    }
  }

  function stop() {
    controller.current?.abort();
    setRun((previous) => ({ ...previous, status: "stopping" }));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "gift-wrap-results.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const visible = run.results.filter(
    (result) =>
      filter === "all" ||
      (filter === "errors"
        ? result.error || result.verdicts.some((v) => v.status !== "accepted")
        : result.scenario === filter),
  );
  return (
    <div className="flex min-h-0 grow flex-col overflow-y-auto md:flex-row md:overflow-hidden" ref={cleanup}>
      <aside className="flex shrink-0 flex-col border-b border-base-300 md:w-80 md:border-b-0 md:border-e">
        <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <label className="flex flex-col gap-2 text-sm">
            Recipient
            <PubkeyPicker
              value={pubkey}
              onChange={(key) => {
                setPubkey(key);
                setExcluded(new Set());
              }}
              placeholder="npub, hex, or NIP-05"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className="font-medium">Inbox relays</span>
            <span className="badge">{inboxes?.status ?? "No recipient"}</span>
          </div>
          {inboxes?.error && (
            <p role="alert" className="text-sm text-error">
              {inboxes.error}
            </p>
          )}
          {inboxes?.status === "ready" && !inboxes.relays.length && (
            <p className="text-sm text-base-content/60">No published inbox relays</p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Additional relays
            <textarea
              className="textarea w-full"
              rows={2}
              placeholder="wss://relay.example.com"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          {relayError && (
            <p role="alert" className="text-sm text-error">
              {relayError}
            </p>
          )}
          <div>
            {available.map((relay) => (
              <label key={relay} className="flex items-center gap-2 border-b border-base-300 py-2 text-sm">
                <input
                  className="checkbox checkbox-sm"
                  type="checkbox"
                  checked={!excluded.has(relay)}
                  onChange={() =>
                    setExcluded((old) => {
                      const next = new Set(old);
                      if (next.has(relay)) next.delete(relay);
                      else next.add(relay);
                      return next;
                    })
                  }
                />
                <span className="truncate" title={relay}>
                  {relay.replace(/^wss?:\/\//, "")}
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Events" value={count} min={1} max={10000} onChange={setCount} />
            <NumberInput label="Workers" value={concurrency} min={1} max={16} onChange={setConcurrency} />
            <NumberInput label="Min delay (ms)" value={minDelay} min={0} max={60000} onChange={setMinDelay} />
            <NumberInput label="Max delay (ms)" value={maxDelay} min={0} max={60000} onChange={setMaxDelay} />
          </div>
          {minDelay > maxDelay && <p className="text-sm text-error">Min delay must not exceed max delay</p>}
          <NumberInput label="Random payload (bytes)" value={bytes} min={1} max={16000} onChange={setBytes} />
          <label className="flex flex-col gap-1 text-sm">
            Message
            <textarea
              className="textarea w-full"
              value={message}
              maxLength={8000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={freshSender}
              onChange={(e) => setFreshSender(e.target.checked)}
            />
            Fresh sender per event
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Generate only
          </label>
        </fieldset>
        <div className="border-t border-base-300 p-4">
          {busy ? (
            <button className="btn btn-error w-full" disabled={run.status === "stopping"} onClick={stop}>
              {run.status === "stopping" ? "Waiting for in-flight publishes" : "Stop run"}
            </button>
          ) : (
            <button className="btn btn-primary w-full" disabled={!canRun} onClick={start}>
              {dryRun ? "Generate" : "Publish"} {count.toLocaleString()} events
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0 shrink-0 md:min-h-0 md:flex-1 md:overflow-y-auto">
        <section className="border-b border-base-300 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Payload scenarios</h2>
            <span className="badge">{selected.size} selected</span>
          </div>
          <div className="grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
            {SCENARIOS.map((scenario) => (
              <label
                title={scenario.hint}
                key={scenario.id}
                className="flex items-center gap-3 border-b border-base-300 py-3 text-sm"
              >
                <input
                  className="checkbox checkbox-sm"
                  type="checkbox"
                  disabled={busy}
                  checked={selected.has(scenario.id)}
                  onChange={() =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (next.has(scenario.id)) next.delete(scenario.id);
                      else next.add(scenario.id);
                      return next;
                    })
                  }
                />
                <span className="flex-1">{scenario.label}</span>
                <span className="text-base-content/60">{scenario.layer}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="border-b border-base-300 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="badge">{run.status}</span>
            <span>
              {run.completed.toLocaleString()} / {run.total.toLocaleString()} events
            </span>
            <span className="text-sm">
              {(run.elapsed / 1000).toFixed(1)}s ·{" "}
              {run.elapsed ? (run.completed / (run.elapsed / 1000)).toFixed(1) : "0"} events/s
            </span>
            <button className="btn btn-sm ms-auto" disabled={!run.completed || busy} onClick={download}>
              Export JSON
            </button>
            <button className="btn btn-sm" disabled={busy || !run.completed} onClick={() => setRun(INITIAL)}>
              Clear
            </button>
          </div>
          <progress className="progress progress-primary w-full" value={run.completed} max={run.total || 1} />
          {run.target && (
            <p className="mt-2 truncate font-mono text-sm" title={run.target}>
              {run.target}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="text-success">{run.accepted} accepted</span>
            <span className="text-warning">{run.rejected} rejected</span>
            <span className="text-error">{run.errors} errors</span>
          </div>
          {!!Object.keys(run.relays).length && (
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Relay</th>
                    <th>Accepted</th>
                    <th>Rejected</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(run.relays).map(([relay, totals]) => (
                    <tr key={relay}>
                      <td>{relay}</td>
                      <td>{totals.accepted}</td>
                      <td>{totals.rejected}</td>
                      <td>{totals.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-4">
          <h2 className="font-semibold">Event log</h2>
          <span className="badge" title="Latest 200 events retained; totals include the entire run">
            {run.results.length} retained
          </span>
          <select
            className="select ms-auto"
            aria-label="Filter event log"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All events</option>
            <option value="errors">Rejected / errors</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {!visible.length && (
          <div className="p-8 text-center text-base-content/60">
            {run.completed ? "No matching events" : busy ? "Generating events…" : "No events generated"}
          </div>
        )}
        {visible.map((result) => (
          <details key={result.index} className="border-b border-base-300">
            <summary className="cursor-pointer px-4 py-3 text-sm">
              <span className="me-3 font-mono">#{result.index + 1}</span>
              {SCENARIOS.find((s) => s.id === result.scenario)?.label}
              <span className="ms-3 text-base-content/60">
                {result.ms} ms ·{" "}
                {result.event ? `${JSON.stringify(result.event).length.toLocaleString()} bytes` : "Generation failed"}
              </span>
              <span className="ms-3">
                {result.error
                  ? "Error"
                  : result.verdicts.length
                    ? `${result.verdicts.filter((v) => v.status === "accepted").length}/${result.verdicts.length} accepted`
                    : "Generated"}
              </span>
            </summary>
            <div className="space-y-2 px-4 pb-4 text-sm">
              {result.error && <p className="text-error">{result.error}</p>}
              {result.verdicts.map((v) => (
                <div key={v.relay} className="flex flex-wrap gap-2">
                  <span className="badge">{v.status}</span>
                  <span>{v.relay}</span>
                  <span className="break-all text-base-content/60">{v.message}</span>
                </div>
              ))}
              {result.event && (
                <pre className="max-h-80 overflow-auto bg-base-200 p-3 text-sm">
                  {JSON.stringify(result.event, null, 2)}
                </pre>
              )}
            </div>
          </details>
        ))}
      </main>
    </div>
  );
}
