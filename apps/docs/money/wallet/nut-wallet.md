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

Deposits require a consumer-provided `recovery` store and a mint supporting [NUT-09 signature restoration](https://github.com/cashubtc/nuts/blob/main/09.md). Constructing, starting, and reading a wallet do not require recovery storage. There is no nonrecoverable fallback for `deposit()`, `createMintQuote()`, or `redeemMintQuote()`.

```typescript
const recovery = localforage.createInstance({
  name: "my-app",
  storeName: `deposits_${pubkey}`,
});

const wallet = new NutWallet({
  pubkey,
  signer,
  pool,
  eventStore,
  couch,
  recovery,
});
```

`RecoveryStorage` from `applesauce-wallet/helpers` requires async `getItem(key)`, `setItem(key, value)`, `removeItem(key)`, and `keys()`. LocalForage instances satisfy this interface directly, including their value-returning `setItem`. Values are strings; `getItem` returns `null` only for missing keys. Reads must reject when locked or unreadable, and mutations must resolve only once durable. A write returning `false` is treated as failure.

Recovery records contain spendable proofs, secrets, and blinding factors: **encrypt them at rest**. The plain LocalForage instance above illustrates scoping, not encryption. The examples use `SecureStorage.createInstance(options)` to wrap isolated LocalForage stores with the already-unlocked encryption key.

The app owns storage isolation: supply a dedicated store for each account and purpose, and reopen that same store after restart. There is no wallet namespace option. Library record prefixes only organize internal records and validate ownership.

Within a JavaScript context, locks and couch write queues are scoped to the supplied storage object; reuse that adapter instance for a shared store. For multiple tabs, workers, or processes, provide `storage.withLock(key, operation)` backed by locks qualified with the backend's own identity. The example `SecureStorage` derives Web Lock names from the LocalForage database name and store name. The wallet never creates global cross-store locks from record keys alone.

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

### Resuming interrupted deposits

The quote is saved before `onQuote` runs. Exact blinded outputs are saved before minting; proofs and signed events are saved before publication. Retries reuse the signed event IDs and require at least one positive relay response for each event before deleting the journal. Pending proofs are held separately from the ordinary couch, so `recoverFromCouch()` cannot swap them during a deposit retry.

```typescript
const pending = await wallet.getPendingDeposits();
// Let the user select an operation after unlocking storage.
await wallet.resumeDeposit(selectedId, {
  onQuote: (quote) => showInvoice(quote.request),
  signal: controller.signal,
});
```

Multiple deposits can remain pending independently. Creating or starting a wallet never resumes them automatically. Cancellation, payment timeouts, signer changes, and publication failures retain recovery state; cancelling does not invalidate the invoice. Do not delete a paid operation's recovery data.

For manual invoice handling, `createMintQuote()` also persists its quote; `redeemMintQuote()` resumes the matching operation. Externally created quotes can be adopted before redemption, but a quote already issued without saved outputs cannot be recovered by inventing new outputs.

### Invoice-funded nutzaps

`MintRecovery` shares the same minting journal without requiring a full `NutWallet`. Read the recipient's nutzap information first and pass its accepted mint, P2PK key, and delivery relays:

```typescript
const recovery = new MintRecovery({
  storage: encryptedStorage,
  owner: pubkey,
  signer,
  publish: async (event, relays) => {
    const responses = await pool.publish(relays ?? [], event);
    if (!responses.some((response) => response.ok)) throw new Error("Nutzap rejected");
  },
  onAccepted: (event) => eventStore.add(event),
});
const pending = await recovery.prepare({
  mint,
  amount: 21,
  nutzap: { recipient, p2pk, relays, comment: "Thanks!" },
});
await recovery.resume(pending.id, { onQuote: (quote) => showInvoice(quote.request) });
```

Import `MintRecovery` from `applesauce-wallet/helpers`. Use `getPending()` after restart and `resume(id)` for an explicit retry. The optional `nutzap.event` targets an event instead of a profile. `publish` must reject unless publication is explicitly accepted; resolving a transport operation alone is not sufficient. The recipient and lock key are persisted, rather than replaced by the currently selected profile on resume.

### Migrating existing consumers

Consumers upgrading to this API must configure `recovery` before creating or redeeming invoices. Existing `Couch` implementations remain supported. `KeyValueCouch` takes an already-scoped string store, without a namespace or storage-key argument:

```typescript
const proofStorage = encryptedStorage.createInstance({
  name: "my-app",
  storeName: `proofs_${pubkey}`,
});
const couch = new KeyValueCouch(proofStorage);
await migrateCouch(oldCouch, couch);
```

`migrateCouch` requires independent source and target storage scopes, persists each token in the target before removing its source copy, and can be retried after interruption. For earlier array-based example backups, use `couch.importLegacy(oldStorage, oldKey)` to copy into the scoped store before deleting the old record.

Use `wallet.importLegacyDeposit(key, oldStorage)` to import an earlier owner-tagged example deposit, including saved outputs, proofs, signed events, and acceptance state. Import its legacy couch first so the journal migration can remove duplicate couch proofs while the old journal still retains them; the old journal is removed only after the new copy is durable. Legacy invoice-funded nutzaps did not identify an owner: call `recovery.importLegacyNutzap(key, getRecipientRelays, oldStorage)` only after the user explicitly chooses the owning account; the callback resolves delivery relays for the saved recipient. The source storage arguments are optional when importing within the same store.

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
The cache stores **decrypted** content — including raw Cashu proofs. Plain `localStorage` is shown for brevity; a real app should encrypt the cache at rest (see the cashu-wallet/admin example's `SecureStorage`, which satisfies `EncryptedContentCache` directly).
:::

## Tracking status

Beyond the balance, the wallet exposes observables for its lifecycle and activity, useful for loading states and disabling buttons while work is in progress.

```typescript
wallet.status$.subscribe((status) => console.log(status)); // idle | loading | ready | missing
wallet.busy$.subscribe((busy) => console.log(busy)); // true while any operation runs
wallet.errorState$.subscribe((error) => console.log(error)); // most recent error
```

See the [TypeDoc reference](https://applesauce.build/typedoc/classes/applesauce-wallet.wallet.NutWallet.html) for the full list of fields and methods.
