# Models

The `applesauce-wallet` package provides a few pre-built models for subscribing to the state of the wallet.

## WalletModel

The `WalletModel` subscribes to the state of a NIP-60 wallet, providing information about whether it's locked and its associated mints.

```typescript
import { WalletModel } from "applesauce-wallet/models";

const wallet = eventStore.model(WalletModel, pubkey).subscribe((info) => {
  if (!info) return console.log("No wallet found");

  if (info.locked) {
    console.log("Wallet is locked");
  } else {
    console.log("Wallet mints:", info.mints);
    console.log("Has private key:", !!info.privateKey);
  }
});
```

## WalletTokensQuery

The `WalletTokensQuery` subscribes to all token events for a wallet, with optional filtering by locked status.

```typescript
import { WalletTokensModel } from "applesauce-wallet/models";

// Get all tokens
const allTokens = eventStore.model(WalletTokensModel, pubkey);

// Get only unlocked tokens
const unlockedTokens = eventStore.model(WalletTokensModel, pubkey, false);
```

## WalletBalanceQuery

The `WalletBalanceQuery` returns the visible balance of a wallet for each mint.

```typescript
import { WalletBalanceModel } from "applesauce-wallet/models";

eventStore.model(WalletBalanceModel, pubkey).subscribe((balances) => {
  for (const [mint, amount] of Object.entries(balances)) {
    console.log(`Balance for ${mint}: ${amount}`);
  }
});
```
