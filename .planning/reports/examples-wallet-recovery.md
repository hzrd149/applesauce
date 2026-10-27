# Handoff: move example wallet-recovery logic into applesauce-wallet

## Why

`apps/examples/src/extra/` should only hold shared example infrastructure (`verifier.ts`, `encrypted-storage.tsx`). Three modules there go beyond that: they implement durable Cashu minting that `applesauce-wallet` does not provide, and they carry ~450 lines of tests inside the examples app. They were added in an unrelated commit (`13b0ee9f feat(common): split Napplet cast…`).

| File | Lines | Test | Consumers |
|---|---|---|---|
| `extra/deposit-recovery.ts` | 236 | `__tests__/deposit-recovery.test.ts` (214) | `wallet/wallet.tsx`, `wallet/admin.tsx`, `wallet/multiple-wallets.tsx` |
| `extra/nutzap-quote.ts` | 149 | `__tests__/nutzap-quote.test.ts` (125) | `nutzap/zap-profile.tsx`, `nutzap/contacts.tsx` |
| `extra/encrypted-couch.ts` | 125 | `__tests__/encrypted-couch.test.ts` (108) | the 3 wallet examples, plus `nutzap-quote.ts` and `deposit-recovery.ts` |

## The library gap

`NutWallet.deposit()` (`packages/wallet/src/wallet/nut-wallet.ts:660`) calls `createMintQuote` → `waitForMintQuote` → `redeemMintQuote`. That runs the `MintTokens`/`MintProofs` action (`packages/wallet/src/actions/tokens.ts:139-186`), which stores the token in the couch only **after** `mintProofsBolt11` returns.

If the app crashes, the tab closes, or the response is lost between "quote paid" and "proofs received", the mint has issued signatures that the client cannot unblind, and the funds are lost. The quote itself is never persisted either, so a paid invoice whose page reloaded cannot be resumed.

The example modules close this gap in four steps:

1. Persist the quote before showing the invoice.
2. After payment, `prepare()` the mint operation and persist the serialized `OutputData` (secrets and blinding factors) **before** calling `completeMint`.
3. On resume, if the quote is already `ISSUED`, call NUT-09 `mint.restore({ outputs })`, match the returned outputs to the saved ones by `B_`, and unblind them with `OutputData.toProof`.
4. Persist the resulting proofs, then publish, and only clear the record after the publish is accepted.

## What each file does

### `deposit-recovery.ts`: `recoverableDeposit(storage, wallet, opts)` / `resumeDeposit(storage, wallet, opts)`
- Stores a record keyed `${namespace}:${wallet.pubkey}`: `quote` → `preview` (serialized outputs) → `token` (serialized proofs) → `events` (signed) → `accepted` (event ids).
- Validates the quote's unit and amount against the record, and refuses to proceed if the record's owner is not `wallet.pubkey`.
- Signs the `WalletTokenFactory` and `WalletHistoryFactory` events **before** publishing and persists them, so retries republish the same ids instead of swapping proofs. It checks that the signer did not change mid-flow (with a `ProxySigner`, the account can switch underneath it).
- Publishes each event separately with an explicit verdict and records the accepted ids. It then removes matching tokens from `wallet.couch` and verifies they are gone.
- Uses a per-database in-memory `Set` plus `navigator.locks` (`ifAvailable`), so a second concurrent run fails fast in the same tab and across tabs.
- Supports an `AbortSignal` and requires an unlocked storage on every step.
- Imports `publishEvent` from `extra/publish.ts`. That file is being inlined into the examples, so the library version should do its own verdict checking.

### `nutzap-quote.ts`: `prepareNutzap(storage, input)` / `resumeNutzap(storage, publish, onInvoice)`
- Runs the same quote → preview → restore/complete → token flow, but mints **P2PK-locked** to the recipient's nutzap key (`.asP2PK({ pubkey })`). It then hands the token to a caller-supplied `publish(recipient, token, comment, couch)`, which is the `NutzapProfile`/`NutzapEvent` action.
- Uses a single global record key (`example-pending-nutzap`), so only one pending zap can exist at a time.
- Its lock *queues* (a promise chain plus `navigator.locks.request`) rather than failing fast.
- Exports the module-level `nutzapStorage$` subject that the nutzap examples use.

### `encrypted-couch.ts`: `createEncryptedCouch(getStorage, namespace)`, `tokenIdentity(token)`, `migrateLegacyCouch(target)`
- A `Couch` (`packages/wallet/src/helpers/couch.ts`) implemented over any async key-value store with `getItem`/`setItem`/`removeItem`. It stores one JSON array per namespace and serializes proofs with `serializeProofs` so `Amount` values round-trip.
- Serializes writes per key with a promise queue plus `navigator.locks`. The cleanup callback from `store()` captures the original storage and key, so switching accounts cannot clear another wallet's token.
- `tokenIdentity()` is an order-independent identity built from (mint without trailing slash, unit, sorted proof UIDs).
- `migrateLegacyCouch()` copies tokens from the plaintext `IndexedDBCouch` into the target couch, then deletes each legacy record.

## Inconsistencies to resolve while unifying

- The NUT-09 restore block is nearly duplicated between the two flows, but only `nutzap-quote` checks each restored signature's `amount` and keyset `id`. `deposit-recovery` skips those checks.
- Only `deposit-recovery` checks the quote's unit and amount against the saved record.
- The locking semantics differ: deposit fails fast and nutzap queues.
- Quote and amount serialization differ: deposit stores `amount` as a string, while nutzap re-wraps it with `Amount.from` after `JSON.parse`.

## Suggested shape (to validate against the CORD/Cashu specs and the wallet package's conventions)

- A small `RecoveryStore` interface (`getItem`/`setItem`/`removeItem`, string values) passed to `NutWallet` (e.g. `options.recovery`). The examples keep `SecureStorage` as the encrypted implementation, and the library could ship a plain IndexedDB or localStorage version.
- One internal "durable mint" primitive covering quote → persisted outputs → completeMint or NUT-09 restore → persisted proofs. `deposit()` and a nutzap mint path would both build on it, with resume entry points such as `NutWallet.resumeDeposit()` or a `pendingDeposits$` observable.
- A `KeyValueCouch` (the generic part of `encrypted-couch.ts`) next to `IndexedDBCouch` and `LocalStorageCouch` in `packages/wallet/src/helpers/`, with `tokenIdentity` and a migration helper exported.
- Port the three test files into `packages/wallet/src/**/__tests__`, and keep their failure-injection cases (persist failure stops minting, lost response then restore, publish rejection keeps proofs, signer switch).

## After the move

- Update the 5 consumer examples to use the library API, keeping `SecureStorage` and `UnlockView` for encryption.
- Delete the three modules and their tests from `apps/examples/src/extra/`.
- Follow the repo rules: one single-sentence changeset per consumer-visible change, single-line JSDoc, and breaking changes allowed on the v7 `next` line with migration notes.
- Verify with `pnpm --filter applesauce-wallet test`, `pnpm --filter applesauce-examples exec tsc -b`, and the browser for `wallet/wallet` and `nutzap/zap-profile`.
