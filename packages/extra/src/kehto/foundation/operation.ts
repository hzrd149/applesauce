import type { ISigner } from "applesauce-signers";
import {
  defer,
  filter,
  finalize,
  firstValueFrom,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  throwIfEmpty,
  timeout,
  type Observable,
} from "rxjs";
import { kehtoAccount$, type KehtoAccount } from "./account.js";

/** Options for resolving an account and bounding its operations */
export interface AccountOperationOptions {
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The resolved account stream overriding signer resolution */
  account$?: Observable<KehtoAccount | undefined>;
  /** The account resolution timeout in milliseconds (default 4000) */
  timeout?: number;
  /** The operation timeout in milliseconds (default 60000) */
  actionTimeout?: number;
}

/** An account snapshot and the signal invalidating its operation */
export interface AccountOperation {
  /** The account owning this operation */
  account: KehtoAccount;
  /** The signal aborted when the operation ends, times out, or changes accounts */
  signal: AbortSignal;
}

/** Creates an executor that bounds operations and invalidates them when their account changes */
export function createAccountExecutor(config: AccountOperationOptions) {
  function withAccount<T>(work: (operation: AccountOperation) => Promise<T>) {
    const account$ = kehtoAccount$(config).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    return firstValueFrom(
      account$.pipe(
        timeout({ first: config.timeout ?? 4000 }),
        take(1),
        switchMap((account) => {
          if (!account) throw new Error("no signer configured");
          const controller = new AbortController();
          const operation = { account, signal: controller.signal };
          const accountChanged$ = account$.pipe(
            filter((current) => current?.signer !== account.signer || current.pubkey !== account.pubkey),
          );

          return defer(() => work(operation)).pipe(
            timeout({ first: config.actionTimeout ?? 60000 }),
            takeUntil(accountChanged$),
            finalize(() => controller.abort(new Error("Account changed or operation timed out"))),
          );
        }),
        throwIfEmpty(() => new Error("Account changed or account unavailable")),
      ),
    );
  }

  return withAccount;
}
