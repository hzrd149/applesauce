import { mergeRelaySets } from "applesauce-core/helpers";

export interface WalletConnectURI {
  /** The pubkey of the wallet service */
  service: string;
  /** The relays to use for the connection */
  relays: string[];
  /** The secret key that the client will use to encrypt messages */
  secret: string;
  /** An optional lub16 lightning address that is associated with the wallet */
  lud16?: string;
}

/**
 * Parses a nostr+walletconnect URI
 * @throws {Error} if the connection string is invalid
 */
export function parseWalletConnectURI(connectionString: string): WalletConnectURI {
  const { host, pathname, searchParams, protocol } = new URL(connectionString);
  if (protocol !== "nostr+walletconnect:") throw new Error("invalid wallet connect uri protocol");

  const service = pathname || host;
  const relays = mergeRelaySets(searchParams.getAll("relay"));
  const secret = searchParams.get("secret");
  const lud16 = searchParams.get("lud16") ?? undefined;

  if (!service || relays.length === 0 || !secret) throw new Error("invalid connection string");

  return { service, relays, secret, lud16 };
}

/** Creates a nostr+walletconnect URI from a WalletConnectURI object */
export function createWalletConnectURI(parts: WalletConnectURI): string {
  const url = new URL(`nostr+walletconnect://${parts.service}`);

  for (const relay of parts.relays) url.searchParams.append("relay", relay);
  url.searchParams.append("secret", parts.secret);
  if (parts.lud16) url.searchParams.append("lud16", parts.lud16);

  return url.toString();
}
