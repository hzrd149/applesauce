import { setHiddenContentEncryptionMethod } from "applesauce-core/helpers/hidden-content";
import { isHexKey } from "applesauce-core/helpers/string";
import { kinds } from "applesauce-core/helpers/event";

// Set encryption types for nostr connect events
setHiddenContentEncryptionMethod(kinds.NostrConnect, "nip44");

export function isErrorResponse(response: any): response is NostrConnectErrorResponse {
  return !!response.error;
}

export enum Permission {
  GetPublicKey = "get_pubic_key",
  SignEvent = "sign_event",
  Nip04Encrypt = "nip04_encrypt",
  Nip04Decrypt = "nip04_decrypt",
  Nip44Encrypt = "nip44_encrypt",
  Nip44Decrypt = "nip44_decrypt",
}

export enum NostrConnectMethod {
  Connect = "connect",
  CreateAccount = "create_account",
  GetPublicKey = "get_public_key",
  SignEvent = "sign_event",
  Nip04Encrypt = "nip04_encrypt",
  Nip04Decrypt = "nip04_decrypt",
  Nip44Encrypt = "nip44_encrypt",
  Nip44Decrypt = "nip44_decrypt",
}

export type ConnectRequestParams = {
  [NostrConnectMethod.Connect]: [string] | [string, string] | [string, string, string];
  [NostrConnectMethod.CreateAccount]: [string, string] | [string, string, string] | [string, string, string, string];
  [NostrConnectMethod.GetPublicKey]: [];
  [NostrConnectMethod.SignEvent]: [string];
  [NostrConnectMethod.Nip04Encrypt]: [string, string];
  [NostrConnectMethod.Nip04Decrypt]: [string, string];
  [NostrConnectMethod.Nip44Encrypt]: [string, string];
  [NostrConnectMethod.Nip44Decrypt]: [string, string];
};

export type ConnectResponseResults = {
  [NostrConnectMethod.Connect]: "ack" | string;
  [NostrConnectMethod.CreateAccount]: string;
  [NostrConnectMethod.GetPublicKey]: string;
  [NostrConnectMethod.SignEvent]: string;
  [NostrConnectMethod.Nip04Encrypt]: string;
  [NostrConnectMethod.Nip04Decrypt]: string;
  [NostrConnectMethod.Nip44Encrypt]: string;
  [NostrConnectMethod.Nip44Decrypt]: string;
};

export type NostrConnectRequest<N extends NostrConnectMethod> = {
  id: string;
  method: N;
  params: ConnectRequestParams[N];
};
export type NostrConnectResponse<N extends NostrConnectMethod> = {
  id: string;
  result: ConnectResponseResults[N];
  error?: string;
};
export type NostrConnectErrorResponse = {
  id: string;
  result: string;
  error: string;
};

/** A bunker:// URI */
export type BunkerURI = {
  remote: string;
  relays: string[];
  secret?: string;
};

/** Parse a bunker:// URI */
export function parseBunkerURI(uri: string): BunkerURI {
  const url = new URL(uri);

  // firefox puts pubkey part in host, chrome puts pubkey in pathname
  const remote = url.host || url.pathname.replace("//", "");
  if (!isHexKey(remote)) throw new Error("Invalid bunker URI: remote is not a valid hex key");

  const relays = url.searchParams.getAll("relay");
  if (relays.length === 0) throw new Error("Invalid bunker URI: missing relays");
  const secret = url.searchParams.get("secret") ?? undefined;

  return { remote, relays, secret };
}

/** Creates a bunker:// URI from a {@link BunkerURI} object */
export function createBunkerURI(data: BunkerURI): string {
  const url = new URL(`bunker://${data.remote}`);
  data.relays.forEach((relay) => url.searchParams.append("relay", relay));
  if (data.secret) url.searchParams.set("secret", data.secret);
  return url.toString();
}

/** App metadata for a nostrconnect:// URI */
export type NostrConnectAppMetadata = {
  /** The name of the client */
  name?: string;
  /** An image for the client */
  image?: string;
  /** The url of the client */
  url?: string | URL;
  /** The permissions the client has */
  permissions?: string[];
};

/** A nostrconnect:// URI */
export type NostrConnectURI = {
  /** The pubkey of the client */
  client: string;
  /** The secret used by the signer to connect to the client */
  secret: string;
  /** The relays used to communicate with the remote signer */
  relays: string[];
  /** The metadata of the client */
  metadata?: NostrConnectAppMetadata;
};

/** Parse a nostrconnect:// URI */
export function parseNostrConnectURI(uri: string): NostrConnectURI {
  const url = new URL(uri);
  const client = url.host || url.pathname.replace("//", "");
  if (!isHexKey(client)) throw new Error("Invalid nostrconnect URI: client is not a valid hex key");

  const secret = url.searchParams.get("secret");
  const relays = url.searchParams.getAll("relay");
  if (!secret) throw new Error("Invalid nostrconnect URI: missing secret");
  if (relays.length === 0) throw new Error("Invalid nostrconnect URI: missing relays");

  const metadata: NostrConnectAppMetadata = {
    name: url.searchParams.get("name") ?? undefined,
    image: url.searchParams.get("image") ?? undefined,
    url: url.searchParams.get("url") ?? undefined,
    permissions: url.searchParams.get("perms")?.split(",") ?? undefined,
  };

  /** Omit metadata if all values are undefined */
  if (Object.values(metadata).every((v) => v === undefined)) return { client, secret, relays };
  else return { client, secret, relays, metadata };
}

/** Create a nostrconnect:// URI from a {@link NostrConnectURI} object */
export function createNostrConnectURI(data: NostrConnectURI): string {
  const params = new URLSearchParams();

  params.set("secret", data.secret);
  if (data.metadata?.name) params.set("name", data.metadata.name);
  if (data.metadata?.url) params.set("url", String(data.metadata.url));
  if (data.metadata?.image) params.set("image", data.metadata.image);
  if (data.metadata?.permissions) params.set("perms", data.metadata.permissions.join(","));
  for (const relay of data.relays) params.append("relay", relay);

  return `nostrconnect://${data.client}?` + params.toString();
}

/** Build an array of signing permissions for event kinds */
export function buildSigningPermissions(kinds: number[]): string[] {
  return [Permission.GetPublicKey, ...kinds.map((k) => `${Permission.SignEvent}:${k}`)];
}
