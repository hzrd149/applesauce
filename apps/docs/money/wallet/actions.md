---
description: Actions for managing NIP-60 Cashu wallets including creating, minting, and spending tokens
---

# Wallet Actions

The `applesauce-wallet` package provides a set of [Actions](https://applesauce.build/typedoc/modules/applesauce-wallet.Actions.html) for common wallet operations. Actions are run via `ActionRunner`; the examples below use `actions.run()` where `actions` is an `ActionRunner` instance.

## CreateWallet

Creates a new NIP-60 wallet event, optional wallet backup, and optional nutzap info. Pass an object with `mints` (required), and optionally `privateKey` (for backup and receiving nutzaps) and `relays`.

```typescript
import { CreateWallet } from "applesauce-wallet/actions";

await actions.run(CreateWallet, {
  mints: ["https://mint.example.com"],
  privateKey: receiveNutzaps ? generateSecretKey() : undefined,
  relays: ["wss://relay.damus.io", "wss://nos.lol"],
});
```

## WalletAddPrivateKey

Adds a private key to an existing wallet event. Requires the wallet to be unlocked.

```typescript
import { WalletAddPrivateKey } from "applesauce-wallet/actions";

await actions.run(WalletAddPrivateKey, privateKey);
await actions.run(WalletAddPrivateKey, privateKey, true); // override existing
```

## UnlockWallet

Unlocks the wallet event and optionally unlocks tokens and history events.

```typescript
import { UnlockWallet } from "applesauce-wallet/actions";

await actions.run(UnlockWallet);
await actions.run(UnlockWallet, { tokens: true, history: true });
```

## SetWalletMints

Sets the mints on the wallet event. Requires the wallet to be unlocked.

```typescript
import { SetWalletMints } from "applesauce-wallet/actions";

await actions.run(SetWalletMints, ["https://mint.example.com", "https://mint2.example.com"]);
```

## SetWalletRelays

Sets the relays on the wallet event. Requires the wallet to be unlocked.

```typescript
import { SetWalletRelays } from "applesauce-wallet/actions";

await actions.run(SetWalletRelays, [...currentRelays, "wss://relay.example.com"]);
```

## ReceiveToken

Swaps a Cashu token at the mint, adds it to the wallet, and optionally creates a history entry. Pass a decoded token and optional `{ addHistory?, couch? }`.

```typescript
import { ReceiveToken } from "applesauce-wallet/actions";
import { getDecodedToken } from "@cashu/cashu-ts";

const token = getDecodedToken(tokenString);
await actions.run(ReceiveToken, token, { couch });
```

## ReceiveNutzaps

Receives P2PK-locked tokens from one or more nutzap events: unlocks with the wallet private key, adds tokens to the wallet, and marks nutzaps as redeemed. Pass nutzap event(s) and optionally a couch.

```typescript
import { ReceiveNutzaps } from "applesauce-wallet/actions";

await actions.run(ReceiveNutzaps, nutzap.event, couch);
await actions.run(ReceiveNutzaps, nutzapEvents, couch);
```

## TokensOperation

Safely selects tokens, runs an async operation (e.g. send or melt), and completes the spend with optional change. Requires a couch so tokens can be recovered if the operation fails. Pass minimum amount (sats), an async callback that receives `{ selectedProofs, mint, cashuWallet }` and returns `{ change? }`, and options `{ mint?, couch, tokenSelection? }`.

```typescript
import { TokensOperation } from "applesauce-wallet/actions";
import { getEncodedToken } from "@cashu/cashu-ts";

await actions.run(
  TokensOperation,
  sendAmount,
  async ({ selectedProofs, mint, cashuWallet }) => {
    const { keep, send } = await cashuWallet.ops.send(sendAmount, selectedProofs).run();
    const sendToken = { mint, proofs: send, unit: "sat" as const };
    setCreatedToken(getEncodedToken(sendToken));
    return { change: keep.length > 0 ? keep : undefined };
  },
  { mint: selectedMint, couch },
);
```

## RolloverTokens

Deletes old token events and creates a new consolidated token event. Does not add a history entry.

```typescript
import { RolloverTokens } from "applesauce-wallet/actions";

await actions.run(RolloverTokens, oldTokenEvents, newToken);
```

## ConsolidateTokens

Combines unlocked token events into one event per mint, verifying proofs at the mint. Optionally unlock token content first with `{ unlockTokens: true }`.

```typescript
import { ConsolidateTokens } from "applesauce-wallet/actions";

await actions.run(ConsolidateTokens);
await actions.run(ConsolidateTokens, { unlockTokens: true });
```

## CompleteSpend

Finalizes a spend by deleting spent token events and creating a history entry. Optionally pass a couch for change token safety.

```typescript
import { CompleteSpend } from "applesauce-wallet/actions";

await actions.run(CompleteSpend, spentTokenEvents, changeToken);
await actions.run(CompleteSpend, spentTokenEvents, changeToken, couch);
```

## RecoverFromCouch

Recovers tokens stored in a couch (e.g. after a failed operation): checks they are unspent and adds them to the wallet if not already present.

```typescript
import { RecoverFromCouch } from "applesauce-wallet/actions";

await actions.run(RecoverFromCouch, couch);
```

## AddNutzapInfoMint

Adds a mint to the nutzap info event (for receiving nutzaps). Pass `{ url, units? }` or an array of same.

```typescript
import { AddNutzapInfoMint } from "applesauce-wallet/actions";

await actions.run(AddNutzapInfoMint, { url: mintUrl, units: ["sat"] });
```

## RemoveNutzapInfoMint

Removes a mint from the nutzap info event.

```typescript
import { RemoveNutzapInfoMint } from "applesauce-wallet/actions";

await actions.run(RemoveNutzapInfoMint, mintUrl);
```

:::warning
Actions throw if preconditions are not met (e.g. adding a private key to a locked wallet, or running token operations without a couch when required).
:::
