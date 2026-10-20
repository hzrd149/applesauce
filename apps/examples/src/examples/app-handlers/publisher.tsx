/**
 * Manage the NIP-89 handler information (kind 31990) for your apps: browse, preview, edit, test, and delete handlers with AppHandlerFactory
 * @tags nip-89, app-handlers, factories
 * @related app-handlers/open-with, app-handlers/recommendations
 */
import { ProxySigner } from "applesauce-accounts";
import { AppHandler, castUser, User } from "applesauce-common/casts";
import { AppHandlerFactory } from "applesauce-common/factories";
import {
  APP_HANDLER_KIND,
  createHandlerLink,
  getHandlerPlatforms,
  HandlerLinkPlatform,
  HandlerLinkType,
  isNsiteAddressPointer,
  NSITE_KIND,
} from "applesauce-common/helpers";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { DeleteFactory } from "applesauce-core/factories";
import { getSeenRelays } from "applesauce-core/helpers";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  decodePointer,
  EventPointer,
  getReplaceableAddressForEvent,
  getReplaceableAddressFromPointer,
  naddrEncode,
  parseReplaceableAddress,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { ProfileContent } from "applesauce-core/helpers/profile";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { PublishResponse, RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, from, map, Observable, of, scan, shareReplay, startWith, tap } from "rxjs";
import JsonBlock from "../../components/json-block";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];
// An empty type is the generic template used for any entity without its own template
const LINK_TYPES: (HandlerLinkType | "")[] = ["", "npub", "nprofile", "note", "nevent", "naddr"];
const KIND_LABELS: Record<number, string> = {
  0: "Profiles",
  1: "Notes",
  20: "Pictures",
  21: "Videos",
  30023: "Articles",
  30311: "Live streams",
  31337: "Tracks",
  34550: "Communities",
};

const kindLabel = (kind: number) => KIND_LABELS[kind] ?? `Kind ${kind}`;

// Login state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

/** Clears the signer and pubkey so the login view is shown again */
function logout() {
  signer$.next(null);
  pubkey$.next(null);
}

// Shared infrastructure
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
const signer = new ProxySigner(signer$.pipe(defined()));

// Loads profiles and nsites referenced by casts on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

/** Streams the user's handlers and handler deletions into the store */
function loadHandlers(relays: string[], pubkey: string): Observable<NostrEvent> {
  return pool
    .subscription(relays, [
      { kinds: [APP_HANDLER_KIND], authors: [pubkey] },
      // The store hides a handler whether its deletion arrives before or after it
      { kinds: [kinds.EventDeletion], authors: [pubkey], "#k": [String(APP_HANDLER_KIND)] },
    ])
    .pipe(mapEventsToStore(eventStore));
}

/** A signed event being published, with relay verdicts streamed in as each relay answers */
type PublishJob = { event: NostrEvent; label: string; responses$: Observable<PublishResponse[]> };

/** Sends an event to every relay and adds it to the store as soon as one relay accepts it */
function startPublish(event: NostrEvent, relays: string[], label: string): PublishJob {
  const responses$ = pool.event(relays, event).pipe(
    tap((response) => response.ok && eventStore.add(event)),
    scan((all, response) => [...all, response], [] as PublishResponse[]),
    startWith([] as PublishResponse[]),
    // Replay so the status panel can re-subscribe without publishing twice
    shareReplay(1),
  );
  return { event, label, responses$ };
}

type LinkKey = `${HandlerLinkPlatform}:${HandlerLinkType | ""}`;
type Form = {
  identifier: string;
  kinds: number[];
  links: Partial<Record<LinkKey, string>>;
  metadata: Pick<ProfileContent, "name" | "picture" | "about">;
  latest: string;
  next: string;
};
type Pointer = AddressPointer | EventPointer | ProfilePointer;

const linkKey = (platform: HandlerLinkPlatform, type: HandlerLinkType | ""): LinkKey => `${platform}:${type}`;
const address = (pointer?: AddressPointer) => (pointer ? getReplaceableAddressFromPointer(pointer) : "");

/** Reads the editable form state out of an existing handler */
function formFromHandler(handler?: AppHandler): Form {
  const links: Form["links"] = {};
  for (const platform of PLATFORMS)
    for (const link of handler?.links(platform) ?? []) links[linkKey(platform, link.type ?? "")] = link.url;

  return {
    identifier: handler?.identifier ?? "",
    kinds: handler?.supportedKinds ?? [],
    links,
    metadata: {
      name: handler?.metadata?.name ?? "",
      picture: handler?.metadata?.picture ?? "",
      about: handler?.metadata?.about ?? "",
    },
    latest: address(handler?.latestPointer),
    next: address(handler?.nextPointer),
  };
}

/**
 * Builds the factory for the form. Editing starts from `.modify(existing)` and only touches fields that changed,
 * so tags this editor doesn't know about are preserved.
 * @throws if the latest or next address is not a named nsite
 */
function buildFactory(form: Form, existing?: AppHandler): AppHandlerFactory {
  const initial = formFromHandler(existing);
  let factory = existing
    ? AppHandlerFactory.modify(existing.event)
    : AppHandlerFactory.create(form.identifier.trim() || undefined);

  for (const kind of initial.kinds) if (!form.kinds.includes(kind)) factory = factory.removeKind(kind);
  for (const kind of form.kinds) if (!initial.kinds.includes(kind)) factory = factory.kind(kind);

  for (const platform of PLATFORMS) {
    for (const type of LINK_TYPES) {
      const key = linkKey(platform, type);
      const url = form.links[key]?.trim() ?? "";
      if (url === (initial.links[key] ?? "")) continue;
      factory = url ? factory.link(platform, url, type || undefined) : factory.removeLink(platform, type || undefined);
    }
  }

  // Merge into the existing metadata so fields like website or lud16 survive the edit, and drop cleared fields
  const metadata: ProfileContent = { ...existing?.metadata, ...form.metadata };
  for (const field of ["name", "picture", "about"] as const) if (!metadata[field]?.trim()) delete metadata[field];
  factory = factory.metadata(metadata);

  if (form.latest.trim() !== initial.latest) factory = factory.latest(form.latest.trim() || null);
  if (form.next.trim() !== initial.next) factory = factory.next(form.next.trim() || null);

  return factory;
}

/** Checks that a site field is empty or a named site address */
function isNamedSiteAddress(value: string): boolean {
  if (!value.trim()) return true;
  const pointer = parseReplaceableAddress(value.trim());
  return !!pointer && pointer.kind === NSITE_KIND && isNsiteAddressPointer(pointer);
}

/** Parses a NIP-19 entity into a pointer for testing link templates */
function parsePointer(input: string): Pointer | null {
  try {
    const decoded = decodePointer(input.trim().replace(/^nostr:/, ""));
    switch (decoded.type) {
      case "npub":
        return { pubkey: decoded.data };
      case "note":
        return { id: decoded.data };
      case "nprofile":
      case "nevent":
      case "naddr":
        return decoded.data;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function AppIcon({ metadata, pubkey, size }: { metadata?: ProfileContent; pubkey: string; size: string }) {
  return (
    <img
      src={metadata?.picture || `https://robohash.org/${pubkey}.png`}
      alt=""
      className={`${size} shrink-0 rounded border border-base-300 object-cover`}
    />
  );
}

function HandlerNavItem({ handler, active, onSelect }: { handler: AppHandler; active: boolean; onSelect: () => void }) {
  const metadata = handler.metadata;

  return (
    <li>
      <button className={active ? "menu-active" : ""} onClick={onSelect}>
        <AppIcon metadata={metadata} pubkey={handler.event.pubkey} size="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{metadata?.display_name || metadata?.name || handler.identifier}</div>
          <div className="truncate text-sm opacity-70">
            {handler.supportedKinds.map(kindLabel).join(", ") || "No kinds"}
          </div>
        </div>
      </button>
    </li>
  );
}

function AccountFooter({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <img
        src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{profile?.displayName || user.npub.slice(0, 12)}</span>
      <button className="btn btn-sm btn-ghost" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function PublishStatus({ job, relays, onDismiss }: { job: PublishJob; relays: string[]; onDismiss: () => void }) {
  const responses = use$(job.responses$) ?? [];
  const pending = relays.filter((url) => !responses.some((r) => r.from === url));
  const accepted = responses.filter((r) => r.ok).length;

  return (
    <div className="mb-4 space-y-2 border border-base-300 p-3">
      <div className="flex items-center gap-2">
        {pending.length > 0 && <span className="loading loading-spinner loading-sm" />}
        <span className="flex-1 font-semibold">
          {job.label}: {accepted} of {relays.length} relays accepted
          {pending.length === 0 && accepted === 0 && <span className="text-error"> (not published)</span>}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul className="text-sm">
        {responses.map((r) => (
          <li key={r.from} className={r.ok ? "text-success" : "text-error"}>
            {r.from}: {r.ok ? "accepted" : r.message || String(r.error ?? "rejected")}
          </li>
        ))}
        {pending.map((url) => (
          <li key={url} className="opacity-70">
            {url}: waiting...
          </li>
        ))}
      </ul>
    </div>
  );
}

function KindsField({ kinds, onChange }: { kinds: number[]; onChange: (kinds: number[]) => void }) {
  const [input, setInput] = useState("");
  const kind = /^\d+$/.test(input.trim()) ? parseInt(input.trim()) : null;

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Supported kinds</legend>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button key={k} className="btn btn-sm" onClick={() => onChange(kinds.filter((x) => x !== k))}>
            {kindLabel(k)} ({k}) ✕
          </button>
        ))}
      </div>
      <div className="join">
        <input
          className="input join-item"
          inputMode="numeric"
          placeholder="30023"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="btn join-item"
          disabled={kind === null || kinds.includes(kind)}
          onClick={() => {
            onChange([...kinds, kind!]);
            setInput("");
          }}
        >
          Add kind
        </button>
      </div>
    </fieldset>
  );
}

function LinksField({ links, onChange }: { links: Form["links"]; onChange: (links: Form["links"]) => void }) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Link templates</legend>
      <p className="text-sm opacity-70">
        Use <code>&lt;bech32&gt;</code> where the NIP-19 entity goes. The generic template handles any entity without
        its own template.
      </p>
      {PLATFORMS.map((platform) => (
        <div key={platform} className="space-y-2 border border-base-300 p-3">
          <h3 className="font-semibold">{platform}</h3>
          {LINK_TYPES.map((type) => {
            const key = linkKey(platform, type);
            return (
              <label key={key} className="flex items-center gap-2">
                <span className="w-24 text-sm">{type || "generic"}</span>
                <input
                  className="input input-sm grow"
                  placeholder={platform === "web" ? `https://my.app/${type || "e"}/<bech32>` : `myapp://<bech32>`}
                  value={links[key] ?? ""}
                  onChange={(e) => onChange({ ...links, [key]: e.target.value })}
                />
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

function MetadataPreview({ metadata, pubkey }: { metadata: ProfileContent; pubkey: string }) {
  return (
    <div className="flex items-center gap-3 border border-base-300 p-3">
      <AppIcon metadata={metadata} pubkey={pubkey} size="h-12 w-12" />
      <div>
        <div className="font-semibold">{metadata.name || "Unnamed app"}</div>
        <div className="text-sm opacity-70">{metadata?.about}</div>
      </div>
    </div>
  );
}

function LinkTester({ draft }: { draft: EventTemplate }) {
  const [input, setInput] = useState("");
  const pointer = useMemo(() => parsePointer(input), [input]);

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Test a link</legend>
      <input
        className="input w-full"
        placeholder="Paste an npub, nprofile, note, nevent, or naddr"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {input && !pointer && <p className="text-sm text-error">Not a supported NIP-19 entity</p>}
      {pointer &&
        PLATFORMS.map((platform) => {
          // The link helpers read only tags, so they work on signed events and unsigned drafts alike
          const link = createHandlerLink(draft, pointer, platform);
          const fallback = !getHandlerPlatforms(draft).includes(platform);
          return (
            <div key={platform} className="flex gap-2 text-sm">
              <span className="w-16 font-semibold">{platform}</span>
              {link ? (
                <span className="break-all">
                  {link} {fallback && <span className="opacity-70">(web fallback)</span>}
                </span>
              ) : (
                <span className="text-error">No template</span>
              )}
            </div>
          );
        })}
    </fieldset>
  );
}

function NsiteStatus({
  label,
  value$,
  pointer,
}: {
  label: string;
  value$: AppHandler["latest$"];
  pointer?: AddressPointer;
}) {
  const site = use$(value$);
  if (!pointer) return null;

  return (
    <div className="flex gap-2 text-sm">
      <span className="w-16 font-semibold">{label}</span>
      <code className="flex-1 truncate">{pointer.identifier}</code>
      {site && <span className="text-success">found</span>}
    </div>
  );
}

function HandlerOverview({
  handler,
  relays,
  onEdit,
  onPublish,
}: {
  handler: AppHandler;
  relays: string[];
  onEdit: () => void;
  onPublish: (job: PublishJob) => void;
}) {
  const metadata = handler.metadata;
  const [error, setError] = useState<string | null>(null);
  const naddr = naddrEncode({ ...handler.pointer, relays: relays.slice(0, 3) });
  const seen = getSeenRelays(handler.event);

  const remove = async () => {
    if (!confirm(`Delete ${metadata?.name || handler.identifier}? Relays that honor deletions will drop it.`)) return;
    setError(null);
    try {
      const signed = await DeleteFactory.fromEvents([handler.event]).sign(signer);
      onPublish(startPublish(signed, relays, "Delete"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start gap-4">
        <AppIcon metadata={metadata} pubkey={handler.event.pubkey} size="h-20 w-20" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{metadata?.display_name || metadata?.name || handler.identifier}</h2>
          <p className="opacity-70">{metadata?.about || "No description"}</p>
          {!metadata?.name && <p className="text-sm text-warning">Missing a name, edit the handler to add one</p>}
        </div>
        <button className="btn btn-primary" onClick={onEdit}>
          Edit
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="font-semibold">Handles</h3>
        <div className="flex flex-wrap gap-2">
          {handler.supportedKinds.map((k) => (
            <span key={k} className="badge badge-outline">
              {kindLabel(k)} ({k})
            </span>
          ))}
          {handler.supportedKinds.length === 0 && <span className="text-sm opacity-70">No kinds</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Link templates</h3>
        {PLATFORMS.map((platform) => (
          <div key={platform} className="flex gap-2 text-sm">
            <span className="w-16 font-semibold">{platform}</span>
            <div className="min-w-0 flex-1">
              {handler.links(platform).map((link, i) => (
                // Apps often reuse one URL for several entity types, so the URL alone isn't a unique key
                <div key={`${link.type ?? "generic"}-${i}`} className="break-all">
                  <span className="opacity-70">{link.type ?? "generic"}:</span> {link.url}
                </div>
              ))}
              {handler.links(platform).length === 0 && (
                <span className="opacity-70">{platform === "web" ? "None" : "Falls back to web"}</span>
              )}
            </div>
          </div>
        ))}
      </section>

      {(handler.latestPointer || handler.nextPointer) && (
        <section className="space-y-2">
          <h3 className="font-semibold">Named nsites</h3>
          <NsiteStatus label="latest" value$={handler.latest$} pointer={handler.latestPointer} />
          <NsiteStatus label="next" value$={handler.next$} pointer={handler.nextPointer} />
        </section>
      )}

      <LinkTester draft={handler.event} />

      <section className="space-y-2">
        <h3 className="font-semibold">Developer</h3>
        <div className="flex gap-2 text-sm">
          <span className="w-24 font-semibold">naddr</span>
          <code className="flex-1 break-all">{naddr}</code>
          <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(naddr)}>
            Copy
          </button>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="w-24 font-semibold">Address</span>
          <code className="flex-1 break-all">{handler.coordinate}</code>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="w-24 font-semibold">Updated</span>
          <span>{new Date(handler.event.created_at * 1000).toLocaleString()}</span>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="w-24 font-semibold">Seen on</span>
          <span className="flex-1">{seen?.size ? [...seen].join(", ") : "Not seen on a relay yet"}</span>
        </div>
        <details className="border border-base-300">
          <summary className="cursor-pointer p-2 text-sm font-semibold">Raw event</summary>
          <JsonBlock value={handler.event} />
        </details>
      </section>

      <section className="space-y-2 border-t border-base-300 pt-4">
        <button className="btn btn-error btn-outline" onClick={remove}>
          Delete handler
        </button>
        {error && <p className="text-sm text-error">{error}</p>}
      </section>
    </div>
  );
}

function HandlerEditor({
  user,
  existing,
  relays,
  onPublish,
  onCancel,
}: {
  user: User;
  existing?: AppHandler;
  relays: string[];
  onPublish: (job: PublishJob) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formFromHandler(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Require a name and validate the site addresses before building, since `.latest()` and `.next()` throw on anything but a named site
  const built = useMemo(() => {
    if (!form.metadata.name?.trim()) return { factory: null, error: "Give the app a name" };
    const invalid = (["latest", "next"] as const).find((field) => !isNamedSiteAddress(form[field]));
    if (invalid) return { factory: null, error: `The ${invalid} site must be a named site address` };
    return { factory: buildFactory(form, existing), error: null };
  }, [form, existing]);

  // Resolve the unsigned draft template for the link tester and the preview
  const draft = use$(() => (built.factory ? from(built.factory) : of(undefined)), [built]);

  const publish = async () => {
    if (!built.factory) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await built.factory.sign(signer);
      onPublish(startPublish(signed, relays, existing ? "Update" : "Publish"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-xl font-semibold">{existing ? `Edit ${existing.identifier}` : "New app handler"}</h2>

      {!existing && (
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Identifier</legend>
          <input
            className="input"
            placeholder="Random if left empty"
            value={form.identifier}
            onChange={(e) => update({ identifier: e.target.value })}
          />
        </fieldset>
      )}

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Metadata</legend>
        {(["name", "picture", "about"] as const).map((field) => (
          <input
            key={field}
            className="input w-full"
            placeholder={field}
            value={form.metadata[field] ?? ""}
            onChange={(e) => update({ metadata: { ...form.metadata, [field]: e.target.value } })}
          />
        ))}
        <MetadataPreview metadata={form.metadata} pubkey={user.pubkey} />
      </fieldset>

      <KindsField kinds={form.kinds} onChange={(kinds) => update({ kinds })} />
      <LinksField links={form.links} onChange={(links) => update({ links })} />

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Named nsites (optional)</legend>
        <input
          className="input w-full"
          placeholder="latest: 35128:<pubkey>:<site>"
          value={form.latest}
          onChange={(e) => update({ latest: e.target.value })}
        />
        <input
          className="input w-full"
          placeholder="next: 35128:<pubkey>:<site>"
          value={form.next}
          onChange={(e) => update({ next: e.target.value })}
        />
      </fieldset>

      {draft && <LinkTester draft={draft} />}

      {draft && (
        <details className="border border-base-300">
          <summary className="cursor-pointer p-2 text-sm font-semibold">Draft event</summary>
          <JsonBlock value={draft} />
        </details>
      )}

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={publish} disabled={!built.factory || busy}>
          {busy && <span className="loading loading-spinner" />}
          {existing ? "Publish update" : "Publish handler"}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        {(error || built.error) && <span className="text-sm text-error">{error || built.error}</span>}
      </div>
    </div>
  );
}

function HandlerManager({ user }: { user: User }) {
  const outboxes = use$(user.outboxes$);
  const relays = useMemo(() => [...new Set(outboxes?.length ? outboxes : FALLBACK_RELAYS)], [outboxes]);

  // Select by address so the selection survives new revisions of the handler
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [editing, setEditing] = useState(false);
  // Kept here so the relay verdicts keep streaming while the selection changes
  const [job, setJob] = useState<PublishJob | null>(null);

  // Keep the subscription open while mounted; events flow into the store and out through `appHandlers$`
  use$(() => (outboxes ? loadHandlers(relays, user.pubkey) : undefined), [relays.join(","), user.pubkey]);
  // Render from the store so handlers appear as each relay delivers them and new revisions replace old ones
  const handlers = use$(user.appHandlers$);

  const current = selected ?? handlers?.[0]?.coordinate ?? null;
  const handler = handlers?.find((h) => h.coordinate === current);

  const select = (next: string | "new") => {
    setSelected(next);
    setEditing(false);
  };
  const published = (next: PublishJob) => {
    setJob(next);
    setEditing(false);
    if (next.event.kind === APP_HANDLER_KIND) setSelected(getReplaceableAddressForEvent(next.event));
    else setSelected(null);
  };

  return (
    <div className="flex min-h-0 grow flex-col md:flex-row">
      <nav className="flex shrink-0 flex-col border-b border-base-300 md:w-72 md:border-r md:border-b-0">
        <ul className="menu min-h-0 w-full flex-1 flex-nowrap overflow-y-auto">
          <li className="menu-title">Your apps</li>
          {handlers?.map((h) => (
            <HandlerNavItem
              key={h.uid}
              handler={h}
              active={current === h.coordinate}
              onSelect={() => select(address(h.pointer))}
            />
          ))}
          <li>
            <button className={current === "new" ? "menu-active" : ""} onClick={() => select("new")}>
              + New app
            </button>
          </li>
        </ul>
        <AccountFooter user={user} />
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {job && <PublishStatus key={job.event.id} job={job} relays={relays} onDismiss={() => setJob(null)} />}

        {current === "new" ? (
          <HandlerEditor user={user} relays={relays} onPublish={published} />
        ) : handler && editing ? (
          // Re-mount on a new revision so the form never edits a stale event
          <HandlerEditor
            key={handler.event.id}
            user={user}
            existing={handler}
            relays={relays}
            onPublish={published}
            onCancel={() => setEditing(false)}
          />
        ) : handler ? (
          // Re-mount per app so local state like the link tester input doesn't carry over
          <HandlerOverview
            key={handler.coordinate}
            handler={handler}
            relays={relays}
            onEdit={() => setEditing(true)}
            onPublish={published}
          />
        ) : (
          <div className="flex max-w-md flex-col gap-2">
            <h2 className="text-lg font-semibold">No app selected</h2>
            <p className="opacity-70">Publish a handler so clients know your app can open Nostr events.</p>
            <button className="btn btn-primary self-start" onClick={() => select("new")}>
              Create an app handler
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function HandlerManagerExample() {
  const user = use$(user$);

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
  };

  if (!user) return <LoginView onLogin={handleLogin} />;
  return <HandlerManager key={user.pubkey} user={user} />;
}
