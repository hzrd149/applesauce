import { castUser, type User } from "applesauce-common/casts";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import type { ISigner } from "applesauce-signers";
import { from, isObservable, of, switchMap } from "rxjs";
import { latest } from "../helpers.js";
import type { KehtoContext } from "../types.js";

/** Relays used when no fallback relays are configured */
export const DEFAULT_KEHTO_FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

/** The live signer, pubkey and relay settings shared by every kehto integration */
export interface KehtoState {
  /** The context the state was created from */
  readonly ctx: KehtoContext;
  /** How long to wait for missing data, in milliseconds */
  readonly timeout: number;
  /** Returns the current signer */
  getSigner(): ISigner | undefined;
  /** Returns the current signer's pubkey once it has resolved */
  getPubkey(): string | undefined;
  /** Returns the current user cast */
  getUser(): User | undefined;
  /** Returns the current fallback relays */
  getFallbackRelays(): string[];
  /** Stops tracking the context observables and removes the event loader it created */
  stop(): void;
}

/** Creates a {@link KehtoState} that tracks the latest signer, pubkey and fallback relays */
export function createKehtoState(ctx: KehtoContext): KehtoState {
  // Napplet reads rely on the store loading missing events, so wire a loader when the app has not
  const loader = ctx.eventStore.eventLoader
    ? undefined
    : createEventLoaderForStore(ctx.eventStore, ctx.pool, { lookupRelays: ctx.lookupRelays });

  const signer = latest<ISigner | undefined>(ctx.signer, undefined);
  const fallbackRelays = latest(ctx.fallbackRelays, DEFAULT_KEHTO_FALLBACK_RELAYS);

  // Kehto asks for the pubkey synchronously, so resolve it every time the signer changes
  const signer$ = isObservable(ctx.signer) ? ctx.signer : of(ctx.signer);
  const pubkey = latest<string | undefined>(
    signer$.pipe(
      switchMap((s) => (s ? from(Promise.resolve(s.getPublicKey()).catch(() => undefined)) : of(undefined))),
    ),
    undefined,
  );

  return {
    ctx,
    timeout: ctx.timeout ?? 4000,
    getSigner: signer.get,
    getPubkey: pubkey.get,
    getUser: () => {
      const current = pubkey.get();
      return current ? castUser(current, ctx.eventStore) : undefined;
    },
    getFallbackRelays: fallbackRelays.get,
    stop: () => {
      signer.stop();
      pubkey.stop();
      fallbackRelays.stop();
      if (loader) {
        loader.stop();
        if (ctx.eventStore.eventLoader === loader) ctx.eventStore.eventLoader = undefined;
      }
    },
  };
}
