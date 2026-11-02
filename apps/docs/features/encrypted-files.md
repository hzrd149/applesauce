---
description: Encrypt files before uploading them and send their decryption key inside private messages
---

# Encrypted Files

Private messages can carry files without exposing them to the file server. The client encrypts the file with a random AES-GCM key, uploads only the ciphertext to a server such as Blossom, and sends the URL, key, and nonce inside the encrypted message. Only the people in the conversation can decrypt the file.

Messages describe an encrypted file in two ways:

- A NIP-17 **file message** (kind 15): the content is the file URL and the decryption fields are tags. Gift-wrapped (NIP-17) messages send files this way.
- An **`imeta` tag** on a chat message (kind 14): the content contains the URL and the tag carries its type and decryption fields. Double-ratchet (NDR) messages send files this way, because NDR uses kind 15 for receipts.

Both clients read both formats.

## Encrypting and decrypting

`encryptFile` from `applesauce-common/helpers` returns the ciphertext and the fields to send. `decryptFile` checks the hashes and throws if the key, nonce, or bytes are wrong.

```ts
const { ciphertext, key, nonce, sha256, originalSha256 } = await encryptFile(file);

const bytes = await decryptFile(ciphertext, { decryptionKey: key, decryptionNonce: nonce, sha256 });
```

Keys and nonces are hex. `decryptFile` accepts 12 and 16 byte nonces, since clients disagree on the length.

## Reading attachments

`getMessageAttachments(message)` returns `FileMetadataFields[]` for a kind 15 file message or for the `imeta` tags of any other message. Encrypted files have `decryptionKey` and `decryptionNonce`, which `isEncryptedFile` checks.

```ts
for (const file of getMessageAttachments(rumor)) {
  if (isEncryptedFile(file)) console.log(file.url, file.type, file.decryptionKey);
}
```

`isValidFileMessage(rumor)` requires a URL as the content and a `file-type` or `decryption-key` tag, which also tells a file apart from an NDR receipt. `getFileMessageMetadata(rumor)` reads a single file message.

## Building file messages

`FileMessageFactory` builds a kind 15 rumor from uploaded file fields. Wrap it with `GiftWrapFactory` like any other NIP-17 rumor.

```ts
const rumor = await FileMessageFactory.create(recipient, file).replyTo(parentId);
```

For a chat message, `createImetaTagForAttachment(file)` writes the decryption fields into an `imeta` tag.

## Integration

The messages clients in `applesauce-extra` take an `upload` function that stores an already encrypted blob and returns its URL. `uploadFile()` encrypts the file and calls it:

```ts
const client = new WrappedMessagesClient({
  ...options,
  upload: async (blob, { signal }) => ({ url: await myUpload(blob, signal) }),
});

const file = await conversation.uploadFile(input.files[0]);
await conversation.send({ content: "", file }); // NDR: send({ content: "", attachments: [file] })
```

`loadAttachment(file)` downloads from the URL or its fallbacks and decrypts the result into a `Blob`. Wrap it in `URL.createObjectURL` to render an image or video, and revoke the URL when the view unmounts.

### Draft attachments

Drafts can hold staged files with `setDraft({ content, files })`. Without more setup they stay in memory, but a `draftFileStorage` adapter restores them with the draft after a reload. Any object with localForage's `getItem`, `setItem`, and `removeItem` works, including a localForage instance. The adapter receives plaintext files, so use an encrypting store when that matters:

```ts
const client = new NdrMessagesClient({
  ...options,
  draftFileStorage: localforage.createInstance({ name: "draft-files" }),
});

await conversation.setDraft({ content: "", files: [pastedFile] });
```

**Examples:** [Gift-wrapped Messages](https://applesauce.build/examples/#/example/messages/gift-wrap), [Double-ratchet Messages](https://applesauce.build/examples/#/example/messages/ndr)

## Best Practices

- Upload ciphertext as `application/octet-stream` with plain uploads, never media uploads, which re-encode the file and break decryption.
- Use the user's [Blossom servers](./blossom-servers.md) as upload targets, with a fallback list for users who have none.
- Stage pasted and picked files in the draft and upload them only on send, so a discarded draft never reaches a server.
- Upload before publishing, so a failed relay publish can be retried without uploading the file again.
