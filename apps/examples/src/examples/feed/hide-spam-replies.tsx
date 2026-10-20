/**
 * Hide reply spam from a live feed with the on-device nspam classifier from applesauce-extra
 * @tags feed, spam, moderation, machine-learning
 * @related feed/spam-filter, feed/relay-timeline
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { mapEventsToStore } from "applesauce-core/observable";
import { type NostrEvent, unixNow } from "applesauce-core/helpers";
import { filterSpam, isNspamReply, NspamClassifier } from "applesauce-extra/nspam";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import { catchError, defer, map, of, shareReplay, startWith } from "rxjs";

import NoteContent from "../../components/note-content";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const DEFAULT_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://nostr.mom/"];

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Download the nspam model once (about 9 MB) and share it
const classifier$ = defer(() => NspamClassifier.load()).pipe(
  map((nspam) => ({ nspam })),
  startWith({ loading: true }),
  catchError((error) => of({ error: String(error) })),
  shareReplay(1),
);

// nspam only scores kind 1 replies, so the feed shows replies
const replies$ = eventStore.timeline({ kinds: [1] }).pipe(map((events) => events.filter(isNspamReply)));

function Reply({ event, nspam, spam }: { event: NostrEvent; nspam: NspamClassifier; spam?: boolean }) {
  const profile = use$(() => castUser(event.pubkey, eventStore).profile$, [event.pubkey]);
  const score = nspam.getScore(event.pubkey)?.score ?? 0;

  return (
    <div className={`min-w-0 border-b border-base-300 p-3 lg:odd:border-r ${spam ? "border-l-4 border-l-error" : ""}`}>
      <div className="mb-1 flex items-center gap-2">
        <img src={profile?.picture ?? `https://robohash.org/${event.pubkey}.png`} className="size-8 rounded-full" />
        <span className="truncate font-semibold">{profile?.displayName ?? event.pubkey.slice(0, 12)}</span>
        <span className={`badge ms-auto ${spam ? "badge-error" : "badge-ghost"}`}>spam {score.toFixed(2)}</span>
      </div>
      <NoteContent event={event} />
    </div>
  );
}

function Feed({ nspam }: { nspam: NspamClassifier }) {
  const [showHidden, setShowHidden] = useState(false);
  const [relays, setRelays] = useState(DEFAULT_RELAYS);

  // Stream the last 10 minutes of notes from the selected relays into the store and keep listening
  use$(
    () =>
      relays.length > 0
        ? pool.subscription(relays, { kinds: [1], since: unixNow() - 600 }).pipe(mapEventsToStore(eventStore))
        : undefined,
    [relays.join(",")],
  );
  const all = use$(replies$);
  // The whole integration: pipe a timeline through filterSpam
  const clean = use$(() => replies$.pipe(filterSpam(nspam)), [nspam]);

  const hidden = useMemo(() => {
    const kept = new Set(clean);
    return all?.filter((event) => !kept.has(event)) ?? [];
  }, [all, clean]);

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex items-center gap-3 border-b border-base-300 p-3">
        <span>
          Showing {clean?.length ?? 0} replies, hid {hidden.length} spam replies
        </span>
        <label className="ms-auto flex items-center gap-2">
          <input
            type="checkbox"
            className="toggle"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
        {relays.map((relay) => (
          <span key={relay} className="badge badge-outline gap-1">
            {relay}
            <button
              className="cursor-pointer"
              title="Remove relay"
              onClick={() => setRelays((list) => list.filter((r) => r !== relay))}
            >
              ✕
            </button>
          </span>
        ))}
        {/* Remount the picker after each change so the input clears */}
        <RelayPicker
          key={relays.join(",")}
          value=""
          className="ms-auto w-full max-w-sm"
          onChange={(relay) => setRelays((list) => (list.includes(relay) ? list : [...list, relay]))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 content-start lg:grid-cols-2">
          {(showHidden ? hidden : clean)?.slice(0, 200).map((event) => (
            <Reply key={event.id} event={event} nspam={nspam} spam={showHidden} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HideSpamReplies() {
  const state = use$(classifier$);

  if (state && "error" in state) return <div className="m-4 border border-error p-3 text-error">{state.error}</div>;
  if (!state || "loading" in state) return <div className="p-4">Downloading the nspam model…</div>;
  return <Feed nspam={state.nspam} />;
}
