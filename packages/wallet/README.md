# Applesauce Wallet

The `applesauce-wallet` package is a package of helpers, models, blueprints and other useful stuff for [NIP-60](https://github.com/nostr-protocol/nips/blob/master/60.md) wallets and [NIP-61](https://github.com/nostr-protocol/nips/blob/master/61.md) nutzaps

Start with [NutWallet](https://applesauce.build/money/wallet/nut-wallet) for balance, token transfers, Lightning deposits and withdrawals over your application's signer, EventStore and RelayPool.

- [Durable deposit recovery](https://applesauce.build/money/wallet/nut-wallet#resuming-interrupted-deposits): reopen account-scoped encrypted storage and explicitly resume pending operations after restart.
- [Invoice-funded nutzaps](https://applesauce.build/money/wallet/nut-wallet#invoice-funded-nutzaps): use `MintRecovery` without a full wallet.
- [KeyValueCouch and migration](https://applesauce.build/money/wallet/nut-wallet#migrating-existing-consumers): persist tokens in consumer-provided storage and migrate with copy-before-delete semantics.

The [wallet guides](https://applesauce.build/money/wallet/package) also cover lower-level actions, casts and models.
