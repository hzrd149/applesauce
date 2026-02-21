---
description: Cast classes for NIP-60 wallet events with reactive observable properties
---

# Wallet casts

The `applesauce-wallet` package provides **casts** that wrap Nostr events into observable models. You get a wallet via the extended `User` from `applesauce-common`: after casting a pubkey to a user and importing the wallet casts, `user.wallet$` and related observables are available.

Import the casts (and register `wallet$` on `User`) from `applesauce-wallet/casts`:

```typescript
import { castUser, User } from "applesauce-common/casts";
import { Wallet, WalletToken, WalletHistory, Nutzap } from "applesauce-wallet/casts";
import "applesauce-wallet/casts"; // registers user.wallet$, user.nutzap$
```

## User extensions

Once the wallet casts are loaded, `User` has `user.wallet$` (replaceable wallet event) and `user.nutzap$` (nutzap info, kind 10019). For full API details see the [Casts module](https://applesauce.build/typedoc/modules/applesauce-wallet.Casts.html).

Example: get the wallet and subscribe to balance/tokens/history from it.

```typescript
const user = castUser(pubkey, eventStore);
const wallet = use$(user.wallet$);
const balance = use$(user.wallet$.balance$);
const tokens = use$(user.wallet$.tokens$);
const history = use$(user.wallet$.history$);
```

## Wallet

Cast for a NIP-60 wallet event (kind 17375). Sync getters return values from the current event; when content is locked, some return `undefined`.

[**Wallet** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-wallet.Casts.Wallet.html)

```typescript
const wallet = use$(user.wallet$);
if (!wallet) return null;
if (!wallet.unlocked) return <UnlockPrompt />;
const balance = use$(wallet.balance$);
const total = balance ? Object.values(balance).reduce((s, n) => s + n, 0) : 0;
```

## WalletToken

Cast for a wallet token event (kind 375). Content (proofs, mint) is hidden until unlocked.

[**WalletToken** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-wallet.Casts.WalletToken.html)

```typescript
function TokenEntry({ token }: { token: WalletToken }) {
  const meta = use$(token.meta$);
  const amount = use$(token.amount$);
  if (!token.unlocked || !meta) return <span>Locked</span>;
  return <div>{amount} sats · {meta.mint}</div>;
}
```

## WalletHistory

Cast for a wallet history event (kind 7376). Content is hidden until unlocked.

[**WalletHistory** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-wallet.Casts.WalletHistory.html)

```typescript
function HistoryEntry({ entry }: { entry: WalletHistory }) {
  const meta = use$(entry.meta$);
  if (!entry.unlocked || !meta) return <span>Locked</span>;
  return (
    <span className={meta.direction === "in" ? "text-success" : "text-error"}>
      {meta.direction === "in" ? "Received" : "Sent"} {meta.amount} sats
    </span>
  );
}
```

## Nutzap

Cast for a NIP-61 nutzap event. Public fields are readable without unlocking.

[**Nutzap** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-wallet.Casts.Nutzap.html)

```typescript
const nutzaps = use$(
  () => eventStore.timeline({ kinds: [NUTZAP_KIND], "#p": [user.pubkey] }).pipe(castTimelineStream(Nutzap, eventStore)),
  [user.pubkey],
);
// ...
const senderProfile = use$(nutzap.sender.profile$);
const zappedEvent = use$(nutzap.zapped$);
```

## NutzapInfo

Cast for nutzap info (kind 10019). Available as `user.nutzap$`. Describes where to receive nutzaps (relays, mints, P2PK pubkey).

[**NutzapInfo** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-wallet.Casts.NutzapInfo.html)

```typescript
const nutzapInfo = use$(user.nutzap$);
const mints = nutzapInfo?.mints ?? [];
```

:::tip
All casts extend `EventCast` and expose `id`, `uid`, `createdAt`, `author`, `seen`, and `event`. Use `use$` from `applesauce-react/hooks` (or subscribe directly) to consume observables in React.
:::
