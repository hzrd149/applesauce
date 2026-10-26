import type { ISigner } from "applesauce-signers";
import {
  catchError,
  defer,
  distinctUntilChanged,
  isObservable,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";

/** A resolved account used for one napplet operation */
export interface KehtoAccount {
  /** The signer that resolved this account's public key */
  readonly signer: ISigner;
  /** The public key belonging to the signer */
  readonly pubkey: string;
}

/** Observes resolved accounts and clears the previous account immediately when its signer changes */
export function createKehtoAccount$(
  signer: ISigner | Observable<ISigner | undefined> | undefined,
): Observable<KehtoAccount | undefined> {
  const signer$ = isObservable(signer) ? signer : of(signer);

  return defer(() => {
    // Let one-shot consumers await the initial pubkey, then invalidate immediately on every change.
    let hasSigner = false;
    return signer$.pipe(
      distinctUntilChanged(),
      switchMap((currentSigner) => {
        const clearPrevious = hasSigner;
        hasSigner = true;
        if (!currentSigner) return of(undefined);

        const resolved$ = defer(async () => currentSigner.getPublicKey()).pipe(
          map((pubkey) => ({ signer: currentSigner, pubkey })),
          catchError(() => of(undefined)),
        );
        return clearPrevious ? resolved$.pipe(startWith(undefined)) : resolved$;
      }),
    );
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
}

const accounts = new WeakMap<object, Observable<KehtoAccount | undefined>>();

/** Returns the shared account stream for a host context without starting a subscription */
export function kehtoAccount$(context: {
  signer?: ISigner | Observable<ISigner | undefined>;
  account$?: Observable<KehtoAccount | undefined>;
}): Observable<KehtoAccount | undefined> {
  if (context.account$) return context.account$;

  let account$ = accounts.get(context);
  if (!account$) {
    account$ = createKehtoAccount$(context.signer);
    accounts.set(context, account$);
  }
  return account$;
}
