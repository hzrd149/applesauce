# Wallet Actions

The `applesauce-wallet` package provides a set of [Actions](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-wallet.Actions.html) for common wallet operations.

## CreateWallet

Creates a new NIP-60 wallet event and wallet backup.

```typescript
import { CreateWallet } from "applesauce-wallet/actions";

await hub.run(CreateWallet, ["wss://mint.example.com"], privateKey);
```

## WalletAddPrivateKey

Adds a private key to an existing wallet event.

```typescript
import { WalletAddPrivateKey } from "applesauce-wallet/actions";

await hub.run(WalletAddPrivateKey, privateKey);
```

## UnlockWallet

Unlocks the wallet event and optionally unlocks tokens and history events.

```typescript
import { UnlockWallet } from "applesauce-wallet/actions";

// Unlock just the wallet
await hub.run(UnlockWallet);

// Unlock wallet and associated tokens/history
await hub.run(UnlockWallet, { tokens: true, history: true });
```

## ReceiveToken

Adds a Cashu token to the wallet and optionally marks nutzaps as redeemed.

```typescript
import { ReceiveToken } from "applesauce-wallet/actions";

await hub.run(ReceiveToken, token, redeemedEventIds);
```

## RolloverTokens

Deletes old tokens and creates a new consolidated token.

```typescript
import { RolloverTokens } from "applesauce-wallet/actions";

await hub.run(RolloverTokens, oldTokenEvents, newToken);
```

## CompleteSpend

Finalizes a spend operation by deleting spent tokens and creating a history entry.

```typescript
import { CompleteSpend } from "applesauce-wallet/actions";

await hub.run(CompleteSpend, spentTokenEvents, changeToken);
```

## ConsolidateTokens

Combines all unlocked token events into a single event per mint.

```typescript
import { ConsolidateTokens } from "applesauce-wallet/actions";

// Consolidate all unlocked tokens
await hub.run(ConsolidateTokens);

// Ignore locked tokens during consolidation
await hub.run(ConsolidateTokens, { ignoreLocked: true });
```

:::warning
Actions will throw errors if preconditions are not met (e.g., trying to add a private key to a locked wallet)
:::
