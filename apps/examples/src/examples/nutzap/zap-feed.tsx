/**
 * Display a feed of nutzaps (Lightning payments) with user information
 * @tags nip-61, nutzap, feed, lightning
 * @related nutzap/zap-profile, zap/timeline
 */
import { relayTimeline } from "../../extra/relay-timeline";

import { castUser, User } from "applesauce-common/casts/user";
import { castTimelineStream } from "applesauce-common/observable";
import { BehaviorSubject, EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { Nutzap } from "applesauce-wallet/casts";
import { NUTZAP_KIND } from "applesauce-wallet/helpers";
import { useMemo } from "react";
import { map, of } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Setup event store
const eventStore = new EventStore();

// Create a relay pool for connections
const pool = new RelayPool();

const relay$ = new BehaviorSubject<string>("wss://relay.primal.net/");

// Create loaders for the event store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: relay$.pipe(map((relay) => [relay])),
});

/** A component for rendering user avatars */
function Avatar({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  return (
    <div className="avatar">
      <div className="w-8 rounded-full">
        <img src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`} alt={user.pubkey} />
      </div>
    </div>
  );
}

/** A component for rendering usernames */
function Username({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  return <>{profile?.displayName ?? "unknown"}</>;
}

function NutzapEvent({ nutzap }: { nutzap: Nutzap }) {
  const zappedEvent = use$(nutzap.zapped$);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar user={nutzap.sender} />
        <h2>
          <span className="font-bold">
            <Username user={nutzap.sender} />
          </span>
          <span> nutzapped {nutzap.amount} sats</span>
          {nutzap.recipient && (
            <span>
              {" "}
              to{" "}
              <span className="font-bold">
                <Username user={nutzap.recipient} />
              </span>
            </span>
          )}
        </h2>
        <time className="ms-auto text-sm text-gray-500">{nutzap.createdAt.toLocaleString()}</time>
      </div>

      <div className="flex gap-2 items-center text-sm text-gray-600">
        <span className="badge badge-primary badge-md">{nutzap.amount} sats</span>
        {nutzap.mint && (
          <span className="badge badge-secondary badge-md" title={nutzap.mint}>
            {new URL(nutzap.mint).hostname}
          </span>
        )}
      </div>

      {nutzap.comment && (
        <>
          <div className="bg-base-200 rounded-lg p-3">
            <p>{nutzap.comment}</p>
          </div>
        </>
      )}

      {zappedEvent ? (
        <div className="border border-base-300 bg-base-100 ">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <Avatar user={castUser(zappedEvent, eventStore)} />
              <h2 className="font-semibold">
                <Username user={castUser(zappedEvent, eventStore)} />
              </h2>
            </div>
            <p>{zappedEvent.content}</p>
          </div>
        </div>
      ) : nutzap.zapPointer ? (
        <div className="border border-base-300 bg-base-200  opacity-50">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">Loading event...</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ZapSummary {
  totalAmount: number;
  totalZaps: number;
  uniqueMints: number;
}

function ZapSummaryCard({ summary }: { summary: ZapSummary }) {
  return (
    <div className="border border-base-300 bg-primary text-primary-content ">
      <div className="p-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="stat-title text-primary-content opacity-80">Total Zapped</div>
            <div className="stat-value text-2xl">{summary.totalAmount.toLocaleString()} sats</div>
          </div>
          <div className="text-center">
            <div className="stat-title text-primary-content opacity-80">Total Zaps</div>
            <div className="stat-value text-2xl">{summary.totalZaps}</div>
          </div>
          <div className="text-center">
            <div className="stat-title text-primary-content opacity-80">Unique Mints</div>
            <div className="stat-value text-2xl">{summary.uniqueMints}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ZapFeed() {
  const relay = use$(relay$);

  const feed = use$(() => relayTimeline(eventStore, pool, [relay], { kinds: [NUTZAP_KIND], limit: 50 }), [relay]);
  const nutzaps = use$(() => of(feed?.events ?? []).pipe(castTimelineStream(Nutzap, eventStore)), [feed]);

  const summary = useMemo(() => {
    if (!nutzaps) return { totalAmount: 0, totalZaps: 0, uniqueMints: 0 };

    const totalAmount = nutzaps.reduce((sum, nutzap) => sum + nutzap.amount, 0);
    const mints = nutzaps.map((n) => n.mint).filter((mint): mint is string => mint !== undefined);
    const uniqueMints = new Set(mints).size;

    return {
      totalAmount,
      totalZaps: nutzaps.length,
      uniqueMints,
    };
  }, [nutzaps]);

  return (
    <div className="mx-auto w-4xl p-4">
      <div className="flex gap-2 mb-4">
        {feed?.errors.map((error) => (
          <p key={error} role="alert" className="text-error">
            {error}
          </p>
        ))}
        {feed?.status === "loading" && <p>Loading nutzaps…</p>}
        <RelayPicker value={relay} onChange={(value) => relay$.next(value)} />
      </div>

      <div className="mb-6">
        <ZapSummaryCard summary={summary} />
      </div>

      <div className="flex flex-col gap-4">
        {nutzaps?.map((nutzap) => (
          <NutzapEvent key={nutzap.id} nutzap={nutzap} />
        ))}
      </div>
    </div>
  );
}
