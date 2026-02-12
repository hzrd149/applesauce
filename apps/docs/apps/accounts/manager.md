---
description: Core AccountManager class for managing multiple accounts with active account tracking and JSON persistence
---

# Account Manager

The [AccountManager](https://applesauce.hzrd149.com/typedoc/classes/applesauce-accounts.AccountManager.html) class is the core of the library, as its name suggests its used to manage multiple accounts

## Account types

By default the account manager comes with no account types. you have to manually add them when you create the instance. luckily there is a handy method to add the most common types [registerCommonAccountTypes](https://applesauce.hzrd149.com/typedoc/classes/applesauce-accounts.registerCommonAccountTypes.html)

```ts
import { AccountManager, registerCommonAccountTypes, AmberClipboardAccount } from "applesauce-accounts";

// create an account manager instance
const manager = new AccountManager();

// register common account types
registerCommonAccountTypes(manager);

// manually add account type
manager.registerType(AmberClipboardAccount);
```

## Adding and removing accounts

```ts
import { AccountManager, registerCommonAccountTypes, PrivateKeyAccount } from "applesauce-accounts";

// create an account manager instance
const manager = new AccountManager();

// register common account types
registerCommonAccountTypes(manager);

// subscribe to the active account
manager.active$.subscribe((account) => {
  if (account) console.log(`${account.id} is now active`);
  else console.log("no account is active");

  updateUI();
});

// create an account
const account = PrivateKeyAccount.fromKey("788229e1801c4576391d39a03610293ea7e6645c9d39aca54c62fc6d71cbc385");

// add it to the manager
manager.addAccount(account);

// set it as active
manager.setActive(account);

// later, remove the account and the active account will also update
manager.removeAccount(account.id);
```

## Active account

The `AccountManager` class exposes a set of methods to track which account is active and switch the active account

- `AccountManager.active` gets the currently active account
- `AccountManager.active$` an observable of the active account, can be used to subscribe to changes
- `AccountManager.setActive(id: string | Account)` set the active account

## Persisting accounts

The account manager exposes two methods that can be used to persist accounts between app reloads. `toJSON` and `fromJSON`

```ts
import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

// create an account manager instance
const manager = new AccountManager();

// register common account types
registerCommonAccountTypes(manager);

// first load all accounts from localStorage
const json = JSON.parse(localStorage.getItem("accounts") || "[]");
await manager.fromJSON(json);

// next, subscribe to any accounts added or removed
manager.accounts$.subscribe((accounts) => {
  // save all the accounts into the "accounts" field
  localStorage.setItem("accounts", JSON.stringify(manager.toJSON()));
});

// load active account from storage
const active = localStorage.getItem("active");
if (active) manager.setActive(active);

// subscribe to active changes
manager.active$.subscribe((account) => {
  if (account) localStorage.setItem("active", account.id);
  else localStorage.clearItem("active");
});
```

## Integration

### With EventFactory

The AccountManager's `signer` property automatically points to the active account:

```ts
const factory = new EventFactory({ signer: manager.signer });

manager.setActive(account1);
await factory.sign(draft); // Uses account1

manager.setActive(account2);
await factory.sign(draft); // Uses account2
```

### With ActionRunner

```ts
const factory = new EventFactory({ signer: manager.signer });
const actions = new ActionRunner(eventStore, factory, publishFn);

await actions.run(FollowUser, pubkey); // Uses active account

manager.setActive(differentAccount);
await actions.run(FollowUser, pubkey); // Automatically uses new account
```

### With ProxySigner

Create custom proxy signers for specific accounts:

```ts
const specificSigner = new ProxySigner(
  manager.accounts$.pipe(map((accounts) => accounts.find((a) => a.id === specificId)?.signer)),
);
```

### With React

```tsx
function AccountSwitcher() {
  const accounts = use$(manager.accounts$);
  const active = use$(manager.active$);

  return (
    <select value={active?.id} onChange={(e) => manager.setActive(e.target.value)}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.metadata?.name}
        </option>
      ))}
    </select>
  );
}
```

## Best Practices

### Single Instance

```ts
// accounts.ts
export const manager = new AccountManager();
registerCommonAccountTypes(manager);
```

### Auto-save Pattern

```ts
// Load from storage
await manager.fromJSON(JSON.parse(localStorage.getItem("accounts") || "[]"));

// Auto-save on changes
manager.accounts$.subscribe(() => {
  localStorage.setItem("accounts", JSON.stringify(manager.toJSON()));
});

// Save/restore active account
manager.active$.subscribe((account) => {
  if (account) localStorage.setItem("active", account.id);
});

const activeId = localStorage.getItem("active");
if (activeId) manager.setActive(activeId);
```

### Register Types Early

```ts
// ✅ Good - register before loading
registerCommonAccountTypes(manager);
await manager.fromJSON(saved);

// ❌ Bad - types not registered
await manager.fromJSON(saved);
registerCommonAccountTypes(manager);
```

### Type-Safe Metadata

```ts
interface AccountMeta {
  name: string;
  color: string;
}

const manager = new AccountManager<AccountMeta>();
const account = PrivateKeyAccount.generateNew<AccountMeta>();
account.metadata = { name: "Alice", color: "#ff0000" };
```

### Error Handling

```ts
const account = manager.getAccount(accountId);
if (!account) {
  console.error("Account not found");
  return;
}
manager.setActive(account);
```
