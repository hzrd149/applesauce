/**
 * Send nutzaps (Lightning payments via Cashu) to contacts with mint quotes
 * @tags nip-61, nutzap, contacts, lightning, cashu
 * @related nutzap/zap-feed, nutzap/zap-profile
 */
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { MintRecovery } from "applesauce-wallet/helpers";

import { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { ProxySigner } from "applesauce-accounts";
import { castUser, User } from "applesauce-common/casts/user";
import { defined, EventStore } from "applesauce-core";
import { Filter, NostrEvent, persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { useCallback, useState } from "react";
import { BehaviorSubject, catchError, defer, map, of, switchMap } from "rxjs";
import LoginView from "../../components/login-view";
import QRCode from "../../components/qr-code";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];

// Application state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const nutzapStorage$ = new BehaviorSubject<SecureStorage | null>(null);
const recovery$ = new BehaviorSubject<MintRecovery | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

// Global state
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
const recoverySigner = new ProxySigner(signer$.pipe(defined()));

async function getRecovery(storage: SecureStorage) {
  const owner = await recoverySigner.getPublicKey();
  const recovery = new MintRecovery({
    storage: storage.createInstance({
      name: "applesauce-examples-wallet",
      storeName: `nutzaps_${owner}`,
    }),
    owner,
    signer: recoverySigner,
    publish: async (event, relays) => {
      const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
      if (!responses.some((response) => response.ok)) throw new Error("No relay accepted the nutzap");
    },
    onAccepted: (event) => eventStore.add(event),
  });
  recovery$.next(recovery);
  return recovery;
}

const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters<NostrEvent>(cache, filters);
}

persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  cacheRequest,
});

// Component for rendering user avatars
function Avatar({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  return (
    <div className="avatar">
      <div className="w-12 rounded-full">
        <img src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`} alt={user.pubkey} />
      </div>
    </div>
  );
}

// Component for rendering usernames
function Username({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  return <>{profile?.displayName ?? npubEncode(user.pubkey).slice(0, 12) + "..."}</>;
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
function ZapModal({ contact, onZapSent, onClose }: { contact: User; onZapSent?: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState(21);

  const [comment, setComment] = useState("");

  const [selectedMintOverride, setSelectedMint] = useState("");

  const [quote, setQuote] = useState<MintQuoteBolt11Response | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const [status, setStatus] = useState<"input" | "invoice" | "paid">("input");

  const nutzapInfo = use$(contact.nutzap$);

  const selectedMint = nutzapInfo?.mints.some((mint) => mint.mint === selectedMintOverride)
    ? selectedMintOverride
    : (nutzapInfo?.mints[0]?.mint ?? "");
  const storage = use$(nutzapStorage$);
  const pending = use$(
    () =>
      recovery$.pipe(
        switchMap((recovery) =>
          recovery
            ? defer(() => recovery.getPending()).pipe(
                map((items) => ({ items, error: null as string | null })),
                catchError((error) => of({ items: [], error: String(error) })),
              )
            : of({ items: [], error: null as string | null }),
        ),
      ),
    [isProcessing],
  );
  const resume = async (id?: string) => {
    if (!storage) return;
    setIsProcessing(true);
    try {
      const recovery = await getRecovery(storage);
      const pending = (await recovery.getPending()).find((pending) =>
        id ? pending.id === id : pending.nutzap?.recipient === contact.pubkey,
      );
      if (!pending) throw new Error("No pending nutzap for this recipient");
      await recovery.resume(pending.id, {
        onQuote: (quote) => {
          setQuote(quote);
          setStatus("invoice");
        },
      });
      setStatus("paid");
      onZapSent?.();
    } catch (error) {
      alert(String(error));
    } finally {
      setIsProcessing(false);
    }
  };
  const handleZap = async () => {
    if (!storage || !selectedMint || !nutzapInfo?.p2pk) return;
    try {
      const recovery = await getRecovery(storage);
      const pending = await recovery.prepare({
        mint: selectedMint,
        amount,
        nutzap: {
          recipient: contact.pubkey,
          p2pk: nutzapInfo.p2pk,
          relays: nutzapInfo.relays,
          comment,
        },
      });
      await resume(pending.id);
    } catch (error) {
      alert(String(error));
    }
  };

  const handleClose = () => {
    setStatus("input");
    setQuote(null);
    setComment("");
    onClose();
  };

  const recoveryControls = (
    <div className="space-y-2 mb-4">
      <button
        className="btn btn-outline"
        disabled={isProcessing}
        onClick={() => {
          if (storage) void getRecovery(storage).catch((error) => alert(String(error)));
        }}
      >
        Load pending zaps
      </button>
      {pending?.error && (
        <p role="alert" className="text-error">
          {pending.error}
        </p>
      )}
      {pending?.items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 border-b border-base-300 py-2">
          <span className="flex-1" title={item.mint}>
            {item.amount} sats · {item.nutzap?.recipient.slice(0, 12)} · {item.stage}
          </span>
          <button className="btn" disabled={isProcessing} onClick={() => resume(item.id)}>
            Resume
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        disabled={isProcessing}
        onClick={async () => {
          if (!storage) return;
          try {
            const recovery = await getRecovery(storage);
            const pending = await recovery.importLegacyNutzap(
              "example-pending-nutzap",
              async (recipient) => {
                const info = await castUser(recipient, eventStore).nutzap$.$first(10_000, undefined);
                if (!info) throw new Error("Saved recipient's nutzap information is unavailable");
                return info.relays;
              },
              storage,
            );
            if (pending) await resume(pending.id);
          } catch (error) {
            alert(String(error));
          }
        }}
      >
        Import legacy zap
      </button>
    </div>
  );

  if (!nutzapInfo) {
    return (
      <dialog id="zap_contact_modal" className="modal modal-open">
        <div className="modal-box">
          {recoveryControls}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Unable to Zap</h2>
            <button className="btn btn-circle btn-ghost" onClick={handleClose}>
              ✕
            </button>
          </div>
          <div className="alert alert-warning">
            <span>This contact doesn't have nutzap info set up yet.</span>
          </div>
          <div className="modal-action">
            <button className="btn" onClick={handleClose}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    );
  }

  return (
    <dialog id="zap_contact_modal" className="modal modal-open">
      <div className="modal-box">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Nutzap Contact</h2>
          <button className="btn btn-circle btn-ghost" onClick={handleClose}>
            ✕
          </button>
        </div>

        {recoveryControls}

        {status === "input" && (
          <div className="space-y-4">
            <div>
              <label className="label">Mint</label>
              <select
                className="select select-bordered w-full"
                value={selectedMint}
                onChange={(e) => setSelectedMint(e.target.value)}
                disabled={nutzapInfo.mints.length === 0}
              >
                {nutzapInfo.mints.length === 0 ? (
                  <option value="">No mints available</option>
                ) : (
                  nutzapInfo.mints.map((mint, i) => (
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
              <button className="btn btn-ghost" onClick={handleClose}>
                Cancel
              </button>
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
              <button className="btn btn-ghost" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "paid" && (
          <div className="text-center space-y-4">
            <div className="text-green-500 text-4xl">✅</div>
            <h3 className="text-lg font-semibold">Zap Sent!</h3>
            <p className="text-sm opacity-70">Your nutzap has been successfully sent</p>
            <div className="modal-action">
              <button className="btn btn-primary" onClick={handleClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

// Contact border border-base-300 component
function ContactCard({ contact, onZap }: { contact: User; onZap: (user: User) => void }) {
  const nutzapInfo = use$(contact.nutzap$);
  const canZap = !!nutzapInfo?.mints.length && !!nutzapInfo?.p2pk;

  return (
    <div className="border border-base-300 bg-base-100   transition-">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <Avatar user={contact} />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">
              <Username user={contact} />
            </h3>
            <p className="text-sm opacity-70 truncate">{npubEncode(contact.pubkey).slice(0, 16)}...</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => onZap(contact)} disabled={canZap === false}>
              ⚡ Zap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Main contacts view component
function ContactsView({ user }: { user: User }) {
  const [selected, setSelected] = useState<User | null>(null);

  // Get contacts from user.contacts$
  const contacts = use$(user.contacts$);

  const handleZap = (user: User) => {
    setSelected(user);
  };

  const handleCloseModal = () => {
    setSelected(null);
  };

  return (
    <div className="container mx-auto my-8 p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Nutzap Your Contacts</h1>
      </div>

      {/* Loading state */}
      {contacts === undefined && (
        <div className="text-center py-8">
          <span className="loading loading-spinner loading-lg"></span>
          <p className="mt-4">Loading your contacts...</p>
        </div>
      )}

      {/* No contacts state */}
      {contacts !== undefined && contacts.length === 0 && (
        <div className="text-center py-8">
          <div className="alert alert-info max-w-md mx-auto">
            <span>You don't have any contacts yet. Follow some people to see them here!</span>
          </div>
        </div>
      )}

      {/* Contacts grid */}
      {contacts && contacts.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Your Contacts ({contacts.length})</h2>
            <p className="text-sm opacity-70">Click the zap button to send sats to your contacts</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contacts.map((contact) => (
              <ContactCard key={contact.pubkey} contact={contact} onZap={handleZap} />
            ))}
          </div>
        </>
      )}

      {/* Zap Modal */}
      {selected && (
        <ZapModal
          contact={selected}
          onZapSent={() => {
            console.log("Zap sent successfully!");
          }}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}

// Main export with login flow
export default function NutzapContacts() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  const handleLogin = useCallback(async (newSigner: ISigner, newPubkey: string) => {
    signer$.next(newSigner);
    pubkey$.next(newPubkey);
    recovery$.next(null);
  }, []);

  const storage = use$(nutzapStorage$);
  if (!signer || !pubkey || !user) return <LoginView onLogin={handleLogin} />;
  if (!storage) return <UnlockView onUnlock={(storage) => nutzapStorage$.next(storage)} />;
  return <ContactsView user={user} />;
}
