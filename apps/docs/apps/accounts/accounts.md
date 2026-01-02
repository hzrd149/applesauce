# Accounts

The [account classes](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-accounts.Accounts.html) are simple wrappers around various [Signers](../../creating/signers/signers.md) and expose a `toJSON` and `fromJSON` method to let you save them to localStorage or indexeddb databases

## Built-in account types

- [ExtensionAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.ExtensionAccount.html) is a wrapper around [ExtensionSigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.ExtensionSigner.html)
- [PasswordAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.PasswordAccount.html) is a wrapper around [PasswordSigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.PasswordSigner.html)
- [NostrConnectAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.NostrConnectAccount.html) is a wrapper around [NostrConnectSigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.NostrConnectSigner.html)
- [PrivateKeyAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.PrivateKeyAccount.html) is a wrapper around [PrivateKeySigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.PrivateKeySigner.html)
- [SerialPortAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.SerialPortAccount.html) is a wrapper around [SerialPortSigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.SerialPortSigner.html)
- [ReadonlyAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.ReadonlyAccount.html) is a wrapper around [ReadonlySigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.ReadonlySigner.html)
- [AmberClipboardAccount](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-accounts.Accounts.AmberClipboardAccount.html) is a wrapper around [AmberClipboardSigner](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-signers.AmberClipboardSigner.html)

## Creating new accounts

All account classes require the signer to be created and setup first

```ts
import { PrivateKeySigner } from "applesauce-signers/signers";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";

// create the signer first
const signer = new PrivateKeySigner();

// setup signer
const pubkey = await signer.getPublicKey();

// create account
const account = new PrivateKeyAccount(pubkey, signer);
```

For a nostr connect signer it would look something like

```ts
import { NostrConnectSigner } from "applesauce-signers/signers";
import { NostrConnectAccount } from "applesauce-accounts/accounts";

const signer = await NostrConnectSigner.fromBunkerURI("bunker://....");

const pubkey = await signer.getPublicKey();

const account = new NostrConnectAccount(pubkey, signer);
```

## Request queue

By default all accounts use a request queue, so the signer only gets on sign/encrypt/decrypt request at a time. This should make it safe to make a bunch of requests to the account without overloading the user

```ts
import { ExtensionSigner } from "applesauce-signers/signers";
import { ExtensionAccount } from "applesauce-accounts/accounts";

const signer = new ExtensionSigner();
const pubkey = await signer.getPublicKey();

const account = new ExtensionAccount(pubkey, signer);

// make requests
account.signEvent({ kind: 1, content: "hello world", created_at: 0, tags: [] }).then((signed) => {
  console.log(signed);
});

// make another without waiting
account.signEvent({ kind: 1, content: "creating spam", created_at: 0, tags: [] }).then((signed) => {
  console.log(signed);
});

account.nip04
  .decrypt("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", "encrypted-text")
  .then((plaintext) => {
    console.log(plaintext);
  });
```

All the requests will be made one at a time in order, if any request fails (user rejects, signer timeout) then the queue will continue

The `account.abortQueue(reason?: Error)` method can be used to abort all pending requests. this will cause all promises to throw with `undefined` or `reason` if it was passed to the `abortQueue` method

To disable the request queue set `account.disableQueue = false` directly after creating the account. it can also be disabled on the `AccountManager` before any accounts are added

## Custom account types

To create your own account type first your going to need to create a new signer class that implements [Nip07Interface](https://hzrd149.github.io/applesauce/typedoc/types/applesauce-signers.Nip07Interface.html)

### Create a new signer class

```ts
class ApiSigner implements Nip07Interface {
  nip04: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };

  constructor(public api: string) {
    // extra boilerplate to make sure encryption methods are nested under .nip04 and .nip44
    this.nip04 = {
      encrypt: this.nip04Encrypt.bind(this),
      decrypt: this.nip04Decrypt.bind(this),
    };
    this.nip44 = {
      encrypt: this.nip44Encrypt.bind(this),
      decrypt: this.nip44Decrypt.bind(this),
    };
  }

  async getPublicKey(): Promise<string> {
    const res = await fetch(this.api + "/get-public-key");
    const json = await res.json();
    return json.pubkey;
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    const res = await fetch(this.api + "/sign", { body: template, method: "POST" });
    const json = await res.json();
    return json.event;
  }

  nip04Encrypt(): string {
    throw new Error("Not implemented yet");
  }
  nip04Decrypt(): string {
    throw new Error("Not implemented yet");
  }
  nip44Encrypt(): string {
    throw new Error("Not implemented yet");
  }
  nip44Decrypt(): string {
    throw new Error("Not implemented yet");
  }
}
```

### Create a new account class

Next create a new account class that extends `BaseAccount` to wrap the signer

```ts
import { SerializedAccount, BaseAccount } from "applesauce-accounts";

type ApiAccountSignerData = {
  api: string;
};

// Its good practice to make the class have a generic type for metadata
export default class ApiAccount<Metadata extends unknown> extends BaseAccount<
  ApiSigner,
  ApiAccountSignerData,
  Metadata
> {
  // NOTE: you must set the static type, otherwise it cant be used in the AccountManager
  static type = "api-account";

  // add a toJSON method that saves all relevant information for the account
  toJSON() {
    return {
      // save basic account information
      type: ApiAccount.type,
      id: this.id,
      pubkey: this.pubkey,
      metadata: this.metadata,

      // save important signer data
      signer: {
        api: this.signer.api,
      },
    };
  }

  // add a static fromJSON method so it can be re-created when the app loads again
  static fromJSON<Metadata extends unknown>(
    json: SerializedAccount<ApiAccountSignerData, Metadata>,
  ): ApiAccount<Metadata> {
    // create signer with saved data
    const signer = new ApiSigner(json.signer.api);

    // create new account class
    const account = new ApiAccount(json.pubkey, signer);

    // don't forget to call loadCommonFields, it sets the id and metadata
    return super.loadCommonFields(account);
  }
}
```

### Add account type to account manager

Next you need to register the account type

Now you can create a new `ApiSigner` and add it to the account manager

```ts
const signer = new ApiSigner("https://api.example.com");
const pubkey = await signer.getPublicKey();
const account = new ApiAccount(pubkey, signer);

accountManager.addAccount(account);
accountManager.setActive(account);
```
