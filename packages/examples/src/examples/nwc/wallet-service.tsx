import { useState, useCallback, useMemo } from "react";
import { WalletService, WalletServiceHandlers } from "applesauce-wallet-connect";
import { RelayPool } from "applesauce-relay";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { nip04, nip44 } from "nostr-tools";
import { WalletMethod } from "applesauce-wallet-connect/helpers";

// Available wallet methods that can be supported
const AVAILABLE_METHODS = [
  "pay_invoice",
  "multi_pay_invoice",
  "pay_keysend",
  "multi_pay_keysend",
  "make_invoice",
  "lookup_invoice",
  "list_transactions",
  "get_balance",
  "get_info",
] as const;

// Default relay list
const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

// Initialize relay pool
const pool = new RelayPool();

// Setup subscription and publish methods
WalletService.subscriptionMethod = pool.subscription.bind(pool);
WalletService.publishMethod = pool.publish.bind(pool);

export default function WalletServiceExample() {
  const [relays, setRelays] = useState<string[]>(DEFAULT_RELAYS);
  const [supportedMethods, setSupportedMethods] = useState<string[]>(["get_balance", "get_info"]);
  const [walletService, setWalletService] = useState<WalletService | null>(null);
  const [balance, setBalance] = useState<number>(100000); // Default balance in sats
  const [serviceInfo, setServiceInfo] = useState<any>(null);
  const [connectionString, setConnectionString] = useState<string>("");
  const [newRelay, setNewRelay] = useState("");

  // Create a simple signer
  const signer = useMemo(() => {
    const secret = generateSecretKey();
    return {
      getPublicKey: async () => getPublicKey(secret),
      signEvent: async (draft: any) => finalizeEvent(draft, secret),
      nip04: {
        encrypt: async (pubkey: string, plaintext: string) => nip04.encrypt(secret, pubkey, plaintext),
        decrypt: async (pubkey: string, ciphertext: string) => nip04.decrypt(secret, pubkey, ciphertext),
      },
      nip44: {
        encrypt: async (pubkey: string, plaintext: string) =>
          nip44.encrypt(plaintext, nip44.getConversationKey(secret, pubkey)),
        decrypt: async (pubkey: string, ciphertext: string) =>
          nip44.decrypt(ciphertext, nip44.getConversationKey(secret, pubkey)),
      },
    };
  }, []);

  // Create wallet service handlers
  const handlers = useMemo(() => {
    const handlers: WalletServiceHandlers = {};

    if (supportedMethods.includes("get_balance")) {
      handlers.get_balance = async () => ({ balance: balance * 1000 }); // Convert to msat
    }

    if (supportedMethods.includes("get_info")) {
      handlers.get_info = async () => ({
        alias: "Example Wallet",
        color: "#3b82f6",
        pubkey: await signer.getPublicKey(),
        network: "mainnet" as const,
        block_height: 800000,
        block_hash: "0000000000000000000000000000000000000000000000000000000000000000",
        methods: supportedMethods as WalletMethod[],
      });
    }

    if (supportedMethods.includes("make_invoice")) {
      handlers.make_invoice = async (params: any) => ({
        type: "incoming" as const,
        state: "pending" as const,
        invoice: "lnbc" + Math.random().toString(36).substring(7),
        description: params.description || "Test invoice",
        description_hash: undefined,
        preimage: undefined,
        payment_hash: Math.random().toString(36).substring(7),
        amount: params.amount,
        fees_paid: 0,
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        metadata: {},
      });
    }

    if (supportedMethods.includes("pay_invoice")) {
      handlers.pay_invoice = async (params: any) => {
        // Simulate payment
        setBalance((prev) => prev - Math.floor(params.amount / 1000)); // Convert from msat to sat
        return {
          preimage: Math.random().toString(36).substring(7),
          payment_hash: Math.random().toString(36).substring(7),
        };
      };
    }

    return handlers;
  }, [supportedMethods, balance, signer]);

  const startWalletService = useCallback(async () => {
    try {
      const service = new WalletService({
        relays,
        signer,
        handlers,
        notifications: [],
      });

      await service.start();
      setWalletService(service);

      // Get connection string
      const connString = service.getConnectionString();
      setConnectionString(connString);

      // Get service info
      const info = {
        pubkey: service.pubkey,
        client: service.client,
        running: service.running,
        relays: service.relays,
      };
      setServiceInfo(info);
    } catch (error) {
      console.error("Failed to start wallet service:", error);
      alert("Failed to start wallet service: " + (error as Error).message);
    }
  }, [relays, signer, handlers]);

  const stopWalletService = useCallback(() => {
    if (walletService) {
      walletService.stop();
      setWalletService(null);
      setServiceInfo(null);
      setConnectionString("");
    }
  }, [walletService]);

  const addRelay = useCallback(() => {
    if (newRelay && !relays.includes(newRelay)) {
      setRelays((prev) => [...prev, newRelay]);
      setNewRelay("");
    }
  }, [newRelay, relays]);

  const removeRelay = useCallback((relay: string) => {
    setRelays((prev) => prev.filter((r) => r !== relay));
  }, []);

  const toggleMethod = useCallback((method: string) => {
    setSupportedMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Wallet Service Example</h1>

      {!walletService ? (
        <div className="space-y-6">
          {/* Relay Configuration */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Relay Configuration</h2>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRelay}
                  onChange={(e) => setNewRelay(e.target.value)}
                  placeholder="wss://relay.example.com"
                  className="flex-1 px-3 py-2 border rounded-md"
                />
                <button onClick={addRelay} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
                  Add Relay
                </button>
              </div>
              <div className="space-y-2">
                {relays.map((relay) => (
                  <div key={relay} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                    <span className="font-mono text-sm">{relay}</span>
                    <button onClick={() => removeRelay(relay)} className="text-red-500 hover:text-red-700">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Supported Methods Configuration */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Supported Methods</h2>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_METHODS.map((method) => (
                <label key={method} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={supportedMethods.includes(method)}
                    onChange={() => toggleMethod(method)}
                    className="rounded"
                  />
                  <span className="text-sm font-mono">{method}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={startWalletService}
            className="w-full py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600"
          >
            Start Wallet Service
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Service Info */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h2 className="text-xl font-semibold text-green-800 mb-2">Service Running</h2>
            <p className="text-green-700">Wallet service is active and listening for requests</p>
          </div>

          {/* Connection String and QR Code */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Connection Details</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-medium mb-2">QR Code</h3>
                <div className="flex justify-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(connectionString)}`}
                    alt="Connection QR Code"
                    className="rounded"
                  />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-medium mb-2">Connection String</h3>
                <div className="bg-gray-100 p-3 rounded text-sm font-mono break-all">{connectionString}</div>
                <button
                  onClick={() => navigator.clipboard.writeText(connectionString)}
                  className="mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                >
                  Copy to Clipboard
                </button>
              </div>
            </div>
          </div>

          {/* Balance Card - Center of page */}
          <div className="flex justify-center">
            <div className="bg-white rounded-lg shadow-lg p-8 min-w-96">
              <h2 className="text-2xl font-semibold text-center mb-6">Wallet Balance</h2>
              <div className="text-center">
                <div className="text-4xl font-bold text-blue-600 mb-6">{balance.toLocaleString()} sats</div>
                <div className="space-y-2">
                  <button
                    onClick={() => setBalance((prev) => prev + 10000)}
                    className="w-full py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                  >
                    Add 10k sats
                  </button>
                  <button
                    onClick={() => setBalance((prev) => Math.max(0, prev - 10000))}
                    className="w-full py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                  >
                    Remove 10k sats
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Service Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Service Information</h2>
            <code className="text-sm whitespace-pre font-mono">{JSON.stringify(serviceInfo, null, 2)}</code>
          </div>

          {/* Stop Button */}
          <button
            onClick={stopWalletService}
            className="w-full py-3 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600"
          >
            Stop Service & Reset
          </button>
        </div>
      )}
    </div>
  );
}
