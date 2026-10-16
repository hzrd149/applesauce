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
  HandlerLinkPlatform,
  RecommendedHandler,
} from "applesauce-common/helpers";
import { AppHandlersModel } from "applesauce-common/models";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { AddressPointer, decodePointer, getReplaceableAddressFromPointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, catchError, endWith, ignoreElements, map, of, startWith } from "rxjs";
import LoginView from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];
const PRESET_KINDS = [
  { kind: 1, label: "Notes" },
  { kind: 30023, label: "Articles" },
  { kind: 30311, label: "Live streams" },
  { kind: 31337, label: "Tracks" },
];

// Login state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

// Shared infrastructure
const eventStore = new EventStore();
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

function RecommendedHandlerRow({
  kind,
  entry,
  handler,
}: {
  kind: number;
  entry: RecommendedHandler;
  handler: AppHandler | undefined;
}) {
  const { busy, error, run } = useOperation();
  const address = getReplaceableAddressFromPointer(entry.pointer);

  // Passing the platform only removes that platform's entry; entries without one remove every platform
  const remove = () => run(() => actions.run(RemoveAppHandlerRecommendation, kind, entry.pointer, entry.platform));

  return (
    <li className="flex flex-col gap-2 border-b border-base-300 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {handler ? (
            <HandlerSummary handler={handler} />
          ) : (
            <p className="break-all text-sm opacity-70">Handler not found: {address}</p>
          )}
        </div>
        <span className="badge badge-outline">{entry.platform ?? "any platform"}</span>
        <button className="btn btn-sm btn-ghost" onClick={remove} disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Remove"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </li>
  );
}

function RecommendationGroup({ recommendation }: { recommendation: AppRecommendation }) {
  // Resolves handlers in the same order as recommendation.handlers, with undefined for missing ones
  const handlers = use$(recommendation.handlers$);

  return (
    <section className="border border-base-300">
      <header className="flex items-center justify-between border-b border-base-300 px-4 py-2">
        <h3 className="font-semibold">Kind {recommendation.supportedKind}</h3>
        <span className="text-sm opacity-70">{recommendation.handlers.length} handlers</span>
      </header>
      {recommendation.handlers.length === 0 ? (
        <p className="px-4 py-3 text-sm opacity-70">No handlers left in this recommendation.</p>
      ) : (
        <ul className="px-4">
          {recommendation.handlers.map((entry, i) => (
            <RecommendedHandlerRow
              key={`${getReplaceableAddressFromPointer(entry.pointer)}:${entry.platform ?? ""}`}
              kind={recommendation.supportedKind}
              entry={entry}
              handler={handlers?.[i]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HandlerOption({
  handler,
  selected,
  recommended,
  onSelect,
}: {
  handler: AppHandler;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        className={`flex w-full items-center gap-2 border px-3 py-2 text-left ${selected ? "border-primary" : "border-base-300"}`}
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1">
          <HandlerSummary handler={handler} />
        </div>
        {recommended && <span className="badge badge-outline">Recommended</span>}
      </button>
    </li>
  );
}

function RecommendForm({ user }: { user: User }) {
  const [kindInput, setKindInput] = useState("30023");
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [naddr, setNaddr] = useState("");
  const [selected, setSelected] = useState<AddressPointer | null>(null);
  const [platform, setPlatform] = useState<HandlerLinkPlatform | "">("");
  const { busy, error, run } = useOperation();

  const kind = /^\d+$/.test(kindInput.trim()) ? parseInt(kindInput.trim()) : undefined;

  // A pasted naddr of a kind 31990 handler, keeping its relay hints
  const pasted = useMemo(() => {
    const value = naddr.trim().replace(/^nostr:/, "");
    if (!value) return { pointer: null, error: null };
    try {
      const decoded = decodePointer(value);
      if (decoded.type !== "naddr" || decoded.data.kind !== APP_HANDLER_KIND)
        return { pointer: null, error: "Expected an naddr of a kind 31990 handler" };
      return { pointer: decoded.data, error: null };
    } catch {
      return { pointer: null, error: "Invalid naddr" };
    }
  }, [naddr]);
  const pastedHandler = use$(
    () =>
      pasted.pointer ? eventStore.replaceable(pasted.pointer).pipe(castEventStream(AppHandler, eventStore)) : undefined,
    [pasted.pointer],
  );

  // Request handlers for the kind from the selected relay into the store
  const status = use$(
    () =>
      kind === undefined ? undefined : requestIntoStore([relay], { kinds: [APP_HANDLER_KIND], "#k": [String(kind)] }),
    [kind, relay],
  );
  // Render handlers from the store so they update as they arrive
  const handlers = use$(
    () =>
      kind === undefined
        ? undefined
        : eventStore.model(AppHandlersModel, kind).pipe(castTimelineStream(AppHandler, eventStore)),
    [kind],
  );

  // The user's existing recommendation for this kind, to mark already recommended handlers
  const existing = use$(
    () =>
      kind === undefined
        ? undefined
        : eventStore
            .replaceable({ kind: APP_RECOMMENDATION_KIND, pubkey: user.pubkey, identifier: String(kind) })
            .pipe(castEventStream(AppRecommendation, eventStore)),
    [kind, user.pubkey],
  );
  const recommended = useMemo(
    () => new Set(existing?.handlers.map((h) => getReplaceableAddressFromPointer(h.pointer))),
    [existing],
  );

  const target = pasted.pointer ?? selected;
  const submit = async () => {
    if (kind === undefined || !target) return;
    const ok = await run(() => actions.run(RecommendAppHandler, kind, target, platform || undefined));
    if (ok) {
      setSelected(null);
      setNaddr("");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">Recommend an app</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Event kind</span>
        <input
          className="input input-bordered w-full"
          inputMode="numeric"
          value={kindInput}
          onChange={(e) => {
            setKindInput(e.target.value);
            setSelected(null);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {PRESET_KINDS.map((preset) => (
          <button
            key={preset.kind}
            className={`btn btn-sm ${kind === preset.kind ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setKindInput(String(preset.kind));
              setSelected(null);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Browse handlers on relay</span>
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        {status?.error && <p className="text-sm text-error">{status.error}</p>}
        {kind === undefined ? (
          <p className="text-sm opacity-70">Enter a numeric event kind.</p>
        ) : handlers && handlers.length > 0 ? (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {handlers.map((handler) => (
              <HandlerOption
                key={handler.uid}
                handler={handler}
                selected={
                  !pasted.pointer &&
                  selected?.identifier === handler.identifier &&
                  selected.pubkey === handler.event.pubkey
                }
                recommended={recommended.has(getReplaceableAddressFromPointer(handler.pointer))}
                onSelect={() => setSelected(handler.pointer)}
              />
            ))}
          </ul>
        ) : status?.loading ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="loading loading-spinner loading-sm" /> Loading handlers for kind {kind}...
          </div>
        ) : (
          <p className="text-sm opacity-70">No handlers for kind {kind} found on this relay.</p>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Or paste a handler naddr</span>
        <input
          className="input input-bordered w-full"
          placeholder="naddr1..."
          value={naddr}
          onChange={(e) => setNaddr(e.target.value)}
        />
      </label>
      {pasted.error && <p className="text-sm text-error">{pasted.error}</p>}
      {pasted.pointer &&
        (pastedHandler ? (
          <div className="border border-primary px-3 py-2">
            <HandlerSummary handler={pastedHandler} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="loading loading-spinner loading-sm" /> Loading handler...
          </div>
        ))}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Platform</span>
        <select
          className="select select-bordered w-full"
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
      </label>

      <button className="btn btn-primary" onClick={submit} disabled={busy || kind === undefined || !target}>
        {busy ? <span className="loading loading-spinner" /> : `Recommend for kind ${kind ?? "?"}`}
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function RecommendationsManager({ user }: { user: User }) {
  const outboxes = use$(user.outboxes$);

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
  const recommendations = use$(
    () =>
      eventStore.timeline({ kinds: [APP_RECOMMENDATION_KIND], authors: [user.pubkey] }).pipe(
        castTimelineStream(AppRecommendation, eventStore),
        map((recs) => [...recs].sort((a, b) => a.supportedKind - b.supportedKind)),
      ),
    [user.pubkey],
  );

  return (
    <div className="flex min-h-0 grow flex-col lg:flex-row">
      <aside className="min-h-0 overflow-y-auto border-base-300 lg:w-96 lg:border-r">
        <RecommendForm user={user} />
      </aside>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <h2 className="text-lg font-semibold">Your recommendations</h2>
        {status?.error && <p className="text-sm text-error">{status.error}</p>}
        {recommendations && recommendations.length > 0 ? (
          recommendations.map((recommendation) => (
            <RecommendationGroup key={recommendation.uid} recommendation={recommendation} />
          ))
        ) : !outboxes || status?.loading ? (
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner" />
            <span>Loading recommendations{outboxes?.length ? ` from ${outboxes.join(", ")}` : ""}...</span>
          </div>
        ) : (
          <p className="opacity-70">You haven't recommended any apps yet. Use the form to recommend one.</p>
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
