/**
 * Sync, inspect, edit and delete all of a user's NIP-78 app-specific data using the NIP-77 sync loader
 * @tags misc, app-data, nip-78, storage, nip-77, sync
 * @related app-handlers/open-with, loader/sync-loader
 */
import { publishEvent } from "../../extra/publish";

import { castUser, User } from "applesauce-common/casts";
import { AppDataFactory } from "applesauce-common/factories";
import {
  APP_DATA_KIND,
  getAppDataContent,
  getAppDataEncryption,
  isAppDataUnlocked,
} from "applesauce-common/helpers/app-data";
import { DeleteFactory, EventStore, watchEventUpdates } from "applesauce-core";
import {
  EncryptionMethod,
  getEventUID,
  getReplaceableIdentifier,
  getSeenRelays,
  kinds,
  mergeRelaySets,
  NostrEvent,
} from "applesauce-core/helpers";
import { getHiddenContent, unlockHiddenContent } from "applesauce-core/helpers/hidden-content";
import {
  createEventLoaderForStore,
  createSyncLoader,
  SyncAuthHandler,
  SyncLoaderStatus,
  SyncRelayStatus,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Lock } from "lucide-react";
import { useRef, useMemo, useState } from "react";
import { BehaviorSubject, combineLatest, distinctUntilChanged, map, switchMap } from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

// Loads every matching event from each relay using NIP-77 negentropy, falling back to paginated requests
const syncLoader = createSyncLoader({ eventStore, pool });

// Used when the user has no NIP-65 outboxes
const FALLBACK_RELAYS = ["wss://relay.damus.io/"];

// Authenticate with relays that require NIP-42 auth to read the user's (often private) app data
const onAuthRequired: SyncAuthHandler = async ({ relay }) => {
  if (signer$.value) await relay.authenticate(signer$.value);
};

// The status of both sync runs: the app data events and the deletions targeting them
type SyncState = { data: SyncLoaderStatus; deletes: SyncLoaderStatus };

// Describes how the content of an app-data event should be displayed
type ContentDisplay =
  | { kind: "empty" }
  | { kind: "locked"; method: EncryptionMethod }
  | { kind: "json"; value: unknown }
  | { kind: "raw"; value: string; encrypted: boolean };

// Detect strings with control chars (likely binary payload rather than text)
function isBinary(s: string) {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0E-\x1F]/.test(s);
}

// Format a unix timestamp as a short relative time (e.g. "5m ago")
function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const encoder = new TextEncoder();

function getContentBytes(event: NostrEvent) {
  return encoder.encode(event.content).length;
}

function getContentDisplay(event: NostrEvent): ContentDisplay {
  if (event.content.length === 0) return { kind: "empty" };

  const encryption = getAppDataEncryption(event);
  if (encryption && !isAppDataUnlocked(event)) return { kind: "locked", method: encryption };

  const parsed = getAppDataContent(event);
  if (parsed !== undefined) return { kind: "json", value: parsed };

  // Not JSON — fall back to the raw string (decrypted if the event was encrypted)
  const raw = encryption ? (getHiddenContent(event) ?? "") : event.content;
  return { kind: "raw", value: raw, encrypted: !!encryption };
}

function EventView({
  event,
  signer,
  onEdit,
  onDelete,
}: {
  event: NostrEvent;
  signer: ISigner | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [decrypting, setDecrypting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const encryption = getAppDataEncryption(event);
  const unlocked = isAppDataUnlocked(event);

  const display = use$(
    () =>
      eventStore.event(event.id).pipe(
        watchEventUpdates(eventStore),
        map((e) => e && getContentDisplay(e)),
      ),
    [event.id],
  );

  const handleDecrypt = async () => {
    if (!signer || !encryption) return;
    try {
      setDecrypting(true);
      setError(null);
      // Use unlockHiddenContent directly so non-JSON payloads don't throw
      await unlockHiddenContent(event, signer, encryption);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decryption failed");
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <>
      <div className="navbar border-b border-base-300 gap-2">
        <div className="flex-1 min-w-0 px-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xl font-bold truncate">{getReplaceableIdentifier(event)}</h2>
            {encryption && <span className="badge badge-warning">{encryption}</span>}
          </div>
          <div className="opacity-60 truncate">
            {new Date(event.created_at * 1000).toLocaleString()} · {event.content.length} chars · {event.tags.length}{" "}
            tags
          </div>
        </div>
        <div className="flex gap-2">
          {encryption && !unlocked && (
            <button className="btn btn-primary" onClick={handleDecrypt} disabled={decrypting || !signer}>
              {decrypting && <span className="loading loading-spinner" />}
              Decrypt
            </button>
          )}
          <button className="btn" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-error btn-outline" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div role="alert" className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-2">Content</h3>
          {display?.kind === "empty" && <p className="opacity-60">This event has no content.</p>}
          {display?.kind === "locked" && (
            <p className="opacity-60">Encrypted with {display.method}. Decrypt to view.</p>
          )}
          {display?.kind === "json" && (
            <pre className="bg-base-200 rounded p-3 overflow-x-auto">{JSON.stringify(display.value, null, 2)}</pre>
          )}
          {display?.kind === "raw" && (
            <>
              <p className="opacity-60 mb-2">
                {display.encrypted ? "Decrypted " : ""}
                {isBinary(display.value) ? "binary data" : "non-JSON text"} · {display.value.length} chars
              </p>
              <pre className="bg-base-200 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {display.value}
              </pre>
            </>
          )}
        </div>

        {event.tags.length > 0 && (
          <div>
            <h3 className="font-semibold mb-2">Tags</h3>
            <div className="space-y-1">
              {event.tags.map((tag, i) => (
                <div key={i} className="flex gap-2 items-baseline">
                  <kbd className="kbd">{tag[0]}</kbd>
                  <span className="font-mono break-all">{tag.slice(1).join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function EventEditor({
  event,
  signer,
  onSave,
  onCancel,
}: {
  event: NostrEvent;
  signer: ISigner | null;
  onSave: (event: NostrEvent) => Promise<void>;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(() => {
    try {
      return JSON.stringify(getAppDataContent(event), null, 2);
    } catch {
      return event.content;
    }
  });

  const [encryption, setEncryption] = useState(() => getAppDataEncryption(event));

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!signer) return;
    try {
      setSaving(true);
      setError(null);
      const parsed = JSON.parse(content);
      const signed = await AppDataFactory.modify(event).as(signer).data(parsed, encryption).sign();
      await onSave(signed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="navbar border-b border-base-300 gap-2">
        <div className="flex-1 min-w-0 px-2">
          <h2 className="text-xl font-bold truncate">Editing: {getReplaceableIdentifier(event)}</h2>
        </div>
        <div className="flex gap-2">
          <select
            className="select"
            value={encryption || ""}
            onChange={(e) => setEncryption(e.target.value ? (e.target.value as EncryptionMethod) : undefined)}
            disabled={saving}
          >
            <option value="">Plain text</option>
            <option value="nip44">NIP-44</option>
            <option value="nip04">NIP-04</option>
          </select>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !signer}>
            {saving && <span className="loading loading-spinner" />}
            Save
          </button>
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4">
        {error && (
          <div role="alert" className="alert alert-error">
            <span>{error}</span>
          </div>
        )}
        <textarea
          className="textarea textarea-bordered font-mono flex-1 min-h-64"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder='{"key": "value"}'
        />
      </div>
    </>
  );
}

// Summarizes a single relay's sync progress for one of the filters
function relayCell(status?: SyncRelayStatus) {
  if (!status) return "—";
  if (status.state === "error") return <span className="text-error">{status.error?.message ?? "error"}</span>;
  if (status.state === "complete") return status.count;
  return (
    <span className="opacity-60">
      {status.state} {status.count > 0 && status.count}
    </span>
  );
}

function SyncStatusPanel({ sync }: { sync: SyncState }) {
  const relays = Object.keys(sync.data.relays);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Sync status</h2>
        <p className="opacity-60">
          {sync.data.loaded} app data events · {sync.deletes.loaded} deletions · select an event to view details
        </p>
      </div>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Method</th>
            <th className="text-right">App data</th>
            <th className="text-right">Deletions</th>
          </tr>
        </thead>
        <tbody>
          {relays.map((relay) => (
            <tr key={relay}>
              <td className="font-mono">{relay.replace(/^wss:\/\//, "").replace(/\/$/, "")}</td>
              <td>{sync.data.relays[relay]?.method ?? "—"}</td>
              <td className="text-right">{relayCell(sync.data.relays[relay])}</td>
              <td className="text-right">{relayCell(sync.deletes.relays[relay])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppDataManager({ user }: { user: User }) {
  const signer = use$(signer$);
  const outboxes = use$(user.outboxes$);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);

  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [deleting, setDeleting] = useState(false);

  // Incremented to restart the sync
  const resync$ = useMemo(() => new BehaviorSubject(0), []);

  // Sync all the user's app data and the deletions targeting it from every outbox. Deletions are synced too so
  // the event store can drop app data that was already deleted, even if a relay still serves it
  const sync = use$<SyncState>(
    () =>
      combineLatest([
        user.outboxes$.pipe(
          map((outboxes) => (outboxes?.length ? outboxes : FALLBACK_RELAYS)),
          distinctUntilChanged((a, b) => a.join() === b.join()),
        ),
        resync$,
      ]).pipe(
        switchMap(([relays]) =>
          combineLatest({
            data: syncLoader({ relays, filter: { kinds: [APP_DATA_KIND], authors: [user.pubkey] }, onAuthRequired })
              .status$,
            deletes: syncLoader({
              relays,
              filter: { kinds: [kinds.EventDeletion], "#k": [String(APP_DATA_KIND)], authors: [user.pubkey] },
              onAuthRequired,
            }).status$,
          }),
        ),
      ),
    [user],
  );
  const syncing = !!sync && !(sync.data.done && sync.deletes.done);

  const events = use$(() => eventStore.timeline({ kinds: [APP_DATA_KIND], authors: [user.pubkey] }), [user.pubkey]);

  const selected = events?.find((e) => getEventUID(e) === selectedId) ?? null;
  // Only count checked ids that are still in the timeline
  const checkedEvents = events?.filter((e) => checked.has(e.id)) ?? [];
  const allChecked = !!events?.length && checkedEvents.length === events.length;

  // Last checkbox clicked without shift, used as the start of shift-click ranges
  const anchorId = useRef<string | null>(null);

  const toggleChecked = (id: string, shiftKey: boolean) => {
    const value = !checked.has(id);
    const ids = events?.map((e) => e.id) ?? [];
    const from = anchorId.current ? ids.indexOf(anchorId.current) : -1;
    const to = ids.indexOf(id);

    // Shift-click applies the clicked row's new state to every row between it and the anchor
    const range = shiftKey && from !== -1 && to !== -1 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];

    const next = new Set(checked);
    for (const id of range) {
      if (value) next.add(id);
      else next.delete(id);
    }
    setChecked(next);
    anchorId.current = id;
  };

  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(events?.map((e) => e.id)));

  // Publish the new revision everywhere the previous one was found so relays replace it
  const handleSave = async (updated: NostrEvent) => {
    await publishEvent(
      pool,
      mergeRelaySets(outboxes?.length ? outboxes : FALLBACK_RELAYS, selected && getSeenRelays(selected)),
      updated,
    );
    eventStore.add(updated);
    setSelectedId(getEventUID(updated));
    setEditing(false);
  };

  // Publish a single NIP-09 deletion for all the events and remove them locally. The deletion is sent to every
  // relay the sync loader found a copy on, not just the current outboxes, so stale copies get deleted too
  const deleteEvents = async (toDelete: NostrEvent[]) => {
    if (!signer || toDelete.length === 0) return;
    const message = toDelete.length === 1 ? "Delete this event?" : `Delete ${toDelete.length} events?`;
    if (!confirm(message)) return;

    try {
      setDeleting(true);
      const signed = await DeleteFactory.fromEvents(toDelete).sign(signer);
      const relays = mergeRelaySets(outboxes?.length ? outboxes : FALLBACK_RELAYS, ...toDelete.map(getSeenRelays));
      await publishEvent(pool, relays, signed);
      eventStore.add(signed);

      const ids = new Set(toDelete.map((e) => e.id));
      for (const id of ids) eventStore.remove(id);
      setChecked((prev) => new Set([...prev].filter((id) => !ids.has(id))));
      if (selectedId && toDelete.some((event) => getEventUID(event) === selectedId)) {
        setSelectedId(null);
        setEditing(false);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete events");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 max-h-dvh">
      <aside className="w-80 shrink-0 border-r border-base-300 flex flex-col bg-base-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-base-300 flex items-center gap-3 min-h-12">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = checkedEvents.length > 0 && !allChecked;
            }}
            onChange={toggleAll}
            disabled={!events?.length || deleting}
            aria-label="Select all events"
          />
          <span className="font-semibold flex-1">
            {checkedEvents.length > 0 ? `${checkedEvents.length} selected` : `Events (${events?.length ?? 0})`}
          </span>
          {checkedEvents.length > 0 && (
            <button
              className="btn btn-error btn-outline btn-sm"
              onClick={() => deleteEvents(checkedEvents)}
              disabled={deleting || !signer}
            >
              {deleting && <span className="loading loading-spinner loading-xs" />}
              Delete
            </button>
          )}
          {checkedEvents.length === 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => resync$.next(resync$.value + 1)}
              disabled={syncing}
              title="Sync again"
            >
              {syncing ? <span className="loading loading-spinner loading-xs" /> : "Resync"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {!events || events.length === 0 ? (
            <div className="p-4 opacity-60 text-center">{syncing ? "Syncing..." : "No app data events found."}</div>
          ) : (
            <ul className="menu w-full select-none">
              {events.map((event) => {
                const enc = getAppDataEncryption(event);
                return (
                  <li key={event.id}>
                    <a
                      className={selectedId === getEventUID(event) ? "menu-active" : ""}
                      onClick={() => {
                        setSelectedId(getEventUID(event));
                        setEditing(false);
                      }}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={checked.has(event.id)}
                        readOnly
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleChecked(event.id, e.shiftKey);
                        }}
                        disabled={deleting}
                        aria-label={`Select ${getReplaceableIdentifier(event)}`}
                      />
                      <div className="flex flex-col gap-1 min-w-0 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold truncate flex-1">{getReplaceableIdentifier(event)}</span>
                          <span
                            className="opacity-60 shrink-0"
                            title={new Date(event.created_at * 1000).toLocaleString()}
                          >
                            {timeAgo(event.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-60">
                          {getContentBytes(event)} bytes · {event.tags.length} tags
                          {enc && <Lock className="size-3.5 ml-1" aria-label={`Encrypted with ${enc}`} />}
                        </div>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          sync ? (
            <SyncStatusPanel sync={sync} />
          ) : (
            <div className="flex-1 flex items-center justify-center opacity-60">Select an event to view details</div>
          )
        ) : editing ? (
          <EventEditor
            key={selected.id}
            event={selected}
            signer={signer}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <EventView
            event={selected}
            signer={signer}
            onEdit={() => setEditing(true)}
            onDelete={() => deleteEvents([selected])}
          />
        )}
      </main>
    </div>
  );
}

export default function AppDataExample() {
  const user = use$(user$);

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
  };

  if (!user) return <LoginView onLogin={handleLogin} />;
  return <AppDataManager user={user} />;
}
