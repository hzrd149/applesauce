# WalletService Class

The `WalletService` class provides a service-side implementation for creating NIP-47 wallet services. It handles incoming wallet requests, processes them through configured handlers, and sends responses back to clients.

## Overview

`WalletService` is designed to be a complete server for Nostr Wallet Connect clients. It provides:

- **Request Handling**: Automatic processing of NIP-47 wallet requests
- **Handler System**: Pluggable method handlers for different wallet operations
- **Encryption Support**: Automatic handling of NIP-04 and NIP-44 encryption
- **Response Management**: Structured response handling with error support
- **Notification Support**: Ability to send notifications to connected clients
- **Lifecycle Management**: Start/stop functionality with proper cleanup

## Creating a Service

### Basic Service Setup

```typescript
import { WalletService, WalletServiceHandlers } from "applesauce-wallet-connect";
import { SimpleSigner } from "applesauce-signers";

// Create a signer for the service
const signer = new SimpleSigner();

// Define method handlers
const handlers: WalletServiceHandlers = {
  get_info: async () => ({
    alias: "My Lightning Wallet",
    color: "#ff6600",
    pubkey: await signer.getPublicKey(),
    network: "mainnet",
    block_height: 800000,
    block_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    methods: ["get_info", "get_balance", "pay_invoice", "make_invoice"],
  }),

  get_balance: async () => ({
    balance: 1000000, // 1000 sats
  }),

  pay_invoice: async (params) => {
    // Implement your payment logic here
    console.log(`Paying invoice: ${params.invoice} for ${params.amount} msats`);

    return {
      preimage: "payment_preimage_here",
      fees_paid: 1000,
    };
  },
};

// Create the service
const service = new WalletService({
  relays: ["wss://relay.example.com"],
  signer,
  handlers,
  notifications: ["payment_received", "payment_sent"],
});

// Start the service
await service.start();
console.log("Wallet service started");

// Get the connection string for clients
const connectionString = service.getConnectionString();
console.log("Clients can connect using:", connectionString);
```

### Setting Up Relay Methods

The service needs methods for subscribing to and publishing events. You can set these globally or per instance:

```typescript
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();

// Set global methods
WalletService.subscriptionMethod = pool.subscription.bind(pool);
WalletService.publishMethod = pool.publish.bind(pool);

// Now all instances will use these methods by default
const service = new WalletService(options);
```

For more details on setting up relay methods, see the [Nostr Connect documentation](../signers/nostr-connect.md).

## Handling Authentication Requests

### Processing Auth URIs

When a client wants to connect, they'll provide a `nostr+walletauth://` URI. You need to:

1. **Parse the URI**: Extract the client's public key and secret
2. **Create a Service**: Use the extracted information to create a service instance
3. **Start the Service**: Begin listening for requests from that client

```typescript
import { parseWalletAuthURI } from "applesauce-wallet-connect/helpers";

// Parse the auth URI from the client
const { secret, service: clientPubkey, relays } = parseWalletAuthURI(authUri);

// Create a service instance for this client
const walletService = new WalletService({
  relays,
  signer,
  handlers,
  secret: hexToBytes(secret), // Convert hex secret to bytes
});

// Start the service
await walletService.start();

// The client can now connect using the connection string
const connectionString = walletService.getConnectionString();
```

### Using fromAuthURI

For convenience, you can use the `fromAuthURI` static method:

```typescript
const walletService = await WalletService.fromAuthURI(authUri, {
  signer,
  handlers,
});

await walletService.start();
```

## Method Handlers

### Understanding Handlers

Handlers are functions that implement the actual wallet functionality. Each handler corresponds to a NIP-47 command:

- `get_info`: Return wallet information
- `get_balance`: Return current balance
- `pay_invoice`: Process Lightning invoice payments
- `make_invoice`: Create new Lightning invoices
- `pay_keysend`: Send keysend payments
- And more...

For a complete list of available commands and their parameters, see the [NIP-47 specification](https://github.com/nostr-protocol/nips/blob/master/47.md#commands).

### Handler Implementation

Each handler receives the parameters from the client request and should return the appropriate result:

```typescript
const handlers: WalletServiceHandlers = {
  get_info: async () => {
    // Return wallet information
    return {
      alias: "My Wallet",
      color: "#ff6600",
      pubkey: await signer.getPublicKey(),
      network: "mainnet",
      block_height: 800000,
      block_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      methods: ["get_info", "get_balance", "pay_invoice"],
    };
  },

  get_balance: async () => {
    // Get balance from your Lightning node or database
    const balance = await getLightningBalance();
    return { balance };
  },

  pay_invoice: async (params) => {
    const { invoice, amount } = params;

    // Validate the invoice
    if (!isValidInvoice(invoice)) {
      throw new InvalidInvoiceError("Invalid Lightning invoice format");
    }

    // Check balance
    const balance = await getLightningBalance();
    if (balance < amount) {
      throw new InsufficientBalanceError(`Insufficient balance: ${balance} msats, required: ${amount} msats`);
    }

    // Process the payment through your Lightning node
    const result = await processLightningPayment(invoice, amount);

    return {
      preimage: result.preimage,
      fees_paid: result.fees_paid,
    };
  },
};
```

## Error Handling

### Throwing Typed Errors

When implementing handlers, you should throw appropriate error types for different failure scenarios:

```typescript
import {
  InsufficientBalanceError,
  InvalidInvoiceError,
  InternalError,
  WalletBaseError,
} from "applesauce-wallet-connect/helpers/error";

const payInvoiceHandler: PayInvoiceHandler = async (params) => {
  try {
    const { invoice, amount } = params;

    // Validate invoice
    if (!isValidInvoice(invoice)) {
      throw new InvalidInvoiceError("Invalid Lightning invoice format");
    }

    // Check balance
    const balance = await getLightningBalance();
    if (balance < amount) {
      throw new InsufficientBalanceError(`Insufficient balance: ${balance} msats, required: ${amount} msats`);
    }

    // Process payment
    const result = await processPayment(invoice, amount);
    return result;
  } catch (error) {
    if (error instanceof WalletBaseError) {
      throw error; // Re-throw wallet errors
    }

    // Wrap unexpected errors
    throw new InternalError(`Payment processing failed: ${error.message}`);
  }
};
```

### Available Error Types

- `InsufficientBalanceError`: When there's not enough balance
- `InvalidInvoiceError`: When an invoice is malformed
- `RateLimitedError`: When rate limits are exceeded
- `RestrictedError`: When an operation is not allowed
- `UserRejectedError`: When the user rejects the operation
- `NotImplementedError`: When a method is not supported
- `InternalError`: For unexpected internal errors

For a complete list of error types, see the [typedocs](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-wallet-connect.html).

## Sending Notifications

### Notifying Clients

You can send notifications to connected clients about important events:

```typescript
// Send a payment received notification
await service.notify("payment_received", {
  payment_hash: "abc123...",
  amount: 100000,
  fee: 1000,
});

// Send a payment sent notification
await service.notify("payment_sent", {
  payment_hash: "def456...",
  amount: 50000,
  fee: 500,
});
```

### Supported Notification Types

- `payment_received`: When a payment is received
- `payment_sent`: When a payment is sent
- `payment_failed`: When a payment fails

## Service Lifecycle

### Starting and Stopping

```typescript
// Start the service
await service.start();

// Check if running
if (service.isRunning()) {
  console.log("Service is active");
}

// Stop the service
service.stop();
```

### Graceful Shutdown

```typescript
// Handle shutdown signals
process.on("SIGTERM", () => {
  console.log("Shutting down wallet service...");
  service.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Shutting down wallet service...");
  service.stop();
  process.exit(0);
});
```

## Advanced Usage

### Dynamic Method Support

You can conditionally enable methods based on runtime conditions:

```typescript
const handlers: WalletServiceHandlers = {};

// Only enable payment methods if payment processor is available
if (paymentProcessor.isAvailable()) {
  handlers.pay_invoice = payInvoiceHandler;
  handlers.make_invoice = makeInvoiceHandler;
}

// Always enable info methods
handlers.get_info = getInfoHandler;
handlers.get_balance = getBalanceHandler;

const service = new WalletService({
  relays: ["wss://relay.example.com"],
  signer,
  handlers,
});
```

### Custom Error Types

You can create custom error types for your specific use cases:

```typescript
import { WalletBaseError } from "applesauce-wallet-connect/helpers/error";

class PaymentProcessorError extends WalletBaseError {
  constructor(
    public processorCode: string,
    message: string,
  ) {
    super("INTERNAL", `Payment processor error (${processorCode}): ${message}`);
  }
}

const payInvoiceHandler: PayInvoiceHandler = async (params) => {
  try {
    const result = await paymentProcessor.pay(params.invoice);
    return result;
  } catch (error) {
    if (error.code === "INSUFFICIENT_FUNDS") {
      throw new InsufficientBalanceError("Insufficient balance in payment processor");
    }

    throw new PaymentProcessorError(error.code, error.message);
  }
};
```
