import { mergeRelaySets } from "applesauce-core/helpers";
import { NotificationType } from "./notification.js";
import { WalletMethod } from "./support.js";

export interface WalletAuthURI {
  /** The public key of the client requesting authorization */
  client: string;
  /** Required. URL of the relay where the client intends to communicate with the wallet service */
  relays: string[];
  /** The name of the client app (optional) */
  name?: string;
  /** The URL of an icon of the client app to display on the confirmation page (optional) */
  icon?: string;
  /** URI to open after the connection is created (optional) */
  returnTo?: string;
  /** The connection cannot be used after this date. Unix timestamp in seconds (optional) */
  expiresAt?: number;
  /** The maximum amount in millisats that can be sent per renewal period (optional) */
  maxAmount?: number;
  /** The reset the budget at the end of the given budget renewal. Can be never (default), daily, weekly, monthly, yearly (optional) */
  budgetRenewal?: "never" | "daily" | "weekly" | "monthly" | "yearly";
  /** List of request types that you need permission for (optional) */
  methods?: WalletMethod[];
  /** List of notification types that you need permission for (optional) */
  notifications?: NotificationType[];
  /** The makes an isolated app connection / sub-wallet with its own balance and only access to its own transaction list (optional) */
  isolated?: boolean;
  /** Url encoded, JSON-serialized metadata that describes the app connection (optional) */
  metadata?: Record<string, any>;
  /** The wallet name for nostr+walletauth+walletname scheme (optional) */
  walletName?: string;
}

/**
 * Parses a nostr+walletauth URI
 * @throws {Error} if the authorization URI is invalid
 */
export function parseWalletAuthURI(authURI: string): WalletAuthURI {
  const { host, pathname, searchParams, protocol } = new URL(authURI);

  // Check if it's a valid wallet auth protocol
  if (!protocol.startsWith("nostr+walletauth")) {
    throw new Error("invalid wallet auth uri protocol");
  }

  // Extract wallet name if present (nostr+walletauth+walletname://)
  const walletName =
    protocol.includes("+") && protocol.split("+").length > 2 ? protocol.split("+")[2]?.replace(/:$/, "") : undefined;

  // The client pubkey is in the pathname or host
  const client = pathname || host;
  if (!client) throw new Error("missing client public key in authorization URI");

  // Relay is required
  const relays = mergeRelaySets(searchParams.getAll("relay"));
  if (relays.length === 0) throw new Error("missing required relay parameter in authorization URI");

  // Parse optional parameters
  const name = searchParams.get("name") ?? undefined;
  const icon = searchParams.get("icon") ?? undefined;
  const returnTo = searchParams.get("return_to") ?? undefined;

  const expiresAtParam = searchParams.get("expires_at");
  const expiresAt = expiresAtParam ? parseInt(expiresAtParam, 10) : undefined;

  const maxAmountParam = searchParams.get("max_amount");
  const maxAmount = maxAmountParam ? parseInt(maxAmountParam, 10) : undefined;

  const budgetRenewal = searchParams.get("budget_renewal") as WalletAuthURI["budgetRenewal"] | null;

  const methodsParam = searchParams.get("request_methods");
  const methods = methodsParam ? (methodsParam.split(" ") as WalletMethod[]) : undefined;

  const notificationsParam = searchParams.get("notification_types");
  const notifications = notificationsParam ? (notificationsParam.split(" ") as NotificationType[]) : undefined;

  const isolatedParam = searchParams.get("isolated");
  const isolated = isolatedParam ? isolatedParam === "true" : undefined;

  const metadataParam = searchParams.get("metadata");
  let metadata: Record<string, any> | undefined;
  if (metadataParam) {
    try {
      metadata = JSON.parse(decodeURIComponent(metadataParam));
    } catch (error) {
      throw new Error("invalid metadata parameter in authorization URI");
    }
  }

  return {
    client,
    relays,
    name,
    icon,
    returnTo,
    expiresAt,
    maxAmount,
    budgetRenewal: budgetRenewal || undefined,
    methods,
    notifications,
    isolated,
    metadata,
    walletName,
  };
}

/**
 * Creates a nostr+walletauth URI from a WalletAuthURI object
 */
export function createWalletAuthURI(parts: WalletAuthURI): string {
  validateWalletAuthURI(parts);

  // Determine the protocol based on whether wallet name is specified
  const protocol = parts.walletName ? `nostr+walletauth+${parts.walletName}` : "nostr+walletauth";

  const url = new URL(`${protocol}://${parts.client}`);

  // Add required relay parameter
  for (const relay of parts.relays) url.searchParams.append("relay", relay);

  // Add optional parameters
  if (parts.name) url.searchParams.append("name", parts.name);
  if (parts.icon) url.searchParams.append("icon", parts.icon);
  if (parts.returnTo) url.searchParams.append("return_to", parts.returnTo);
  if (parts.expiresAt) url.searchParams.append("expires_at", parts.expiresAt.toString());
  if (parts.maxAmount) url.searchParams.append("max_amount", parts.maxAmount.toString());
  if (parts.budgetRenewal && parts.budgetRenewal !== "never")
    url.searchParams.append("budget_renewal", parts.budgetRenewal);

  if (parts.methods && parts.methods.length > 0) url.searchParams.append("request_methods", parts.methods.join(" "));

  if (parts.notifications && parts.notifications.length > 0)
    url.searchParams.append("notification_types", parts.notifications.join(" "));

  if (parts.isolated !== undefined) url.searchParams.append("isolated", parts.isolated.toString());

  if (parts.metadata) url.searchParams.append("metadata", encodeURIComponent(JSON.stringify(parts.metadata)));

  return url.toString();
}

/**
 * Validates a WalletAuthURI object
 * @returns true if valid, throws Error if invalid
 */
export function validateWalletAuthURI(parts: WalletAuthURI): boolean {
  if (!parts.client || parts.client.length === 0) throw new Error("client public key is required");

  if (!parts.relays || parts.relays.length === 0) throw new Error("at least one relay is required");

  if (parts.expiresAt && parts.expiresAt <= Math.floor(Date.now() / 1000))
    throw new Error("expires_at must be in the future");

  if (parts.maxAmount && parts.maxAmount <= 0) throw new Error("max_amount must be positive");

  if (parts.budgetRenewal && !["never", "daily", "weekly", "monthly", "yearly"].includes(parts.budgetRenewal))
    throw new Error("invalid budget_renewal value");

  return true;
}
