# Wallet View Technical Report: Implementation Analysis and Applesauce Migration Guide

## Executive Summary

The wallet view (`src/views/wallet/index.tsx`) is a Cashu ecash wallet implementation built on the **applesauce** framework. It demonstrates a clean separation of concerns using applesauce's reactive model system, action-based mutations, and React hooks integration. This report details the architecture, data flow, and provides guidance for rebuilding similar functionality in other applications.

---

## Architecture Overview

### Core Dependencies

The wallet relies on several applesauce packages:

```
applesauce-core: ^4.4.2          // Core reactive models
applesauce-react: ^4.0.0         // React hooks integration
applesauce-wallet: ^4.0.0        // Wallet-specific models & actions
applesauce-actions: ^4.0.0       // Action system
```

### View Structure

```
/wallet/
├── index.tsx                    // Main wallet view
├── components/
│   ├── balance-card.tsx         // Balance display & quick actions
│   └── wallet-unlock-button.tsx // Unlock wallet UI
└── tabs/
    ├── history.tsx              // Transaction history
    ├── tokens.tsx               // Stored ecash tokens
    └── mints.tsx                // Connected mints & balances
```

---

## How Models Are Used

### 1. **WalletBalanceModel** - Reactive Balance Tracking

The `WalletBalanceModel` from `applesauce-wallet/models` provides real-time balance information:

```tsx
const balance = useEventModel(WalletBalanceModel, [account.pubkey]);
```

**What it does:**

- Returns a dictionary mapping mint URLs to token amounts: `{ [mintUrl: string]: number }`
- Automatically updates when tokens are added/removed
- Returns `undefined` when wallet is locked (encrypted)

**Usage in balance display:**

```tsx
{
  balance ? Object.values(balance).reduce((t, v) => t + v, 0) : "--Locked--";
}
```

**Usage in mints tab:**

```tsx
{balance &&
  Object.entries(balance).map(([mint, total]) => (
    // Render mint card
  ))
}
```

### 2. **WalletQuery** - Wallet Existence & State

Custom model defined in `src/models/wallet.ts`:

```tsx
export function WalletQuery(user: string | ProfilePointer): Model<WalletInfo | undefined> {
  const pointer = typeof user === "string" ? { pubkey: user } : user;
  return (events) =>
    events
      .replaceable({ kind: WALLET_KIND, pubkey: pointer.pubkey, relays: pointer.relays })
      .pipe(ignoreElements(), mergeWith(events.model(WalletModel, pointer.pubkey)));
}
```

**What it does:**

- Queries for the wallet replaceable event (kind 37375)
- Returns `WalletInfo` object containing wallet metadata
- Includes `locked` boolean indicating encryption state

**Usage:**

```tsx
const wallet = useUserWallet(account.pubkey);
```

Via the custom hook:

```tsx
export default function useUserWallet(user?: string | ProfilePointer) {
  return useEventModel(WalletQuery, user ? [user] : undefined);
}
```

### 3. **WalletHistoryModel** - Transaction History

Used in the history tab to display past transactions:

```tsx
const history = useEventModel(WalletHistoryModel, [account.pubkey]) ?? [];
const locked = useEventModel(WalletHistoryModel, [account.pubkey, true]) ?? [];
```

**Key features:**

- Second parameter `true` filters for locked (encrypted) entries only
- Returns array of Nostr events (kind 7376)
- Each event contains encrypted transaction details

### 4. **WalletTokensModel** - Stored Ecash Tokens

```tsx
const tokens = useEventModel(WalletTokensModel, [account.pubkey]) ?? [];
const locked = useEventModel(WalletTokensModel, [account.pubkey, true]) ?? [];
```

**What it does:**

- Returns array of token events (kind 7375)
- Each event stores encrypted Cashu token proofs
- Supports filtering for locked tokens

### 5. **TimelineModel** - Event Loading

```tsx
const { timeline: events, loader } = useTimelineLoader(`${account.pubkey}-wallet-tokens`, readRelays, [
  {
    kinds: [WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
    authors: [account.pubkey],
  },
  { kinds: [kinds.EventDeletion], "#k": [String(WALLET_TOKEN_KIND)], authors: [account.pubkey] },
]);
```

**How it works:**

- Creates a timeline subscription for wallet events
- Loads from user's outbox relays
- Includes deletion events for proper event handling
- Returns both the timeline and a loader for pagination

---

## Unlocking Mechanism

### The Lock/Unlock Pattern

The wallet uses **NIP-44 encryption** to protect sensitive data. When locked, token proofs and transaction details are encrypted with the user's private key.

### 1. **Unlock Button Component**

```tsx
export default function WalletUnlockButton({ children, ...props }: Omit<ButtonProps, "onClick" | "isLoading">) {
  const account = useActiveAccount()!;
  const wallet = useUserWallet(account.pubkey);

  const actions = useActionHub();
  const unlock = useAsyncAction(async () => {
    if (!wallet) throw new Error("Missing wallet");
    if (wallet.locked === false) return;

    await actions.run(UnlockWallet, { history: true, tokens: true });
  }, [wallet, actions]);

  return (
    <Button onClick={unlock.run} isLoading={unlock.loading} {...props}>
      {children || "Unlock"}
    </Button>
  );
}
```

**Key components:**

- `useActionHub()` - Gets the action dispatcher
- `UnlockWallet` action - Applesauce wallet action that decrypts data
- `useAsyncAction` - Custom hook that handles async operations with error toasts

### 2. **UnlockWallet Action**

From `applesauce-wallet/actions`, this action:

1. Prompts for NIP-07 signer access (if needed)
2. Decrypts all wallet events using the private key
3. Updates events in the event store
4. Options: `{ history: true, tokens: true }` control what to unlock

### 3. **Individual Entry Unlocking**

History entries can be unlocked individually:

```tsx
const { run: unlock } = useAsyncAction(async () => {
  await unlockHistoryContent(entry, account);
  eventStore.update(entry);
}, [entry, account, eventStore]);
```

Token entries similarly:

```tsx
const { run: unlock } = useAsyncAction(async () => {
  if (!account) return;
  await unlockTokenContent(token, account);
  eventStore.update(token);
}, [token, account, eventStore]);
```

**Helper functions from `applesauce-wallet/helpers`:**

- `unlockHistoryContent(event, account)` - Decrypts a history event
- `unlockTokenContent(event, account)` - Decrypts a token event
- `isHistoryContentUnlocked(event)` - Checks if already decrypted
- `isTokenContentUnlocked(event)` - Checks token encryption state
- `getHistoryContent(event)` - Extracts decrypted history data
- `getTokenContent(event)` - Extracts decrypted token proofs

### 4. **The useAsyncAction Hook**

Critical pattern for async operations in this codebase:

```tsx
export default function useAsyncAction<Args extends Array<any>, T = any>(
  fn: (...args: Args) => Promise<T>,
  deps: DependencyList = [],
): { loading: boolean; run: (...args: Args) => Promise<T | undefined> } {
  const ref = useRef(fn);
  ref.current = fn;

  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const run = useCallback<(...args: Args) => Promise<T | undefined>>(async (...args: Args) => {
    setLoading(true);
    try {
      const result = await ref.current(...args);
      setLoading(false);
      return result;
    } catch (e) {
      if (e instanceof Error) toast({ description: e.message, status: "error" });
      console.log(e);
    }
    setLoading(false);
  }, deps);

  return { loading, run };
}
```

**Benefits:**

- Automatic error handling with toast notifications
- Loading state management
- Clean separation from UI logic
- Follows workspace rule to avoid try/catch in components

---

## Data Flow Diagram

```
User Action (Unlock Button Click)
    ↓
useAsyncAction wrapper
    ↓
actions.run(UnlockWallet, options)
    ↓
UnlockWallet Action (applesauce-wallet)
    ├─→ Request signer access
    ├─→ Decrypt history events (if options.history)
    ├─→ Decrypt token events (if options.tokens)
    └─→ Update events in EventStore
    ↓
EventStore emits updates
    ↓
useEventModel hooks re-render
    ↓
UI updates with decrypted data
```

---

## Rebuilding in Another App with Applesauce

### Prerequisites

```json
{
  "dependencies": {
    "applesauce-core": "^4.4.2",
    "applesauce-react": "^4.0.0",
    "applesauce-wallet": "^4.0.0",
    "applesauce-actions": "^4.0.0",
    "applesauce-signers": "^4.2.0",
    "@cashu/cashu-ts": "latest"
  }
}
```

### Step 1: Setup Applesauce Context

Wrap your app with applesauce providers:

```tsx
import { EventStoreProvider } from "applesauce-react";
import { createEventStore } from "applesauce-core";
import { ActionHubProvider } from "applesauce-react/hooks";

const eventStore = createEventStore();

function App() {
  return (
    <EventStoreProvider store={eventStore}>
      <ActionHubProvider>
        <YourWalletView />
      </ActionHubProvider>
    </EventStoreProvider>
  );
}
```

### Step 2: Create Wallet View Component

```tsx
import { useActiveAccount, useEventModel, useActionHub } from "applesauce-react/hooks";
import { WalletBalanceModel } from "applesauce-wallet/models";
import { CreateWallet, UnlockWallet } from "applesauce-wallet/actions";
import { WALLET_KIND } from "applesauce-wallet/helpers";

function WalletView() {
  const account = useActiveAccount();
  const actions = useActionHub();

  // Check if wallet exists
  const wallet = useEventModel(WalletQuery, [account.pubkey]);

  // Get balance (undefined when locked)
  const balance = useEventModel(WalletBalanceModel, [account.pubkey]);

  const createWallet = async () => {
    await actions.run(CreateWallet, []);
  };

  const unlockWallet = async () => {
    await actions.run(UnlockWallet, { history: true, tokens: true });
  };

  if (!wallet) {
    return <button onClick={createWallet}>Create Wallet</button>;
  }

  const totalBalance = balance ? Object.values(balance).reduce((sum, val) => sum + val, 0) : 0;

  return (
    <div>
      <h1>Balance: {wallet.locked ? "Locked" : totalBalance}</h1>
      {wallet.locked && <button onClick={unlockWallet}>Unlock Wallet</button>}
    </div>
  );
}
```

### Step 3: Define Custom Models (if needed)

```tsx
import { Model } from "applesauce-core";
import { WalletModel } from "applesauce-wallet/models";
import { WALLET_KIND } from "applesauce-wallet/helpers";

export function WalletQuery(pubkey: string): Model<WalletInfo | undefined> {
  return (events) =>
    events
      .replaceable({ kind: WALLET_KIND, pubkey })
      .pipe(ignoreElements(), mergeWith(events.model(WalletModel, pubkey)));
}
```

### Step 4: Load Wallet Events

```tsx
import { useTimelineLoader } from "./hooks/use-timeline-loader";
import { WALLET_TOKEN_KIND, WALLET_HISTORY_KIND } from "applesauce-wallet/helpers";

function WalletHistory() {
  const account = useActiveAccount();
  const relays = ["wss://relay.damus.io"]; // Your relay list

  const { timeline, loader } = useTimelineLoader(`${account.pubkey}-wallet`, relays, [
    {
      kinds: [WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
      authors: [account.pubkey],
    },
  ]);

  return (
    <div>
      {timeline.map((event) => (
        <HistoryEntry key={event.id} event={event} />
      ))}
    </div>
  );
}
```

### Step 5: Handle Individual Entry Unlocking

```tsx
import { unlockHistoryContent, getHistoryContent, isHistoryContentUnlocked } from "applesauce-wallet/helpers";
import { useEventStore } from "applesauce-react/hooks";

function HistoryEntry({ event }) {
  const account = useActiveAccount();
  const eventStore = useEventStore();
  const locked = !isHistoryContentUnlocked(event);

  const unlock = async () => {
    await unlockHistoryContent(event, account);
    eventStore.update(event); // Trigger re-render
  };

  const details = locked ? null : getHistoryContent(event);

  return (
    <div>
      {locked ? (
        <button onClick={unlock}>Unlock Entry</button>
      ) : (
        <div>
          <p>Amount: {details.amount}</p>
          <p>Direction: {details.direction}</p>
          <p>Mint: {details.mint}</p>
        </div>
      )}
    </div>
  );
}
```

---

## Key Patterns & Best Practices

### 1. **Use Models for All Data Access**

❌ **Don't** query events directly:

```tsx
const events = eventStore.getEvents({ kinds: [WALLET_KIND] });
```

✅ **Do** use models:

```tsx
const wallet = useEventModel(WalletQuery, [pubkey]);
```

### 2. **Use Actions for All Mutations**

❌ **Don't** manually create/sign events:

```tsx
const event = await signer.sign({ kind: WALLET_KIND, ... });
```

✅ **Do** use actions:

```tsx
await actions.run(CreateWallet, []);
```

### 3. **Handle Async with useAsyncAction**

❌ **Don't** use try/catch in components:

```tsx
const onClick = async () => {
  try {
    await unlock();
  } catch (e) {
    toast({ status: "error", description: e.message });
  }
};
```

✅ **Do** use useAsyncAction:

```tsx
const unlock = useAsyncAction(async () => {
  await actions.run(UnlockWallet, options);
}, [actions]);

<button onClick={unlock.run} isLoading={unlock.loading}>
```

### 4. **Update EventStore After Manual Decryption**

Always call `eventStore.update(event)` after modifying an event:

```tsx
await unlockHistoryContent(entry, account);
eventStore.update(entry); // Required for reactivity
```

### 5. **Use Timeline Loaders for Event Subscriptions**

The `useTimelineLoader` pattern:

- Automatically subscribes to relays
- Handles pagination
- Integrates with intersection observers
- Caches results

---

## Security Considerations

1. **Encryption at Rest**: All sensitive data (tokens, history) is NIP-44 encrypted
2. **Signer Access**: Unlocking requires NIP-07 extension or other signer
3. **No Plaintext Storage**: Decrypted data only exists in memory
4. **Per-Entry Unlocking**: Users can unlock individual entries without exposing entire wallet
5. **Deletion Support**: Properly handles event deletion (kind 5) for privacy

---

## Common Gotchas

1. **Balance returns undefined when locked** - Always check for undefined before rendering
2. **EventStore updates don't auto-trigger** - Must call `eventStore.update()` after manual changes
3. **Models need dependencies array** - `useEventModel(Model, [pubkey])` not `useEventModel(Model, pubkey)`
4. **Locked filtering** - Second parameter to models filters locked entries: `useEventModel(WalletHistoryModel, [pubkey, true])`
5. **Timeline loader key** - Must be unique per timeline to avoid conflicts

---

## Conclusion

The wallet view demonstrates applesauce's strengths:

- **Reactive Models**: Data automatically updates across components
- **Action System**: Clean separation of business logic from UI
- **Type Safety**: Full TypeScript support throughout
- **Encryption**: Built-in NIP-44 support for sensitive data
- **Composability**: Models and actions are reusable across views

To rebuild this in another app, focus on:

1. Setting up applesauce providers correctly
2. Using `useEventModel` for all data access
3. Using `actions.run()` for all mutations
4. Following the unlock pattern with proper EventStore updates
5. Implementing error handling with `useAsyncAction`

The architecture scales well and provides excellent developer experience with minimal boilerplate.
