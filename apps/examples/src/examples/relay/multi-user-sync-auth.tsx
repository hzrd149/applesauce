/**
 * Run a NIP-77 negentropy sync on a relay that requires NIP-42 auth, waiting for multiple users to authenticate
 * @tags relay, auth, nip-42, nip-77, sync, negentropy
 * @related relay/multi-user-auth
 */
import { mapEventsToTimeline } from "applesauce-core";
import { getPublicKey, NostrEvent, unixNow } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { RelayPool, SyncDirection } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { useEffect, useState } from "react";
import { BehaviorSubject, catchError, EMPTY, filter, map, merge, of, scan, startWith, Subject, tap } from "rxjs";

// Relays that support multiple authenticated users on one connection and NIP-77 negentropy sync.
// They gate a kind 1059 sync until every #p pubkey is authenticated, the same way they gate a REQ.
const RELAYS = ["wss://relay.ditto.pub/", "wss://relay.dreamith.to/"];

const pool = new RelayPool();

type User = { name: string; signer: PrivateKeySigner; pubkey: string };

const NAMES = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy"];

/** Create a throwaway user with a new private key */
function createUser(index: number): User {
  const signer = new PrivateKeySigner();
  return { name: NAMES[index] ?? `User ${index + 1}`, signer, pubkey: getPublicKey(signer.key) };
}

// Keep the users at module level so their keys are stable, any number of signers can be added
const users$ = new BehaviorSubject<User[]>([createUser(0), createUser(1)]);
const addUser = () => users$.next([...users$.value, createUser(users$.value.length)]);

type LogEntry = { time: string; message: string };
const now = () => new Date().toLocaleTimeString();

// Log lines from user actions (publish, authenticate, sync) merged into the protocol log below
const actions$ = new Subject<string>();
const logAction = (message: string) => actions$.next(message);

/** Convert a NIP-01 / NIP-77 relay message into a human readable log line */
function messageToLogLine(m: any): string | null {
  if (m[0] === "AUTH") return "AUTH challenge received";
  if (m[0] === "CLOSED") return `CLOSED: ${m[2]}`;
  if (m[0] === "OK") return `OK ${m[2] ? "accepted" : "rejected"} ${String(m[1]).slice(0, 8)} ${m[3] || ""}`;
  if (m[0] === "NEG-MSG") return "NEG-MSG — negentropy reconciliation";
  if (m[0] === "NEG-ERR") return `NEG-ERR: ${m[2]}`;
  return null;
}

/** Create a dummy kind 1059 gift wrap addressed to all users, signed by a new ephemeral key */
async function createGiftWrap(pubkeys: string[]) {
  const ephemeral = new PrivateKeySigner();
  return await ephemeral.signEvent({
    kind: 1059,
    content: "not a real gift wrap, just a demo",
    created_at: unixNow(),
    tags: pubkeys.map((pubkey) => ["p", pubkey]),
  });
}

/** Badge showing the auth state of a single pubkey based on relay.status$.authentications */
function AuthStateBadge({ state }: { state?: { response: { ok: boolean; message?: string } | null } }) {
  if (!state) return <span className="badge badge-ghost">not authenticated</span>;
  if (state.response === null) return <span className="badge badge-warning">pending</span>;
  if (state.response.ok) return <span className="badge badge-success">authenticated</span>;
  return <span className="badge badge-error">failed: {state.response.message}</span>;
}

export default function MultiUserSyncAuthExample() {
  const [url, setUrl] = useState(RELAYS[0]);
  const [published, setPublished] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const relay = pool.relay(url);

  // Subscribe to the dynamic list of users
  const users = use$(users$);
  const pubkeys = users.map((u) => u.pubkey);

  // Subscribe to the relay status (connection, challenge, and multi-user auth state)
  const status = use$(() => relay.status$, [relay]);

  // Whether the relay advertises NIP-77 support in its NIP-11 document
  const supported = use$(() => relay.supported$, [relay]);
  const supportsNIP77 = supported?.includes(77);

  // Build the log by merging the relays protocol messages with user action lines,
  // accumulated with scan. Recreated when the relay changes, which also resets the log
  const log = use$(
    () =>
      merge(
        relay.message$.pipe(
          map(messageToLogLine),
          filter((line): line is string => line !== null),
        ),
        actions$,
      ).pipe(
        map((message): LogEntry => ({ time: now(), message })),
        scan((log, entry) => [...log.slice(-30), entry], [] as LogEntry[]),
        startWith([] as LogEntry[]),
      ),
    [relay],
  );

  // Syncing gift wraps is restricted: the relay rejects the NIP-77 negotiation with auth-required
  // until every #p pubkey is authenticated. waitForAuth holds the sync until all of them are, then
  // reconciles and downloads the gift wraps the relay has. Unlike a subscription, a sync completes.
  const synced = use$(() => {
    if (!syncing) return of([] as NostrEvent[]);

    return pool.sync([url], [], { kinds: [1059], "#p": pubkeys }, SyncDirection.RECEIVE, { waitForAuth: pubkeys }).pipe(
      tap({
        next: (event) => logAction(`Synced gift wrap ${event.id.slice(0, 8)}`),
        complete: () => {
          logAction("Sync complete");
          setSyncing(false);
        },
      }),
      mapEventsToTimeline(),
      startWith([] as NostrEvent[]),
      catchError((error) => {
        logAction(`Sync error: ${error instanceof Error ? error.message : String(error)}`);
        setSyncing(false);
        return EMPTY;
      }),
    );
  }, [url, syncing, users]);

  // Reset the demo state when the relay changes
  useEffect(() => {
    setPublished(null);
    setSyncing(false);
  }, [relay]);

  // Publishing a gift wrap does NOT require authentication (the sender is an ephemeral key)
  const publish = async () => {
    const gift = await createGiftWrap(pubkeys);
    logAction(`Publishing gift wrap ${gift.id.slice(0, 8)}…`);

    try {
      const [response] = await pool.publish([url], gift);
      if (response.ok) setPublished(gift.id);
      logAction(`Publish ${response.ok ? "accepted" : `rejected: ${response.message}`}`);
    } catch (error) {
      logAction(`Publish error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sync = () => {
    setSyncing(true);
    logAction(`Syncing gift wraps (waits for all ${users.length} users to authenticate)…`);
  };

  const stopSync = () => {
    setSyncing(false);
    logAction("Stopped sync");
  };

  const authenticate = async (signer: PrivateKeySigner, name: string) => {
    try {
      const response = await relay.authenticate(signer);
      logAction(`${name} auth response: ${response.ok ? "ok" : (response.message ?? "failed")}`);
    } catch (error) {
      logAction(`${name} auth error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Authenticate every user that is not authenticated yet, one at a time
  const authenticateAll = async () => {
    for (const { name, signer, pubkey } of users$.value) {
      if (!relay.isAuthenticated(pubkey)) await authenticate(signer, name);
    }
  };

  return (
    <div className="container mx-auto p-4 flex flex-col gap-4 w-full max-w-none">
      <div className="flex items-center gap-2">
        <select className="select select-bordered" value={url} onChange={(e) => setUrl(e.target.value)}>
          {RELAYS.map((relay) => (
            <option key={relay} value={relay}>
              {relay}
            </option>
          ))}
        </select>
        <span className={`badge ${status?.connected ? "badge-success" : "badge-ghost"}`}>
          {status?.connected ? "connected" : "disconnected"}
        </span>
        <span className={`badge ${status?.challenge ? "badge-info" : "badge-ghost"}`}>
          {status?.challenge ? "challenge received" : "no challenge"}
        </span>
        <span
          className={`badge ${supported === undefined ? "badge-ghost" : supportsNIP77 ? "badge-success" : "badge-error"}`}
        >
          {supported === undefined ? "checking NIP-77…" : supportsNIP77 ? "NIP-77 supported" : "no NIP-77"}
        </span>
      </div>

      <p className="text-sm opacity-70">
        Publishing a kind 1059 gift wrap works without authentication (the sender is an ephemeral key), but{" "}
        <b>syncing gift wraps requires every #p user to be authenticated</b> on the connection. Publish a gift wrap,
        start a sync, then authenticate the users one at a time — the NIP-77 negotiation is held open with{" "}
        <code>waitForAuth: [...pubkeys]</code> and only reconciles once the last AUTH is accepted, then downloads the
        matching gift wraps and completes. Add as many signers as you want to test with.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          {/* Step 1+2: publish a gift wrap and sync it back */}
          <div className="border border-base-300 rounded-box p-4 flex flex-col gap-2">
            <h2 className="font-bold">Gift wraps</h2>
            <div className="flex items-center gap-2">
              <button className="btn btn-sm btn-secondary" onClick={publish}>
                1. Publish gift wrap
              </button>
              {published && <span className="badge badge-success font-mono">{published.slice(0, 8)} published</span>}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-sm btn-primary" disabled={syncing} onClick={sync}>
                2. Sync gift wraps
              </button>
              {syncing && <span className="badge badge-warning">waiting for all users to authenticate…</span>}
              {syncing && (
                <button className="btn btn-sm btn-ghost" onClick={stopSync}>
                  Stop
                </button>
              )}
            </div>
            {(synced ?? []).length > 0 && (
              <div className="text-sm">
                <span className="opacity-70">Synced:</span>{" "}
                {(synced ?? []).map((event) => (
                  <code
                    key={event.id}
                    className={`badge font-mono mr-1 ${event.id === published ? "badge-success" : "badge-outline"}`}
                  >
                    {event.id.slice(0, 8)}
                  </code>
                ))}
              </div>
            )}
          </div>

          {/* Step 3: per-user authentication state from status.authentications */}
          <div className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-bold flex-1">Users ({users.length})</h2>
              <button className="btn btn-sm" onClick={addUser}>
                Add signer
              </button>
              <button className="btn btn-sm" disabled={!status?.challenge} onClick={authenticateAll}>
                Authenticate all
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {users.map(({ name, signer, pubkey }) => (
                <div key={pubkey} className="flex items-center gap-2 border-b border-base-300 pb-2 last:border-b-0">
                  <div className="flex-1">
                    <div className="font-mono text-sm">{name}</div>
                    <div className="font-mono text-xs opacity-60">{pubkey.slice(0, 16)}…</div>
                  </div>
                  <AuthStateBadge state={status?.authentications[pubkey]} />
                  <button
                    className="btn btn-sm"
                    disabled={!status?.challenge || status?.authentications[pubkey]?.response?.ok === true}
                    onClick={() => authenticate(signer, name)}
                  >
                    Authenticate
                  </button>
                </div>
              ))}
            </div>

            <div className="text-sm">
              <span className="opacity-70">Authenticated pubkeys:</span>{" "}
              {status?.authenticatedPubkeys.length ? (
                status.authenticatedPubkeys.map((p) => (
                  <code key={p} className="badge badge-outline font-mono mr-1">
                    {p.slice(0, 8)}
                  </code>
                ))
              ) : (
                <span className="opacity-50">none</span>
              )}
            </div>
          </div>
        </div>

        {/* Protocol log */}
        <div className="border border-base-300 rounded-box p-4">
          <h2 className="font-bold mb-2">Log</h2>
          <div className="font-mono text-xs flex flex-col gap-1 max-h-96 overflow-y-auto">
            {log && log.length === 0 && <span className="opacity-50">Publish a gift wrap to get started…</span>}
            {log &&
              log.map((entry, i) => (
                <div key={i}>
                  <span className="opacity-50">{entry.time}</span> {entry.message}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
