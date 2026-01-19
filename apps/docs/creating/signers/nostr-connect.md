# Nostr Connect

The [`NostrConnectSigner`](https://applesauce.build/typedoc/classes/applesauce-signers.NostrConnectSigner.html) is a client side implementation of a [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) remote signer.

## Relay Communication

The `NostrConnectSigner` requires two methods for communicating with relays: a subscription method for receiving events and a publish method for sending events.

These methods can be set either through the constructor or globally on the class. At least one of these approaches must be used before creating a `NostrConnectSigner` instance.

```typescript
import { Observable } from "rxjs";

function subscriptionMethod(relays, filters) {
  return new Observable((observer) => {
    // Create subscription to relays
    const cleanup = subscribeToRelays(relays, filters, (event) => {
      observer.next(event);
    });

    return () => cleanup();
  });
}

async function publishMethod(relays, event) {
  for (const relay of relays) {
    await publishToRelay(relay, event);
  }
}

// Set methods globally once at app initialization
NostrConnectSigner.subscriptionMethod = subscriptionMethod;
NostrConnectSigner.publishMethod = publishMethod;

// Or pass them as options when creating a signer
const signer = new NostrConnectSigner({
  relays: ["wss://relay.example.com"],
  subscriptionMethod,
  publishMethod,
  // ... other options
});
```

### Using the relay pool

The simplest way to set these methods is to use the `RelayPool` from the `applesauce-relay` package.

```typescript
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();

// Set the pool globally
NostrConnectSigner.pool = pool;

// Or pass the pool as an option when creating a signer
const signer = new NostrConnectSigner({
  relays: ["wss://relay.example.com"],
  pool,
  // ... other options
});
```

## Connecting to a remote signer

The `NostrConnectSigner` can be created with a remote signer's public key, and will automatically connect to it.

```js
import { NostrConnectSigner } from "applesauce-signers";

const signer = new NostrConnectSigner({
  remote: "<remote signer pubkey>",
  // Optional: Users pubkey
  pubkey: "<user pubkey>",
  // Optional: Custom subscription method
  subscriptionMethod: customSubMethod,
  // Optional: Custom publish method
  publishMethod: customPubMethod,
  // Optional: Custom auth handler
  onAuth: async (url) => {
    // Handle auth requests
  },
});

// start the connection process
await signer.connect(/* optional secret */, /* optional requested permissions */);
console.log("Connected!");

// get the users pubkey
const pubkey = await signer.getPublicKey();
console.log("Users pubkey is", pubkey);
```

## Initiating connection from client

To start a connection from the client side, you can use the `getNostrConnectURI` and `waitForSigner` methods:

```js
const signer = new NostrConnectSigner({
  subscriptionMethod: customSubMethod,
  publishMethod: customPubMethod,
  relays: ["wss://relay.example.com"],
  // ... other options
});

// get the nostrconnect:// URI with optional metadata
const uri = signer.getNostrConnectURI({
  name: "My App",
  url: "https://example.com",
  image: "https://example.com/icon.png",
  permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3, 10002]),
});
console.log(uri);

// Create an optional AbortSignal to cancel the waiting process if needed
const controller = new AbortController();
const signal = controller.signal;

try {
  // wait for the remote signer to connect, optionally passing an AbortSignal
  await signer.waitForSigner(signal);
  console.log("Connected!");

  const pubkey = await signer.getPublicKey();
  console.log("Users pubkey is", pubkey);
} catch (error) {
  console.error("Connection was aborted:", error);
}

// Later, if you need to abort the waiting process:
setTimeout(() => {
  controller.abort();
}, 10_000);
```

## Handling bunker URIs

The `NostrConnectSigner.fromBunkerURI` method can be used to create a new signer from a `bunker://` URI, it will return a promise that will resolve when the signer is connected.

```js
const signer = await NostrConnectSigner.fromBunkerURI(
  "bunker://266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5?relay=wss://relay.nsec.app&secret=d9aa70",
  {
    permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3, 10002]),
    // ... other options
  },
);
```

You can also parse a bunker URI manually using `NostrConnectSigner.parseBunkerURI`:

```js
const { remote, relays, secret } = NostrConnectSigner.parseBunkerURI(uri);
```

## Permissions

The `NostrConnectSigner` uses a set of predefined permissions that can be requested from the remote signer:

```typescript
enum Permission {
  GetPublicKey = "get_pubic_key",
  SignEvent = "sign_event",
  Nip04Encrypt = "nip04_encrypt",
  Nip04Decrypt = "nip04_decrypt",
  Nip44Encrypt = "nip44_encrypt",
  Nip44Decrypt = "nip44_decrypt",
}
```

Use the static `NostrConnectSigner.buildSigningPermissions` method to create an array of signing permissions for specific event kinds:

```js
const permissions = NostrConnectSigner.buildSigningPermissions([0, 1, 3, 10002]);
```

These permissions can be passed when:

- Connecting to a remote signer via `connect(secret, permissions)`
- Creating a nostr connect URI via `getNostrConnectURI({ permissions })`
- Creating a signer from a bunker URI via `fromBunkerURI(uri, { permissions })`

## App Metadata

When creating a nostr connect URI, you can provide metadata about your application:

```typescript
type NostrConnectAppMetadata = {
  name?: string;
  image?: string;
  url?: string | URL;
  permissions?: string[];
};
```

This metadata is used to display information about your application to the user when they connect their signer.

## Encryption Methods

The `NostrConnectSigner` supports both NIP-04 and NIP-44 encryption through the `nip04` and `nip44` properties:

```typescript
// NIP-04 encryption
const encrypted = await signer.nip04.encrypt(pubkey, plaintext);
const decrypted = await signer.nip04.decrypt(pubkey, ciphertext);

// NIP-44 encryption
const encrypted = await signer.nip44.encrypt(pubkey, plaintext);
const decrypted = await signer.nip44.decrypt(pubkey, ciphertext);
```
