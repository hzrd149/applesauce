---
description: NIP-07 compatible signers for various platforms including browser extensions, hardware devices, and Nostr Connect
---

# Signers

All signers in the `applesauce-signers` package are compatible with the [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) API

## Features

- All signers follow the [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) API
- [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) `bunker://` URI support
- Support for client initinated NIP-46 connection (`nostrconnect://` URIs)
- [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md) encrypted password signer
- Support for [nostr-signing-device](https://github.com/lnbits/nostr-signing-device) on chrome based browsers
- Support for [Amber](https://github.com/greenart7c3/Amber) clipboard signer (deprecated)

## Installation

:::code-group

```sh [npm]
npm install applesauce-signers
```

```sh [yarn]
yarn install applesauce-signers
```

```sh [pnpm]
pnpm install applesauce-signers
```

:::
