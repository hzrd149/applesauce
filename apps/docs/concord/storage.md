# Persistence & media

By default a `ConcordClient` keeps everything in memory — fine for a demo, but a real app should persist memberships and cache decrypted messages so the community loads instantly on reload. Both are pluggable seams you pass to the [client](/concord/client).

## Membership storage

`ConcordStorage` is a small async key/value interface for the user's membership and key material plus sync cursors. It's the mirror the client restores from at `start()` before it reaches the relays.

```ts
interface ConcordStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

In the browser the default already wraps `localStorage`, so you usually don't need to pass anything. Supply your own to store material somewhere durable (e.g. on a server or in a native app):

```ts
const client = new ConcordClient({ signer, pool, storage: myStorage });
```

`memoryStorage()` is available for tests and ephemeral sessions — it isn't durable.

## Caching decrypted messages

By default each plane's rumors live in an in-memory store that's rebuilt from relays on every reload. To persist decrypted messages across reloads, pass a `storeFactory` that returns an [AsyncRumorStore](/core/event-store) backed by a database:

```ts
const client = new ConcordClient({
  signer,
  pool,
  storeFactory: (communityId, planeKey) => makeRumorStore(communityId, planeKey),
});
```

The factory is called once per community plane (`control`, `guestbook`, `channel:<id>`, …). Cached history renders immediately at startup, then sync fills in only the delta.

## Media uploads

Sending file attachments or setting a community icon/banner requires an `uploader`. Concord carries no [Blossom](https://github.com/hzrd149/blossom) dependency itself — you inject one that encrypts and uploads a blob and returns the attachment (url + per-file encryption + hash):

```ts
interface ConcordUploader {
  upload(file: Blob, communityId: string, options?: ConcordUploadOptions): Promise<MediaAttachment>;
}

const client = new ConcordClient({ signer, pool, uploader: myUploader });
```

Without an uploader, `sendMessage` with files, `setCommunityImage`, and friends throw. Everything else works fine.

### Upload progress

`sendMessage` can report progress for the whole attachment batch. The uploader reports per-file phase changes through `options.onProgress`, and Concord turns them into `{ total, done, phase }` for the send call.

```ts
const uploader: ConcordUploader = {
  async upload(file, communityId, options) {
    const encrypted = await encrypt(file);
    options?.onProgress?.("uploading");
    return uploadEncrypted(encrypted, communityId);
  },
};
```

Concord emits the initial `"encrypting"` phase before each file is handed to the uploader, so uploaders usually only need to report the transition to `"uploading"`.
