import localforage from "localforage";
import { useState } from "react";
import SecureStorage from "../extra/encrypted-storage";

/** A view that lets the user enter a pin to unlock the encrypted storage */
export default function UnlockView({ onUnlock }: { onUnlock: (storage: SecureStorage, pubkey?: string) => void }) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const storage = new SecureStorage(localforage);
      const isValid = await storage.unlock(pin);

      if (!isValid) return setError("Invalid PIN");

      const pubkey = (await storage.getItem("pubkey")) ?? undefined;
      onUnlock(storage, pubkey);
    } catch (err) {
      setError("Failed to unlock storage");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => localforage.clear();

  return (
    <div className="flex items-center justify-center min-h-screen bg-base-200">
      <form onSubmit={handleUnlock} className="card w-96 bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Unlock Storage</h2>
          <div className="form-control">
            <input
              type="password"
              placeholder="Enter PIN"
              className="input input-bordered"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <div className="text-error text-sm">{error}</div>}
          <div className="card-actions justify-between">
            <button type="button" className="btn btn-primary" onClick={handleClear} tabIndex={1}>
              Clear
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !pin}>
              {loading ? <span className="loading loading-spinner" /> : "Unlock"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
