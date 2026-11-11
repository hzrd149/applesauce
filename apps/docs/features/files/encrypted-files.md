---
description: Encrypt files before uploading them and send their decryption key inside private messages
---

# Encrypted Files

Private messages can carry files without exposing them to the file server. The client encrypts the file with a random AES-GCM key, uploads only the ciphertext to a server such as Blossom, and sends the URL, key, and nonce inside the encrypted message. Only the people in the conversation can decrypt the file.

Messages describe an encrypted file in two ways:

- A NIP-17 **file message** (kind 15): the content is the file URL and the decryption fields are tags. Gift-wrapped (NIP-17) messages send one file per message this way. When `file` is supplied, the wrapped client's `send()` ignores `content`; send any caption as a separate text message.
- An **`imeta` tag** on a chat message (kind 14): the content contains text and attachment URLs, and the tags carry their types and decryption fields. Double-ratchet (NDR) messages can send multiple attachments with text this way, because NDR uses kind 15 for receipts.

Both clients read both formats.

## Encrypting and decrypting

`encryptFile` from `applesauce-common/helpers/encrypted-file` returns the ciphertext and the fields to send. `decryptFile` authenticates the AES-GCM ciphertext and checks only the hashes supplied in its options: `sha256` checks encrypted bytes, and `originalSha256` checks decrypted bytes.

```ts
import { encryptFile, decryptFile } from "applesauce-common/helpers/encrypted-file";

const { ciphertext, key, nonce, sha256, originalSha256 } = await encryptFile(file);

const bytes = await decryptFile(ciphertext, {
  decryptionKey: key,
  decryptionNonce: nonce,
  sha256,
  originalSha256,
});
```

Keys and nonces are hex. `decryptFile` accepts 12 and 16 byte nonces, since clients disagree on the length.

## Reading attachments

`getMessageAttachments(message)` returns `FileMetadataFields[]` for a kind 15 file message or for the `imeta` tags of any other message. Encrypted files have `decryptionKey` and `decryptionNonce`, which `isEncryptedFile` checks.

```ts
import { getMessageAttachments } from "applesauce-common/helpers/file-message";
import { isEncryptedFile } from "applesauce-common/helpers/file-metadata";

for (const file of getMessageAttachments(rumor)) {
  if (isEncryptedFile(file)) console.log(file.url, file.type, file.decryptionKey);
}
```

`isValidFileMessage(rumor)` requires a URL as the content and a `file-type` or `decryption-key` tag, which also tells a file apart from an NDR receipt. `getFileMessageMetadata(rumor)` reads a single file message.

## Building file messages

`FileMessageFactory` builds a kind 15 event template from uploaded file fields, not a stamped rumor. `GiftWrapFactory` supplies the sender pubkey and rumor ID and returns a signed envelope:

```ts
import { FileMessageFactory, GiftWrapFactory } from "applesauce-common/factories";

const template = await FileMessageFactory.create(recipient, file).replyTo(parentId);
const envelope = await GiftWrapFactory.create(signer, recipient, template);
await pool.publish(recipientDmRelays, envelope);
```

The relay list above is application-resolved. Use [WrappedMessagesClient](../../extra/messages.md) for participant relay discovery, the sender's backup copy, and retained publication retries. See [Gift-wrap Receiver](../../extra/gift-wrap.md) for receiving and decrypting envelopes.

For a chat message, `createImetaTagForAttachment(file)` from `applesauce-common/helpers/file-metadata` writes the decryption fields into an `imeta` tag.

## Integration

The messages clients in `applesauce-extra` take an `upload` function that stores an already encrypted blob and returns its URL. `uploadFile()` encrypts the file and calls it:

```ts
const client = new WrappedMessagesClient({
  ...options,
  upload: async (blob, { signal }) => ({ url: await myUpload(blob, signal) }),
});

const conversation = client.conversation(recipient);
const file = await conversation.uploadFile(input.files[0]);
await conversation.send({ content: "", file });
```

For NDR, use `conversation.send({ content: "Photos", attachments: uploadedFiles })` instead.

`loadAttachment(file)` from `applesauce-extra/messages` downloads from the URL or its fallbacks and decrypts the result into a `Blob`. Wrap it in `URL.createObjectURL` to render an image or video, and revoke the URL when the view unmounts.

By default, `loadAttachment` replaces script-capable MIME types (HTML, XHTML, SVG, XML, and JavaScript/ECMAScript) with `application/octet-stream` on the returned `Blob`. The attachment still downloads, but its sender-declared type is not preserved for browser rendering.

Pass `loadAttachment(file, { allowActiveContent: true })` only when you need the original type in a safe rendering context, such as SVG in an `<img>`. Opening that blob URL directly or embedding it in an `<iframe>` can run sender-provided scripts in your app's origin.

### Retrying wrapped publication

Retain the prepared send before publishing so a partial relay failure can retry the same envelopes:

```ts
const file = await conversation.uploadFile(pickedFile);
const prepared = await conversation.prepareSend({ content: "", file });

try {
  await prepared.publish();
} catch (error) {
  showPublicationError(error);
  // Keep this handle for the application's Retry button.
}

const retry = () => prepared.publish();
```

`prepared.publish()` skips envelopes already accepted. Calling `send({ content: "", file })` again creates new envelopes; reusing uploaded metadata avoids only another upload, not another message. See [Messages](../../extra/messages.md) for client lifecycle and recovery.

### Draft attachments

Drafts can hold staged files with `setDraft({ content, files })`. Reload recovery requires both a saved draft record and a file-byte store. Wrapped clients need **both `draftStorage` and `draftFileStorage`**; NDR derives its draft record store from the required `storage` and needs `draftFileStorage` for the bytes. Without both stores, staged files remain in memory only.

File storage implements `getItem`, `setItem`, and `removeItem` for blobs, such as a localForage instance. The adapters receive plaintext draft records and files; the clients don't encrypt them. Supply account-scoped encrypting stores to protect drafts at rest:

```ts
const client = new WrappedMessagesClient({
  ...options,
  draftStorage: encryptedDraftRecords,
  draftFileStorage: encryptedDraftFiles,
});

const conversation = client.conversation(recipient);
await conversation.setDraft({ content: "", files: [pastedFile] });
```

For NDR, upload every staged file **before** calling `sendDraft(attachments)`. That method never uploads `draft.files`: without metadata, a text-and-files draft sends only text and then clears the unchanged draft, including its staged files.

Keep composer edits disabled during upload and dispatch, since `sendDraft()` reads the current draft again:

```ts
setComposerBusy(true); // application disables edits and duplicate sends
try {
  const draft = await ndrConversation.loadDraft();
  const attachments = [];
  for (const file of draft?.files ?? []) {
    attachments.push(await ndrConversation.uploadFile(file));
  }

  await ndrConversation.sendDraft(attachments);
} finally {
  setComposerBusy(false);
}
```

An upload failure leaves the draft unsent. Retain any successfully uploaded metadata for an upload retry; once NDR has durably queued a send, use its outbox recovery instead of sending the draft again. Wrapped conversations do not have `sendDraft()`; use `prepareSend()` and keep staged files until the corresponding publications are accepted.

**Examples:** [Gift-wrapped Messages](https://applesauce.build/examples/#/example/messages/gift-wrap), [Double-ratchet Messages](https://applesauce.build/examples/#/example/messages/ndr)

## Best Practices

- Upload ciphertext as `application/octet-stream` with plain uploads, never media uploads, which re-encode the file and break decryption.
- Use the user's [Blossom servers](./blossom-servers.md) as upload targets, with a fallback list for users who have none.
- Stage pasted and picked files in the draft and upload them only on send, so a discarded draft never reaches a server.
- Retain a wrapped prepared send or NDR's durable outbox envelopes for publication retries; retaining only the upload metadata is not message deduplication.
