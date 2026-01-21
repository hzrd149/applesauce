import type { IAccount } from "applesauce-accounts";
import { ExtensionAccount, NostrConnectAccount, PrivateKeyAccount } from "applesauce-accounts/accounts";
import { castUser } from "applesauce-common/casts/user";
import { use$ } from "applesauce-react/hooks";
import { NostrConnectSigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { accounts } from "../services/accounts";
import { eventStore } from "../services/event-store";
import { UserAvatar, UserName } from "../components";

// Simple QR code component
const QRCode = ({ data }: { data: string }) => (
  <div className="flex items-center justify-center p-4 bg-white rounded-lg">
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`}
      alt="QR Code"
      className="w-48 h-48"
    />
  </div>
);

// Account Item Component for Existing Accounts
function AccountItem({
  account,
  onLogin,
  onRemove,
}: {
  account: IAccount;
  onLogin: () => void;
  onRemove: () => void;
}) {
  const user = useMemo(() => castUser(account.pubkey, eventStore), [account.pubkey]);

  return (
    <div className="card bg-base-100 shadow-md mb-3">
      <div className="card-body p-4">
        <div className="flex items-center gap-4">
          <UserAvatar user={user} size="md" />
          <div className="flex-1">
            <h3 className="font-semibold">
              <UserName user={user} fallback={account.pubkey.slice(0, 12) + "..."} />
            </h3>
            <p className="text-sm opacity-70 font-mono">{account.pubkey.slice(0, 16) + "..."}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={onLogin}>
              Login
            </button>
            <button className="btn btn-error btn-sm" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Existing Accounts Section Component
function ExistingAccountsSection({
  onLoginSuccess,
  onBack,
}: {
  onLoginSuccess?: () => void;
  onBack: () => void;
}) {
  const allAccounts = use$(accounts.accounts$);

  const handleLogin = (accountId: string) => {
    accounts.setActive(accountId);
    if (onLoginSuccess) {
      onLoginSuccess();
    } else {
      onBack();
    }
  };

  const handleRemove = (account: IAccount) => {
    if (window.confirm(`Are you sure you want to remove this account?\n\n${account.pubkey.slice(0, 16)}...`)) {
      accounts.removeAccount(account.id);
    }
  };

  if (allAccounts.length === 0) {
    return null;
  }

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4">Existing Accounts</h2>
      <div className="space-y-2">
        {allAccounts.map((account) => (
          <AccountItem
            key={account.id}
            account={account}
            onLogin={() => handleLogin(account.id)}
            onRemove={() => handleRemove(account)}
          />
        ))}
      </div>
      <div className="divider">OR</div>
      <h2 className="text-2xl font-bold mb-4 mt-6">Add New Account</h2>
    </div>
  );
}

interface SignInViewProps {
  onBack: () => void;
  onSignInSuccess?: () => void;
}

export default function SignInView({ onBack, onSignInSuccess }: SignInViewProps) {
  const [activeTab, setActiveTab] = useState<"extension" | "nostr-connect" | "private-key">("extension");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleAccountCreated = async (account: ExtensionAccount | NostrConnectAccount | PrivateKeyAccount) => {
    try {
      // Add account to manager
      accounts.addAccount(account);
      // Set as active
      accounts.setActive(account);
      // Show success
      setSuccess(true);
      setError(null);
      // Navigate back after a short delay
      setTimeout(() => {
        if (onSignInSuccess) {
          onSignInSuccess();
        } else {
          onBack();
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add account");
    }
  };

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-100 border-b border-base-300 flex-none">
        <div className="flex-1">
          <button onClick={onBack} className="btn btn-ghost">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="ml-4 font-semibold">Sign In</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        {success ? (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body items-center text-center">
              <div className="text-6xl mb-4">✓</div>
              <h2 className="card-title text-2xl">Successfully Signed In!</h2>
              <p className="opacity-70">Redirecting...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Existing Accounts Section */}
            <ExistingAccountsSection onLoginSuccess={onSignInSuccess} onBack={onBack} />

            {/* Tabs */}
            <div className="tabs tabs-boxed mb-6 justify-center">
              <button
                className={`tab ${activeTab === "extension" ? "tab-active" : ""}`}
                onClick={() => {
                  setActiveTab("extension");
                  setError(null);
                }}
              >
                Extension
              </button>
              <button
                className={`tab ${activeTab === "nostr-connect" ? "tab-active" : ""}`}
                onClick={() => {
                  setActiveTab("nostr-connect");
                  setError(null);
                }}
              >
                Nostr Connect
              </button>
              <button
                className={`tab ${activeTab === "private-key" ? "tab-active" : ""}`}
                onClick={() => {
                  setActiveTab("private-key");
                  setError(null);
                }}
              >
                Private Key
              </button>
            </div>

            {/* Extension Account Tab */}
            {activeTab === "extension" && (
              <ExtensionLogin onAccountCreated={handleAccountCreated} error={error} setError={setError} />
            )}

            {/* Nostr Connect Tab */}
            {activeTab === "nostr-connect" && (
              <NostrConnectLogin onAccountCreated={handleAccountCreated} error={error} setError={setError} />
            )}

            {/* Private Key Tab */}
            {activeTab === "private-key" && (
              <PrivateKeyLogin onAccountCreated={handleAccountCreated} error={error} setError={setError} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Extension Account Login Component
function ExtensionLogin({
  onAccountCreated,
  error,
  setError,
}: {
  onAccountCreated: (account: ExtensionAccount) => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      const account = await ExtensionAccount.fromExtension();
      await onAccountCreated(account);
    } catch (err) {
      console.error("Extension login error:", err);
      if (err instanceof Error && err.message.includes("extension")) {
        setError("Nostr extension not found. Please install a Nostr browser extension (e.g., nos2x, Alby).");
      } else {
        setError(err instanceof Error ? err.message : "Failed to connect with extension");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title mb-4">Login with Browser Extension</h2>
        <p className="opacity-70 mb-4">
          Connect using a Nostr browser extension like nos2x or Alby. Make sure the extension is installed and unlocked.
        </p>
        <button className="btn btn-primary w-full" onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect with Extension"}
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

// Nostr Connect Login Component
function NostrConnectLogin({
  onAccountCreated,
  error,
  setError,
}: {
  onAccountCreated: (account: NostrConnectAccount) => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const [method, setMethod] = useState<"qr" | "bunker">("qr");
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleQrCodeLogin = async () => {
    try {
      setError(null);
      setIsConnecting(true);

      // Create a new signer for QR code login
      const signer = new NostrConnectSigner({
        relays: ["wss://relay.nsec.app"],
      });

      // Generate QR code URI with metadata
      const uri = signer.getNostrConnectURI({
        name: "Applesauce Code Snippets",
      });

      setNostrConnectUri(uri);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

      try {
        // Wait for signer to connect
        await signer.waitForSigner(controller.signal);
        clearTimeout(timeoutId);

        const pubkey = await signer.getPublicKey();
        const account = new NostrConnectAccount(pubkey, signer);
        await onAccountCreated(account);
        setNostrConnectUri(null);
      } catch (err) {
        console.error("Wait for signer error:", err);
        if (err instanceof Error && err.message === "Aborted") {
          setError("Connection timeout. Please try again.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to connect");
        }
        setNostrConnectUri(null);
      }
    } catch (err) {
      console.error("QR code login error:", err);
      setError(err instanceof Error ? err.message : "QR code login failed");
      setNostrConnectUri(null);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBunkerUrlLogin = async () => {
    if (!bunkerUrl) return;

    try {
      setIsConnecting(true);
      setError(null);

      // Create signer from bunker URL
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount(pubkey, signer);
      await onAccountCreated(account);
    } catch (err) {
      console.error("Bunker URL connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  if (nostrConnectUri) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body items-center text-center">
          <p className="mb-4">Scan this QR code with your Nostr mobile signer</p>
          <a target="_parent" href={nostrConnectUri}>
            <QRCode data={nostrConnectUri} />
          </a>
          <button className="btn btn-outline mt-4" onClick={() => setNostrConnectUri(null)}>
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
    <div className="space-y-4">
      {/* Method Selector */}
      <div className="tabs tabs-boxed">
        <button
          className={`tab ${method === "qr" ? "tab-active" : ""}`}
          onClick={() => {
            setMethod("qr");
            setError(null);
          }}
        >
          QR Code
        </button>
        <button
          className={`tab ${method === "bunker" ? "tab-active" : ""}`}
          onClick={() => {
            setMethod("bunker");
            setError(null);
          }}
        >
          Bunker URL
        </button>
      </div>

      {/* QR Code Method */}
      {method === "qr" && (
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title mb-4">Login with QR Code</h2>
            <p className="opacity-70 mb-4">
              Generate a QR code that you can scan with your Nostr mobile signer app (e.g., Amethyst, Damus).
            </p>
            <button className="btn btn-primary w-full" onClick={handleQrCodeLogin} disabled={isConnecting}>
              {isConnecting ? "Generating..." : "Generate QR Code"}
            </button>

            {error && (
              <div className="alert alert-error mt-4">
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bunker URL Method */}
      {method === "bunker" && (
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title mb-4">Login with Bunker URL</h2>
            <p className="opacity-70 mb-4">Enter a bunker:// URL from your Nostr signer app.</p>
            <div className="form-control mb-4">
              <input
                type="text"
                placeholder="Enter bunker:// URL"
                className="input input-bordered w-full"
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary w-full"
              onClick={handleBunkerUrlLogin}
              disabled={!bunkerUrl || isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </button>

            {error && (
              <div className="alert alert-error mt-4">
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Private Key Login Component
function PrivateKeyLogin({
  onAccountCreated,
  error,
  setError,
}: {
  onAccountCreated: (account: PrivateKeyAccount) => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const [privateKey, setPrivateKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    if (!privateKey.trim()) {
      setError("Please enter a private key");
      return;
    }

    try {
      setIsConnecting(true);
      setError(null);

      // Validate and create account
      const account = PrivateKeyAccount.fromKey(privateKey.trim());
      await onAccountCreated(account);
    } catch (err) {
      console.error("Private key login error:", err);
      if (err instanceof Error && err.message.includes("nsec")) {
        setError("Invalid nsec format. Please check your private key.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to create account from private key");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title mb-4">Login with Private Key</h2>
        <p className="opacity-70 mb-4">
          Enter your private key (nsec or hex format). Your key is stored locally and never sent to any server.
        </p>
        <div className="form-control mb-4">
          <input
            type="password"
            placeholder="Enter nsec1... or hex private key"
            className="input input-bordered w-full"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
          />
          <label className="label">
            <span className="label-text-alt">Keep your private key secure and never share it</span>
          </label>
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={handleConnect}
          disabled={!privateKey.trim() || isConnecting}
        >
          {isConnecting ? "Connecting..." : "Sign In"}
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
