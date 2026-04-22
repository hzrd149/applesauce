---
description: React hooks and providers for integrating Applesauce with reactive bindings for event models, accounts, actions, and content rendering
---

# React

The `applesauce-react` package connects Applesauce to React. It provides hooks that subscribe to observables and rerender components when data changes, plus context providers for dependency-injecting the event store, account manager, and action runner.

Non-React apps don't need this package — the core observables can be subscribed to directly with `.subscribe()`.

## Features

- **`use$`** hook — subscribe to any observable or chainable observable with automatic cleanup
- Hooks for the event store, models, accounts, active account, and action runner
- Hooks for rendering parsed NAST content and markdown
- Context providers for `EventStore`, `AccountManager`, and `ActionRunner`

## Installation

:::code-group

```sh [npm]
npm install applesauce-react
```

```sh [yarn]
yarn install applesauce-react
```

```sh [pnpm]
pnpm install applesauce-react
```

:::
