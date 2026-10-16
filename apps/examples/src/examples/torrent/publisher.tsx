/**
 * Build and publish a NIP-35 torrent from a .torrent file or magnet link with TorrentFactory
 * @tags nip-35, torrent, publish, factory
 * @related torrent/feed, torrent/search, torrent/manager
 */
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { castUser, User } from "applesauce-common/casts";
import { TorrentFactory } from "applesauce-common/factories";
import {
  buildTorrentMagnetLink,
  createTorrentExternalIdentifier,
  isTorrentInfoHash,
  TorrentExternalIdentifier,
  TorrentExternalIdentifierPrefix,
  TorrentFile,
} from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { EventTemplate, NostrEvent, relaySet } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { BehaviorSubject, map } from "rxjs";
import LoginView from "../../components/login-view";

const FALLBACK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];
const CATEGORY_PRESETS = ["video,movie,4k", "video,tv", "audio,music", "software,linux", "ebook"];
const ID_PREFIXES: TorrentExternalIdentifierPrefix[] = ["imdb", "tmdb", "ttvdb", "mal", "anilist"];

const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: LOOKUP_RELAYS, extraRelays: FALLBACK_RELAYS });

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

type TorrentForm = {
  infoHash: string;
  title: string;
  content: string;
  files: TorrentFile[];
  trackers: string[];
  tags: string[];
  categoryPath: string;
  newznab: string;
  externalIds: TorrentExternalIdentifier[];
};

const EMPTY_FORM: TorrentForm = {
  infoHash: "",
  title: "",
  content: "",
  files: [],
  trackers: [],
  tags: [],
  categoryPath: "",
  newznab: "",
  externalIds: [],
};

type BValue = number | Uint8Array | BValue[] | { [key: string]: BValue };
const text = new TextDecoder();

/** Decodes a bencoded .torrent file and hashes the raw `info` dictionary to get the V1 info hash */
function decodeTorrentFile(bytes: Uint8Array): Partial<TorrentForm> {
  let pos = 0;
  let infoStart = -1;
  let infoEnd = -1;

  const peek = () => {
    if (pos >= bytes.length) throw new Error("Invalid .torrent file");
    return String.fromCharCode(bytes[pos]);
  };
  const readUntil = (char: string) => {
    const start = pos;
    while (peek() !== char) pos++;
    return text.decode(bytes.subarray(start, pos++));
  };
  const decode = (depth: number): BValue => {
    const c = peek();
    if (c === "i") return (pos++, Number(readUntil("e")));
    if (c === "l") {
      pos++;
      const list: BValue[] = [];
      while (peek() !== "e") list.push(decode(depth + 1));
      return (pos++, list);
    }
    if (c === "d") {
      pos++;
      const dict: Record<string, BValue> = {};
      while (peek() !== "e") {
        const key = text.decode(decode(depth + 1) as Uint8Array);
        if (depth === 0 && key === "info") infoStart = pos;
        dict[key] = decode(depth + 1);
        if (depth === 0 && key === "info") infoEnd = pos;
      }
      return (pos++, dict);
    }
    const length = Number(readUntil(":"));
    pos += length;
    return bytes.subarray(pos - length, pos);
  };

  const root = decode(0) as Record<string, any>;
  if (infoStart === -1) throw new Error("Missing info dictionary");

  const info = root.info as Record<string, any>;
  const name = text.decode(info.name);
  const files: TorrentFile[] = info.files
    ? info.files.map((f: any) => ({
        name: [name, ...f.path.map((p: Uint8Array) => text.decode(p))].join("/"),
        size: f.length,
      }))
    : [{ name, size: info.length }];
  const announce: Uint8Array[] = root["announce-list"]?.flat() ?? (root.announce ? [root.announce] : []);

  return {
    infoHash: bytesToHex(sha1(bytes.subarray(infoStart, infoEnd))),
    title: name,
    files,
    trackers: Array.from(new Set(announce.map((url) => text.decode(url)))),
  };
}

/** Reads the info hash, name and trackers from a magnet link, or accepts a raw info hash */
function parseMagnetOrHash(input: string): Partial<TorrentForm> {
  const value = input.trim();
  if (!value.startsWith("magnet:")) return { infoHash: value.toLowerCase() };

  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  const xt = params.getAll("xt").find((v) => v.startsWith("urn:btih:"));
  return {
    infoHash: xt?.slice("urn:btih:".length).toLowerCase() ?? "",
    title: params.get("dn") ?? "",
    trackers: params.getAll("tr"),
  };
}

/** Builds the torrent with the same chain for both the preview and the signed event */
function buildTorrent(form: TorrentForm) {
  let factory = TorrentFactory.create(form.infoHash, form.content || undefined);
  if (form.title) factory = factory.title(form.title);
  factory = factory.files(form.files).trackers(form.trackers);
  if (form.categoryPath) factory = factory.categoryPath(form.categoryPath);
  if (form.newznab) factory = factory.category(Number(form.newznab));
  return factory.externalIds(form.externalIds).searchTags(form.tags);
}

function StringListEditor({
  values,
  placeholder,
  onChange,
}: {
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const value = input.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setInput("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="join w-full">
        <input
          className="input input-sm join-item w-full"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-sm join-item" onClick={add}>
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <button
            key={value}
            className="badge badge-outline gap-1"
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            {value} ✕
          </button>
        ))}
      </div>
    </div>
  );
}

function ExternalIdEditor({
  ids,
  onChange,
}: {
  ids: TorrentExternalIdentifier[];
  onChange: (ids: TorrentExternalIdentifier[]) => void;
}) {
  const [prefix, setPrefix] = useState<TorrentExternalIdentifierPrefix>("imdb");
  const [mediaType, setMediaType] = useState("");
  const [id, setId] = useState("");

  const add = () => {
    if (!id.trim()) return;
    const identifier = createTorrentExternalIdentifier(prefix, id.trim(), mediaType.trim() || undefined);
    if (!ids.some((i) => i.identifier === identifier.identifier)) onChange([...ids, identifier]);
    setId("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="join w-full">
        <select
          className="select select-sm join-item w-28"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value as TorrentExternalIdentifierPrefix)}
        >
          {ID_PREFIXES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input
          className="input input-sm join-item w-28"
          placeholder="movie (optional)"
          value={mediaType}
          onChange={(e) => setMediaType(e.target.value)}
        />
        <input
          className="input input-sm join-item w-full"
          placeholder="tt15239678"
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-sm join-item" onClick={add}>
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {ids.map((i) => (
          <button
            key={i.identifier}
            className="badge badge-outline gap-1"
            onClick={() => onChange(ids.filter((x) => x.identifier !== i.identifier))}
          >
            {i.identifier} ✕
          </button>
        ))}
      </div>
    </div>
  );
}

function Publisher({ user, signer }: { user: User; signer: ISigner }) {
  const mailboxes = use$(() => user.mailboxes$, [user.pubkey]);
  const publishRelays = useMemo(
    () => (mailboxes?.outboxes?.length ? relaySet(FALLBACK_RELAYS, mailboxes.outboxes) : FALLBACK_RELAYS),
    [mailboxes],
  );

  const [form, setForm] = useState<TorrentForm>(EMPTY_FORM);
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<EventTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<NostrEvent | null>(null);
  const [results, setResults] = useState<{ relay: string; ok: boolean; message?: string }[] | null>(null);

  const update = (patch: Partial<TorrentForm>) => setForm((f) => ({ ...f, ...patch }));
  const validHash = isTorrentInfoHash(form.infoHash);

  // Rebuild the unsigned preview whenever the form changes
  useEffect(() => {
    if (!validHash) return setDraft(null);
    let cancelled = false;
    buildTorrent(form).then((template) => !cancelled && setDraft(template));
    return () => {
      cancelled = true;
    };
  }, [form, validHash]);

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setError(null);
      setForm({ ...EMPTY_FORM, ...decodeTorrentFile(new Uint8Array(await file.arrayBuffer())) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read .torrent file");
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const signed = await buildTorrent(form).sign(signer);
      const responses = await pool.publish(publishRelays, signed);
      eventStore.add(signed);
      setPublished(signed);
      setResults(responses.map((r) => ({ relay: r.from, ok: r.ok, message: r.message })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-6xl w-full mx-auto my-8 px-4 grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold">Publish a torrent</h1>
          <p className="text-base-content/60">
            Load a .torrent file or magnet link, fill in the NIP-35 metadata, and publish a kind 2003 event with{" "}
            <code>TorrentFactory</code>.
          </p>
        </div>

        <fieldset className="fieldset border border-base-300 rounded-box p-4">
          <legend className="fieldset-legend">Source</legend>
          <input type="file" accept=".torrent" className="file-input file-input-sm w-full" onChange={loadFile} />
          <div className="join w-full">
            <input
              className="input input-sm join-item w-full"
              placeholder="magnet:?xt=urn:btih:... or a 40 character info hash"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <button
              className="btn btn-sm join-item"
              onClick={() => setForm({ ...EMPTY_FORM, ...parseMagnetOrHash(source) })}
            >
              Load
            </button>
          </div>
        </fieldset>

        <fieldset className="fieldset border border-base-300 rounded-box p-4">
          <legend className="fieldset-legend">Metadata</legend>
          <label className="label">Info hash</label>
          <input
            className={`input input-sm w-full font-mono ${form.infoHash && !validHash ? "input-error" : ""}`}
            value={form.infoHash}
            onChange={(e) => update({ infoHash: e.target.value.trim().toLowerCase() })}
          />
          {form.infoHash && !validHash && (
            <p className="text-error text-xs">
              Must be a 40 character hex V1 info hash (base32 hashes are not supported)
            </p>
          )}
          <label className="label">Title</label>
          <input
            className="input input-sm w-full"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
          />
          <label className="label">Description</label>
          <textarea
            className="textarea textarea-sm w-full"
            rows={3}
            value={form.content}
            onChange={(e) => update({ content: e.target.value })}
          />
          <label className="label">Category path (tcat)</label>
          <input
            className="input input-sm w-full"
            placeholder="video,movie,4k"
            value={form.categoryPath}
            onChange={(e) => update({ categoryPath: e.target.value })}
          />
          <div className="flex flex-wrap gap-1">
            {CATEGORY_PRESETS.map((preset) => (
              <button key={preset} className="btn btn-xs btn-ghost" onClick={() => update({ categoryPath: preset })}>
                {preset}
              </button>
            ))}
          </div>
          <label className="label">Newznab category ID</label>
          <input
            className="input input-sm w-full"
            type="number"
            placeholder="2045"
            value={form.newznab}
            onChange={(e) => update({ newznab: e.target.value })}
          />
          <label className="label">External IDs</label>
          <ExternalIdEditor ids={form.externalIds} onChange={(externalIds) => update({ externalIds })} />
          <label className="label">Search tags</label>
          <StringListEditor values={form.tags} placeholder="movie" onChange={(tags) => update({ tags })} />
          <label className="label">Trackers</label>
          <StringListEditor
            values={form.trackers}
            placeholder="udp://tracker.example.com:1337"
            onChange={(trackers) => update({ trackers })}
          />
        </fieldset>

        {form.files.length > 0 && (
          <fieldset className="fieldset border border-base-300 rounded-box p-4">
            <legend className="fieldset-legend">Files ({form.files.length})</legend>
            <ul className="text-xs font-mono max-h-48 overflow-y-auto">
              {form.files.map((file) => (
                <li key={file.name} className="flex justify-between gap-2">
                  <span className="truncate">{file.name}</span>
                  <span className="text-base-content/60">{file.size ?? "?"} B</span>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="border border-base-300 rounded-box p-4">
          <div className="font-semibold mb-2">Magnet link</div>
          {validHash ? (
            <code className="text-xs break-all">
              {buildTorrentMagnetLink(form.infoHash, form.trackers, form.title || undefined)}
            </code>
          ) : (
            <p className="text-base-content/60 text-sm">Enter a valid info hash to preview the event.</p>
          )}
        </div>

        {draft && (
          <div className="border border-base-300 rounded-box p-4 overflow-auto">
            <div className="font-semibold mb-2">Unsigned kind {draft.kind} event</div>
            <pre className="text-xs">{JSON.stringify(draft.tags, null, 2)}</pre>
          </div>
        )}

        <button className="btn btn-primary" disabled={!validHash || publishing} onClick={publish}>
          {publishing ? "Publishing..." : `Sign and publish to ${publishRelays.length} relays`}
        </button>
        {error && <div className="text-error text-sm">{error}</div>}

        {published && results && (
          <div className="border border-base-300 rounded-box p-4">
            <div className="font-semibold mb-2">Published {published.id.slice(0, 12)}…</div>
            <ul className="space-y-1 text-xs font-mono">
              {results.map((r) => (
                <li key={r.relay} className="flex gap-2">
                  <span className={r.ok ? "text-success" : "text-error"}>{r.ok ? "ok" : "fail"}</span>
                  <span>{r.relay}</span>
                  {r.message && <span className="truncate text-base-content/50">{r.message}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TorrentPublisher() {
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

  return <Publisher user={user} signer={signer} />;
}
