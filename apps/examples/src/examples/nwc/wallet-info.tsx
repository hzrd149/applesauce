/**
 * Display wallet information including balance, capabilities, and connection status
 * @tags nip-47, nwc, wallet, info
 * @related nwc/simple-wallet, nwc/transactions
 */
import { Subject, switchMap, defer, map, startWith, catchError, of } from "rxjs";

import { hexToBytes } from "@noble/hashes/utils.js";
import { use$ } from "applesauce-react/hooks";
import type { NostrEvent } from "applesauce-core/helpers";
import { RelayPool } from "applesauce-relay";
import { WalletConnect } from "applesauce-wallet-connect";
import {
  getPreferredEncryption,
  parseWalletConnectURI,
  supportsMethod,
  WalletInfo,
} from "applesauce-wallet-connect/helpers";
import { useMemo, useState } from "react";

// Create a relay pool to make relay connections
const pool = new RelayPool();

/** Publishes an event and throws unless at least one relay accepts it */
async function publish(relays: string[], event: NostrEvent) {
  const responses = await pool.publish(relays, event);
  if (!responses.some((r) => r.ok)) throw new Error("No relay accepted the event");
  return responses;
}

function WalletInfoDisplay({ walletInfo }: { walletInfo: WalletInfo }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Wallet Information</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Basic Info */}
        <div className="border border-base-300  bg-base-200">
          <div className="p-4">
            <h3 className="font-semibold">Basic Information</h3>
            <div className="space-y-2">
              <div>
                <span className="font-medium">Alias:</span>
                <span className="ml-2">{walletInfo.alias}</span>
              </div>
              <div>
                <span className="font-medium">Network:</span>
                <span
                  className={`ml-2 badge ${
                    walletInfo.network === "mainnet"
                      ? "badge-success"
                      : walletInfo.network === "testnet"
                        ? "badge-warning"
                        : "badge-info"
                  }`}
                >
                  {walletInfo.network}
                </span>
              </div>
              <div>
                <span className="font-medium">Color:</span>
                <div className="flex items-center ml-2">
                  <div className="w-4 h-4 rounded mr-2 border" style={{ backgroundColor: walletInfo.color }}></div>
                  <code className="text-sm">{walletInfo.color}</code>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Node Info */}
        <div className="border border-base-300  bg-base-200">
          <div className="p-4">
            <h3 className="font-semibold">Node Information</h3>
            <div className="space-y-2">
              <div>
                <span className="font-medium">Public Key:</span>
                <code className="ml-2 text-sm break-all">{walletInfo.pubkey}</code>
              </div>
              <div>
                <span className="font-medium">Block Height:</span>
                <span className="ml-2 badge badge-outline">{walletInfo.block_height?.toLocaleString()}</span>
              </div>
              <div>
                <span className="font-medium">Block Hash:</span>
                <code className="ml-2 text-sm break-all">{walletInfo.block_hash}</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Supported Methods */}
      <div className="border border-base-300  bg-base-200">
        <div className="p-4">
          <h3 className="font-semibold">Supported Methods</h3>
          <div className="flex flex-wrap gap-2 mt-2">
            {walletInfo.methods.map((method) => (
              <span key={method} className="badge badge-primary">
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Notifications */}
      {walletInfo.notifications && walletInfo.notifications.length > 0 && (
        <div className="border border-base-300  bg-base-200">
          <div className="p-4">
            <h3 className="font-semibold">Supported Notifications</h3>
            <div className="flex flex-wrap gap-2 mt-2">
              {walletInfo.notifications.map((notification) => (
                <span key={notification} className="badge badge-secondary">
                  {notification}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Raw wallet info */}
      <div className="border border-base-300  bg-base-200">
        <div className="p-4">
          <h3 className="font-semibold">Raw Wallet Info</h3>
          <pre className="text-sm">{JSON.stringify(walletInfo, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

export default function WalletInfoExample() {
  const [uri, setUri] = useState("");

  const parseResult = useMemo(() => {
    if (!uri.trim()) return { parsed: null, error: null };
    try {
      return { parsed: parseWalletConnectURI(uri), error: null };
    } catch (error) {
      return { parsed: null, error: String(error) };
    }
  }, [uri]);
  const parsed = parseResult.parsed;
  const handleUriChange = (value: string) => setUri(value);
  // Create WalletConnect instance
  const wallet = useMemo(() => {
    if (!parsed) return undefined;

    try {
      const secret = hexToBytes(parsed.secret);
      const walletConnect = new WalletConnect({
        ...parsed,
        secret,
        subscriptionMethod: pool.subscription.bind(pool),
        publishMethod: publish,
      });

      return walletConnect;
    } catch (err) {
      console.error("Failed to create wallet connection:", err);
      return undefined;
    }
  }, [parsed]);

  // Get wallet capabilities to check if get_info is supported
  const support = use$(() => wallet?.support$, [wallet]);

  const fetch$ = useMemo(() => new Subject<void>(), []);
  const result = use$(
    () =>
      fetch$.pipe(
        switchMap(() => {
          if (!wallet || !support || !supportsMethod(support, "get_info"))
            return of({ info: null, loading: false, error: "get_info is unavailable" });
          return defer(() => wallet.getInfo()).pipe(
            map((info) => ({ info, loading: false, error: null as string | null })),
            startWith({ info: null, loading: true, error: null }),
            catchError((error) => of({ info: null, loading: false, error: String(error) })),
          );
        }),
      ),
    [wallet, support, fetch$],
  );
  const walletInfo = result?.info;
  const loading = result?.loading ?? false;
  const error = parseResult.error || result?.error;
  const methodError = support && !supportsMethod(support, "get_info") ? "get_info is unsupported" : null;
  const fetchWalletInfo = () => fetch$.next();

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Wallet Info</h1>
        <p className="mb-4 opacity-70">
          Enter a nostr+walletconnect URI to connect to a wallet and fetch its information using the get_info method.
        </p>

        {/* URI Input */}
        <div className="mb-8">
          <label className="label">
            <span className="label-text">Wallet Connect URI</span>
          </label>
          <textarea
            value={uri}
            onChange={(e) => handleUriChange(e.target.value)}
            placeholder="nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=secretkey"
            className="textarea textarea-bordered w-full"
            rows={3}
          />
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </div>

        {/* Connection Status and Actions */}
        {parsed && (
          <div className="mb-8">
            <div className="border border-base-300  bg-base-200">
              <div className="p-4">
                <h3 className="font-semibold">Connection Details</h3>
                <div className="space-y-2">
                  <div>
                    <span className="font-medium">Service:</span>
                    <code className="ml-2 text-sm">{parsed.service}</code>
                  </div>
                  <div>
                    <span className="font-medium">Relays:</span>
                    <div className="ml-2">
                      {parsed.relays.map((relay, index) => (
                        <div key={index}>
                          <code className="text-sm">{relay}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                  {support && (
                    <div>
                      <span className="font-medium">Encryption:</span>
                      <code className="ml-2 text-sm">{getPreferredEncryption(support)}</code>
                    </div>
                  )}
                </div>

                {/* Wallet Capabilities Status */}
                {support === undefined ? (
                  <div className="alert alert-info mt-4">
                    <div className="flex items-center">
                      <span className="loading loading-spinner loading-sm mr-3"></span>
                      <p>Loading wallet capabilities...</p>
                    </div>
                  </div>
                ) : support === null ? (
                  <div className="alert alert-warning mt-4">
                    <p>No wallet capabilities found or wallet is offline.</p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <button onClick={fetchWalletInfo} disabled={loading} className="btn btn-primary">
                      {loading ? (
                        <>
                          <span className="loading loading-spinner loading-sm mr-2"></span>
                          Fetching...
                        </>
                      ) : (
                        "Fetch Wallet Info"
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Method Not Supported Warning */}
        {methodError && (
          <div className="alert alert-warning mb-8">
            <div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="stroke-current shrink-0 h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.996-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div>
                <h3 className="font-bold">Method Not Supported</h3>
                <div className="text-sm">{methodError}</div>
              </div>
            </div>
          </div>
        )}

        {/* Wallet Info Display */}
        {walletInfo && <WalletInfoDisplay walletInfo={walletInfo} />}
      </div>
    </div>
  );
}
