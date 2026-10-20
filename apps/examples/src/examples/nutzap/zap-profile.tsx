/**
 * Display nutzap information on user profiles with mint details
 * @tags nip-61, nutzap, profile, lightning
 * @related nutzap/zap-feed, nutzap/contacts
 */
import { castTimelineStream } from "applesauce-common/observable";

import { relayTimeline } from "../../extra/relay-timeline";

import { NutzapInfo } from "applesauce-wallet/casts";
import UnlockView from "../../components/unlock-view";
import { nutzapStorage$, prepareNutzap, resumeNutzap } from "../../extra/nutzap-quote";
import { publishEvent } from "../../extra/publish";

import { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { ActionRunner } from "applesauce-actions";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";

import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { NutzapProfile } from "applesauce-wallet/actions";
import { NUTZAP_INFO_KIND } from "applesauce-wallet/helpers";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { useState } from "react";
import { of } from "rxjs";
import QRCode from "../../components/qr-code";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

// Global state
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
const signer = new ExtensionSigner();
const actions = new ActionRunner(eventStore, signer, (event, relays) =>
  publishEvent(pool, relays?.length ? relays : ["wss://relay.damus.io/", "wss://nos.lol/"], event),
);

// Create an address loader to load user profiles
// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  // Fallback to lookup relays if profiles cant be found
  lookupRelays: lookupRelays$,
});

// Timeline item component for displaying nutzap info events
function TimelineItem({
  nutzapInfo,
  onSelect,
}: {
  nutzapInfo: NutzapInfo;
  onSelect: (nutzapInfo: NutzapInfo) => void;
}) {
  const mints = nutzapInfo.mints;

  // Load the actual profile data
  const profile = use$(nutzapInfo.author.profile$);

  const displayName = getDisplayName(profile) || npubEncode(nutzapInfo.author.pubkey);
  const picture = getProfilePicture(profile, `https://robohash.org/${nutzapInfo.author.pubkey}.png`);

  return (
    <div className="border border-base-300 bg-base-100   cursor-pointer" onClick={() => onSelect(nutzapInfo)}>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-12 rounded-full">
              <img src={picture} alt={displayName} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">{displayName}</h3>
            <p className="text-sm opacity-70 truncate">{npubEncode(nutzapInfo.author.pubkey)}</p>
          </div>
          <div className="text-right">
            <div className="badge badge-primary">
              {mints.length} mint{mints.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Profile details component
function ProfileCard({ nutzapInfo }: { nutzapInfo: NutzapInfo }) {
  const mints = nutzapInfo.mints;
  const relays = nutzapInfo.relays;
  const nutzapPubkey = nutzapInfo.p2pk;

  // Load the actual profile data
  const profile = use$(nutzapInfo.author.profile$);

  const displayName = getDisplayName(profile) || npubEncode(nutzapInfo.author.pubkey);
  const picture = getProfilePicture(profile, `https://robohash.org/${nutzapInfo.author.pubkey}.png`);

  return (
    <div className="border border-base-300 bg-base-100  max-w-xl mx-auto">
      <div className="p-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="avatar">
            <div className="w-16 rounded-full">
              <img src={picture} alt={displayName} />
            </div>
          </div>
          <div>
            <h2 className="font-semibold">{displayName}</h2>
            <p className="text-sm opacity-70">{npubEncode(nutzapInfo.author.pubkey)}</p>
          </div>
        </div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">Nutzap Pubkey:</h3>
          <div className="text-sm bg-base-200 rounded px-2 py-1 font-mono">
            {nutzapPubkey ? nutzapPubkey : "Not specified"}
          </div>
        </div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">Supported Mints:</h3>
          <div className="space-y-1">
            {mints.map((mint, i) => (
              <div key={i} className="text-sm bg-base-200 rounded px-2 py-1">
                {mint.mint}
                {mint.units && mint.units.length > 0 && (
                  <span className="ml-2 text-sm opacity-70">({mint.units.join(", ")})</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">Relays:</h3>
          <div className="space-y-1">
            {relays.map((relay, i) => (
              <div key={i} className="text-sm bg-base-200 rounded px-2 py-1">
                {relay}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            className="btn btn-primary btn-lg"
            onClick={() => (document.getElementById("zap_modal") as HTMLDialogElement)?.showModal()}
            disabled={!nutzapPubkey || mints.length === 0}
          >
            ⚡ Zap Profile
          </button>
        </div>
      </div>
    </div>
  );
}

// QR Code component for lightning invoice
function InvoiceQRCode({ value }: { value: string }) {
  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="bg-white p-4 rounded-lg">
        <QRCode value={value} size={192} className="h-48 w-48" alt="Lightning invoice QR code" />
      </div>
      <div className="text-center">
        <p className="text-sm font-mono break-all bg-base-200 p-2 rounded">{value}</p>
      </div>
    </div>
  );
}

// Zap modal component
function ZapModal({ nutzapInfo, onZapSent }: { nutzapInfo: NutzapInfo; onZapSent?: () => void }) {
  const [amount, setAmount] = useState(21);

  const [comment, setComment] = useState("");

  const [selectedMintOverride, setSelectedMintOverride] = useState<string>("");

  const [quote, setQuote] = useState<MintQuoteBolt11Response | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const [status, setStatus] = useState<"input" | "invoice" | "paid">("input");

  const mints = nutzapInfo.mints;

  const selectedMint = mints.some((mint) => mint.mint === selectedMintOverride)
    ? selectedMintOverride
    : (mints[0]?.mint ?? "");
  const nutzapPubkey = nutzapInfo.p2pk;
  const storage = use$(nutzapStorage$);
  const resume = async () => {
    if (!storage) return;
    setIsProcessing(true);
    try {
      await resumeNutzap(
        storage,
        (recipient, token, comment, couch) => actions.run(NutzapProfile, recipient, token, { comment, couch }),
        (quote) => {
          setQuote(quote);
          setStatus("invoice");
        },
      );
      setStatus("paid");
      onZapSent?.();
    } catch (error) {
      alert(String(error));
    } finally {
      setIsProcessing(false);
    }
  };
  const handleZap = async () => {
    if (!storage || !selectedMint || !nutzapPubkey) return;
    try {
      await prepareNutzap(storage, {
        mint: selectedMint,
        amount,
        recipient: nutzapInfo.author.pubkey,
        p2pk: nutzapPubkey,
        comment,
      });
      await resume();
    } catch (error) {
      alert(String(error));
    }
  };

  return (
    <dialog id="zap_modal" className="modal">
      <div className="modal-box">
        <button className="btn btn-outline mb-4" disabled={isProcessing} onClick={resume}>
          Resume pending zap
        </button>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Zap Profile</h2>
          <form method="dialog">
            <button className="btn btn-circle btn-ghost">✕</button>
          </form>
        </div>

        {status === "input" && (
          <div className="space-y-4">
            <div>
              <label className="label">Mint</label>
              <select
                className="select select-bordered w-full"
                value={selectedMint}
                onChange={(e) => setSelectedMintOverride(e.target.value)}
                disabled={mints.length === 0}
              >
                {mints.length === 0 ? (
                  <option value="">No mints available</option>
                ) : (
                  mints.map((mint, i) => (
                    <option key={i} value={mint.mint}>
                      {mint.mint}
                      {mint.units && mint.units.length > 0 && ` (${mint.units.join(", ")})`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="label">Amount (sats)</label>
              <input
                type="number"
                className="input input-bordered w-full"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min="1"
              />
            </div>

            <div>
              <label className="label">Comment (optional)</label>
              <textarea
                className="textarea textarea-bordered w-full"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Say something nice..."
              />
            </div>

            <div className="modal-action">
              <form method="dialog">
                <button className="btn btn-ghost">Cancel</button>
              </form>
              <button onClick={handleZap} className="btn btn-primary" disabled={isProcessing || !selectedMint}>
                {isProcessing ? "Processing..." : "Create Zap"}
              </button>
            </div>
          </div>
        )}

        {status === "invoice" && quote && (
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">Pay Invoice</h3>
              <p className="text-sm opacity-70 mb-4">Scan the QR code or copy the invoice to pay {amount} sats</p>
            </div>

            <InvoiceQRCode value={quote.request} />

            <div className="modal-action">
              <form method="dialog">
                <button className="btn btn-ghost">Cancel</button>
              </form>
            </div>
          </div>
        )}

        {status === "paid" && (
          <div className="text-center space-y-4">
            <div className="text-green-500 text-4xl">✅</div>
            <h3 className="text-lg font-semibold">Zap Sent!</h3>
            <p className="text-sm opacity-70">Your nutzap has been successfully sent to the profile</p>
            <div className="modal-action">
              <form method="dialog">
                <button className="btn btn-primary">Done</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

export default function ZapProfile() {
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");

  const feed = use$(
    () => relayTimeline(eventStore, pool, relay ? [relay] : [], { kinds: [NUTZAP_INFO_KIND] }),
    [relay],
  );
  const timeline = use$(() => of(feed?.events ?? []).pipe(castTimelineStream(NutzapInfo, eventStore)), [feed]);
  const selectedNutzapInfo = timeline?.find((event) => event.uid === selectedAddress);
  const setSelectedNutzapInfo = (event: NutzapInfo | null) => setSelectedAddress(event?.uid ?? null);

  const storage = use$(nutzapStorage$);
  if (!storage) return <UnlockView onUnlock={(storage) => nutzapStorage$.next(storage)} />;
  return (
    <div className="container mx-auto my-8 p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Nutzap Profile</h1>
      </div>

      {feed?.errors.map((error) => (
        <p key={error} role="alert" className="text-error">
          {error}
        </p>
      ))}
      {selectedNutzapInfo ? (
        <div className="space-y-4">
          <button className="btn" onClick={() => setSelectedNutzapInfo(null)}>
            ← Back to timeline
          </button>
          <ProfileCard nutzapInfo={selectedNutzapInfo} />
          <ZapModal
            nutzapInfo={selectedNutzapInfo}
            onZapSent={() => {
              // Optionally close modal or show success
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Relay Selection */}
          <RelayPicker value={relay} onChange={(value: string) => setRelay(value)} className="flex-1" />

          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Recent Nutzap Profiles</h2>
            <p className="text-sm opacity-70">Click on a profile to view details and zap them</p>
          </div>

          {feed?.status === "loading" && relay.length > 0 && (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
              <p className="mt-4">Loading nutzap profiles...</p>
            </div>
          )}

          {relay.length === 0 && (
            <div className="text-center py-8">
              <div className="alert alert-warning max-w-md mx-auto">
                <span>Please add at least one relay to query for nutzap profiles.</span>
              </div>
            </div>
          )}

          {feed?.status !== "loading" && timeline && timeline.length === 0 && relay.length > 0 && (
            <div className="text-center py-8">
              <div className="alert alert-info max-w-md mx-auto">
                <span>No nutzap profiles found. Profiles will appear here as they are discovered.</span>
              </div>
            </div>
          )}

          {timeline && timeline.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {timeline.map((nutzapInfo) => (
                <TimelineItem key={nutzapInfo.id} nutzapInfo={nutzapInfo} onSelect={setSelectedNutzapInfo} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
