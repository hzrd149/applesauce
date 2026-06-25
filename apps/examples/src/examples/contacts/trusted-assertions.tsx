/**
 * Score every contact in your follow list with a NIP-85 trusted assertions provider.
 * Reads your kind 10040 trusted provider list, then loads each trusted provider's kind 30382 assertion per contact.
 * @tags nip-02, nip-85, contacts, web-of-trust, trusted-assertions
 * @related contacts/open-ranking, contacts/manager
 */
import { AssertionProvider, castUser, User, UserAssertion } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useEffect, useMemo, useState } from "react";
import { BehaviorSubject, map, of } from "rxjs";

import LoginView from "../../components/login-view";

// Setup event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create unified event loader so profiles, contacts, mailboxes and assertion events are fetched on demand
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
});

// Setup application state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

/** A sortable numeric metric exposed by a kind 30382 user assertion */
type SortOption = { id: string; label: string; get: (a: UserAssertion) => number | undefined };

const SORT_OPTIONS: SortOption[] = [
  { id: "rank", label: "Rank", get: (a) => a.rank },
  { id: "followers", label: "Followers", get: (a) => a.followerCount },
  { id: "posts", label: "Posts", get: (a) => a.postCount },
  { id: "reactions", label: "Reactions", get: (a) => a.reactionsCount },
  { id: "zapsReceived", label: "Zaps received", get: (a) => a.zapsReceived.amount },
  { id: "zapsSent", label: "Zaps sent", get: (a) => a.zapsSent.amount },
  { id: "reports", label: "Reports received", get: (a) => a.reportsReceived },
];

function formatNumber(value: number): string {
  return value.toLocaleString();
}

/** Renders the display name of a service provider pubkey */
function ProviderName({ provider }: { provider: AssertionProvider }) {
  const profile = use$(() => castUser(provider.pubkey, eventStore).profile$, [provider.pubkey]);
  return <>{getDisplayName(profile, provider.pubkey.slice(0, 8) + "…")}</>;
}

function ContactRow({ user, assertion, loaded }: { user: User; assertion?: UserAssertion; loaded: boolean }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  const displayName = getDisplayName(profile, user.pubkey.slice(0, 8) + "…");
  const picture = getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`);

  return (
    <li className="list-row items-center">
      <div>
        <img className="size-10 rounded-box" src={picture} alt={displayName} />
      </div>
      <div className="min-w-0">
        <div className="truncate">{displayName}</div>
        <div className="text-xs font-mono opacity-60 truncate">{user.pubkey.slice(0, 16)}…</div>
      </div>

      {/* A selection of the metrics carried by the kind 30382 assertion */}
      <div className="list-col-wrap flex flex-wrap gap-3 text-xs opacity-70">
        {assertion?.followerCount !== undefined && <span>{formatNumber(assertion.followerCount)} followers</span>}
        {assertion?.postCount !== undefined && <span>{formatNumber(assertion.postCount)} posts</span>}
        {assertion?.zapsReceived.amount !== undefined && <span>{formatNumber(assertion.zapsReceived.amount)} sats recv</span>}
      </div>

      {/* The normalized 0–100 rank, the headline metric of a user assertion */}
      <div className="text-right">
        {!loaded ? (
          <span className="loading loading-spinner loading-sm" />
        ) : assertion?.rank !== undefined ? (
          <span className="badge badge-primary font-mono" title="NIP-85 rank (0–100)">
            {assertion.rank}
          </span>
        ) : (
          <span className="text-xs opacity-40" title="No assertion published for this contact">
            —
          </span>
        )}
      </div>
    </li>
  );
}

function ContactAssertions({ user }: { user: User }) {
  const signer = use$(signer$);
  const contacts = use$(() => user.contacts$, [user.pubkey]);

  // The user's kind 10040 trusted provider list, declaring who they trust for each assertion
  const trustedList = use$(() => user.trustedProviders$, [user.pubkey]);
  // The providers trusted specifically for the 30382:rank assertion (includes hidden ones once unlocked)
  const rankProviders = use$(() => (trustedList ? trustedList.userRank$ : of<AssertionProvider[]>([])), [trustedList]);

  const [selectedPubkey, setSelectedPubkey] = useState<string>("");
  const [assertions, setAssertions] = useState<Record<string, { assertion?: UserAssertion }>>({});
  const [sortField, setSortField] = useState<string>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [unlocking, setUnlocking] = useState(false);

  const providers = rankProviders ?? [];
  const supported = providers.length > 0;
  const selectedProvider = providers.find((p) => p.pubkey === selectedPubkey) ?? providers[0];

  // Default the selection to the first trusted provider once they load
  useEffect(() => {
    if (selectedProvider && selectedProvider.pubkey !== selectedPubkey) setSelectedPubkey(selectedProvider.pubkey);
  }, [selectedProvider, selectedPubkey]);

  // Subscribe to every contact's assertion from the selected provider, filling the map as events arrive
  const contactKey = contacts?.map((c) => c.pubkey).join(",");
  useEffect(() => {
    setAssertions({});
    if (!selectedProvider || !contacts?.length) return;

    const subs = contacts.map((c) =>
      selectedProvider
        .getUserAssertion(c.pubkey)
        .subscribe((assertion) => setAssertions((m) => ({ ...m, [c.pubkey]: { assertion } }))),
    );
    return () => subs.forEach((s) => s.unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider?.pubkey, contactKey]);

  // Sort by the selected metric, sinking contacts without an assertion to the bottom
  const sortOption = SORT_OPTIONS.find((o) => o.id === sortField) ?? SORT_OPTIONS[0];
  const sorted = useMemo(() => {
    if (!contacts) return [];
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (pubkey: string) => {
      const a = assertions[pubkey]?.assertion;
      return a ? sortOption.get(a) : undefined;
    };
    return [...contacts].sort((a, b) => {
      const va = get(a.pubkey);
      const vb = get(b.pubkey);
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return (va - vb) * dir;
    });
  }, [contacts, assertions, sortOption, sortDir]);

  const handleUnlock = async () => {
    if (!trustedList || !signer || unlocking) return;
    try {
      setUnlocking(true);
      await trustedList.unlock(signer);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unlock private providers");
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="container mx-auto my-8 px-4 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Contact Assertions</h1>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            signer$.next(null);
            pubkey$.next(null);
          }}
        >
          Sign out
        </button>
      </div>

      {/* Provider list status — assertions need a trusted 30382:rank provider in the kind 10040 list */}
      {trustedList?.hasHidden && !trustedList.unlocked && (
        <div className="alert alert-info mb-4">
          <span>Your trusted provider list has an encrypted section.</span>
          <button className="btn btn-sm" onClick={handleUnlock} disabled={!signer || unlocking}>
            {unlocking ? <span className="loading loading-spinner loading-sm" /> : "Unlock private providers"}
          </button>
        </div>
      )}

      {contacts !== undefined && !supported && (
        <div className="alert alert-warning mb-4">
          <span>
            None of your trusted providers publish <code>30382:rank</code> assertions. Add one to your NIP-85 list
            (kind 10040) to score your contacts.
          </span>
        </div>
      )}

      {supported && (
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Trusted rank provider</span>
            {providers.length > 1 ? (
              <select
                className="select select-bordered"
                value={selectedProvider?.pubkey ?? ""}
                onChange={(e) => setSelectedPubkey(e.target.value)}
              >
                {providers.map((p) => (
                  <option key={p.pubkey} value={p.pubkey}>
                    {p.pubkey.slice(0, 12)}…
                  </option>
                ))}
              </select>
            ) : (
              selectedProvider && (
                <span className="badge badge-ghost badge-lg">
                  <ProviderName provider={selectedProvider} />
                </span>
              )
            )}
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-xl font-semibold">Contacts {contacts ? `(${contacts.length})` : ""}</h2>

        {/* Sort the list by any of the numeric metrics from the assertions */}
        {supported && !!contacts?.length && (
          <div className="join">
            <select
              className="select select-bordered select-sm join-item"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  Sort by {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm join-item"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={sortDir === "desc" ? "Descending (highest first)" : "Ascending (lowest first)"}
            >
              {sortDir === "desc" ? "↓" : "↑"}
            </button>
          </div>
        )}
      </div>

      {!contacts ? (
        <div className="flex items-center gap-2 text-sm opacity-70 py-8">
          <span className="loading loading-spinner loading-sm" />
          Loading contacts…
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 opacity-60">No contacts found in your follow list.</div>
      ) : (
        <ul className="list border border-base-300 rounded-box">
          {sorted.map((contact) => (
            <ContactRow
              key={contact.pubkey}
              user={contact}
              assertion={supported ? assertions[contact.pubkey]?.assertion : undefined}
              loaded={!supported || assertions[contact.pubkey] !== undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ContactAssertionsExample() {
  const user = use$(user$);

  if (!user) {
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );
  }

  return <ContactAssertions user={user} />;
}
