---
description: Collection of NIP-07 signers including password, private key, extension, and hardware signers
---

## Password Signer

The [PasswordSigner](https://applesauce.build/typedoc/classes/applesauce-signers.PasswordSigner.html) is a [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md) (Private Key Encryption) signer

To reuse an existing `ncryptsec` you can set the `signer.ncryptsec` field

```ts
// create a new password signer
const signer = new PasswordSigner();

// use a pre-existing ncryptsec
signer.ncryptsec = "ncryptsec1q...";
```

To create a new ncryptsec you can set the `signer.key` field on the signer

```ts
// create a new password signer
const signer = new PasswordSigner();

// or create a new one using a key and password
const randomBytes = new Uint8Array(64);
window.crypto.getRandomValues(randomBytes);

signer.key = randomBytes;
signer.setPassword("changeme");

// new ncryptset
console.log(signer.ncryptsec);
```

### Locking and Unlocking

To unlock the signer so it can sign events you have to call the [`unlock`](https://applesauce.build/typedoc/classes/applesauce-signers.PasswordSigner.html#unlock) method

```ts
try {
  const password = prompt("Enter Password");
  await signer.unlock(password);
} catch (err) {
  console.log("Failed to unlock signer. maybe incorrect password?");
}
```

### Changing the password

To change the password you can simply unlock the signer then call [`setPassword`](https://applesauce.build/typedoc/classes/applesauce-signers.PasswordSigner.html#setPassword)

```ts
try {
  const unlockPassword = prompt("Enter current password");
  await signer.unlock(unlockPassword);

  // set new password
  const unlockPassword = prompt("Enter new password");
  await signer.setPassword(unlockPassword);
} catch (err) {
  console.log("Failed to unlock signer. maybe incorrect password?");
}
```

### Additional fields and methods

- [`unlocked`](https://applesauce.build/typedoc/classes/applesauce-signers.PasswordSigner.html#unlocked) a boolean field whether the signer is unlocked
- [`testPassword`](https://applesauce.build/typedoc/classes/applesauce-signers.PasswordSigner.html#testPassword) will return a promise that resolves or rejects based on if can decrypt the ncryptsec

## Private Key Signer

The [`PrivateKeySigner`](https://applesauce.build/typedoc/classes/applesauce-signers.PrivateKeySigner.html) class is a standard signer that holds the secret key in memory and supports NIP-04 and NIP-44 encryption.

> [!INFO]
> The previously exported `SimpleSigner` is a deprecated alias for `PrivateKeySigner`. Use `PrivateKeySigner` in new code.

You can create a new signer and secret key by not passing anything into the constructor

```ts
const signer = new PrivateKeySigner();
```

Or you can import an existing secret key

```ts
const key = new Uint8Array(32);
window.crypto.getRandomValues(key);

// pass the key into constructor
const signer = new PrivateKeySigner(key);
```

Or use the static `fromKey` method to accept either a hex string, NIP-19 nsec, or `Uint8Array`:

```ts
const signer = PrivateKeySigner.fromKey("nsec1...");
```

## Extension Signer

The [`ExtensionSigner`](https://applesauce.build/typedoc/classes/applesauce-signers.ExtensionSigner.html) class wraps the browser's [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) `window.nostr` provider (Alby, nos2x, etc).

```ts
import { ExtensionSigner } from "applesauce-signers";

const signer = new ExtensionSigner();
const pubkey = await signer.getPublicKey();
```

> [!WARNING]
> `ExtensionSigner` requires `window.nostr` to be available. Check for support before use.

## Readonly Signer

The [`ReadonlySigner`](https://applesauce.build/typedoc/classes/applesauce-signers.ReadonlySigner.html) is a signer that only exposes the public key and cannot sign events. It's useful for viewing another user's account without any signing capability.

```ts
import { ReadonlySigner } from "applesauce-signers";

const signer = new ReadonlySigner("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
```

## Android Native Signer

The [`AndroidNativeSigner`](https://applesauce.build/typedoc/classes/applesauce-signers.AndroidNativeSigner.html) integrates with native Android signing implementations for apps built with frameworks that expose a native bridge (Capacitor, Cordova, etc).

## Serial Port Signer

The [SerialPortSigner](https://applesauce.build/typedoc/classes/applesauce-signers.SerialPortSigner.html) is a that supports the [nostr-signing-device](https://github.com/lnbits/nostr-signing-device)

> [!WARNING]
> This signer only works on chrome browsers and does not support NIP-44 encryption

### Checking support

The signer exposes a static property [`SerialPortSigner.SUPPORTED`](https://applesauce.build/typedoc/classes/applesauce-signers.SerialPortSigner.html#SUPPORTED) that will test if `navigator.serial` is supported

## Amber Clipboard Signer

The [`AmberClipboardSigner`](https://applesauce.build/typedoc/classes/applesauce-signers.AmberClipboardSigner.html) class can be used to connect to the [Amber web api](https://github.com/greenart7c3/Amber/blob/master/docs/web-apps.md)

> [!WARNING]
> This signer can NOT work in the background and always requires direct user approval
