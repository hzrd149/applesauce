/**
 * Create a Nostr Connect provider that allows remote signers to authenticate and sign events
 * @tags nip-46, signers, bunker, provider, nostr-connect
 * @related signers/bunker, cli/bunker-login
 */
import { use$ } from "applesauce-react/hooks";
import { BehaviorSubject, Observable } from "rxjs";

import { bytesToHex } from "@noble/hashes/utils.js";
import { RelayPool } from "applesauce-relay";
import { ExtensionMissingError, ExtensionSigner, NostrConnectProvider, PrivateKeySigner } from "applesauce-signers";
import { nanoid } from "nanoid";
import { useCallback, useRef, useMemo } from "react";
import QRCode from "../../components/qr-code";
import RelayPicker from "../../components/relay-picker";

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Setup nostr connect provider static methods
NostrConnectProvider.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectProvider.publishMethod = pool.publish.bind(pool);

const ProviderQRCode = ({ data }: { data: string }) => (
  <div className="flex items-center justify-center p-4 bg-white rounded-lg">
    <QRCode value={data} size={192} className="h-48 w-48" alt="Nostr Connect QR code" />
  </div>
);

// Log entry interface
interface LogEntry {
  id: string;
  timestamp: Date;
  type: "info" | "request" | "response" | "error" | "connect" | "disconnect";
  message: string;
  details?: any;
}

// Component for signer selection
const SignerSelector = ({
  selectedSigner,
  onSignerChange,
  onGenerateKey,
}: {
  selectedSigner: "extension" | "generated";
  onSignerChange: (signer: "extension" | "generated") => void;
  onGenerateKey: () => void;
}) => {
  const extensionAvailable = !!window.nostr;

  return (
    <div className="flex flex-col gap-2 w-full">
      <label className="label">
        <span className="label-text">Select Signer</span>
      </label>
      <div className="flex gap-2">
        <button
          className={`btn ${selectedSigner === "extension" ? "btn-primary" : "btn-outline"}`}
          onClick={() => onSignerChange("extension")}
          disabled={!extensionAvailable}
        >
          Browser Extension
        </button>
        <button
          className={`btn ${selectedSigner === "generated" ? "btn-primary" : "btn-outline"}`}
          onClick={() => onSignerChange("generated")}
        >
          Generate New Key
        </button>
      </div>
      {selectedSigner === "generated" && (
        <button className="btn btn-sm btn-secondary mt-2" onClick={onGenerateKey}>
          Generate New Key
        </button>
      )}
      {!extensionAvailable && (
        <div className="alert alert-warning mt-2">
          <span>Nostr extension not detected. Install a browser extension like nos2x or Alby.</span>
        </div>
      )}
    </div>
  );
};

// Component for starting provider with nostrconnect:// URI
const NostrConnectURISection = ({ onStartProvider }: { onStartProvider: (uri: string) => void }) => {
  const uri$ = useMemo(() => new BehaviorSubject(""), []);
  const uri = use$(uri$);

  const parsedUri$ = useMemo(() => new BehaviorSubject<any>(null), []);
  const parsedUri = use$(parsedUri$);

  const error$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const error = use$(error$);

  const parseURI = () => {
    try {
      if (!uri.startsWith("nostrconnect://")) {
        throw new Error("Invalid nostrconnect:// URI");
      }

      const url = new URL(uri);
      const metadata = {
        name: url.searchParams.get("name") || "Unknown App",
        url: url.searchParams.get("url") || "",
        description: url.searchParams.get("description") || "",
        icons: url.searchParams.get("icons") ? url.searchParams.get("icons")!.split(",") : [],
        permissions: url.searchParams.get("permissions") ? url.searchParams.get("permissions")!.split(",") : [],
      };

      parsedUri$.next({
        client: url.hostname,
        secret: url.searchParams.get("secret") || "",
        metadata,
      });
      error$.next(null);
    } catch (err) {
      error$.next(err instanceof Error ? err.message : "Failed to parse URI");
      parsedUri$.next(null);
    }
  };

  const handleStart = () => {
    if (parsedUri) {
      onStartProvider(uri);
    }
  };

  return (
    <div className="border border-base-300 bg-base-200 ">
      <div className="p-4">
        <h3 className="font-semibold">Start with nostrconnect:// URI</h3>
        <div className="flex flex-col gap-2">
          <label className="label">
            <span className="label-text">Paste nostrconnect:// URI</span>
          </label>
          <input
            type="text"
            placeholder="nostrconnect://..."
            className="input input-bordered w-full"
            value={uri}
            onChange={(e) => uri$.next(e.target.value)}
          />
        </div>
        <button className="btn btn-primary mt-2" onClick={parseURI} disabled={!uri.trim()}>
          Parse URI
        </button>

        {parsedUri && (
          <div className="mt-4">
            <h4 className="font-semibold mb-2">Parsed URI:</h4>
            <div className="bg-base-100 p-3 rounded-lg">
              <p>
                <strong>Client:</strong> {parsedUri.client}
              </p>
              <p>
                <strong>App Name:</strong> {parsedUri.metadata.name}
              </p>
              {parsedUri.metadata.description && (
                <p>
                  <strong>Description:</strong> {parsedUri.metadata.description}
                </p>
              )}
              {parsedUri.metadata.permissions.length > 0 && (
                <p>
                  <strong>Permissions:</strong> {parsedUri.metadata.permissions.join(", ")}
                </p>
              )}
            </div>
            <button className="btn btn-success w-full mt-3" onClick={handleStart}>
              Start Provider
            </button>
          </div>
        )}

        {error && (
          <div className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Component for starting provider with bunker:// URI
const BunkerURISection = ({
  onStartProvider,
  bunkerUri,
  showQR,
}: {
  onStartProvider: () => void;
  bunkerUri: string;
  showQR: boolean;
}) => {
  const generateBunkerURI = async () => {
    // This will be called when the provider is started
    onStartProvider();
  };

  return (
    <div className="border border-base-300 bg-base-200 ">
      <div className="p-4">
        <h3 className="font-semibold">Start and Wait for Client</h3>
        <p className="text-sm opacity-70 mb-4">
          Start the provider and wait for a client to connect. The bunker:// URI will be displayed as a QR code.
        </p>

        <button className="btn btn-accent w-full" onClick={generateBunkerURI}>
          Start Provider & Show Bunker URI
        </button>

        {showQR && bunkerUri && (
          <div className="mt-4 text-center">
            <h4 className="font-semibold mb-2">Bunker URI:</h4>
            <div className="bg-base-100 p-3 rounded-lg mb-3">
              <code className="text-sm break-all select-all">{bunkerUri}</code>
            </div>
            <ProviderQRCode data={bunkerUri} />
          </div>
        )}
      </div>
    </div>
  );
};

// Main component
export default function BunkerProvider() {
  const selectedRelay$ = useMemo(() => new BehaviorSubject("wss://bucket.coracle.social/"), []);
  const selectedRelay = use$(selectedRelay$);

  const selectedSigner$ = useMemo(() => new BehaviorSubject<"extension" | "generated">("extension"), []);
  const selectedSigner = use$(selectedSigner$);

  const generatedKey$ = useMemo(() => new BehaviorSubject<PrivateKeySigner | null>(null), []);
  const generatedKey = use$(generatedKey$);

  const provider$ = useMemo(() => new BehaviorSubject<NostrConnectProvider | null>(null), []);
  const provider = use$(provider$);

  const logs$ = useMemo(() => new BehaviorSubject<LogEntry[]>([]), []);
  const logs = use$(logs$);

  const bunkerUri$ = useMemo(() => new BehaviorSubject<string>(""), []);
  const bunkerUri = use$(bunkerUri$);

  const showBunkerURI$ = useMemo(() => new BehaviorSubject(false), []);
  const showBunkerURI = use$(showBunkerURI$);

  const isProviderRunning$ = useMemo(() => new BehaviorSubject(false), []);
  const isProviderRunning = use$(isProviderRunning$);

  const logsEndRef = useRef<HTMLDivElement>(null);
  use$(
    () =>
      new Observable<void>(() => () => {
        void provider?.stop();
      }),
    [provider],
  );

  // Auto-scroll to bottom of logs
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Add log entry
  const addLog = useCallback((type: LogEntry["type"], message: string, details?: any) => {
    const entry: LogEntry = {
      id: nanoid(),
      timestamp: new Date(),
      type,
      message,
      details,
    };
    logs$.next(((prev: typeof logs$.value) => [...prev, entry])(logs$.value));
    setTimeout(scrollToBottom, 100);
  }, []);

  // Generate new key
  const handleGenerateKey = useCallback(async () => {
    const signer = new PrivateKeySigner();
    generatedKey$.next(signer);
    const pubkey = await signer.getPublicKey();
    addLog("info", "Generated new key", { pubkey: pubkey, nsec: bytesToHex(signer.key) });
  }, [addLog]);

  // Create signer instance
  const createSigner = useCallback(async () => {
    try {
      if (selectedSigner === "extension") {
        const signer = new ExtensionSigner();
        await signer.getPublicKey(); // Test if extension works
        addLog("info", "Using browser extension signer");
        return signer;
      } else {
        const signer = generatedKey || new PrivateKeySigner();
        if (!generatedKey) {
          generatedKey$.next(signer);
        }
        const pubkey = await signer.getPublicKey();
        addLog("info", "Using generated key signer", { pubkey });
        return signer;
      }
    } catch (error) {
      if (error instanceof ExtensionMissingError) {
        addLog("error", "Browser extension not available");
        throw error;
      }
      addLog("error", "Failed to create signer", { error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  }, [selectedSigner, generatedKey, addLog]);

  // Start provider with nostrconnect:// URI
  const handleStartWithURI = useCallback(
    async (uri: string) => {
      try {
        addLog("info", "Starting provider with nostrconnect:// URI", { uri });

        const signer = await createSigner();

        const newProvider = new NostrConnectProvider({
          relays: [selectedRelay],
          upstream: signer,
          onClientConnect: (client) => {
            showBunkerURI$.next(false);
            addLog("connect", "Client connected", { client });
          },
          onClientDisconnect: (client) => {
            addLog("disconnect", "Client disconnected", { client });
          },
          onLogout: (client) => {
            addLog("disconnect", "Client logged out, session ended", { client });
          },
          onConnect: (client, permissions) => {
            addLog("request", "Connect request received", { client, permissions });
            return true; // Always accept connections
          },
          onSignEvent: (draft, _client) => {
            addLog("request", "Sign event request received", draft);
            return true; // Always allow signing
          },
          onNip04Encrypt: (pubkey, plaintext, _client) => {
            addLog("request", "NIP-04 encrypt request received", { targetPubkey: pubkey, plaintext });
            return true; // Always allow encryption
          },
          onNip04Decrypt: (pubkey, _ciphertext, _client) => {
            addLog("request", "NIP-04 decrypt request received", { targetPubkey: pubkey });
            return true; // Always allow decryption
          },
          onNip44Encrypt: (pubkey, plaintext, _client) => {
            addLog("request", "NIP-44 encrypt request received", { targetPubkey: pubkey, plaintext });
            return true; // Always allow encryption
          },
          onNip44Decrypt: (pubkey, _ciphertext, _client) => {
            addLog("request", "NIP-44 decrypt request received", { targetPubkey: pubkey });
            return true; // Always allow decryption
          },
        });

        await newProvider.start(uri);

        provider$.next(newProvider);
        isProviderRunning$.next(true);
        addLog("info", "Provider started successfully with URI");
      } catch (error) {
        addLog("error", "Failed to start provider with URI", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [selectedRelay, selectedSigner, generatedKey, addLog, createSigner],
  );

  // Start provider and wait for client
  const handleStartAndWait = useCallback(async () => {
    try {
      addLog("info", "Starting provider and waiting for client connection");

      const signer = await createSigner();

      const newProvider = new NostrConnectProvider({
        relays: [selectedRelay],
        upstream: signer,
        // Use a different signer for the provider identity
        signer: new PrivateKeySigner(),
        bunkerSecret: nanoid(16), // Generate random secret clients must present to connect
        onClientConnect: (client) => {
          showBunkerURI$.next(false);
          addLog("connect", "Client connected", { client });
        },
        onClientDisconnect: (client) => {
          addLog("disconnect", "Client disconnected", { client });
        },
        onLogout: (client) => {
          addLog("disconnect", "Client logged out, session ended", { client });
        },
        onConnect: (client, permissions) => {
          addLog("request", "Connect request received", { client, permissions });
          return true; // Always accept connections
        },
        onSignEvent: (draft, _client) => {
          addLog("request", "Sign event request received", draft);
          return true; // Always allow signing
        },
        onNip04Encrypt: (pubkey, plaintext, _client) => {
          addLog("request", "NIP-04 encrypt request received", { targetPubkey: pubkey, plaintext });
          return true; // Always allow encryption
        },
        onNip04Decrypt: (pubkey, _ciphertext, _client) => {
          addLog("request", "NIP-04 decrypt request received", { targetPubkey: pubkey });
          return true; // Always allow decryption
        },
        onNip44Encrypt: (pubkey, plaintext, _client) => {
          addLog("request", "NIP-44 encrypt request received", { targetPubkey: pubkey, plaintext });
          return true; // Always allow encryption
        },
        onNip44Decrypt: (pubkey, _ciphertext, _client) => {
          addLog("request", "NIP-44 decrypt request received", { targetPubkey: pubkey });
          return true; // Always allow decryption
        },
      });

      await newProvider.start();

      // Get bunker URI
      const uri = await newProvider.getBunkerURI();
      bunkerUri$.next(uri);

      provider$.next(newProvider);
      isProviderRunning$.next(true);
      showBunkerURI$.next(true);
      addLog("info", "Provider started successfully, waiting for client", { bunkerUri: uri });
    } catch (error) {
      addLog("error", "Failed to start provider", { error: error instanceof Error ? error.message : "Unknown error" });
    }
  }, [selectedRelay, selectedSigner, generatedKey, addLog, createSigner]);

  // Stop provider
  const handleStopProvider = useCallback(async () => {
    if (provider) {
      try {
        await provider.stop();
        provider$.next(null);
        isProviderRunning$.next(false);
        bunkerUri$.next("");
        showBunkerURI$.next(false);
        addLog("info", "Provider stopped");
      } catch (error) {
        addLog("error", "Failed to stop provider", { error: error instanceof Error ? error.message : "Unknown error" });
      }
    }
  }, [provider, addLog]);

  // Clear logs
  const clearLogs = useCallback(() => {
    logs$.next([]);
  }, []);

  return (
    <div className="container mx-auto my-8 px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-8 text-center">Nostr Connect Provider Example</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Configuration */}
        <div className="space-y-6">
          <div className="border border-base-300 bg-base-100 ">
            <div className="p-4">
              <h2 className="font-semibold">Configuration</h2>

              <RelayPicker
                value={selectedRelay}
                onChange={(next: typeof selectedRelay$.value) => selectedRelay$.next(next)}
                common={["wss://relay.nsec.app/", "wss://bucket.coracle.social/"]}
              />

              <div className="divider"></div>

              <SignerSelector
                selectedSigner={selectedSigner}
                onSignerChange={(next: typeof selectedSigner$.value) => selectedSigner$.next(next)}
                onGenerateKey={handleGenerateKey}
              />
            </div>
          </div>

          <NostrConnectURISection onStartProvider={handleStartWithURI} />
          <BunkerURISection onStartProvider={handleStartAndWait} bunkerUri={bunkerUri} showQR={showBunkerURI} />

          {isProviderRunning && (
            <div className="border border-base-300 bg-base-100 ">
              <div className="p-4">
                <h3 className="font-semibold">Provider Controls</h3>
                <button className="btn btn-error w-full" onClick={handleStopProvider}>
                  Stop Provider
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Center Column - Logs */}
        <div className="lg:col-span-2">
          <div className="border border-base-300 bg-base-100  h-full">
            <div className="p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold">Provider Logs</h2>
                <button className="btn btn-sm btn-outline" onClick={clearLogs}>
                  Clear Logs
                </button>
              </div>

              <div className="bg-base-200 rounded-lg p-4 h-full overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-center text-base-content/50 py-8">
                    No logs yet. Start a provider to see activity.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((entry) => (
                      <div
                        key={entry.id}
                        className={`p-3 rounded-lg ${
                          entry.type === "error"
                            ? "bg-error/20"
                            : entry.type === "connect"
                              ? "bg-success/20"
                              : entry.type === "disconnect"
                                ? "bg-warning/20"
                                : entry.type === "request"
                                  ? "bg-info/20"
                                  : "bg-base-100"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`badge badge ${
                              entry.type === "error"
                                ? "badge-error"
                                : entry.type === "connect"
                                  ? "badge-success"
                                  : entry.type === "disconnect"
                                    ? "badge-warning"
                                    : entry.type === "request"
                                      ? "badge-info"
                                      : "badge-neutral"
                            }`}
                          >
                            {entry.type}
                          </span>
                          <span className="flex-1">{entry.message}</span>
                          <span className="text-sm opacity-70 ms-auto">{entry.timestamp.toLocaleTimeString()}</span>
                        </div>
                        {entry.details && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm opacity-70">View Details</summary>
                            <pre className="mt-2 text-sm bg-base-300 p-2 rounded overflow-x-auto">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
