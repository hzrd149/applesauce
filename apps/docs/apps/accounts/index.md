---
description: Account management system with support for saving, loading, and managing multiple Nostr accounts with custom metadata
---

# Accounts

The `applesauce-accounts` package provides a system for managing multiple Nostr accounts in your app. It wraps signers in serializable account classes, tracks which one is active, and exposes a single reactive signer that always points at the current user.

## Features

- **`AccountManager`** — central class that tracks accounts, the active account, and exposes a reactive `signer` proxy
- Built-in account types wrapping every signer in `applesauce-signers` (extension, private key, NIP-49 password, NIP-46 bunker, readonly, Amber, serial port, Android native)
- JSON serialization for saving and restoring accounts across sessions
- Per-account metadata (name, icon, color, etc) with typed generics
- Built-in request queue so signers don't get hammered with concurrent requests
- Supports custom account types

## Installation

:::code-group

```sh [npm]
npm install applesauce-accounts applesauce-signers
```

```sh [yarn]
yarn install applesauce-accounts applesauce-signers
```

```sh [pnpm]
pnpm install applesauce-accounts applesauce-signers
```

:::

> [!INFO]
> `applesauce-signers` provides the signer classes that account types wrap. You'll almost always want both.
