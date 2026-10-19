# applesauce-accounts

A simple nostr account management system built on top of [applesauce-signers](https://applesauce.build/signers/installation.html)

See [documentation](https://applesauce.build/signers/signers.html)

## Seed Words Account

Create a NIP-06 account from validated BIP-39 words with an explicitly imported wordlist:

```ts
import { SeedWordsAccount } from "applesauce-accounts/accounts/seed-words-account";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const account = SeedWordsAccount.fromWords(words, { wordlist });
manager.registerType(SeedWordsAccount);
manager.addAccount(account);
```

Register this optional account explicitly for restoration with `manager.fromJSON()`. Serialization stores the derived private key, ID, public key, and metadata; it does not retain the seed words or passphrase.
