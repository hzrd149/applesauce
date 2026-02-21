---
description: Reactive models for querying and subscribing to NIP-60 wallet state
---

# Wallet models

The `applesauce-wallet` package provides [models](https://applesauce.build/typedoc/modules/applesauce-wallet.Models.html) that subscribe to event-store streams and return computed observables. Use them with `eventStore.model(Model, ...args)`. The wallet **casts** (see [casts](./casts.md)) use these models internally (e.g. `Wallet.balance$` uses `WalletBalanceModel`).

Import from `applesauce-wallet/models`:

```typescript
import {
  WalletBalanceModel,
  WalletHistoryModel,
  WalletRedeemedModel,
  WalletTokensModel,
  EventNutZapzModel,
  ProfileNutZapzModel,
  ReceivedNutzapsModel,
} from "applesauce-wallet/models";
```

## WalletBalanceModel

Returns the visible balance per mint (sats). Subscribes to wallet token events (kind 375), filters to unlocked tokens, excludes deleted tokens, and sums proofs per mint (ignoring duplicate proofs).

```typescript
const balance$ = eventStore.model(WalletBalanceModel, pubkey);
balance$.subscribe((balance) => {
  // balance: Record<string, number>  e.g. { "https://mint.example.com": 1000 }
});
```

## WalletTokensModel

Returns a timeline of wallet token events (kind 375) for a pubkey. Optionally filter by unlocked status. Deleted tokens (per token content) are excluded.

```typescript
const allTokens$ = eventStore.model(WalletTokensModel, pubkey);
const unlockedOnly$ = eventStore.model(WalletTokensModel, pubkey, true);
const lockedOnly$ = eventStore.model(WalletTokensModel, pubkey, false);
```

## WalletHistoryModel

Returns a timeline of wallet history events (kind 7376) for a pubkey. Optionally filter by unlocked status.

```typescript
const allHistory$ = eventStore.model(WalletHistoryModel, pubkey);
const unlockedOnly$ = eventStore.model(WalletHistoryModel, pubkey, true);
const lockedOnly$ = eventStore.model(WalletHistoryModel, pubkey, false);
```

## WalletRedeemedModel

Returns the set of nutzap event IDs that have been marked as redeemed in wallet history events. Built by scanning history events for redeemed e-tags.

```typescript
const redeemedIds$ = eventStore.model(WalletRedeemedModel, pubkey);
redeemedIds$.subscribe((ids) => {
  // ids: string[]  nutzap event ids already received
});
```

## ReceivedNutzapsModel

Returns the same as `WalletRedeemedModel`: nutzap event IDs that have been received (appear as redeemed in unlocked wallet history). Implemented by composing `WalletHistoryModel` and extracting redeemed IDs.

```typescript
const receivedIds$ = eventStore.model(ReceivedNutzapsModel, pubkey);
```

## EventNutZapzModel

Returns nutzap events (kind 9734) that target a given event (e.g. a note). Uses common event-relation filters so nutzaps that reference the event are included. Only valid nutzap events are returned.

```typescript
const nutzaps$ = eventStore.model(EventNutZapzModel, someEvent);
```

## ProfileNutZapzModel

Returns nutzap events (kind 9734) that target a user’s profile (p-tag only; nutzaps targeting specific events are excluded).

```typescript
const profileNutzaps$ = eventStore.model(ProfileNutZapzModel, pubkey);
```

:::tip
For UI you typically use the **casts** (`Wallet`, `WalletToken`, `WalletHistory`, `Nutzap`) and `user.wallet$` from `applesauce-wallet/casts`, which consume these models. Use the models directly when you need raw event streams or custom pipelines.
:::
