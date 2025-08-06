export interface WalletConnectURI {
  service: string;
  relays: string[];
  secret: string;
}

/**
 * Parses a nostr+walletconnect URI
 * @throws {Error} if the connection string is invalid
 */
export function parseWalletConnectURI(connectionString: string): WalletConnectURI {
  const { host, pathname, searchParams, protocol } = new URL(connectionString);
  if (protocol !== "nostr+walletconnect:") throw new Error("invalid wallet connect uri protocol");

  const service = pathname || host;
  const relays = searchParams.getAll("relay");
  const secret = searchParams.get("secret");

  if (!service || relays.length === 0 || !secret) throw new Error("invalid connection string");

  return { service, relays, secret };
}

/** Creates a nostr+walletconnect URI from a WalletConnectURI object */
export function createWalletConnectURI(parts: WalletConnectURI): string {
  const url = new URL(`nostr+walletconnect://${parts.service}`);

  for (const relay of parts.relays) url.searchParams.append("relay", relay);
  url.searchParams.append("secret", parts.secret);

  return url.toString();
}
