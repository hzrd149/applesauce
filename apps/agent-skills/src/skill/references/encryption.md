# Encrypted content (NIP-04 / NIP-44) and hidden tags

Read this when handling DMs (NIP-04 legacy, NIP-44 versioned, NIP-17 gift-wrapped) or any event with hidden tags (NIP-51 mute lists, bookmarks, etc.).

Encrypted content and hidden tags are **opt-in**: the store holds the raw event; you decide when to decrypt. Applesauce caches the decrypted result on the event's symbol once decrypted so models and casts can deliver it reactively without re-decrypting per render.

## One-time wiring at startup

Use `persistEncryptedContent(eventStore, storage)` to restore cached plaintext on insertion and save newly unlocked content. It does not ask a signer to decrypt; unlocking remains an explicit application action.

```ts
import { persistEncryptedContent } from "applesauce-common/helpers";

const stopCaching = persistEncryptedContent(eventStore, accountStorage);

// When the account session ends:
stopCaching();
```

Supply account-scoped storage encrypted at rest: values are plaintext keyed by event ID. Plaintext attached to an event is not scoped by signer. On account change, stop the old persistence process, dispose account-owned messaging clients and private stores, and create the next account's resources. Stopping persistence does not erase plaintext already attached to events.

For direct cache access or bounded stream restoration, see the [encrypted-content caching guide](https://applesauce.build/apps/encryption/caching).

## Reading encrypted content reactively

```ts
import { EncryptedContentModel } from "applesauce-core/models";

eventStore.model(EncryptedContentModel, event).subscribe((content) => {
  // content: string | undefined — undefined until decrypted, then the plaintext
});
```

In React: `useEventModel(EncryptedContentModel, [event])`.

The model is passive: it emits `undefined` until plaintext is restored or explicitly unlocked. It observes unlock updates even without persistence. In non-React consumers, retain and unsubscribe the subscription when the view closes.

## Hidden tags lifecycle

NIP-51 lists (mute, bookmark, pin, follow sets) keep their sensitive entries inside an encrypted `content` field. Unlock once per event, then check the cached state:

```ts
import { unlockHiddenTags, isHiddenTagsUnlocked } from "applesauce-core/helpers";

if (!isHiddenTagsUnlocked(event)) {
  await unlockHiddenTags(event, signer);
}
// now models / casts see the hidden entries and re-emit
```

Gate UI on `isHiddenTagsUnlocked(event)` (or its reactive equivalent through a model) — don't try to derive it from the raw `content` string.

## NIP-17 gift-wrapped messages

Use `WrappedMessagesClient` from `applesauce-extra/messages` for conversations, drafts, receiving and retryable sending. It uses a `GiftWrapReceiver` with the application's encrypted-event `EventStore` and a separate `RumorStore` or `AsyncRumorStore` for validated plaintext. Query conversations through that shared rumor store; reading does not invoke the signer.

Use `GiftWrapReceiver` from `applesauce-extra/gift-wrap` directly for other gift-wrapped protocols. Receivers and clients are account-scoped; injected stores and receivers remain application-owned. Keep prepared send handles for retries instead of calling `send()` again.

Follow the [messaging client](https://applesauce.build/extra/messages), [receiver](https://applesauce.build/extra/gift-wrap), and [encrypted file](https://applesauce.build/features/files/encrypted-files) workflows. For device registration, durable ratchet state and groups, use the [NDR client](https://applesauce.build/extra/ndr).

## Common pitfalls

- Assuming a cache or model unlocks content — call an unlock method from a user action, or explicitly opt into background decryption.
- Decrypting in a loop per render — use the client's shared processing and cache so views do not repeat signer prompts.
- Treating empty hidden tags as "no hidden entries" instead of "not yet unlocked". Always check `isHiddenTagsUnlocked`.

## Worked examples

- `assets/examples/messages/legacy.tsx` — NIP-04 receiving and durable send retries
- `assets/examples/messages/gift-wrap.tsx` — shared rumor queries and encrypted attachments
- `assets/examples/messages/ndr.tsx` — devices, groups and durable messaging state

All indexed in `examples.md`.
