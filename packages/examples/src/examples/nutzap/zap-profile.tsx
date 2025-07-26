import { CashuMint, CashuWallet, MintQuoteResponse } from "@cashu/cashu-ts";
import { ActionHub } from "applesauce-actions";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, getSeenRelays, mergeRelaySets } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-factory";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableEagerMemo, useObservableMemo } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { NutzapProfile } from "applesauce-wallet/actions";
import {
  getNutzapInfoMints,
  getNutzapInfoPubkey,
  getNutzapInfoRelays,
  NUTZAP_INFO_KIND,
} from "applesauce-wallet/helpers";
import { NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";
import { useState } from "react";
import { startWith } from "rxjs/operators";

// Preset list of npubs that can be zapped
const PRESET_NPUBS = [
  {
    name: "hzrd149",
    pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    relays: ["wss://nostrue.com/", "wss://relay.damus.io/"],
  },
  {
    name: "PABLOF7z",
    pubkey: "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52",
    relays: ["wss://f7z.io/", "wss://relay.primal.net/"],
  },
  {
    name: "verbiricha",
    pubkey: "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194",
    relays: ["wss://frens.nostr1.com/", "wss://pyramid.fiatjaf.com/"],
  },
  {
    name: "calle",
    pubkey: "50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63",
    relays: ["wss://relay.damus.io/", "wss://relay.primal.net/"],
  },
];

// Global state
const eventStore = new EventStore();
const pool = new RelayPool();
const signer = new ExtensionSigner();
const factory = new EventFactory({ signer: signer });
const actionHub = new ActionHub(eventStore, factory, async () => {});

// Create an address loader to load user profiles
const addressLoader = createAddressLoader(pool, {
  // Pass all events to the store
  eventStore,
  // Fallback to lookup relays if profiles cant be found
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

// Profile card component
function ProfileCard({ nutzapInfo }: { nutzapInfo: NostrEvent }) {
  const mints = getNutzapInfoMints(nutzapInfo);
  const relays = getNutzapInfoRelays(nutzapInfo);
  const nutzapPubkey = getNutzapInfoPubkey(nutzapInfo);

  // Load the actual profile data
  const profile = useObservableEagerMemo(
    () => eventStore.profile({ pubkey: nutzapInfo.pubkey, relays: mergeRelaySets(getSeenRelays(nutzapInfo)) }),
    [nutzapInfo],
  );

  const displayName = getDisplayName(profile) || npubEncode(nutzapInfo.pubkey);
  const picture = getProfilePicture(profile, `https://robohash.org/${nutzapInfo.pubkey}.png`);

  return (
    <div className="card bg-base-100 shadow-md max-w-xl mx-auto">
      <div className="card-body">
        <div className="flex items-center gap-4 mb-4">
          <div className="avatar">
            <div className="w-16 rounded-full">
              <img src={picture} alt={displayName} />
            </div>
          </div>
          <div>
            <h2 className="card-title">{displayName}</h2>
            <p className="text-sm opacity-70">{npubEncode(nutzapInfo.pubkey)}</p>
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
                  <span className="ml-2 text-xs opacity-70">({mint.units.join(", ")})</span>
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

        <div className="card-actions justify-end">
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
function QRCode({ value }: { value: string }) {
  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="bg-white p-4 rounded-lg">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(value)}`}
          alt="QR Code"
          className="w-48 h-48"
        />
      </div>
      <div className="text-center">
        <p className="text-sm font-mono break-all bg-base-200 p-2 rounded">{value}</p>
      </div>
    </div>
  );
}

// Zap modal component
function ZapModal({ nutzapInfo, onZapSent }: { nutzapInfo: NostrEvent; onZapSent?: () => void }) {
  const [amount, setAmount] = useState(21);
  const [comment, setComment] = useState("");
  const [quote, setQuote] = useState<MintQuoteResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<"input" | "invoice" | "paid">("input");

  const mints = getNutzapInfoMints(nutzapInfo);
  const firstMint = mints[0]?.mint;
  const rawNutzapPubkey = getNutzapInfoPubkey(nutzapInfo);
  const nutzapRelays = getNutzapInfoRelays(nutzapInfo);

  // Ensure pubkey is properly prefixed with "02" for NIP-61 compliance
  const nutzapPubkey = rawNutzapPubkey
    ? rawNutzapPubkey.length === 64
      ? `02${rawNutzapPubkey}`
      : rawNutzapPubkey
    : null;

  const handleZap = async () => {
    if (!firstMint || !nutzapPubkey) {
      alert("Profile doesn't have proper nutzap info");
      return;
    }

    setIsProcessing(true);
    try {
      // Create mint and wallet
      const mint = new CashuMint(firstMint);
      const wallet = new CashuWallet(mint);

      // Request a quote for minting
      const quote = await wallet.createMintQuote(amount);
      setQuote(quote);
      setStatus("invoice");

      // Start checking payment status
      const checkPayment = async () => {
        try {
          const quoteStatus = await wallet.checkMintQuote(quote.quote);
          if (quoteStatus.state === "PAID") {
            // Mint proofs with P2PK lock
            const result = await wallet.mintProofs(amount, quote.quote, {
              pubkey: nutzapPubkey,
            });

            // Create token from proofs
            const tokens = { mint: firstMint, proofs: result.proofs, unit: "sat" };

            // Create nutzap event
            await actionHub.exec(NutzapProfile, nutzapInfo.pubkey, tokens, comment).forEach(async (event) => {
              // Publish to nutzap relays
              try {
                await pool.publish(nutzapRelays, event);
              } catch (error) {
                console.error("Failed to publish", error);
              }
            });

            setStatus("paid");
            onZapSent?.();
          }
        } catch (error) {
          console.error("Payment check failed:", error);
        }
      };

      // Poll for payment every 2 seconds
      const pollInterval = setInterval(checkPayment, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(pollInterval), 300000);
    } catch (error) {
      console.error("Zap failed:", error);
      alert("Failed to create zap: " + error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <dialog id="zap_modal" className="modal">
      <div className="modal-box">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Zap Profile</h2>
          <form method="dialog">
            <button className="btn btn-sm btn-circle btn-ghost">✕</button>
          </form>
        </div>

        {status === "input" && (
          <div className="space-y-4">
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
              <button onClick={handleZap} className="btn btn-primary" disabled={isProcessing}>
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

            <QRCode value={quote.request} />

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
  const [selected, setSelected] = useState<string>("");

  // Load nutzap info for selected npub using address loader
  const nutzapInfo = useObservableMemo(() => {
    if (!selected) return undefined;

    return addressLoader({
      kind: NUTZAP_INFO_KIND,
      pubkey: selected,
      relays: PRESET_NPUBS.find((p) => p.pubkey === selected)?.relays,
    }).pipe(startWith(undefined));
  }, [selected]);

  return (
    <div className="container mx-auto my-8 p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Nutzap Profile</h1>
      </div>

      <div className="text-center mb-6">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Choose a profile:</label>
          <select
            className="select select-bordered w-full max-w-xs"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a profile...</option>
            {PRESET_NPUBS.map((profile) => (
              <option key={profile.pubkey} value={profile.pubkey}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && !nutzapInfo && (
        <div className="text-center">
          <span className="loading loading-spinner loading-lg"></span>
          <p className="mt-4">Loading nutzap info...</p>
        </div>
      )}

      {nutzapInfo ? (
        <ProfileCard nutzapInfo={nutzapInfo} />
      ) : selected ? (
        <div className="text-center">
          <div className="alert alert-warning max-w-md mx-auto">
            <span>No nutzap info found for this profile</span>
          </div>
        </div>
      ) : null}

      {nutzapInfo && <ZapModal nutzapInfo={nutzapInfo} />}
    </div>
  );
}
