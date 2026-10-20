/**
 * Manage your NIP-89 app recommendations: review the handlers you recommend per event kind and add or remove them
 * @tags nip-89, app-handlers, actions
 * @related app-handlers/open-with, app-handlers/publisher
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { RecommendAppHandler, RemoveAppHandlerRecommendation } from "applesauce-actions/actions";
import { AppHandler, AppRecommendation, castUser, User } from "applesauce-common/casts";
import {
  APP_HANDLER_KIND,
  APP_RECOMMENDATION_KIND,
  getAppHandlersFilter,
  getAppRecommendationsFilter,
  HandlerLinkPlatform,
  RecommendedHandler,
} from "applesauce-common/helpers";
import { AppHandlersModel, RecommendedAppHandlersModel } from "applesauce-common/models";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";
import {
  AddressPointer,
  decodePointer,
  getReplaceableAddressFromPointer,
  naddrEncode,
} from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, catchError, distinctUntilChanged, endWith, ignoreElements, map, of, startWith } from "rxjs";
import LoginView from "../../components/login-view";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];
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
const PRESET_KINDS = [1, 30023, 30311, 31337];

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
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  // Actions publish recommendations to the user's outboxes
  await publishEvent(pool, relays?.length ? relays : FALLBACK_RELAYS, event);
});

// Loads handlers, profiles, and nsites referenced by casts on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

type LoadStatus = { loading: boolean; error?: string };

/** Requests events into the store and reports when the request finishes */
function requestIntoStore(relays: string[], filter: Parameters<RelayPool["request"]>[1]) {
  return pool.request(relays, filter).pipe(
    mapEventsToStore(eventStore),
    ignoreElements(),
    endWith<LoadStatus>({ loading: false }),
    startWith<LoadStatus>({ loading: true }),
    catchError((err) => of<LoadStatus>({ loading: false, error: err instanceof Error ? err.message : String(err) })),
  );
}

/** Runs an async operation with local busy and error state */
function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function HandlerSummary({ handler }: { handler: AppHandler }) {
  // Falls back to the author's kind:0 profile when the handler has no metadata of its own
  const metadata = use$(handler.metadata$);
  const name = metadata?.display_name || metadata?.name || handler.name;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={metadata?.picture || `https://robohash.org/${handler.event.pubkey}.png`}
        alt={name}
        className="h-10 w-10 shrink-0 rounded object-cover"
      />
      <div className="min-w-0">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-sm opacity-70">
          {metadata?.about || `Handles kinds ${handler.supportedKinds.join(", ")}`}
        </p>
      </div>
    </div>
  );
}

/** Handler addresses mapped to the contacts that recommend them */
type Endorsements = Map<string, string[]>;

function ContactAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  const name = profile?.displayName || pubkey.slice(0, 8);
  return (
    <img
      src={profile?.picture || `https://robohash.org/${pubkey}.png`}
      alt={name}
      title={name}
      className="h-6 w-6 rounded-full border border-base-100 object-cover"
    />
  );
}

/** A compact stack of the contacts that recommend an app */
function RecommendedBy({ pubkeys }: { pubkeys?: string[] }) {
  if (!pubkeys?.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex -space-x-2">
        {pubkeys.slice(0, 4).map((p) => (
          <ContactAvatar key={p} pubkey={p} />
        ))}
      </div>
      <span className="text-sm opacity-70">
        {pubkeys.length} {pubkeys.length === 1 ? "contact" : "contacts"}
      </span>
    </div>
  );
}

/** A recommended handler with every platform entry the user listed it under */
type RecommendedApp = { address: string; pointer: AddressPointer; entries: RecommendedHandler[]; handler?: AppHandler };

/** Groups recommendation entries by handler so each app appears once */
function groupByHandler(entries: RecommendedHandler[], handlers: (AppHandler | undefined)[] = []): RecommendedApp[] {
  const apps = new Map<string, RecommendedApp>();
  entries.forEach((entry, i) => {
    const address = getReplaceableAddressFromPointer(entry.pointer);
    const app = apps.get(address) ?? { address, pointer: entry.pointer, entries: [] };
    app.entries.push(entry);
    app.handler ??= handlers[i];
    apps.set(address, app);
  });
  return [...apps.values()];
}

function RecommendedAppItem({ kind, app, contacts }: { kind: number; app: RecommendedApp; contacts?: string[] }) {
  const { busy, error, run } = useOperation();
  const { handler } = app;

  // Platforms the handler has links for that aren't recommended yet
  const listed = new Set(app.entries.map((e) => e.platform));
  const missing = handler?.platforms.filter((p) => !listed.has(p)) ?? [];

  // Passing the platform only removes that entry, null only removes the entry without one, undefined removes all
  const remove = (platform?: HandlerLinkPlatform | null) =>
    run(() => actions.run(RemoveAppHandlerRecommendation, kind, app.pointer, platform));
  const add = (platform: HandlerLinkPlatform) =>
    run(() => actions.run(RecommendAppHandler, kind, app.pointer, platform));

  return (
    <details className="collapse collapse-arrow rounded-none border border-base-300">
      <summary className="collapse-title flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {handler ? (
            <HandlerSummary handler={handler} />
          ) : (
            <p className="break-all text-sm opacity-70">Handler not found: {app.address}</p>
          )}
        </div>
        <RecommendedBy pubkeys={contacts} />
        <div className="flex shrink-0 gap-1">
          {app.entries.map((e) => (
            <span key={e.platform ?? ""} className="badge badge-outline">
              {e.platform ?? "any"}
            </span>
          ))}
        </div>
      </summary>

      <div className="collapse-content flex flex-col gap-4 text-sm">
        {handler?.description && <p>{handler.description}</p>}

        <div className="flex flex-col gap-1">
          <span className="font-semibold">Recommended on</span>
          {app.entries.map((e) => (
            <div key={e.platform ?? ""} className="flex items-center gap-2 border-b border-base-300 py-1">
              <span className="flex-1">{e.platform ?? "Any platform"}</span>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => remove(e.platform ?? null)}>
                Remove
              </button>
            </div>
          ))}
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="opacity-70">Also recommend on</span>
              {missing.map((p) => (
                <button key={p} className="btn btn-sm btn-outline" disabled={busy} onClick={() => add(p)}>
                  + {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {handler && (
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Opens links with</span>
            {handler.platforms.map((p) =>
              handler.links(p).map((link) => (
                <code key={`${p}:${link.url}`} className="break-all opacity-70">
                  {p} {link.type ? `(${link.type})` : ""} {link.url}
                </code>
              )),
            )}
            <span className="pt-1 opacity-70">
              Also handles:{" "}
              {handler.supportedKinds
                .filter((k) => k !== kind)
                .map(kindLabel)
                .join(", ") || "nothing else"}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <code className="flex-1 truncate opacity-50">{naddrEncode(app.pointer)}</code>
          <button className="btn btn-sm btn-error btn-outline" disabled={busy} onClick={() => remove()}>
            {busy ? <span className="loading loading-spinner loading-sm" /> : "Remove app"}
          </button>
        </div>
        {error && <p className="text-error">{error}</p>}
      </div>
    </details>
  );
}

function AddAppForm({
  kind,
  user,
  recommended,
  endorsements,
}: {
  kind: number;
  user: User;
  recommended: Set<string>;
  endorsements?: Endorsements;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AddressPointer | null>(null);
  const [platform, setPlatform] = useState<HandlerLinkPlatform | "">("");
  const { busy, error, run } = useOperation();
  const outboxes = use$(user.outboxes$);

  // The input filters the list, unless it holds a pasted naddr of a kind 31990 handler (keeping its relay hints)
  const pasted = useMemo(() => {
    const value = query.trim().replace(/^nostr:/, "");
    if (!value.startsWith("naddr1")) return { pointer: null, error: null };
    try {
      const decoded = decodePointer(value);
      if (decoded.type !== "naddr" || decoded.data.kind !== APP_HANDLER_KIND)
        return { pointer: null, error: "Expected an naddr of a kind 31990 handler" };
      return { pointer: decoded.data, error: null };
    } catch {
      return { pointer: null, error: "Invalid naddr" };
    }
  }, [query]);
  const pastedHandler = use$(
    () =>
      pasted.pointer ? eventStore.replaceable(pasted.pointer).pipe(castEventStream(AppHandler, eventStore)) : undefined,
    [pasted.pointer],
  );

  // Request handlers for the kind from the user's outboxes into the store
  const status = use$(
    () =>
      outboxes ? requestIntoStore(outboxes.length ? outboxes : FALLBACK_RELAYS, getAppHandlersFilter(kind)) : undefined,
    [kind, outboxes?.join(",")],
  );
  // Render handlers from the store so they update as they arrive, hiding ones already recommended
  const handlers = use$(
    () => eventStore.model(AppHandlersModel, kind).pipe(castTimelineStream(AppHandler, eventStore)),
    [kind],
  );
  // Filter by name and description, listing apps your contacts recommend first
  const available = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = (h: AppHandler) => !search || `${h.name} ${h.description ?? ""}`.toLowerCase().includes(search);
    const count = (h: AppHandler) => endorsements?.get(getReplaceableAddressFromPointer(h.pointer))?.length ?? 0;
    return handlers
      ?.filter((h) => !recommended.has(getReplaceableAddressFromPointer(h.pointer)) && matches(h))
      .sort((a, b) => count(b) - count(a));
  }, [handlers, recommended, endorsements, query]);

  const target = pasted.pointer ?? selected;
  const submit = async () => {
    if (!target) return;
    const ok = await run(() => actions.run(RecommendAppHandler, kind, target, platform || undefined));
    if (ok) {
      setSelected(null);
      setQuery("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        className="input input-bordered w-full"
        placeholder="Filter apps or paste a handler naddr1..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {status?.error && <p className="text-sm text-error">{status.error}</p>}
      {pasted.error ? (
        <p className="text-sm text-error">{pasted.error}</p>
      ) : pasted.pointer ? (
        pastedHandler ? (
          <div className="border border-primary px-3 py-2">
            <HandlerSummary handler={pastedHandler} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="loading loading-spinner loading-sm" /> Loading handler...
          </div>
        )
      ) : available && available.length > 0 ? (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {available.map((handler) => {
            const active = selected?.identifier === handler.identifier && selected.pubkey === handler.event.pubkey;
            return (
              <li key={handler.uid}>
                <button
                  className={`flex w-full items-center gap-3 border px-3 py-2 text-left ${active ? "border-primary" : "border-base-300"}`}
                  onClick={() => setSelected(handler.pointer)}
                >
                  <div className="min-w-0 flex-1">
                    <HandlerSummary handler={handler} />
                  </div>
                  <RecommendedBy pubkeys={endorsements?.get(getReplaceableAddressFromPointer(handler.pointer))} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : !status || status.loading ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-sm" /> Finding apps that handle {kindLabel(kind)}...
        </div>
      ) : (
        <p className="text-sm opacity-70">
          {query ? `No apps match "${query}".` : `No other apps for ${kindLabel(kind)} found on your relays.`}
        </p>
      )}

      <div className="flex gap-2">
        <select
          className="select select-bordered"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as HandlerLinkPlatform | "")}
        >
          <option value="">Any platform</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button className="btn btn-primary flex-1" onClick={submit} disabled={busy || !target}>
          {busy ? <span className="loading loading-spinner" /> : `Recommend for ${kindLabel(kind)}`}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function KindPanel({ kind, user, recommendation }: { kind: number; user: User; recommendation?: AppRecommendation }) {
  // Resolves handlers in the same order as recommendation.handlers, with undefined for missing ones
  const handlers = use$(() => recommendation?.handlers$, [recommendation]);
  const apps = useMemo(() => groupByHandler(recommendation?.handlers ?? [], handlers), [recommendation, handlers]);
  const recommended = useMemo(() => new Set(apps.map((a) => a.address)), [apps]);
  const outboxes = use$(user.outboxes$);

  // Contacts joined into a key so the streams below only resubscribe when the set changes
  const contactsKey = use$(
    () =>
      user.contacts$.pipe(
        map((users) =>
          users
            .map((u) => u.pubkey)
            .sort()
            .join(","),
        ),
        distinctUntilChanged(),
      ),
    [user],
  );
  const contacts = useMemo(() => (contactsKey ? contactsKey.split(",") : []), [contactsKey]);

  // Load the contacts' recommendations for this kind into the store
  const contactStatus = use$(
    () =>
      outboxes && contacts.length
        ? requestIntoStore(outboxes.length ? outboxes : FALLBACK_RELAYS, getAppRecommendationsFilter(kind, contacts))
        : undefined,
    [kind, contacts, outboxes?.join(",")],
  );
  // Which contacts recommend each handler for this kind
  const endorsements = use$(
    () =>
      contacts.length
        ? eventStore
            .model(RecommendedAppHandlersModel, kind, contacts)
            .pipe(
              map(
                (ranked): Endorsements =>
                  new Map(
                    ranked.map((r) => [
                      getReplaceableAddressFromPointer(castEvent(r.handler, AppHandler, eventStore).pointer),
                      r.recommenders,
                    ]),
                  ),
              ),
            )
        : of<Endorsements>(new Map()),
    [kind, contacts],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">
          {kindLabel(kind)} <span className="text-sm font-normal opacity-50">kind {kind}</span>
        </h2>
        <p className="text-sm opacity-70">
          Clients suggest these apps to you and your followers when opening {kindLabel(kind).toLowerCase()} they can't
          display.
        </p>
      </div>

      {apps.length > 0 ? (
        <div className="flex flex-col gap-2">
          {apps.map((app) => (
            <RecommendedAppItem key={app.address} kind={kind} app={app} contacts={endorsements?.get(app.address)} />
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-base-300 p-4 text-sm opacity-70">
          You don't recommend any apps for {kindLabel(kind).toLowerCase()} yet.
        </p>
      )}

      {contactStatus?.error && <p className="text-sm text-error">{contactStatus.error}</p>}

      <details className="collapse collapse-plus rounded-none border-t border-base-300" open={apps.length === 0}>
        <summary className="collapse-title px-0 font-semibold">Recommend an app</summary>
        <div className="collapse-content px-0">
          <AddAppForm kind={kind} user={user} recommended={recommended} endorsements={endorsements} />
        </div>
      </details>
    </div>
  );
}

function NewKindPanel({ onSelect }: { onSelect: (kind: number) => void }) {
  const [input, setInput] = useState("");
  const kind = /^\d+$/.test(input.trim()) ? parseInt(input.trim()) : undefined;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Recommend apps for a new kind</h2>
        <p className="text-sm opacity-70">Pick the type of event you want to recommend apps for.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESET_KINDS.map((k) => (
          <button key={k} className="btn btn-sm btn-outline" onClick={() => onSelect(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input input-bordered flex-1"
          inputMode="numeric"
          placeholder="Event kind, e.g. 30023"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={kind === undefined}
          onClick={() => kind !== undefined && onSelect(kind)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function RecommendationsManager({ user }: { user: User }) {
  const outboxes = use$(user.outboxes$);
  const [active, setActive] = useState<number | "new" | null>(null);
  const [drafts, setDrafts] = useState<number[]>([]);

  // Load every kind 31989 the user has published from their outboxes
  const status = use$(
    () =>
      outboxes
        ? requestIntoStore(outboxes.length ? outboxes : FALLBACK_RELAYS, {
            kinds: [APP_RECOMMENDATION_KIND],
            authors: [user.pubkey],
          })
        : undefined,
    [outboxes?.join(","), user.pubkey],
  );

  // One replaceable event per kind; the store keeps only the newest revision
  const recommendations = use$(user.appRecommendations$);
  const byKind = useMemo(() => new Map(recommendations?.map((r) => [r.supportedKind, r])), [recommendations]);

  // Published kinds plus kinds picked in the "new" tab that have no recommendation yet
  const kinds = useMemo(() => [...new Set([...byKind.keys(), ...drafts])].sort((a, b) => a - b), [byKind, drafts]);
  const loading = !outboxes || status?.loading;
  const current = active ?? kinds[0] ?? (loading ? null : "new");

  const selectNew = (kind: number) => {
    setDrafts((d) => (d.includes(kind) ? d : [...d, kind]));
    setActive(kind);
  };

  return (
    <div className="flex min-h-0 grow flex-col md:flex-row">
      <nav className="flex shrink-0 flex-col border-b border-base-300 md:w-56 md:border-r md:border-b-0">
        <ul className="menu min-h-0 w-full flex-1 flex-nowrap overflow-y-auto">
          <li className="menu-title">Event kinds</li>
          {kinds.map((kind) => (
            <li key={kind}>
              <button className={current === kind ? "menu-active" : ""} onClick={() => setActive(kind)}>
                <span className="flex-1 truncate">{kindLabel(kind)}</span>
                <span className="badge badge-ghost">{byKind.get(kind)?.handlers.length ?? 0}</span>
              </button>
            </li>
          ))}
          <li>
            <button className={current === "new" ? "menu-active" : ""} onClick={() => setActive("new")}>
              + New kind
            </button>
          </li>
        </ul>
        <div className="border-t border-base-300 p-2">
          <button className="btn btn-sm btn-ghost w-full" onClick={logout}>
            Logout
          </button>
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {status?.error && <p className="mb-4 text-sm text-error">{status.error}</p>}
        {current === null ? (
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner" />
            <span>Loading recommendations{outboxes?.length ? ` from ${outboxes.join(", ")}` : ""}...</span>
          </div>
        ) : current === "new" ? (
          <NewKindPanel onSelect={selectNew} />
        ) : (
          <KindPanel key={current} kind={current} user={user} recommendation={byKind.get(current)} />
        )}
      </main>
    </div>
  );
}

export default function RecommendationsExample() {
  const user = use$(user$);

  const handleLogin = async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
  };

  if (!user) return <LoginView onLogin={handleLogin} />;
  return <RecommendationsManager user={user} />;
}
