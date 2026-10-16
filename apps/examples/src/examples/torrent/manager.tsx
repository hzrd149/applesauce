/**
 * Edit your published NIP-35 torrents with TorrentFactory.modify and replace the old event with a NIP-09 deletion
 * @tags nip-35, nip-09, torrent, factory, modify, delete
 * @related torrent/publisher, torrent/feed, torrent/search, simple/event-deletion
 */
import { castUser, Torrent, User } from "applesauce-common/casts";
import { TorrentFactory } from "applesauce-common/factories";
import { TORRENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { DeleteFactory, EventStore, mapEventsToStore } from "applesauce-core";
import { EventTemplate, relaySet } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useEffect, useMemo, useState } from "react";
import { BehaviorSubject, map } from "rxjs";
import LoginView from "../../components/login-view";

const FALLBACK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: LOOKUP_RELAYS, extraRelays: FALLBACK_RELAYS });

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

type EditState = {
  title: string;
  content: string;
  categoryPath: string;
  files: string[];
  trackers: string[];
  tags: string[];
  externalIds: string[];
};

function initialState(torrent: Torrent): EditState {
  return {
    title: torrent.title ?? "",
    content: torrent.event.content,
    categoryPath: torrent.categoryPath ?? "",
    files: torrent.files.map((f) => f.name),
    trackers: torrent.trackers,
    tags: torrent.searchTags,
    externalIds: torrent.externalIdentifiers.map((id) => id.identifier),
  };
}

/** Turns the edits into a TorrentFactory.modify chain using the add/remove builder methods */
function buildModified(torrent: Torrent, edit: EditState) {
  const original = initialState(torrent);
  const removed = (a: string[], b: string[]) => a.filter((v) => !b.includes(v));

  let factory = TorrentFactory.modify(torrent.event).content(edit.content);
  if (edit.title) factory = factory.title(edit.title);
  if (edit.categoryPath !== original.categoryPath)
    factory = edit.categoryPath ? factory.categoryPath(edit.categoryPath) : factory.clearCategoryPath();

  for (const name of removed(original.files, edit.files)) factory = factory.removeFile(name);
  for (const url of removed(original.trackers, edit.trackers)) factory = factory.removeTracker(url);
  for (const url of removed(edit.trackers, original.trackers)) factory = factory.addTracker(url);
  for (const tag of removed(original.tags, edit.tags)) factory = factory.removeSearchTag(tag);
  for (const tag of removed(edit.tags, original.tags)) factory = factory.addSearchTag(tag);
  for (const id of removed(original.externalIds, edit.externalIds)) factory = factory.removeExternalId(id);

  return factory;
}

function RemovableList({
  label,
  values,
  onChange,
  addPlaceholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addPlaceholder?: string;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    if (input.trim() && !values.includes(input.trim())) onChange([...values, input.trim()]);
    setInput("");
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <ul className="text-xs font-mono max-h-40 overflow-y-auto">
        {values.map((value) => (
          <li key={value} className="flex items-center justify-between gap-2">
            <span className="truncate">{value}</span>
            <button className="btn btn-xs btn-ghost" onClick={() => onChange(values.filter((v) => v !== value))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {addPlaceholder && (
        <div className="join w-full">
          <input
            className="input input-xs join-item w-full"
            placeholder={addPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn btn-xs join-item" onClick={add}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function TagDiff({ before, after }: { before: string[][]; after: string[][] }) {
  const key = (t: string[]) => JSON.stringify(t);
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));
  const removed = before.filter((t) => !afterKeys.has(key(t)));
  const added = after.filter((t) => !beforeKeys.has(key(t)));

  if (removed.length === 0 && added.length === 0) return <p className="text-sm text-base-content/60">No tag changes</p>;

  return (
    <pre className="text-xs overflow-x-auto">
      {removed.map((t) => (
        <div key={"-" + key(t)} className="text-error">
          - {key(t)}
        </div>
      ))}
      {added.map((t) => (
        <div key={"+" + key(t)} className="text-success">
          + {key(t)}
        </div>
      ))}
    </pre>
  );
}

function Editor({
  torrent,
  signer,
  relays,
  onSaved,
}: {
  torrent: Torrent;
  signer: ISigner;
  relays: string[];
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState<EditState>(() => initialState(torrent));
  const [preview, setPreview] = useState<EventTemplate | null>(null);
  const [deleteOld, setDeleteOld] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<EditState>) => setEdit((e) => ({ ...e, ...patch }));

  // Preview the modified (unsigned) event
  useEffect(() => {
    let cancelled = false;
    buildModified(torrent, edit).then((template) => !cancelled && setPreview(template));
    return () => {
      cancelled = true;
    };
  }, [torrent, edit]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const signed = await buildModified(torrent, edit).sign(signer);
      await pool.publish(relays, signed);
      eventStore.add(signed);

      // Kind 2003 is a regular event, so the old version stays unless it is deleted
      if (deleteOld) {
        const deletion = await DeleteFactory.fromEvents([torrent.event], "Replaced by an edited torrent").sign(signer);
        await pool.publish(relays, deletion);
        eventStore.add(deletion);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="fieldset border border-base-300 rounded-box p-4">
        <legend className="fieldset-legend">Edit {torrent.infoHash.slice(0, 12)}…</legend>
        <label className="label">Title</label>
        <input
          className="input input-sm w-full"
          value={edit.title}
          onChange={(e) => update({ title: e.target.value })}
        />
        <label className="label">Description</label>
        <textarea
          className="textarea textarea-sm w-full"
          rows={3}
          value={edit.content}
          onChange={(e) => update({ content: e.target.value })}
        />
        <label className="label">Category path (empty to clear)</label>
        <input
          className="input input-sm w-full"
          value={edit.categoryPath}
          onChange={(e) => update({ categoryPath: e.target.value })}
        />
        <RemovableList label="Files" values={edit.files} onChange={(files) => update({ files })} />
        <RemovableList
          label="Trackers"
          values={edit.trackers}
          onChange={(trackers) => update({ trackers })}
          addPlaceholder="udp://tracker.example.com:1337"
        />
        <RemovableList
          label="Search tags"
          values={edit.tags}
          onChange={(tags) => update({ tags })}
          addPlaceholder="movie"
        />
        <RemovableList
          label="External IDs"
          values={edit.externalIds}
          onChange={(externalIds) => update({ externalIds })}
        />
      </fieldset>

      <div className="border border-base-300 rounded-box p-4">
        <div className="font-semibold mb-2">Changes</div>
        {preview && <TagDiff before={torrent.event.tags} after={preview.tags} />}
      </div>

      <label className="label cursor-pointer gap-2">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={deleteOld}
          onChange={(e) => setDeleteOld(e.target.checked)}
        />
        <span className="text-sm">Request deletion of the old event (NIP-09), since torrents are not replaceable</span>
      </label>

      <button className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? "Saving..." : "Sign and republish"}
      </button>
      {error && <div className="text-error text-sm">{error}</div>}
    </div>
  );
}

function Manager({ user, signer }: { user: User; signer: ISigner }) {
  const mailboxes = use$(() => user.mailboxes$, [user.pubkey]);
  const relays = useMemo(
    () => (mailboxes?.outboxes?.length ? relaySet(FALLBACK_RELAYS, mailboxes.outboxes) : FALLBACK_RELAYS),
    [mailboxes],
  );
  const [selected, setSelected] = useState<Torrent | null>(null);

  // Load the user's torrents from their outboxes
  use$(
    () =>
      pool.subscription(relays, { kinds: [TORRENT_KIND], authors: [user.pubkey] }).pipe(mapEventsToStore(eventStore)),
    [relays, user.pubkey],
  );

  const torrents = use$(
    () =>
      eventStore
        .timeline({ kinds: [TORRENT_KIND], authors: [user.pubkey] })
        .pipe(castTimelineStream(Torrent, eventStore)),
    [user.pubkey],
  );

  return (
    <div className="max-w-6xl w-full mx-auto my-8 px-4 flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold">My torrents</h1>
        <p className="text-base-content/60">
          Edit a torrent with <code>TorrentFactory.modify()</code> and republish it to {relays.length} relays.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ul className="flex flex-col gap-2">
          {torrents === undefined ? (
            <span className="loading loading-spinner" />
          ) : torrents.length === 0 ? (
            <p className="text-base-content/60">
              You have not published any torrents yet. Try the torrent publisher example.
            </p>
          ) : (
            torrents.map((torrent) => (
              <li key={torrent.id}>
                <button
                  className={`w-full text-left border rounded-box p-3 ${selected?.id === torrent.id ? "border-primary" : "border-base-300"}`}
                  onClick={() => setSelected(torrent)}
                >
                  <div className="font-semibold">{torrent.title || "Untitled torrent"}</div>
                  <div className="text-xs text-base-content/60">
                    {torrent.files.length} files · {torrent.trackers.length} trackers ·{" "}
                    {torrent.createdAt.toLocaleString()}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>

        {selected ? (
          <Editor
            key={selected.id}
            torrent={selected}
            signer={signer}
            relays={relays}
            onSaved={() => setSelected(null)}
          />
        ) : (
          <p className="text-base-content/60">Select a torrent to edit.</p>
        )}
      </div>
    </div>
  );
}

export default function TorrentManager() {
  const signer = use$(signer$);
  const user = use$(user$);

  if (!signer || !user)
    return (
      <LoginView
        onLogin={(nextSigner, pubkey) => {
          signer$.next(nextSigner);
          pubkey$.next(pubkey);
        }}
      />
    );

  return <Manager user={user} signer={signer} />;
}
