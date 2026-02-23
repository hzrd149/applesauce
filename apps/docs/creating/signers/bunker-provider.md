---
description: Nostr Connect provider for creating upstream signers that handle remote signing requests
---

# Nostr Connect Provider

The [`NostrConnectProvider`](https://applesauce.build/typedoc/classes/applesauce-signers.NostrConnectProvider.html) is a server-side implementation of a [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) remote signer. It allows clients to connect and request signing operations through encrypted Nostr events.

## Upstream signer

The `NostrConnectProvider` requires an upstream signer that will be used for the common [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) operations (`sign_event`, `nip04_encrypt`, etc.)

```typescript
import { PrivateKeySigner } from "applesauce-signers";

// Create a new signer for the users key
const upstream = PrivateKeySigner.fromKey("nsec1...");

// Create a new provider that will use the upstream signer
const provider = new NostrConnectProvider({
  relays: ["wss://relay.example.com"],
  upstream,
});

// Or create a new provider that uses the user's key for signing and communication (legacy)
const provider = new NostrConnectProvider({
  relays: ["wss://relay.example.com"],
  upstream,
  // Explicitly set the signer that is used for communication to the users signer
  signer: upstream,
});

// Start the provider
await provider.start(/* optional nostrconnect:// URI */);
```

## Relay Communication

The `NostrConnectProvider` requires two methods for communicating with relays: a subscription method for receiving events and a publish method for sending events.

These methods can be set either through the constructor or globally on the class. At least one of these approaches must be used before creating a `NostrConnectProvider` instance.

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
NostrConnectProvider.subscriptionMethod = subscriptionMethod;
NostrConnectProvider.publishMethod = publishMethod;

// Or pass them as options when creating a provider
const provider = new NostrConnectProvider({
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
NostrConnectProvider.pool = pool;

// Or pass the pool as an option when creating a provider
const provider = new NostrConnectProvider({
  relays: ["wss://relay.example.com"],
  pool,
  // ... other options
});
```

## Authorization Callbacks

The provider supports several authorization callbacks to control what operations clients can perform:

```typescript
const provider = new NostrConnectProvider({
  // ... other options

  // Control connection requests
  onConnect: (client, permissions) => {
    // Return true to accept, false to reject
    return permissions.includes("sign_event"); // Only allow clients that request signing
  },

  // Control event signing
  onSignEvent: (draft, client) => {
    // Check if the event kind is allowed
    if (draft.kind === 1) return true; // Allow text notes
    if (draft.kind === 3) return true; // Allow contact lists
    throw new Error("Unsupported event kind"); // Reject other kinds with custom message
  },

  // Control NIP-04 encryption/decryption
  onNip04Encrypt: (pubkey, plaintext, client) => true,
  onNip04Decrypt: (pubkey, ciphertext, client) => true,

  // Control NIP-44 encryption/decryption
  onNip44Encrypt: (pubkey, plaintext, client) => true,
  onNip44Decrypt: (pubkey, ciphertext, client) => true,
});
```

## Waiting for Client (`bunker://` URI)

To create a provider that waits for clients to connect, you can use the `waitForClient` method:

```typescript
import { NostrConnectProvider, PrivateKeySigner } from "applesauce-signers";

// Create a signer for the users key
const user = PrivateKeySigner.fromKey("nsec1...");

// Create a signer for the provider's identity (recomended to be different from the upstream signer)
const signer = new PrivateKeySigner();

const provider = new NostrConnectProvider({
  relays: ["wss://relay.signer.com"],
  upstream: user, // Signer for actual operations
  signer: signer, // Provider's identity (optional, will create a new PrivateKeySigner if not provided)
  secret: "my-secret-key", // Recommended secret for client authentication (optional)
  onClientConnect: (client) => {
    console.log("Client connected:", client);
  },
  onClientDisconnect: (client) => {
    console.log("Client disconnected:", client);
  },
  onConnect: (client, permissions) => {
    console.log("Connection request from:", client, "with permissions:", permissions);
    return true; // Accept the connection
  },
  onSignEvent: (draft, client) => {
    console.log("Sign request from:", client, "for event:", draft);
    return true; // Allow signing
  },
  // ... other authorization callbacks
});

// Start the provider and wait for a client
try {
  // Get the bunker:// URI for clients to connect
  const bunkerUri = await provider.getBunkerURI();
  console.log("Bunker URI:", bunkerUri);

  // Open the subscription and wait for the client to connect
  const clientPubkey = await provider.waitForClient();
  console.log("Connected to client:", clientPubkey);
} catch (error) {
  console.error("Failed to connect:", error);
}

// Stop the provider when done
await provider.stop();
```

### Getting the Bunker URI

The `getBunkerURI()` method returns a `bunker://` URI that clients can use to connect:

```typescript
const bunkerUri = await provider.getBunkerURI();
// Returns: bunker://<provider-pubkey>?relay=<relay-url>&secret=<secret>
```

This URI can be displayed as a QR code or shared with clients to initiate connections.

## Connect to client (`nostrconnect://` URI)

To create a provider that responds to a client's `nostrconnect://` URI, pass the URI to the `start` method:

```typescript
import { NostrConnectProvider, PrivateKeySigner } from "applesauce-signers";

// Create a signer for the users key
const user = PrivateKeySigner.fromKey("nsec1...");

// Create a new provider with the users signer
const provider = new NostrConnectProvider({
  relays: ["wss://relay.signer.com"],
  upstream: user,
  onClientConnect: (client) => {
    console.log("Client connected:", client);
  },
  onConnect: (client, permissions) => {
    console.log("Connection request from:", client, "with permissions:", permissions);
    return true;
  },
  // ... other callbacks
});

// Get the nostrconnect:// URI from the client
const nostrConnectUri = "nostrconnect://client-pubkey?secret=shared-secret&relay=wss://relay.signer.com&name=MyApp";

try {
  // Start the provider and respond to the client's `nostrconnect://` URI
  await provider.start(nostrConnectUri);
  console.log("Provider started and connected to client");
} catch (error) {
  console.error("Failed to start provider:", error);
}

// Stop when done
await provider.stop();
```

### Handling Initial Connect Requests

You can also start a provider with an initial `connect` request event:

```typescript
// Start with a connect request event
await provider.start(connectRequestEvent);

// Or start and wait for the first connect request
await provider.start();
```

## New `connect` requests

Its not recomended but it is possible to listen for `connect` requests sent to the users pubkey and create a connection.

```typescript
const pool = new RelayPool();

const user = PrivateKeySigner.fromKey("nsec1...");

const providers: NostrConnectProvider[] = [];

// Open a new subscription that will listen for new `connect` requests
pool
  .subscription(["wss://relay.signer.com"], { kinds: [kinds.NostrConnect], "#p": [await user.getPublicKey()] })
  .subscribe((event) => {
    // WARNING: manually validate that this is a new `connect` request, otherwise you will create infinite providers!

    // Presume this is a `connect` request and ask the user if they want to connect to the random client that just asked
    if ((await askUserForConnection(event.pubkey, event)) === false) return;

    // Create a new provider that will respond to the connect request
    const provider = new NostrConnectProvider({
      relays: ["wss://relay.signer.com"],
      upstream: user,
      pool,
      // Use the users signer, since the client is expecting to hear back from the users pubkey
      signer: user,
    });

    // Start the provider and respond to the `connect` request
    provider.start(event);
    providers.push(provider);
  });

// Later close all providers
function shutdown() {
  for (const provider of providers) {
    provider.stop();
  }
}
```

## Provider Lifecycle

### Starting the Provider

```typescript
// Start without waiting for a specific client
await provider.start();

// Start and respond to a specific nostrconnect:// URI
await provider.start(nostrConnectUri);

// Start and respond to a connect request event
await provider.start(connectRequestEvent);
```

### Stopping the Provider

```typescript
await provider.stop();
```

This will:

- Close the relay subscription
- Clear the state
- Cancel any pending operations

### Checking Provider Status

```typescript
if (provider.listening) {
  console.log("Provider is listening for requests");
}

if (provider.connected) {
  console.log("Provider is connected to client:", provider.client);
}
```

## Error Handling

The provider automatically handles errors and sends appropriate error responses to clients:

```typescript
const upstream = {
  signEvent: async (draft) => {
    // Errors throw in the upstream signer will be passed along to the client
    throw new Error("You shall not sign!");
  },
};

const provider = new NostrConnectProvider({
  // ... other options

  onConnect: (client, permissions) => {
    // Errors throw in the callback methods will be passed along to the client
    throw new Error("You shall not pass!");
  },
});
```
