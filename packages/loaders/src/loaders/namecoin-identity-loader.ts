/**
 * NIP-05 over Namecoin (`.bit`) identity loader.
 *
 * Mirrors {@link ./dns-identity-loader.DnsIdentityLoader} but resolves
 * identities against the Namecoin blockchain instead of DNS. The loader is
 * transport-free by design: an ElectrumX (WSS / TCP+TLS) client is **not**
 * bundled because applesauce is isomorphic. Consumers wire one up by
 * assigning {@link NamecoinIdentityLoader#resolve} to a function that returns
 * the raw name-value JSON string for a Namecoin name.
 *
 * Accepted identifiers (parser lives in
 * {@link ../helpers/namecoin-identity}):
 *
 * - `alice@example.bit`
 * - `example.bit` (uses the `_` root entry)
 * - `d/example` (domain namespace)
 * - `id/alice` (identity namespace)
 * - A leading `nostr:` prefix is tolerated on any of the above.
 *
 * Local-part priority when scanning a `nostr.names` map: exact match → `_` →
 * first valid entry (only when the identifier targets the root `_`).
 *
 * See {@link https://github.com/nostr-protocol/nips/pull/2349 nostr-protocol/nips#2349}.
 */

import { unixNow } from "applesauce-core/helpers";

import {
  getIdentityFromNamecoinValue,
  Identity,
  IdentityStatus,
  NamecoinAddress,
  parseNamecoinAddress,
} from "../helpers/namecoin-identity.js";
import type { AsyncIdentityCache } from "./dns-identity-loader.js";

export type { AsyncIdentityCache };

/** Cache key used for Namecoin identities. */
function identityKey(namecoinName: string, localPart: string): string {
  return `${namecoinName}#${localPart}`;
}

/**
 * Loader that resolves NIP-05-over-Namecoin (`.bit`) identifiers.
 *
 * @example
 * ```ts
 * const loader = new NamecoinIdentityLoader(cache);
 * loader.resolve = async (name) => {
 *   // Implement an ElectrumX query of your choice; return the raw
 *   // Namecoin name-value JSON string for `name`.
 *   return await myElectrumxClient.getNameValue(name);
 * };
 *
 * const identity = await loader.requestIdentity("alice@example.bit");
 * ```
 */
export class NamecoinIdentityLoader {
  identities = new Map<string, Identity>();

  /**
   * Transport hook. Must return the raw Namecoin name-value JSON string for
   * the supplied Namecoin name (e.g. `d/example`, `id/alice`).
   *
   * The default implementation throws — consumers are expected to inject an
   * ElectrumX client.
   */
  resolve: (namecoinName: string) => Promise<string> = async () => {
    throw new Error(
      "No Namecoin resolver configured. Set `loader.resolve = ...` to a function returning the raw name-value JSON string from an ElectrumX server.",
    );
  };

  /** How long an identity should be kept until it's considered expired (in seconds). Defaults to 1 week. */
  expiration = 60 * 60 * 24 * 7;

  constructor(public cache?: AsyncIdentityCache) {}

  /** Resolves a Namecoin name via {@link resolve} and parses the JSON value. */
  async fetchIdentity(name: string, namecoinName: string): Promise<Identity> {
    const checked = unixNow();
    const address: NamecoinAddress = {
      namecoinName: namecoinName.toLowerCase(),
      localPart: name.toLowerCase(),
      isDomain: !namecoinName.toLowerCase().startsWith("id/"),
    };

    try {
      const raw = await this.resolve.call(undefined, address.namecoinName);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid JSON";
        return {
          name: address.localPart,
          domain: address.namecoinName,
          checked,
          status: IdentityStatus.Error,
          error: message,
        };
      }

      const identity = getIdentityFromNamecoinValue(address, parsed, checked);
      const key = identityKey(address.namecoinName, address.localPart);
      this.identities.set(key, identity);

      // Save the resolved identity to the cache when present.
      if (this.cache && identity.status === IdentityStatus.Found) {
        await this.cache.save({ [key]: identity });
      }

      return identity;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown";
      return {
        name: address.localPart,
        domain: address.namecoinName,
        checked,
        status: IdentityStatus.Error,
        error: message,
      };
    }
  }

  /** Loads an identity from the cache or fetches it. */
  async loadIdentity(name: string, namecoinName: string): Promise<Identity> {
    const lcName = name.toLowerCase();
    const lcNamecoin = namecoinName.toLowerCase();
    const key = identityKey(lcNamecoin, lcName);

    let identity: Identity | undefined;
    if (this.cache) identity = await this.cache.load(key);

    if (!identity || unixNow() - identity.checked > this.expiration) {
      return await this.fetchIdentity(lcName, lcNamecoin);
    }
    this.identities.set(key, identity);
    return identity;
  }

  private requesting = new Map<string, Promise<Identity>>();

  /**
   * Request resolution of an identity. Accepts either a parsed pair (name +
   * namecoinName) or a single Namecoin identifier string (e.g.
   * `alice@example.bit`, `d/example`, `id/alice`). Returns the cached/loaded
   * identity, deduplicating concurrent in-flight requests.
   */
  requestIdentity(identifier: string): Promise<Identity>;
  requestIdentity(name: string, namecoinName: string): Promise<Identity>;
  requestIdentity(nameOrIdentifier: string, namecoinName?: string): Promise<Identity> {
    let name = nameOrIdentifier;
    let target = namecoinName;
    if (target === undefined) {
      const parsed = parseNamecoinAddress(nameOrIdentifier);
      if (!parsed) {
        return Promise.reject(new Error(`Invalid Namecoin identifier: ${nameOrIdentifier}`));
      }
      name = parsed.localPart;
      target = parsed.namecoinName;
    }
    const lcName = name.toLowerCase();
    const lcNamecoin = target.toLowerCase();
    const key = identityKey(lcNamecoin, lcName);

    const existing = this.identities.get(key);
    if (existing && unixNow() - existing.checked <= this.expiration) {
      return Promise.resolve(existing);
    }

    let ongoing = this.requesting.get(key);
    if (!ongoing) {
      ongoing = this.loadIdentity(lcName, lcNamecoin).finally(() => {
        this.requesting.delete(key);
      });
      this.requesting.set(key, ongoing);
    }

    return ongoing;
  }

  /** Checks if an identity is already loaded (no fetch). */
  getIdentity(name: string, namecoinName: string): Identity | undefined {
    return this.identities.get(identityKey(namecoinName.toLowerCase(), name.toLowerCase()));
  }
}
