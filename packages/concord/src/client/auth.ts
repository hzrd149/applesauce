// Scope-owned NIP-42 auth primitives (D-02/D-06/D-07/D-08/D-09/D-12).
//
// An instance-scoped, pure pubkey→signer map whose `onAuthRequired` handler
// answers exactly the
// relay-supplied `missingPubkeys` it holds a signer for. Every engine owns its
// own `StreamSigners` (community, private channel, invite watcher) so two
// independently-constructed holders sharing one relay never authenticate each
// other's keys. `createUserAuthHandler` is a separate path for the user's own
// signer (which may be a NIP-46 bunker or extension dialog) — it never shares
// this module's registry.
//
// Nothing here subscribes to the relay's challenge or status observables, drives
// a per-relay reference count, or dedupes a repeated AUTH — those are exactly the
// mechanisms this module replaces (D-01/D-11/D-18).

import { PrivateKeySigner } from "applesauce-signers";
import type { ISigner } from "applesauce-signers";
import { Observable, distinctUntilChanged, map, startWith } from "rxjs";
import { normalizeURL } from "applesauce-core/helpers";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RelayAuthHandler, RelayPool, RelayStatus } from "applesauce-relay";
import type { GroupKey } from "../helpers/crypto.js";
import { logger } from "../logger.js";

/** Module-level NIP-42 auth tracer (D-03). Derived once at module scope —
 *  never `.extend()`d again at an individual log call site (SEED-001/14-D-18). */
const authLog = logger.extend("auth");

export interface StreamSignersOptions {
  /** Called with a human-readable message whenever an AUTH this holder attempts is
   *  rejected by the relay or throws. The holder never touches any status observable
   *  itself — the owning engine records/surfaces the message (D-13). */
  onAuthFailure?: (message: string) => void;
}

/**
 * An instance-scoped, pure pubkey→signer map for the stream keys one scope (a
 * community, a private channel, an invite watcher, …) currently holds. Its
 * `onAuthRequired` handler intersects the relay's `missingPubkeys` against this
 * map — never a pubkey it holds no signer for, never a fallback to the whole
 * registry, never a pubkey outside `missingPubkeys` (T-15-01).
 */
export class StreamSigners {
  /** pubkey (x-only hex) → the signer that NIP-42-authenticates it. Accumulates
   *  within its scope and is intentionally never pruned (D-07): a historical
   *  epoch re-walk still needs old keys. Do not add eviction or a shared/static map. */
  private readonly registry = new Map<string, PrivateKeySigner>();

  constructor(private readonly options: StreamSignersOptions = {}) {}

  /** Register stream keys (idempotent, skips a `pk` already present). Returns the
   *  pubkeys newly added. */
  register(keys: GroupKey[]): string[] {
    const added: string[] = [];
    for (const k of keys) {
      if (this.registry.has(k.pk)) continue;
      this.registry.set(k.pk, new PrivateKeySigner(k.sk));
      added.push(k.pk);
    }
    return added;
  }

  /** Register a raw secp256k1 secret key that is NOT a `GroupKey` (no `convKey`,
   *  never addresses a plane) — an invite-link signer key, freshly generated or
   *  restored from a stored `signerSk` (D-17). Idempotent; returns the x-only hex
   *  pubkey it was registered under. */
  addSecretKey(secretKey: Uint8Array): string {
    const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
    if (!this.registry.has(pubkey)) this.registry.set(pubkey, new PrivateKeySigner(secretKey));
    return pubkey;
  }

  /** A plain map lookup — the only lookup shape the handler needs. */
  get(pubkey: string): PrivateKeySigner | undefined {
    return this.registry.get(pubkey);
  }

  /** The held pubkeys, for tests and diagnostics only. */
  pubkeys(): string[] {
    return [...this.registry.keys()];
  }

  private fail(url: string, pubkey: string, reason: string): void {
    const message = `auth failed on ${url} for stream key ${pubkey.slice(0, 8)}: ${reason}`;
    this.options.onAuthFailure?.(message);
  }

  /** Reports a TOTAL answering failure — this scope held no signer for ANY of a
   *  non-empty `missingPubkeys` request. Distinct from {@link fail}, which reports
   *  a relay refusing (or erroring on) a correctly-signed AUTH: this is the scope
   *  being unable to sign at all, the registration-gap signature CR-01 exposed
   *  (T-15-24/WR-03). Never fires on a partial answer or a `null` request — see
   *  the two guards at the {@link onAuthRequired} call site. */
  private failNoSigner(url: string, requestedCount: number): void {
    const message = `no signer held for any of the ${requestedCount} pubkey(s) the relay asked about on ${url} — this scope's onAuthRequired answered none of them`;
    this.options.onAuthFailure?.(message);
  }

  /**
   * Answer a relay's `onAuthRequired` signal by authenticating exactly the
   * pubkeys in `missingPubkeys` this holder has a signer for. `missingPubkeys:
   * null` (the operation asked for any authenticated user) authenticates nothing
   * on this path — the stream path never falls back to the whole registry. Never
   * throws — a failed AUTH is a value reported through `onAuthFailure`, not an
   * exception (13-D-01/D-02). Declared as an arrow-function class field so a call
   * site can pass `holder.onAuthRequired` unbound directly into an options bag.
   *
   * Invariant (D-13/T-15-24/WR-03): a TOTAL answering failure over a non-empty
   * `missingPubkeys` — this scope answered zero of the pubkeys the relay asked
   * about — is reported on both the `:auth` trace and `onAuthFailure`. Under
   * per-operation narrowing, `missingPubkeys` is always computed from THIS
   * operation's own `waitForAuth`, so answering none of it can only mean a
   * registration gap in this scope, never a routine cross-scope skip. A partial
   * answer (this scope owns some, not all, of a union-widened request) and a
   * `null` request (the client-wide user-auth path) both stay silent by design.
   */
  readonly onAuthRequired: RelayAuthHandler = async (ctx) => {
    let answered = 0;
    for (const pk of ctx.missingPubkeys ?? []) {
      const signer = this.registry.get(pk);
      if (!signer) continue;
      answered++;
      authLog("stream-key auth requested pk=%s relay=%s", pk.slice(0, 8), ctx.url);
      try {
        const res = await ctx.relay.authenticate(signer);
        if (res.ok) {
          authLog("stream-key auth succeeded pk=%s relay=%s", pk.slice(0, 8), ctx.url);
        } else {
          authLog("stream-key auth rejected pk=%s relay=%s", pk.slice(0, 8), ctx.url);
          this.fail(ctx.url, pk, "relay rejected the AUTH");
        }
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        authLog("stream-key AUTH to %s failed pk=%s: %s", ctx.url, pk.slice(0, 8), message);
        this.fail(ctx.url, pk, message);
      }
    }

    if (Array.isArray(ctx.missingPubkeys) && ctx.missingPubkeys.length > 0 && answered === 0) {
      authLog("stream-key auth: no signer held for any of %d requested pubkeys relay=%s", ctx.missingPubkeys.length, ctx.url);
      this.failNoSigner(ctx.url, ctx.missingPubkeys.length);
    }
  };
}

/**
 * A separate path (D-08/D-09) for answering NIP-42 challenges with the USER's
 * own signer — which may be a NIP-46 bunker or an extension dialog, so it stays
 * off the stream code path entirely. Authenticates only when `missingPubkeys` is
 * `null` (any authenticated user) or contains the resolved user pubkey; this
 * handler owns exactly one identity (T-15-03). `getPubkey` is a thunk rather than
 * a bare string because `InviteWatcher` resolves the user's pubkey asynchronously
 * in `start()` while `ConcordClient` has it earlier — one shape serves both.
 */
export function createUserAuthHandler(
  signer: ISigner,
  getPubkey: () => string | undefined,
  options: StreamSignersOptions = {},
): RelayAuthHandler {
  return async (ctx) => {
    const pubkey = getPubkey();
    if (pubkey === undefined) return;
    if (ctx.missingPubkeys !== null && !ctx.missingPubkeys.includes(pubkey)) return;

    authLog("user auth requested pubkey=%s relay=%s", pubkey.slice(0, 8), ctx.url);
    try {
      const res = await ctx.relay.authenticate(signer);
      if (res.ok) {
        authLog("user auth succeeded pubkey=%s relay=%s", pubkey.slice(0, 8), ctx.url);
      } else {
        authLog("user auth rejected pubkey=%s relay=%s", pubkey.slice(0, 8), ctx.url);
        options.onAuthFailure?.(`auth failed on ${ctx.url} for user ${pubkey.slice(0, 8)}: relay rejected the AUTH`);
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      authLog("user AUTH to %s failed pubkey=%s: %s", ctx.url, pubkey.slice(0, 8), message);
      options.onAuthFailure?.(`auth failed on ${ctx.url} for user ${pubkey.slice(0, 8)}: ${message}`);
    }
  };
}

/** Look up a relay's status in a `pool.status$` snapshot, tolerating un/normalized
 *  URLs. */
export function lookupRelayStatus(statuses: Record<string, RelayStatus>, url: string): RelayStatus | undefined {
  return statuses[normalizeURL(url)] ?? statuses[url];
}

/**
 * Whether at least one of `relays` has an open socket, as a derived boolean
 * observable over `pool.status$` (D-12). Reads only the connected flag — never
 * the auth-required-for-read/publish flags or the authenticated-pubkeys/challenge
 * fields, which are relay-wide, not operation-scoped.
 */
export function connectedRelays$(pool: RelayPool, relays: string[]): Observable<boolean> {
  return pool.status$.pipe(
    startWith({} as Record<string, RelayStatus>),
    map((statuses) => relays.some((url) => lookupRelayStatus(statuses, url)?.connected ?? false)),
    distinctUntilChanged(),
  );
}
