# WalletConnect Class

The `WalletConnect` class provides a client-side implementation for connecting to NIP-47 wallet services. It handles all communication with wallet services, including request encryption, response decryption, and notification handling.

## Overview

`WalletConnect` is designed to be a complete client for interacting with Nostr Wallet Connect services. It provides:

- **Reactive Architecture**: Built on RxJS for efficient event handling
- **Encryption Support**: Automatic handling of NIP-04 and NIP-44 encryption
- **Request Management**: Built-in timeout handling and error management
- **Notification Support**: Real-time wallet notifications
- **Type Safety**: Full TypeScript support with typed responses

## Relay Connections

The `WalletConnect` requires two methods for communicating with relays: a subscription method for receiving events and a publish method for sending events.

These methods can be set either through the constructor or globally on the class. At least one of these approaches must be used before creating a `WalletConnect` instance.

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
WalletConnect.subscriptionMethod = subscriptionMethod;
WalletConnect.publishMethod = publishMethod;

// Or pass them as options when creating a signer
const signer = new WalletConnect({
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
WalletConnect.pool = pool;

// Or pass the pool as an option when creating a client
const client = new WalletConnect({
  relays: ["wss://relay.example.com"],
  pool,
  // ... other options
});
```

## Using a `nostr+walletconnect://` URI

The most common way to create a client is using a connection string:

```typescript
import { WalletConnect } from "applesauce-wallet-connect";

// Create a new client from a connection string
const wallet = WalletConnect.fromConnectionString(
  "nostr+walletconnect://relay.example.com?secret=abc123&pubkey=def456",
);

// Start using the wallet
await wallet.getInfo();
await wallet.payInvoice("lnbc1...");
```

## Using a `nostr+walletauth://` URI

Some wallets support a `nostr+walletauth://` URI for the client app to request a connection from the wallet service.

```typescript
import { WalletConnect } from "applesauce-wallet-connect";

// Create a new client with a random secret key
const secret = generateSecretKey();
const wallet = new WalletConnect(
  secret,
  relays: ["wss://relay.wallet.com"],
);

// Get the auth URI and show it to the user as a QR code
const authUri = wallet.getAuthURI();

// Wait for the service to respond
await wallet.waitForService();
console.log("Connected to wallet service!");

// Start using the wallet
await wallet.getInfo();
```

## Checking Wallet Capabilities

Before using specific methods, it's good practice to check what the wallet supports:

```typescript
// Get the wallet's supported methods and capabilities
const support = await wallet.getSupport();

if (support) {
  console.log("Supported methods:", support.methods);
  console.log("Encryption methods:", support.encryption);
  console.log("Notification types:", support.notifications);
}

// Check specific method support
if (await wallet.supportsMethod("pay_invoice")) {
  console.log("Wallet supports invoice payments");
}

if (await wallet.supportsNotifications()) {
  console.log("Wallet supports notifications");
}
```

## Basic Wallet Operations

### Getting Wallet Information

```typescript
// Get basic wallet info
const info = await wallet.getInfo();
console.log("Wallet alias:", info.alias);
console.log("Network:", info.network);

// Get current balance
const balance = await wallet.getBalance();
console.log("Balance:", balance.balance, "msats");
```

### Transaction History

```typescript
// Get recent transactions
const transactions = await wallet.listTransactions({
  limit: 10,
  type: "incoming",
});

transactions.transactions.forEach((tx) => {
  console.log(`${tx.type}: ${tx.amount} msats`);
});
```

## Payment Operations

### Invoice Payments

```typescript
// Pay a Lightning invoice
const result = await wallet.payInvoice("lnbc1...");
console.log("Payment successful:", result.preimage);

// Pay multiple invoices at once
const results = await wallet.payMultipleInvoices([{ invoice: "lnbc1..." }, { invoice: "lnbc2..." }]);
```

### Keysend Payments

```typescript
// Send a keysend payment
const result = await wallet.payKeysend(
  "pubkey123...",
  100000, // 100 sats in msats
  undefined, // preimage (optional)
  [{ type: 696969, value: "Hello from Nostr!" }], // TLV records
);
```

### Creating Invoices

```typescript
// Create a new invoice
const invoice = await wallet.makeInvoice(50000, {
  description: "Coffee payment",
  expiry: 3600, // 1 hour
});

console.log("Invoice created:", invoice.payment_request);
```

## Notifications

### Using the notification Method

The `notification` method allows you to listen for specific types of notifications:

```typescript
// Listen for payment received notifications
const subscription = wallet.notification("payment_received", (notification) => {
  const { payment_hash, amount, fee } = notification;
  console.log(`Payment received: ${amount} msats`);
});

// Listen for payment sent notifications
const sentSubscription = wallet.notification("payment_sent", (notification) => {
  console.log("Payment sent successfully");
});

// Clean up when done
subscription.unsubscribe();
sentSubscription.unsubscribe();
```

### Using Observables

For more advanced usage, you can subscribe to the observables directly:

```typescript
import { filter, map } from "rxjs";

// Subscribe to all notifications
wallet.notifications$.subscribe((notification) => {
  console.log("Notification:", notification);
});

// Filter notifications by type
wallet.notifications$
  .pipe(
    filter((n) => n.notification_type === "payment_received"),
    map((n) => n.notification),
  )
  .subscribe((notification) => {
    console.log("Payment received:", notification);
  });
```

## Available Observables

### support$

Emits wallet support information when it changes:

```typescript
wallet.support$.subscribe((support) => {
  if (support) {
    console.log("Wallet supports:", support.methods);
  }
});
```

### notifications$

Emits all wallet notifications:

```typescript
wallet.notifications$.subscribe((notification) => {
  console.log("Notification:", notification);
});
```

### encryption$

Emits the preferred encryption method:

```typescript
wallet.encryption$.subscribe((method) => {
  console.log("Using encryption:", method);
});
```

## Error Handling

WalletConnect provides comprehensive error handling with typed errors:

```typescript
try {
  const result = await wallet.payInvoice("lnbc1...");
  console.log("Payment successful:", result.preimage);
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log("Not enough balance:", error.message);
  } else if (error instanceof InvalidInvoiceError) {
    console.log("Invalid invoice:", error.message);
  } else {
    console.log("Unexpected error:", error.message);
  }
}
```

### Common Error Types

- `InsufficientBalanceError`: When the wallet doesn't have enough balance
- `InvalidInvoiceError`: When an invoice is malformed
- `RateLimitedError`: When too many requests are made
- `UserRejectedError`: When the user rejects the operation

For a complete list of error types and their meanings, see the [typedocs](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-wallet-connect.WalletConnect.html).
