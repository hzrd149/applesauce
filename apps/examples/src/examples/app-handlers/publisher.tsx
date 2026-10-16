/**
 * Publish and edit NIP-89 handler information (kind 31990) for your app with AppHandlerFactory
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
import { defined, EventStore } from "applesauce-core";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  decodePointer,
  EventPointer,
  getReplaceableAddressForEvent,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { ProfileContent } from "applesauce-core/helpers/profile";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, from, of } from "rxjs";
import JsonBlock from "../../components/json-block";
import LoginView from "../../components/login-view";
import { publishEvent } from "../../extra/publish";
import { relayTimeline } from "../../extra/relay-timeline";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];
// An empty type is the generic template used for any entity without its own template
const LINK_TYPES: (HandlerLinkType | "")[] = ["", "npub", "nprofile", "note", "nevent", "naddr"];

// Application state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

const eventStore = new EventStore();
const pool = new RelayPool();
const signer = new ProxySigner(signer$.pipe(defined()));

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

type LinkKey = `${HandlerLinkPlatform}:${HandlerLinkType | ""}`;
type Form = {
  identifier: string;
  kinds: number[];
  links: Partial<Record<LinkKey, string>>;
  useProfile: boolean;
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
    useProfile: !!handler && !handler.metadata,
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
  factory = factory.metadata(form.useProfile || Object.keys(metadata).length === 0 ? null : metadata);

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

function HandlerList({
  user,
  handlers,
  selected,
  onSelect,
}: {
  user: User;
  handlers?: AppHandler[];
  selected: string | null;
  onSelect: (address: string | null) => void;
}) {
  const outboxes = use$(user.outboxes$);

  // Load the user's handlers from their outboxes into the store
  const status = use$(
    () =>
      outboxes
        ? relayTimeline(eventStore, pool, outboxes.length ? outboxes : FALLBACK_RELAYS, {
            kinds: [APP_HANDLER_KIND],
            authors: [user.pubkey],
          })
        : undefined,
    [outboxes, user.pubkey],
  );

  return (
    <div className="flex flex-col gap-2 w-72 shrink-0 min-h-0 overflow-y-auto border-r border-base-300 pr-4">
      <button className={`btn ${selected === null ? "btn-primary" : ""}`} onClick={() => onSelect(null)}>
        New handler
      </button>
      {!status || status.status === "loading" ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading handlers...
        </div>
      ) : null}
      {status?.errors.map((error) => (
        <p key={error} className="text-sm text-error">
          {error}
        </p>
      ))}
      {status && status.status !== "loading" && handlers?.length === 0 && (
        <p className="text-sm opacity-70">You haven't published any handlers.</p>
      )}
      {handlers?.map((handler) => (
        <button
          key={handler.uid}
          className={`text-left border p-2 ${handler.coordinate === selected ? "border-primary" : "border-base-300"}`}
          onClick={() => onSelect(handler.coordinate)}
        >
          <div className="font-semibold truncate">{handler.metadata?.name || handler.identifier}</div>
          <div className="text-sm opacity-70">Kinds: {handler.supportedKinds.join(", ") || "none"}</div>
        </button>
      ))}
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
            {k} ✕
          </button>
        ))}
      </div>
      <div className="join">
        <input
          className="input join-item"
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
        <div key={platform} className="border border-base-300 p-3 space-y-2">
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

function MetadataPreview({ user, own }: { user: User; own?: ProfileContent }) {
  // Published handlers expose this fallback as `handler.metadata$`; the draft previews it from the author's profile
  const profile = use$(user.profile$);
  const metadata = own ?? profile?.metadata;

  return (
    <div className="flex items-center gap-3 border border-base-300 p-3">
      {metadata?.picture && <img src={metadata.picture} className="w-12 h-12 object-cover" />}
      <div>
        <div className="font-semibold">{metadata?.display_name || metadata?.name || "Unnamed app"}</div>
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
          // The link helpers read only tags, so they work on the unsigned draft and fall back to web templates
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

type PublishResult = { event: NostrEvent; verdicts: string[] };

function HandlerEditor({
  user,
  existing,
  result,
  onPublished,
}: {
  user: User;
  existing?: AppHandler;
  result: PublishResult | null;
  onPublished: (result: PublishResult) => void;
}) {
  const outboxes = use$(user.outboxes$);
  const [form, setForm] = useState<Form>(() => formFromHandler(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Validate the site addresses before building, since `.latest()` and `.next()` throw on anything but a named site
  const built = useMemo(() => {
    const invalid = (["latest", "next"] as const).find((field) => !isNamedSiteAddress(form[field]));
    if (invalid) return { factory: null, error: `The ${invalid} site must be a named site address` };
    return { factory: buildFactory(form, existing), error: null };
  }, [form, existing]);

  // Resolve the unsigned draft template for the link tester
  const draft = use$(() => (built.factory ? from(built.factory) : of(undefined)), [built]);

  const publish = async () => {
    if (!built.factory) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await built.factory.sign(signer);
      const responses = await publishEvent(pool, outboxes?.length ? outboxes : FALLBACK_RELAYS, signed);
      eventStore.add(signed);
      onPublished({
        event: signed,
        verdicts: responses.map((r) => `${r.from}: ${r.ok ? "accepted" : (r.message ?? "rejected")}`),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 grow min-h-0 overflow-y-auto">
      <h2 className="text-xl font-semibold">{existing ? `Edit ${existing.identifier}` : "New handler"}</h2>

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

      <KindsField kinds={form.kinds} onChange={(kinds) => update({ kinds })} />
      <LinksField links={form.links} onChange={(links) => update({ links })} />

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Metadata</legend>
        <label className="label">
          <input
            type="checkbox"
            className="checkbox"
            checked={form.useProfile}
            onChange={(e) => update({ useProfile: e.target.checked })}
          />
          Use my profile instead
        </label>
        {!form.useProfile &&
          (["name", "picture", "about"] as const).map((field) => (
            <input
              key={field}
              className="input w-full"
              placeholder={field}
              value={form.metadata[field] ?? ""}
              onChange={(e) => update({ metadata: { ...form.metadata, [field]: e.target.value } })}
            />
          ))}
        <MetadataPreview
          user={user}
          own={form.useProfile || !Object.values(form.metadata).some((v) => v?.trim()) ? undefined : form.metadata}
        />
      </fieldset>

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
        {built.error && <p className="text-sm text-error">{built.error}</p>}
      </fieldset>

      {draft && <LinkTester draft={draft} />}

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={publish} disabled={!built.factory || busy}>
          {busy && <span className="loading loading-spinner" />}
          {existing ? "Publish update" : "Publish handler"}
        </button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>

      {result && (
        <div className="space-y-2">
          <ul className="text-sm">
            {result.verdicts.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          <JsonBlock value={result.event} />
        </div>
      )}
    </div>
  );
}

function Publisher({ user }: { user: User }) {
  // Select by address so the selection survives new revisions of the handler
  const [selected, setSelected] = useState<string | null>(null);
  // Kept here because publishing a new handler selects it, which re-mounts the editor
  const [result, setResult] = useState<PublishResult | null>(null);
  // Render from the store so new revisions replace old ones
  const handlers = use$(() => user.appHandlers$, [user]);
  const existing = handlers?.find((h) => h.coordinate === selected);

  return (
    <div className="flex min-h-0 grow gap-4 p-4">
      <HandlerList
        user={user}
        handlers={handlers}
        selected={selected}
        onSelect={(address) => {
          setSelected(address);
          setResult(null);
        }}
      />
      {/* Re-mount the editor when switching handlers so the form starts from that handler */}
      <HandlerEditor
        key={selected ?? "new"}
        user={user}
        existing={existing}
        result={result}
        onPublished={(published) => {
          setResult(published);
          setSelected(getReplaceableAddressForEvent(published.event));
        }}
      />
    </div>
  );
}

export default function HandlerPublisherExample() {
  const pubkey = use$(pubkey$);
  const user = useMemo(() => (pubkey ? castUser(pubkey, eventStore) : undefined), [pubkey]);

  const handleLogin = (s: ISigner, p: string) => {
    signer$.next(s);
    pubkey$.next(p);
  };

  if (!user) return <LoginView onLogin={handleLogin} />;
  return <Publisher user={user} />;
}
