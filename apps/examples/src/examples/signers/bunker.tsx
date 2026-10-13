/**
 * Authenticate and sign events using Nostr Connect (NIP-46) bunker protocol
 * @tags nip-46, signers, bunker, nostr-connect
 * @related cli/bunker-login, signers/bunker-provider
 */
import { use$ } from "applesauce-react/hooks";
import { BehaviorSubject, Observable } from "rxjs";

import { NoteFactory } from "applesauce-common/factories";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { useMemo } from "react";
import JsonBlock from "../../components/json-block";
import QRCode from "../../components/qr-code";

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Setup nostr connect signer
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

const SignerQRCode = ({ data }: { data: string }) => (
  <div className="flex items-center justify-center p-4 bg-white rounded-lg">
    <QRCode value={data} size={192} className="h-48 w-48" alt="Nostr Connect QR code" />
  </div>
);

const BunkerUrlLogin = ({ onSignerCreated }: { onSignerCreated: (signer: NostrConnectSigner) => void }) => {
  const bunkerUrl$ = useMemo(() => new BehaviorSubject(""), []);
  const bunkerUrl = use$(bunkerUrl$);

  const isConnecting$ = useMemo(() => new BehaviorSubject(false), []);
  const isConnecting = use$(isConnecting$);

  const error$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const error = use$(error$);

  const handleConnect = async () => {
    if (!bunkerUrl) return;

    try {
      isConnecting$.next(true);
      error$.next(null);

      // Create signer from bunker URL
      const newSigner = await NostrConnectSigner.fromBunkerURI(bunkerUrl);

      onSignerCreated(newSigner);
    } catch (err) {
      console.error("Connection error:", err);
      error$.next(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      isConnecting$.next(false);
    }
  };

  return (
    <div className="border border-base-300 bg-base-200  mb-6">
      <div className="p-4">
        <h2 className="font-semibold mb-4">Login with Bunker URL</h2>
        <div className="flex flex-col gap-2 mb-4">
          <input
            type="text"
            placeholder="Enter bunker:// URL"
            className="input input-bordered w-full"
            value={bunkerUrl}
            onChange={(e) => bunkerUrl$.next(e.target.value)}
          />
        </div>
        <button className={`btn btn-primary w-full`} onClick={handleConnect} disabled={!bunkerUrl || isConnecting}>
          {isConnecting ? "Connecting..." : "Connect"}
        </button>

        {error && (
          <div className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const QRCodeLogin = ({ onSignerCreated }: { onSignerCreated: (signer: NostrConnectSigner) => void }) => {
  const nostrConnectUri$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const nostrConnectUri = use$(nostrConnectUri$);

  const error$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const error = use$(error$);

  const isConnecting$ = useMemo(() => new BehaviorSubject(false), []);
  const isConnecting = use$(isConnecting$);

  const pending$ = useMemo(
    () =>
      new BehaviorSubject<{
        signer: NostrConnectSigner;
        controller: AbortController;
        timeout: ReturnType<typeof setTimeout>;
        handedOff: boolean;
      } | null>(null),
    [],
  );
  const pending = use$(pending$);
  use$(
    () =>
      new Observable<void>(() => () => {
        if (pending && !pending.handedOff) {
          pending.controller.abort();
          clearTimeout(pending.timeout);
          void pending.signer.close();
        }
      }),
    [pending],
  );

  const handleQrCodeLogin = async () => {
    try {
      error$.next(null);
      isConnecting$.next(true);

      // Create a new signer for QR code login
      const newSigner = new NostrConnectSigner({
        relays: ["wss://bucket.coracle.social"],
      });

      // Generate QR code URI with metadata
      const uri = newSigner.getNostrConnectURI({
        name: "Applesauce Example",
      });

      nostrConnectUri$.next(uri);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const operation = { signer: newSigner, controller, timeout: timeoutId, handedOff: false };
      pending$.next(operation);

      try {
        // Wait for signer to connect
        await newSigner.waitForSigner(controller.signal);
        clearTimeout(timeoutId);

        operation.handedOff = true;
        pending$.next(null);
        onSignerCreated(newSigner);
        nostrConnectUri$.next(null);
      } catch (err) {
        console.error("Wait for signer error:", err);
        if (err instanceof Error && err.message === "Aborted") {
          error$.next("Connection timeout. Please try again.");
        } else {
          error$.next(err instanceof Error ? err.message : "Failed to connect");
        }
        nostrConnectUri$.next(null);
      }
    } catch (err) {
      console.error("QR code login error:", err);
      error$.next(err instanceof Error ? err.message : "QR code login failed");
      nostrConnectUri$.next(null);
    } finally {
      isConnecting$.next(false);
    }
  };

  if (nostrConnectUri) {
    return (
      <div className="border border-base-300 bg-base-200 ">
        <div className="p-4 items-center text-center">
          <p className="mb-4">Scan this QR code with your Nostr mobile signer</p>
          <a target="_parent" href={nostrConnectUri}>
            <SignerQRCode data={nostrConnectUri} />
          </a>
          <button
            className="btn btn-outline mt-4"
            onClick={() => {
              pending$.next(null);
              nostrConnectUri$.next(null);
              isConnecting$.next(false);
            }}
          >
            Cancel
          </button>

          {error && (
            <div className="alert alert-error mt-4">
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-base-300 bg-base-200 ">
      <div className="p-4">
        <h2 className="font-semibold mb-4">Login with QR Code</h2>
        <button className="btn btn-accent w-full" onClick={handleQrCodeLogin} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Login with QR Code"}
        </button>

        {error && (
          <div className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const AccountCard = ({ signer, onDisconnect }: { signer: NostrConnectSigner; onDisconnect: () => void }) => {
  const error$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const error = use$(error$);

  const userPubkey$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const userPubkey = use$(userPubkey$);

  const isLoadingPubkey$ = useMemo(() => new BehaviorSubject(false), []);
  const isLoadingPubkey = use$(isLoadingPubkey$);

  // State for the text note component
  const noteText$ = useMemo(() => new BehaviorSubject<string>(""), []);
  const noteText = use$(noteText$);

  const signedEvent$ = useMemo(() => new BehaviorSubject<any>(null), []);
  const signedEvent = use$(signedEvent$);

  const isSigningNote$ = useMemo(() => new BehaviorSubject(false), []);
  const isSigningNote = use$(isSigningNote$);

  const isLoggingOut$ = useMemo(() => new BehaviorSubject(false), []);
  const isLoggingOut = use$(isLoggingOut$);

  const handleGetPubkey = async () => {
    try {
      isLoadingPubkey$.next(true);
      error$.next(null);
      const pubkey = await signer.getPublicKey();
      userPubkey$.next(pubkey);
    } catch (err) {
      // The request was cancelled by disconnecting
      if (err instanceof Error && err.message === "Closed") return;
      console.error("Failed to get pubkey:", err);
      error$.next(err instanceof Error ? err.message : "Failed to get pubkey");
    } finally {
      isLoadingPubkey$.next(false);
    }
  };

  const handleSignNote = async () => {
    if (!noteText.trim()) return;

    try {
      isSigningNote$.next(true);
      error$.next(null);

      // Create and sign a simple text note
      const signedNote = await NoteFactory.create(noteText).sign(signer);

      // Set the signed event to display
      signedEvent$.next(signedNote);
    } catch (err) {
      if (err instanceof Error && err.message === "Closed") return;
      console.error("Failed to sign note:", err);
      error$.next(err instanceof Error ? err.message : "Failed to sign note");
    } finally {
      isSigningNote$.next(false);
    }
  };

  // Close the local connection without telling the remote signer
  const handleDisconnect = () => {
    signer.close();
    onDisconnect();
  };

  // Notify the remote signer to end the session, then close the local connection
  const handleLogout = async () => {
    try {
      isLoggingOut$.next(true);
      error$.next(null);
      // Wait up to 5 seconds for the remote signer to acknowledge
      await signer.logout({ timeout: 5_000 });
    } catch (err) {
      console.error("Failed to logout:", err);
      error$.next(err instanceof Error ? err.message : "Failed to logout");
    } finally {
      isLoggingOut$.next(false);
      onDisconnect();
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-center">Account Information</h1>

      <div className="border border-base-300 bg-base-200  mb-6">
        <div className="p-4">
          <h2 className="font-semibold mb-4">Public Key</h2>
          <div className="flex flex-col gap-2 mb-4">
            <input
              type="text"
              className="input input-bordered w-full font-mono text-sm"
              value={userPubkey || ""}
              readOnly
            />
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={handleGetPubkey}
            disabled={isLoadingPubkey || isLoggingOut}
          >
            {isLoadingPubkey ? "Loading..." : "Fetch Public Key"}
          </button>
        </div>
      </div>

      <div className="border border-base-300 bg-base-200  mb-6">
        <div className="p-4">
          <h2 className="font-semibold mb-4">Create and Sign a Note</h2>
          <div className="flex flex-col gap-2 mb-4">
            <textarea
              className="textarea textarea-bordered w-full h-32"
              placeholder="Type your note here..."
              value={noteText}
              onChange={(e) => noteText$.next(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={handleSignNote}
            disabled={!noteText.trim() || isSigningNote || isLoggingOut}
          >
            {isSigningNote ? "Signing..." : "Sign Note"}
          </button>

          {signedEvent && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Signed Event:</h3>
              <JsonBlock value={signedEvent} />
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-outline flex-1" onClick={handleDisconnect} disabled={isLoggingOut}>
          Disconnect
        </button>
        <button className="btn btn-error btn-outline flex-1" onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut && <span className="loading loading-spinner loading-sm" />}
          {isLoggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>

      {isLoggingOut && (
        <p className="text-sm text-base-content/70 mt-2 text-center">
          Waiting for the remote signer to acknowledge the logout (up to 5 seconds)...
        </p>
      )}

      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default function BunkerLogin() {
  const signer$ = useMemo(() => new BehaviorSubject<NostrConnectSigner | null>(null), []);
  const signer = use$(signer$);

  use$(
    () =>
      new Observable<void>(() => () => {
        void signer?.close();
      }),
    [signer],
  );

  // Handle signer creation
  const handleSignerCreated = (newSigner: NostrConnectSigner) => {
    signer$.next(newSigner);
  };

  // Handle disconnect
  const handleDisconnect = () => {
    signer?.close();
    signer$.next(null);
  };

  if (!signer) {
    return (
      <div className="container mx-auto my-8 px-4 py-8 max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Bunker Login</h1>

        <BunkerUrlLogin onSignerCreated={handleSignerCreated} />
        <QRCodeLogin onSignerCreated={handleSignerCreated} />
      </div>
    );
  }

  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-md">
      <AccountCard signer={signer} onDisconnect={handleDisconnect} />
    </div>
  );
}
