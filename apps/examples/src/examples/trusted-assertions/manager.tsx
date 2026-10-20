/**
 * Discover, add, remove and configure your NIP-85 trusted assertion providers (kind 10040)
 * @tags nip-85, trusted-assertions, web-of-trust, actions
 * @related contacts/trusted-assertions, contacts/open-ranking, mutes/manager
 */
import { ActionRunner } from "applesauce-actions";
import {
  AddTrustedProvider,
  MoveTrustedProvider,
  RemoveTrustedProvider,
  RemoveTrustedService,
  SetTrustedProvider,
} from "applesauce-actions/actions";
import { AssertionProvider, castPubkey, castUser, type User } from "applesauce-common/casts";
import {
  ADDRESS_ASSERTION_KIND,
  EVENT_ASSERTION_KIND,
  getPublicProviders,
  IDENTIFIER_ASSERTION_KIND,
  TRUSTED_ASSERTION_TAGS,
  TRUSTED_PROVIDER_LIST_KIND,
  type TrustedProvider,
  USER_ASSERTION_KIND,
} from "applesauce-common/helpers";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { mergeRelaySets } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import {
  BehaviorSubject,
  endWith,
  ignoreElements,
  type Observable,
  of,
  startWith,
  switchMap,
  take,
  timeout,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Loads profiles, relay lists, provider lists and assertions on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

type Account = { user: User; signer: ISigner; actions: ActionRunner };
const account$ = new BehaviorSubject<Account | undefined>(undefined);

function login(signer: ISigner, pubkey: string) {
  // Actions publish the kind 10040 list to the user's outboxes
  const actions = new ActionRunner(eventStore, signer, async (event, relays) => {
    await publishEvent(pool, relays?.length ? relays : FALLBACK_RELAYS, event);
  });
  account$.next({ user: castUser(pubkey, eventStore), signer, actions });
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  account$.next(undefined);
}

// ─── Scores ─────────────────────────────────────────────────────────────────

// Each NIP-85 assertion kind scores a different type of subject
const GROUPS = [
  { kind: USER_ASSERTION_KIND, label: "People", description: "Scores about users, like rank and follower counts" },
  { kind: EVENT_ASSERTION_KIND, label: "Notes", description: "Scores about individual posts" },
  { kind: ADDRESS_ASSERTION_KIND, label: "Articles", description: "Scores about editable content like articles" },
  {
    kind: IDENTIFIER_ASSERTION_KIND,
    label: "External content",
    description: "Scores about websites, books, hashtags and more",
  },
];
const ASSERTION_KINDS = GROUPS.map((g) => g.kind);

const TAG_LABELS: Record<string, string> = {
  rank: "Rank",
  followers: "Followers",
  first_created_at: "First seen",
  post_cnt: "Posts",
  reply_cnt: "Replies",
  reactions_cnt: "Reactions",
  zap_amt_recd: "Zap sats received",
  zap_amt_sent: "Zap sats sent",
  zap_cnt_recd: "Zaps received",
  zap_cnt_sent: "Zaps sent",
  zap_avg_amt_day_recd: "Daily zap sats received",
  zap_avg_amt_day_sent: "Daily zap sats sent",
  reports_cnt_recd: "Reports received",
  reports_cnt_sent: "Reports sent",
  t: "Topics",
  active_hours_start: "Active hours start",
  active_hours_end: "Active hours end",
  comment_cnt: "Comments",
  quote_cnt: "Quotes",
  repost_cnt: "Reposts",
  reaction_cnt: "Reactions",
  zap_cnt: "Zaps",
  zap_amount: "Zap sats",
};

// Tags on assertion events that are not scores
const NON_RESULT_TAGS = new Set(["d", "p", "e", "a", "k", "i"]);

/** A score type, identified by the assertion kind and result tag */
type Slot = Pick<TrustedProvider, "kind" | "tag">;

/** A provider entry in the list, with where it is stored */
type Entry = TrustedProvider & { hidden: boolean };

const slotKey = (s: Slot) => `${s.kind}:${s.tag}`;
const entryKey = (e: Entry) => `${slotKey(e)}:${e.servicePubkey}:${e.hidden}`;

const groupLabel = (kind: number) => GROUPS.find((g) => g.kind === kind)?.label ?? "Other";
const tagLabel = (tag: string) => TAG_LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1).replace(/_/g, " ");
const slotLabel = (s: Slot) => `${groupLabel(s.kind)} · ${tagLabel(s.tag)}`;

/** Returns the spec scores for a kind followed by any extra tags seen in use */
function slotsForKind(kind: number, extra: Slot[]): Slot[] {
  const tags = [...(TRUSTED_ASSERTION_TAGS[kind] ?? []), ...extra.filter((s) => s.kind === kind).map((s) => s.tag)];
  return Array.from(new Set(tags), (tag) => ({ kind, tag }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Runs an async task while tracking it as pending, and alerts on failure */
function usePending() {
  const [pending, setPending] = useState<string[]>([]);
  const run = async (key: string, task: () => Promise<void>) => {
    setPending((p) => [...p, key]);
    try {
      await task();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPending((p) => p.filter((k) => k !== key));
    }
  };
  return { pending, run };
}

// ─── Loading ────────────────────────────────────────────────────────────────

type OutboxLoad = { relays: string[]; fallback: boolean; done: boolean };

/** Fetches the user's provider list from their outboxes so the latest version is always shown */
function loadFromOutboxes(user: User): Observable<OutboxLoad> {
  return user.outboxes$.pipe(
    defined(),
    take(1),
    timeout({ first: 10_000, with: () => of<string[]>([]) }),
    switchMap((outboxes) => {
      const fallback = outboxes.length === 0;
      const relays = fallback ? FALLBACK_RELAYS : outboxes;
      return pool
        .request(relays, { kinds: [TRUSTED_PROVIDER_LIST_KIND], authors: [user.pubkey] })
        .pipe(
          mapEventsToStore(eventStore),
          ignoreElements(),
          startWith({ relays, fallback, done: false }),
          endWith({ relays, fallback, done: true }),
        );
    }),
  );
}

/** Fetches the kind 10040 lists of the given pubkeys from the lookup relays */
function loadProviderLists(pubkeys: string[]): Observable<boolean> {
  const filters = [];
  for (let i = 0; i < pubkeys.length; i += 250)
    filters.push({ kinds: [TRUSTED_PROVIDER_LIST_KIND], authors: pubkeys.slice(i, i + 250) });

  return pool
    .request(mergeRelaySets(lookupRelays$.value, FALLBACK_RELAYS), filters)
    .pipe(mapEventsToStore(eventStore), ignoreElements(), startWith(false), endWith(true));
}

/** What a provider has published, read from a few sample assertions per kind */
type ServiceProbe = {
  done: boolean;
  kinds: { kind: number; latest: number; tags: string[] }[];
};

/** Samples recent assertions from a provider to show what it publishes and whether it is alive */
function useServiceProbe(pubkey: string, relays: string[]): ServiceProbe {
  const relayKey = relays.join(",");
  const done = use$(
    () =>
      pool
        .request(
          mergeRelaySets(relays, FALLBACK_RELAYS),
          ASSERTION_KINDS.map((kind) => ({ kinds: [kind], authors: [pubkey], limit: 5 })),
        )
        .pipe(mapEventsToStore(eventStore), ignoreElements(), startWith(false), endWith(true)),
    [pubkey, relayKey],
  );
  const events = use$(
    () => eventStore.timeline(ASSERTION_KINDS.map((kind) => ({ kinds: [kind], authors: [pubkey] }))),
    [pubkey],
  );

  const kinds = useMemo(
    () =>
      ASSERTION_KINDS.flatMap((kind) => {
        const matching = events?.filter((e) => e.kind === kind) ?? [];
        if (matching.length === 0) return [];
        const tags = new Set(matching.flatMap((e) => e.tags.map((t) => t[0]).filter((t) => !NON_RESULT_TAGS.has(t))));
        const latest = Math.max(...matching.map((e) => e.created_at));
        return [{ kind, latest, tags: Array.from(tags) }];
      }),
    [events],
  );

  return { done: !!done, kinds };
}

/** A provider found in the lists of the user's follows */
type DiscoveredService = {
  pubkey: string;
  users: string[];
  slots: (Slot & { users: string[]; relay?: string })[];
};

/** Aggregates the public providers of follows that are already in the event store */
function useDiscoveredServices(user: User): DiscoveredService[] {
  const contacts = use$(user.contacts$);
  const authors = useMemo(() => contacts?.map((c) => c.pubkey).filter((p) => p !== user.pubkey) ?? [], [contacts]);
  const lists = use$(
    () => (authors.length ? eventStore.timeline({ kinds: [TRUSTED_PROVIDER_LIST_KIND], authors }) : of([])),
    [authors],
  );

  return useMemo(() => {
    const services = new Map<string, Map<string, Slot & { users: Set<string>; relays: string[] }>>();
    for (const list of lists ?? []) {
      for (const p of getPublicProviders(list)) {
        const slots = services.get(p.servicePubkey) ?? new Map();
        services.set(p.servicePubkey, slots);
        const slot = slots.get(slotKey(p)) ?? { kind: p.kind, tag: p.tag, users: new Set<string>(), relays: [] };
        slots.set(slotKey(p), slot);
        slot.users.add(list.pubkey);
        if (p.relay) slot.relays.push(p.relay);
      }
    }

    return Array.from(services, ([pubkey, slots]) => {
      const users = new Set(Array.from(slots.values()).flatMap((s) => Array.from(s.users)));
      return {
        pubkey,
        users: Array.from(users),
        slots: Array.from(slots.values())
          .map((s) => ({ kind: s.kind, tag: s.tag, users: Array.from(s.users), relay: mostCommon(s.relays) }))
          .sort((a, b) => b.users.length - a.users.length),
      };
    }).sort((a, b) => b.users.length - a.users.length);
  }, [lists]);
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ─── Shared components ──────────────────────────────────────────────────────

function ServiceLabel({ pubkey }: { pubkey: string }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const profile = use$(user.profile$);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
        className="size-8 shrink-0 rounded-full object-cover"
        alt=""
      />
      <div className="min-w-0">
        <div className="truncate font-medium">{profile?.displayName ?? user.npub.slice(0, 16) + "…"}</div>
        <div className="truncate font-mono text-sm text-base-content/50">{user.npub}</div>
      </div>
    </div>
  );
}

function Avatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
      title={profile?.displayName ?? pubkey}
      className="size-6 rounded-full border border-base-100 object-cover"
      alt=""
    />
  );
}

function ServiceSummary({ pubkey, probe }: { pubkey: string; probe: ServiceProbe }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {profile?.about && <p className="whitespace-pre-line text-base-content/70">{profile.about}</p>}
      {profile?.website && (
        <a className="link" href={profile.website} target="_blank" rel="noreferrer">
          {profile.website}
        </a>
      )}
      {probe.kinds.map((k) => (
        <div key={k.kind} className="border-l-2 border-base-300 pl-3">
          <div>
            <span className="font-medium">{groupLabel(k.kind)}</span>{" "}
            <span className="text-base-content/60">· updated {new Date(k.latest * 1000).toLocaleString()}</span>
          </div>
          <div className="text-base-content/60">{k.tags.map(tagLabel).join(", ")}</div>
        </div>
      ))}
      {probe.kinds.length === 0 && (
        <p className="text-base-content/60">
          {probe.done ? "No recent scores found from this provider." : "Looking for recent scores…"}
        </p>
      )}
    </div>
  );
}

function ServiceInfo({ pubkey, relays }: { pubkey: string; relays: string[] }) {
  const probe = useServiceProbe(pubkey, relays);
  return <ServiceSummary pubkey={pubkey} probe={probe} />;
}

/** Shows the kind 30382 assertion a provider published about the signed in user */
function AboutYou({ provider, self }: { provider: TrustedProvider; self: string }) {
  const cast = useMemo(
    () =>
      castPubkey(
        { pubkey: provider.servicePubkey, relays: provider.relay ? [provider.relay] : undefined },
        AssertionProvider,
        eventStore,
      ),
    [provider.servicePubkey, provider.relay],
  );
  const assertion = use$(() => cast.getUserAssertion(self), [cast, self]);

  if (!assertion) return <p className="text-sm text-base-content/60">This provider hasn't scored you yet.</p>;

  const metrics: [string, string | number | undefined][] = [
    ["Rank", assertion.rank],
    ["Followers", assertion.followerCount],
    ["Posts", assertion.postCount],
    ["Replies", assertion.replyCount],
    ["Reactions", assertion.reactionsCount],
    ["Zap sats received", assertion.zapsReceived.amount],
    ["Reports received", assertion.reportsReceived],
    ["First post", assertion.firstPostTime?.toLocaleDateString()],
    ["Topics", assertion.topics.join(", ") || undefined],
  ];

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="font-medium">What this provider says about you</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4">
        {metrics
          .filter(([, v]) => v !== undefined)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-base-content/60">{label}</dt>
              <dd className="tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</dd>
            </div>
          ))}
      </dl>
      <div className="text-base-content/50">Updated {assertion.createdAt.toLocaleString()}</div>
    </div>
  );
}

function RelayHintEditor({ entry, account }: { entry: Entry; account: Account }) {
  const [relay, setRelay] = useState(entry.relay ?? "");
  const { pending, run } = usePending();
  const changed = relay.trim() !== (entry.relay ?? "");

  const save = () =>
    run("relay", () =>
      account.actions.run(AddTrustedProvider, { ...entry, relay: relay.trim() || undefined }, entry.hidden),
    );

  return (
    <div className="join w-full max-w-md">
      <input
        className="input join-item flex-1"
        placeholder="Relay where this provider publishes"
        value={relay}
        onChange={(e) => setRelay(e.target.value)}
      />
      <button className="btn join-item" disabled={!changed || pending.length > 0} onClick={save}>
        Save relay
      </button>
    </div>
  );
}

// ─── By score ───────────────────────────────────────────────────────────────

function EntryRow({ entry, account }: { entry: Entry; account: Account }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = usePending();
  const busy = pending.length > 0;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ServiceLabel pubkey={entry.servicePubkey} />
        </div>
        {entry.hidden && <span className="badge badge-outline">private</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => run("move", () => account.actions.run(MoveTrustedProvider, entry, !entry.hidden))}
        >
          {entry.hidden ? "Make public" : "Make private"}
        </button>
        <button
          className="btn btn-ghost btn-sm text-error"
          disabled={busy}
          onClick={() => run("remove", () => account.actions.run(RemoveTrustedProvider, entry, entry.hidden))}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Remove"}
        </button>
      </div>
      {open && (
        <div className="ms-11 flex flex-col gap-4">
          <ServiceInfo pubkey={entry.servicePubkey} relays={entry.relay ? [entry.relay] : []} />
          {entry.kind === USER_ASSERTION_KIND && <AboutYou provider={entry} self={account.user.pubkey} />}
          <RelayHintEditor entry={entry} account={account} />
        </div>
      )}
    </div>
  );
}

function AssignForm({
  slot,
  account,
  suggestions,
  onDone,
}: {
  slot: Slot;
  account: Account;
  suggestions: DiscoveredService[];
  onDone: () => void;
}) {
  const [pubkey, setPubkey] = useState("");
  const [relay, setRelay] = useState("");
  const [hidden, setHidden] = useState(false);
  const [replace, setReplace] = useState(false);
  const { pending, run } = usePending();

  // Providers your follows use for this score
  const forSlot = suggestions
    .map((s) => ({ service: s, slot: s.slots.find((x) => slotKey(x) === slotKey(slot)) }))
    .filter((s) => s.slot)
    .slice(0, 5);

  const submit = async () => {
    const provider = { ...slot, servicePubkey: pubkey, relay: relay.trim() || undefined };
    const ok = await run("assign", () =>
      replace
        ? account.actions.run(SetTrustedProvider, provider, hidden)
        : account.actions.run(AddTrustedProvider, provider, hidden),
    );
    if (ok) onDone();
  };

  return (
    <div className="flex flex-col gap-3 border border-base-300 p-3">
      {forSlot.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-base-content/60">Used by your follows</span>
          {forSlot.map(({ service, slot: s }) => (
            <button
              key={service.pubkey}
              className={`flex items-center gap-3 border-s-2 px-2 py-1 text-left ${pubkey === service.pubkey ? "border-primary bg-base-200" : "border-transparent"}`}
              onClick={() => {
                setPubkey(service.pubkey);
                setRelay(s!.relay ?? "");
              }}
            >
              <div className="min-w-0 flex-1">
                <ServiceLabel pubkey={service.pubkey} />
              </div>
              <span className="text-sm text-base-content/60">{s!.users.length} follows</span>
            </button>
          ))}
        </div>
      )}
      <PubkeyPicker value={pubkey} onChange={setPubkey} placeholder="Provider npub, hex key or NIP-05" />
      <input
        className="input w-full"
        placeholder="Relay where this provider publishes (optional)"
        value={relay}
        onChange={(e) => setRelay(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="toggle" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Private
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="toggle" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace current providers
        </label>
        <div className="ms-auto flex gap-2">
          <button className="btn btn-ghost" onClick={onDone}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!pubkey || pending.length > 0} onClick={submit}>
            {pending.length ? <span className="loading loading-spinner loading-sm" /> : "Use provider"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  entries,
  account,
  suggestions,
}: {
  slot: Slot;
  entries: Entry[];
  account: Account;
  suggestions: DiscoveredService[];
}) {
  const [assigning, setAssigning] = useState(false);

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-medium">{tagLabel(slot.tag)}</span>
        {entries.length === 0 && <span className="text-sm text-base-content/50">No provider</span>}
        {!assigning && (
          <button className="btn btn-ghost btn-sm ms-auto" onClick={() => setAssigning(true)}>
            Add provider
          </button>
        )}
      </div>
      {entries.length > 0 && (
        <div className="divide-y divide-base-300">
          {entries.map((e) => (
            <EntryRow key={entryKey(e)} entry={e} account={account} />
          ))}
        </div>
      )}
      {assigning && (
        <AssignForm slot={slot} account={account} suggestions={suggestions} onDone={() => setAssigning(false)} />
      )}
    </div>
  );
}

function SlotsView({
  entries,
  account,
  suggestions,
}: {
  entries: Entry[];
  account: Account;
  suggestions: DiscoveredService[];
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const forSlot = (slot: Slot) => entries.filter((e) => slotKey(e) === slotKey(slot));

  // Entries for kinds outside the spec still show up, under "Other"
  const otherKinds = Array.from(new Set(entries.map((e) => e.kind).filter((k) => !ASSERTION_KINDS.includes(k))));
  const groups = [
    ...GROUPS,
    ...otherKinds.map((kind) => ({ kind, label: "Other", description: "Scores your clients may not recognize" })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-3">
        <p className="text-sm text-base-content/60">
          Each score is calculated by the providers you choose. Clients use them to rank and filter content for you.
        </p>
        <label className="ms-auto flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
          />
          Show all scores
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => {
          const slots = slotsForKind(group.kind, entries).filter((slot) => showEmpty || forSlot(slot).length > 0);
          if (slots.length === 0) return null;
          return (
            <section key={group.kind}>
              <div className="border-b border-base-300 bg-base-200 px-4 py-2">
                <h2 className="font-semibold">{group.label}</h2>
                <p className="text-sm text-base-content/60">{group.description}</p>
              </div>
              <div className="divide-y divide-base-300">
                {slots.map((slot) => (
                  <SlotRow
                    key={slotKey(slot)}
                    slot={slot}
                    entries={forSlot(slot)}
                    account={account}
                    suggestions={suggestions}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {entries.length === 0 && !showEmpty && (
          <p className="p-8 text-center text-base-content/60">
            No providers yet. Show all scores to pick one, or discover what your follows use.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── By provider ────────────────────────────────────────────────────────────

function ServicesView({ entries, account }: { entries: Entry[]; account: Account }) {
  const { pending, run } = usePending();
  const services = Array.from(new Set(entries.map((e) => e.servicePubkey)));

  return (
    <div className="min-h-0 flex-1 divide-y divide-base-300 overflow-y-auto">
      {services.map((pubkey) => {
        const used = entries.filter((e) => e.servicePubkey === pubkey);
        const relays = Array.from(new Set(used.flatMap((e) => (e.relay ? [e.relay] : []))));
        return (
          <div key={pubkey} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ServiceLabel pubkey={pubkey} />
              </div>
              <button
                className="btn btn-ghost btn-sm text-error"
                disabled={pending.includes(pubkey)}
                onClick={() => run(pubkey, () => account.actions.run(RemoveTrustedService, pubkey))}
              >
                {pending.includes(pubkey) ? <span className="loading loading-spinner loading-sm" /> : "Remove provider"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {used.map((e) => (
                <span key={entryKey(e)} className="badge badge-outline">
                  {slotLabel(e)}
                  {e.hidden && " · private"}
                </span>
              ))}
            </div>
            <ServiceInfo pubkey={pubkey} relays={relays} />
          </div>
        );
      })}
      {services.length === 0 && <p className="p-8 text-center text-base-content/60">No providers yet.</p>}
    </div>
  );
}

// ─── Discover ───────────────────────────────────────────────────────────────

function DiscoverRow({
  service,
  entries,
  account,
  hidden,
}: {
  service: DiscoveredService;
  entries: Entry[];
  account: Account;
  hidden: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = usePending();
  const mine = new Set(entries.filter((e) => e.servicePubkey === service.pubkey).map(slotKey));
  const toProvider = (s: DiscoveredService["slots"][number]): TrustedProvider => ({
    kind: s.kind,
    tag: s.tag,
    servicePubkey: service.pubkey,
    relay: s.relay,
  });
  const missing = service.slots.filter((s) => !mine.has(slotKey(s)));
  const relays = Array.from(new Set(service.slots.flatMap((s) => (s.relay ? [s.relay] : []))));

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ServiceLabel pubkey={service.pubkey} />
        </div>
        <div className="flex -space-x-2">
          {service.users.slice(0, 6).map((p) => (
            <Avatar key={p} pubkey={p} />
          ))}
        </div>
        <span className="text-sm text-base-content/60">{service.users.length} follows</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={missing.length === 0 || pending.length > 0}
          onClick={() => run("all", () => account.actions.run(AddTrustedProvider, missing.map(toProvider), hidden))}
        >
          {missing.length === 0 ? "Added" : `Use for ${plural(missing.length, "score")}`}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {service.slots.map((s) => {
          const added = mine.has(slotKey(s));
          return (
            <button
              key={slotKey(s)}
              className={`btn btn-sm ${added ? "btn-success btn-outline" : "btn-outline"}`}
              disabled={added || pending.includes(slotKey(s))}
              onClick={() => run(slotKey(s), () => account.actions.run(AddTrustedProvider, toProvider(s), hidden))}
            >
              {slotLabel(s)} <span className="text-base-content/60">{s.users.length}</span>
            </button>
          );
        })}
      </div>
      {open && <ServiceInfo pubkey={service.pubkey} relays={relays} />}
    </div>
  );
}

function DiscoverView({
  account,
  entries,
  services,
}: {
  account: Account;
  entries: Entry[];
  services: DiscoveredService[];
}) {
  const contacts = use$(account.user.contacts$);
  const done = use$(() => (contacts ? loadProviderLists(contacts.map((c) => c.pubkey)) : undefined), [contacts]);
  const [hidden, setHidden] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-3">
        <span className="text-sm text-base-content/60">
          {!contacts
            ? "Loading follows…"
            : `${services.length} providers used by your ${contacts.length} follows${done ? "" : " (loading…)"}`}
        </span>
        <label className="ms-auto flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="toggle" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Add as private
        </label>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-base-300 overflow-y-auto">
        {services.map((s) => (
          <DiscoverRow key={s.pubkey} service={s} entries={entries} account={account} hidden={hidden} />
        ))}
        {done && services.length === 0 && (
          <p className="p-8 text-center text-base-content/60">None of your follows have chosen providers yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Add manually ───────────────────────────────────────────────────────────

function ManualForm({ pubkey, account }: { pubkey: string; account: Account }) {
  const [relay, setRelay] = useState("");
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<Slot[]>([]);
  const { pending, run } = usePending();
  const probe = useServiceProbe(pubkey, relay.trim() ? [relay.trim()] : []);

  // Scores the provider has actually published are highlighted, including ones outside the spec
  const detected = probe.kinds.flatMap((k) => k.tags.map((tag) => ({ kind: k.kind, tag })));
  const detectedKeys = new Set(detected.map(slotKey));
  const isSelected = (slot: Slot) => selected.some((s) => slotKey(s) === slotKey(slot));
  const toggle = (slot: Slot) =>
    setSelected((s) => (isSelected(slot) ? s.filter((x) => slotKey(x) !== slotKey(slot)) : [...s, slot]));

  const submit = async () => {
    const providers = selected.map((slot) => ({ ...slot, servicePubkey: pubkey, relay: relay.trim() || undefined }));
    if (await run("add", () => account.actions.run(AddTrustedProvider, providers, hidden))) setSelected([]);
  };

  return (
    <div className="flex flex-col gap-4">
      <ServiceLabel pubkey={pubkey} />
      <ServiceSummary pubkey={pubkey} probe={probe} />
      <input
        className="input w-full max-w-md"
        placeholder="Relay where this provider publishes (optional)"
        value={relay}
        onChange={(e) => setRelay(e.target.value)}
      />

      {GROUPS.map((group) => (
        <section key={group.kind} className="flex flex-col gap-2">
          <div>
            <h3 className="font-semibold">{group.label}</h3>
            <p className="text-sm text-base-content/60">{group.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {slotsForKind(group.kind, detected).map((slot) => (
              <label
                key={slotKey(slot)}
                className={`flex cursor-pointer items-center gap-2 border px-2 py-1 text-sm ${detectedKeys.has(slotKey(slot)) ? "border-success" : "border-base-300"}`}
              >
                <input type="checkbox" className="checkbox" checked={isSelected(slot)} onChange={() => toggle(slot)} />
                {tagLabel(slot.tag)}
              </label>
            ))}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="toggle" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Private (encrypted to yourself)
        </label>
        <button className="btn btn-primary" disabled={selected.length === 0 || pending.length > 0} onClick={submit}>
          {pending.length ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            `Use for ${plural(selected.length, "score")}`
          )}
        </button>
      </div>
    </div>
  );
}

function ManualView({ account }: { account: Account }) {
  const [pubkey, setPubkey] = useState("");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-sm text-base-content/60">
          Paste a provider's key to see what it publishes, then choose the scores it should calculate for you. Scores it
          has published recently are outlined in green.
        </p>
        <PubkeyPicker value={pubkey} onChange={setPubkey} placeholder="Provider npub, hex key or NIP-05" />
        {pubkey && <ManualForm key={pubkey} pubkey={pubkey} account={account} />}
      </div>
    </div>
  );
}

// ─── Manager ────────────────────────────────────────────────────────────────

type View = "scores" | "providers" | "discover" | "manual";

function AccountFooter({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="mt-auto flex items-center gap-2 border-t border-base-300 p-2">
      <img
        src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`}
        className="size-8 shrink-0 rounded-full object-cover"
        alt=""
      />
      <span className="min-w-0 flex-1 truncate">{profile?.displayName ?? user.npub.slice(0, 12)}</span>
      <button className="btn btn-sm btn-ghost" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

/** A one line summary of where the list was loaded from */
function sourceSummary(load?: OutboxLoad) {
  if (!load) return "Finding your outbox relays…";
  const count = `${load.relays.length} ${load.fallback ? "fallback" : "outbox"} relays`;
  return load.done ? `Loaded from ${count}` : `Loading from ${count}…`;
}

function ProviderManager({ account }: { account: Account }) {
  const { user, signer } = account;
  const load = use$(() => loadFromOutboxes(user), [user]);
  const list = use$(user.trustedProviders$);
  const hiddenProviders = use$(() => list?.hiddenProviders$, [list]);
  const suggestions = useDiscoveredServices(user);
  const [view, setView] = useState<View>("scores");
  const [unlocking, setUnlocking] = useState(false);

  const entries = useMemo<Entry[]>(
    () => [
      ...(list?.publicProviders ?? []).map((p) => ({ ...p, hidden: false })),
      ...(hiddenProviders ?? []).map((p) => ({ ...p, hidden: true })),
    ],
    [list, hiddenProviders],
  );

  const unlock = async () => {
    if (!list) return;
    setUnlocking(true);
    try {
      await list.unlock(signer);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unlock private providers");
    } finally {
      setUnlocking(false);
    }
  };

  const views: { id: View; label: string; count?: number }[] = [
    { id: "scores", label: "By score", count: new Set(entries.map(slotKey)).size },
    { id: "providers", label: "By provider", count: new Set(entries.map((e) => e.servicePubkey)).size },
    { id: "discover", label: "Discover", count: suggestions.length || undefined },
    { id: "manual", label: "Add manually" },
  ];

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col border-e border-base-300">
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Trusted providers</h1>
            <p className="text-sm text-base-content/60">
              Services that calculate trust scores, like rank and follower counts, for your clients.
            </p>
          </div>

          <section className="flex flex-col gap-1 text-sm">
            <p>
              {list
                ? `${plural(new Set(entries.map(slotKey)).size, "score")} from ${plural(new Set(entries.map((e) => e.servicePubkey)).size, "provider")} · updated ${list.createdAt.toLocaleDateString()}`
                : load?.done
                  ? "No providers chosen yet"
                  : "Loading your providers…"}
            </p>
            <p className="text-base-content/60" title={load?.relays.join("\n")}>
              {sourceSummary(load)}
            </p>
          </section>

          {list?.hasHidden && !hiddenProviders && (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-base-content/60">Some of your providers are private and encrypted.</p>
              <button className="btn btn-outline" onClick={unlock} disabled={unlocking}>
                {unlocking ? <span className="loading loading-spinner loading-sm" /> : "Unlock private providers"}
              </button>
            </section>
          )}

          <nav className="flex flex-col">
            {views.map((v) => (
              <button
                key={v.id}
                className={`flex justify-between border-s-2 px-3 py-1.5 text-left ${view === v.id ? "border-primary bg-base-200" : "border-transparent"}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
                {v.count !== undefined && <span className="tabular-nums text-base-content/60">{v.count}</span>}
              </button>
            ))}
          </nav>
        </div>

        <AccountFooter user={user} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === "scores" && <SlotsView entries={entries} account={account} suggestions={suggestions} />}
        {view === "providers" && <ServicesView entries={entries} account={account} />}
        {view === "discover" && <DiscoverView account={account} entries={entries} services={suggestions} />}
        {view === "manual" && <ManualView account={account} />}
      </main>
    </div>
  );
}

export default function TrustedProviderManager() {
  const account = use$(account$);

  if (!account)
    return (
      <div className="min-h-0 grow overflow-y-auto">
        <LoginView onLogin={login} />
      </div>
    );

  return <ProviderManager key={account.user.pubkey} account={account} />;
}
