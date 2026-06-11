---
description: A high-level NIP-60 Cashu wallet class for showing balance, receiving, and sending tokens
---

# NutWallet

`NutWallet` is a reusable, high-level [NIP-60](https://github.com/nostr-protocol/nips/blob/master/60.md) Cashu wallet. It wraps the lower-level [actions](./actions.md), [casts](./casts.md) and [models](./models.md) behind a single class so you don't have to wire them together yourself.

It takes care of loading the wallet's events, keeping the balance up to date, and running the common operations (receive, send, deposit, withdraw). State is exposed as RxJS observables so your UI can react to changes automatically.

## Creating a wallet instance

A `NutWallet` is built from a few shared dependencies: the user's `pubkey`, a `signer`, a `RelayPool`, an `EventStore`, and a `Couch` (safe temporary storage for tokens during multi-step operations).

```typescript
import { NutWallet } from "applesauce-wallet/wallet";
import { IndexedDBCouch } from "applesauce-wallet/helpers";

const wallet = new NutWallet({
  pubkey,
  signer,
  pool,
  eventStore,
  couch: new IndexedDBCouch(),
  autoUnlock: true,
});

await wallet.start();
```

`start()` begins loading the wallet's events from relays. With `autoUnlock: true` the wallet, its tokens and history are decrypted automatically as they load. Call `stop()` (or `dispose()`) when you're done to clean up subscriptions.

:::tip
If the user doesn't have a wallet yet, use `NutWallet.create()` to publish a new NIP-60 wallet event and return a started instance.
:::

## Showing the balance

The balance is exposed as observables that update on their own as tokens are received or spent.

```typescript
// Total balance across all mints, in sats
wallet.totalBalance$.subscribe((sats) => console.log(sats));

// Per-mint balances: { "https://mint.example.com": 1200 }
wallet.balance$.subscribe((balance) => console.log(balance));
```

In React, subscribe with the `use$` hook so the component re-renders when the balance changes:

```tsx
const total = use$(wallet.totalBalance$);
return <span>{total} sats</span>;
```

## Receiving tokens

Pass an encoded Cashu token string (or a decoded token) to `receiveToken()`. The wallet swaps the proofs at the mint and adds them to the balance.

```typescript
await wallet.receiveToken(tokenString);
```

The balance observables update automatically once the token is received.

## Sending tokens

`sendToken()` creates a new Cashu token for the given amount and returns the encoded string to hand off to the recipient.

```typescript
const token = await wallet.sendToken(500);

// Or restrict the send to a specific mint
const token = await wallet.sendToken(500, { mint: "https://mint.example.com" });
```

By default any mint with enough balance is used. The spent tokens are removed and the balance updates on its own.

## Lightning deposits and withdrawals

`NutWallet` also bridges to Lightning. `deposit()` adds sats by creating an invoice and waiting for it to be paid, and `withdraw()` pays a Lightning invoice from a mint's balance. Both take a payment `method` so new methods (bolt12, on-chain) slot in as cashu adds support; `payInvoice()` is a bolt11 alias for `withdraw()`.

```typescript
// Deposit: surface the invoice via onQuote, then wait + redeem automatically
await wallet.deposit({
  method: "bolt11",
  mint: "https://mint.example.com",
  amount: 1000,
  onQuote: (quote) => showInvoice(quote.request),
});

// Withdraw: pay a bolt11 invoice from a mint's balance
await wallet.withdraw({ method: "bolt11", mint: "https://mint.example.com", invoice });
```

## Caching decrypted content

NIP-60 wallet, token, and history events are NIP-44 encrypted, so every unlock asks the signer to decrypt them. Pass a `decryptionCache` and the wallet restores already-decrypted content from it before decrypting and persists newly decrypted content back after — so `unlock()` and `autoUnlock` never re-run decryption for content seen in a previous session.

The cache is any object with async `getItem`/`setItem` keyed by event id:

```typescript
import type { EncryptedContentCache } from "applesauce-common/helpers";

const decryptionCache: EncryptedContentCache = {
  getItem: async (id) => localStorage.getItem(`wallet-content:${id}`),
  setItem: async (id, content) => localStorage.setItem(`wallet-content:${id}`, content),
};

const wallet = new NutWallet({ pubkey, signer, pool, eventStore, couch, autoUnlock: true, decryptionCache });
await wallet.start();
```

With a warm cache, the wallet loads and unlocks without a single decryption request to the signer.

:::warning
The cache stores **decrypted** content — including raw Cashu proofs. Plain `localStorage` is shown for brevity; a real app should encrypt the cache at rest (see the wallet/admin example's `SecureStorage`, which satisfies `EncryptedContentCache` directly).
:::

## Tracking status

Beyond the balance, the wallet exposes observables for its lifecycle and activity, useful for loading states and disabling buttons while work is in progress.

```typescript
wallet.status$.subscribe((status) => console.log(status)); // idle | loading | ready | missing
wallet.busy$.subscribe((busy) => console.log(busy)); // true while any operation runs
wallet.errorState$.subscribe((error) => console.log(error)); // most recent error
```

See the [TypeDoc reference](https://applesauce.build/typedoc/classes/applesauce-wallet.wallet.NutWallet.html) for the full list of fields and methods.
