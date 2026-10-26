import { EventContentEncryptionMethod, type NostrEvent } from "applesauce-core/helpers";
import { isNIP04Encrypted } from "applesauce-core/helpers/encryption";
import type { ISigner } from "applesauce-signers";
import {
  catchError,
  defaultIfEmpty,
  defer,
  filter,
  finalize,
  firstValueFrom,
  isObservable,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
  take,
  takeUntil,
} from "rxjs";
import type { EncryptedContentCache } from "applesauce-common/helpers";
import { kehtoAccount$, type KehtoAccount } from "./account.js";

/** Account and cache settings for napplet decryption */
export interface NappletDecryptionOptions {
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream */
  account$?: Observable<KehtoAccount | undefined>;
  /** Whether encrypted content is decrypted (default true) */
  decrypt?: boolean;
  /** The host plaintext cache or reactive active cache keyed by account public key and event id */
  decryptionCache?: EncryptedContentCache | Observable<EncryptedContentCache | undefined>;
}

// Scope shared work to the host context so separate hosts never share cache policy.
const pendingDecryptions = new WeakMap<
  NappletDecryptionOptions,
  WeakMap<ISigner, Map<EncryptedContentCache | undefined, Map<string, Observable<string>>>>
>();

/** Streams a plaintext copy for napplet reads using the current signer and optional host cache */
export function decryptForNapplet$(context: NappletDecryptionOptions, event: NostrEvent): Observable<NostrEvent> {
  const method = isNIP04Encrypted(event.content) ? "nip04" : EventContentEncryptionMethod[event.kind];
  if (context.decrypt === false || !event.content || !method) return of(event);

  return kehtoAccount$(context).pipe(
    take(1),
    switchMap((account) => {
      const cache$ = isObservable(context.decryptionCache) ? context.decryptionCache : of(context.decryptionCache);
      return cache$.pipe(
        take(1),
        map((cache) => ({ account, cache })),
      );
    }),
    switchMap(({ account, cache }) => {
      // Resolve the signer on subscription, including events queued behind another decrypt.
      if (!account || !account.signer[method]) return of(event);

      const { signer, pubkey } = account;
      // Incoming messages use their author; outgoing messages use their recipient.
      const recipient = event.tags.find((tag) => tag[0] === "p")?.[1];
      if (event.pubkey !== pubkey && recipient !== pubkey) return of(event);
      const peerPubkey = event.pubkey === pubkey ? (recipient ?? pubkey) : event.pubkey;
      const key = `${pubkey}:${event.id}`;

      let signers = pendingDecryptions.get(context);
      if (!signers) {
        signers = new WeakMap();
        pendingDecryptions.set(context, signers);
      }

      let caches = signers.get(signer);
      if (!caches) {
        caches = new Map();
        signers.set(signer, caches);
      }

      let requests = caches.get(cache);
      if (!requests) {
        requests = new Map();
        caches.set(cache, requests);
      }

      let content$ = requests.get(key);
      if (!content$) {
        // Cache failures fall back to the signer, and failed writes still deliver plaintext.
        content$ = defer(() => cache?.getItem(key) ?? Promise.resolve(null)).pipe(
          catchError(() => of(null)),
          switchMap((cached) => {
            if (cached !== null) return of(cached);

            return defer(() => signer[method]!.decrypt(peerPubkey, event.content)).pipe(
              switchMap((content) =>
                defer(() => cache?.setItem(key, content) ?? Promise.resolve()).pipe(
                  catchError(() => of(undefined)),
                  map(() => content),
                ),
              ),
            );
          }),
          // Release completed or abandoned work; only concurrent readers share plaintext.
          finalize(() => {
            requests!.delete(key);
            if (requests!.size === 0) caches!.delete(cache);
          }),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
        requests.set(key, content$);
      }

      return content$.pipe(
        // An account switch must never deliver the previous account's plaintext.
        takeUntil(
          kehtoAccount$(context).pipe(filter((current) => current?.signer !== signer || current.pubkey !== pubkey)),
        ),
        map((content) => ({ ...event, content })),
        defaultIfEmpty(event),
      );
    }),
    catchError(() => of(event)),
  );
}

/** Returns a plaintext copy for promise-based kehto callbacks */
export function decryptForNapplet(context: NappletDecryptionOptions, event: NostrEvent): Promise<NostrEvent> {
  return firstValueFrom(decryptForNapplet$(context, event));
}
