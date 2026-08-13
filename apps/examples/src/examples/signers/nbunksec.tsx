/**
 * Create and restore nbunksec sessions with an immediate Nostr Connect QR login flow
 * @tags nip-46, signers, nbunksec, bunker, nostr-connect
 * @related signers/bunker, signers/bunker-provider
 */
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { FormEvent, useEffect, useRef, useState } from "react";
import QRCode from "../../components/qr-code";

const DEFAULT_RELAY = "wss://bucket.coracle.social";
const pool = new RelayPool();

type QrSession = {
  signer: NostrConnectSigner;
  uri: string;
};

type ConnectedSession = {
  signer: NostrConnectSigner;
  pubkey: string;
  nbunksec: string;
};

function createQrSession(relay: string): QrSession {
  const signer = new NostrConnectSigner({ pool, relays: [relay] });
  const uri = signer.getNostrConnectURI({ name: "Applesauce nbunksec Example" });

  return { signer, uri };
}

function validateRelay(value: string) {
  const relay = new URL(value);
  if (relay.protocol !== "wss:" && relay.protocol !== "ws:") throw new Error("Relay must use ws:// or wss://");
  return relay.toString();
}

export default function NbunksecExample() {
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [relayInput, setRelayInput] = useState(DEFAULT_RELAY);
  const [qrSession, setQrSession] = useState(() => createQrSession(DEFAULT_RELAY));
  const [credential, setCredential] = useState("");
  const [connected, setConnected] = useState<ConnectedSession>();
  const [connectingCredential, setConnectingCredential] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const activeSigner = useRef<NostrConnectSigner | null>(qrSession.signer);

  useEffect(
    () => () => {
      void activeSigner.current?.close();
    },
    [],
  );

  useEffect(() => {
    const signer = qrSession.signer;
    let cancelled = false;

    const waitForSigner = async () => {
      try {
        await signer.waitForSigner();
        const pubkey = await signer.getPublicKey();
        if (cancelled || activeSigner.current !== signer) return;

        setConnected({ signer, pubkey, nbunksec: signer.getNbunksec() });
        setError(undefined);
      } catch (err) {
        if (cancelled || activeSigner.current !== signer) return;
        if (err instanceof Error && err.message !== "Closed") setError(err.message);
      }
    };

    void waitForSigner();

    return () => {
      cancelled = true;
      void signer.close();
    };
  }, [qrSession]);

  const replaceQrSession = (nextRelay: string) => {
    const nextSession = createQrSession(nextRelay);
    const previousSigner = activeSigner.current;

    activeSigner.current = nextSession.signer;
    setConnected(undefined);
    setCopied(false);
    setError(undefined);
    setQrSession(nextSession);
    void previousSigner?.close();
  };

  const handleRelaySubmit = (event: FormEvent) => {
    event.preventDefault();

    try {
      const nextRelay = validateRelay(relayInput.trim());
      setRelay(nextRelay);
      setRelayInput(nextRelay);
      replaceQrSession(nextRelay);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid relay URL");
    }
  };

  const handleCredentialSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = credential.trim();
    if (!value) return;

    const pendingQrSigner = activeSigner.current;
    activeSigner.current = null;
    void pendingQrSigner?.close();

    try {
      setConnectingCredential(true);
      setError(undefined);

      let signer: NostrConnectSigner;
      if (value.startsWith("bunker://")) signer = await NostrConnectSigner.fromBunkerURI(value, { pool });
      else if (value.startsWith("nbunksec1")) signer = await NostrConnectSigner.fromNbunksec(value, { pool });
      else throw new Error("Paste a bunker:// URI or nbunksec1 credential");

      activeSigner.current = signer;
      const pubkey = await signer.getPublicKey();
      setConnected({ signer, pubkey, nbunksec: signer.getNbunksec() });
      setCredential("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to remote signer");
      replaceQrSession(relay);
    } finally {
      setConnectingCredential(false);
    }
  };

  const handleCopy = async () => {
    if (!connected) return;

    try {
      await navigator.clipboard.writeText(connected.nbunksec);
      setCopied(true);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy nbunksec");
    }
  };

  const handleStartOver = () => {
    void connected?.signer.close();
    replaceQrSession(relay);
  };

  const handleLogout = async () => {
    if (!connected) return;

    setLoggingOut(true);
    setError(undefined);
    await connected.signer.logout();
    replaceQrSession(relay);
    setLoggingOut(false);
  };

  if (connected) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-2xl items-center px-4 py-10">
        <div className="w-full border border-base-300 bg-base-100 p-5 sm:p-8">
          <div className="mb-8 border-l-4 border-success pl-4">
            <p className="text-sm font-medium uppercase tracking-wide text-success">Remote signer connected</p>
            <h1 className="mt-1 text-3xl font-semibold">Session ready</h1>
          </div>

          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="connected-pubkey">
                Public key
              </label>
              <textarea
                id="connected-pubkey"
                className="textarea textarea-bordered h-20 w-full resize-none select-all font-mono text-xs"
                value={connected.pubkey}
                readOnly
              />
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <label className="text-sm font-medium" htmlFor="connected-nbunksec">
                  Restorable nbunksec session
                </label>
                <span className="text-xs text-warning">Treat this like a private key</span>
              </div>
              <textarea
                id="connected-nbunksec"
                className="textarea textarea-bordered h-32 w-full resize-none select-all font-mono text-xs"
                value={connected.nbunksec}
                readOnly
              />
              <p className="mt-2 text-sm text-base-content/65">
                Copy this value, reload the page, and paste it below the QR code to restore this exact client session.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className={`btn sm:col-span-2 ${copied ? "btn-success" : "btn-primary"}`}
                onClick={handleCopy}
                disabled={loggingOut}
              >
                {copied ? "Copied nbunksec" : "Copy nbunksec"}
              </button>
              <button className="btn btn-outline" onClick={handleStartOver} disabled={loggingOut}>
                Disconnect
              </button>
              <button className="btn btn-error btn-outline" onClick={handleLogout} disabled={loggingOut}>
                {loggingOut ? <span className="loading loading-spinner loading-sm" /> : null}
                {loggingOut ? "Logging out..." : "Logout session"}
              </button>
            </div>

            <p className="text-sm text-base-content/65">
              Disconnect keeps the session available for nbunksec restoration. Logout asks the remote signer to remove
              it.
            </p>

            {error ? (
              <div className="border-l-4 border-error bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid min-h-full w-full max-w-4xl items-center gap-8 px-4 py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <section>
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-primary">NIP-46 remote signer</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Scan to connect</h1>
        <p className="mt-3 max-w-xl text-base-content/70">
          This page is already waiting for your signer. Scan the QR code or open it on this device to approve the
          connection.
        </p>

        <div className="mt-6 inline-block border border-base-300 bg-white p-3">
          <QRCode
            value={qrSession.uri}
            href={qrSession.uri}
            title="Open Nostr Connect URI"
            size={256}
            className="h-64 w-64"
            alt="Nostr Connect login QR code"
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-base-content/65">
          <span className="loading loading-dots loading-sm" />
          Waiting for remote signer
        </div>
      </section>

      <section className="space-y-7 border-t border-base-300 pt-7 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <form onSubmit={handleRelaySubmit}>
          <label className="mb-2 block text-sm font-medium" htmlFor="signer-relay">
            Signer relay
          </label>
          <div className="join w-full">
            <input
              id="signer-relay"
              type="url"
              className="input input-bordered join-item min-w-0 flex-1"
              value={relayInput}
              onChange={(event) => setRelayInput(event.target.value)}
              placeholder="wss://relay.example.com"
            />
            <button className="btn btn-outline join-item" disabled={relayInput.trim() === relay}>
              Update
            </button>
          </div>
          <p className="mt-2 text-xs text-base-content/60">Updating the relay creates a fresh QR session.</p>
        </form>

        <div className="divider text-xs uppercase tracking-wider text-base-content/50">or restore a session</div>

        <form onSubmit={handleCredentialSubmit}>
          <label className="mb-2 block text-sm font-medium" htmlFor="remote-signer-credential">
            Bunker URI or nbunksec
          </label>
          <textarea
            id="remote-signer-credential"
            className="textarea textarea-bordered h-28 w-full font-mono text-xs"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="bunker://... or nbunksec1..."
          />
          <button className="btn btn-secondary mt-3 w-full" disabled={!credential.trim() || connectingCredential}>
            {connectingCredential ? <span className="loading loading-spinner loading-sm" /> : null}
            {connectingCredential ? "Connecting..." : "Connect credential"}
          </button>
        </form>

        {error ? <div className="border-l-4 border-error bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
      </section>
    </main>
  );
}
