import { ExtensionSigner } from "applesauce-signers";
import { useState } from "react";

/** A view that asks the user to login with the browser extension */
export default function LoginView({ onLogin }: { onLogin: (signer: ExtensionSigner, pubkey: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();

      onLogin(signer, pubkey);
    } catch (err) {
      setError("Failed to login with extension");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-base-200">
      <div className="card w-96 bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Login Required</h2>
          <p>Please login with your Nostr extension</p>
          {error && <div className="text-error text-sm">{error}</div>}
          <div className="card-actions justify-end">
            <button onClick={handleLogin} className="btn btn-primary" disabled={loading}>
              {loading ? <span className="loading loading-spinner" /> : "Login"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
