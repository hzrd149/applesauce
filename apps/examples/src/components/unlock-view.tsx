import { use$ } from "applesauce-react/hooks";
import localforage from "localforage";
import { useMemo } from "react";
import { BehaviorSubject, Subject, catchError, defer, exhaustMap, map, of, startWith, tap } from "rxjs";
import SecureStorage from "../extra/encrypted-storage";

/** A view that lets the user enter a pin to unlock the encrypted storage */
export default function UnlockView({ onUnlock }: { onUnlock: (storage: SecureStorage, pubkey?: string) => void }) {
  const pin$ = useMemo(() => new BehaviorSubject(""), []);
  const unlock$ = useMemo(() => new Subject<{ type: "unlock"; pin: string } | { type: "clear" }>(), []);
  const pin = use$(pin$);
  const operation = use$(
    () =>
      unlock$.pipe(
        exhaustMap((value) =>
          defer(async () => {
            if (value.type === "clear") {
              await localforage.clear();
              pin$.next("");
              return undefined;
            }
            const storage = new SecureStorage(localforage);
            if (!(await storage.unlock(value.pin))) throw new Error("Invalid PIN");
            return { storage, pubkey: (await storage.getItem("pubkey")) ?? undefined };
          }).pipe(
            tap((result) => {
              if (result) onUnlock(result.storage, result.pubkey);
            }),
            map(() => ({ loading: false, error: "" })),
            catchError((error) =>
              of({ loading: false, error: error instanceof Error ? error.message : "Failed to unlock storage" }),
            ),
            startWith({ loading: true, error: "" }),
          ),
        ),
      ),
    [unlock$, pin$, onUnlock],
  );

  return (
    <div className="flex items-center justify-center py-8">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          unlock$.next({ type: "unlock", pin });
        }}
        className="w-96 border border-base-300 p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Unlock Storage</h2>
        <input
          type="password"
          placeholder="Enter PIN"
          className="input input-bordered w-full"
          value={pin}
          onChange={(event) => pin$.next(event.target.value)}
          disabled={operation?.loading}
        />
        {operation?.error && (
          <div className="text-error text-sm" role="alert">
            {operation.error}
          </div>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={operation?.loading || !pin}>
          {operation?.loading ? <span className="loading loading-spinner" /> : "Unlock"}
        </button>
        <button
          type="button"
          className="btn btn-outline w-full"
          disabled={operation?.loading}
          onClick={() => unlock$.next({ type: "clear" })}
        >
          Clear storage
        </button>
      </form>
    </div>
  );
}
