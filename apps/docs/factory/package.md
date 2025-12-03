# Factory

The `EventFactory` class is now part of the `applesauce-core` package, providing a unified interface for creating and modifying Nostr events. Blueprints and additional operations are available in the `applesauce-common` package.

## Features

- Works with any NIP-07 signer ( `applesauce-signers` )
- Tons of pre-built operations for creating and modifying events
- Support for encrypted tags in NIP-51 events
- Pre-built operations for NIP-59 gift wrapping
- Blueprints for common event types
- Relays hints for `e` and `p` tags

## Installation

The EventFactory is part of `applesauce-core`:

:::code-group

```sh [npm]
npm install applesauce-core
```

```sh [yarn]
yarn install applesauce-core
```

```sh [pnpm]
pnpm install applesauce-core
```

:::

For blueprints and additional operations, also install `applesauce-common`:

:::code-group

```sh [npm]
npm install applesauce-common
```

```sh [yarn]
yarn install applesauce-common
```

```sh [pnpm]
pnpm install applesauce-common
```

:::
