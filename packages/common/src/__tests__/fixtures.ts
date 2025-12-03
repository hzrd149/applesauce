import { EventSigner } from "applesauce-core/event-factory";
import {
  EncryptedContentSigner,
  EventTemplate,
  finalizeEvent,
  kinds,
  unixNow,
  UnsignedEvent,
} from "applesauce-core/helpers";
import { nip04, nip44 } from "applesauce-core/helpers/encryption";
import { NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";

export class FakeUser implements EncryptedContentSigner, EventSigner {
  key = generateSecretKey();
  pubkey = getPublicKey(this.key);

  nip04 = {
    encrypt: (pubkey: string, plaintext: string) => nip04.encrypt(this.key, pubkey, plaintext),
    decrypt: (pubkey: string, ciphertext: string) => nip04.decrypt(this.key, pubkey, ciphertext),
  };

  nip44 = {
    encrypt: (pubkey: string, plaintext: string) =>
      nip44.encrypt(plaintext, nip44.getConversationKey(this.key, pubkey)),
    decrypt: (pubkey: string, ciphertext: string) =>
      nip44.decrypt(ciphertext, nip44.getConversationKey(this.key, pubkey)),
  };

  getPublicKey() {
    return this.pubkey;
  }

  signEvent(draft: EventTemplate | UnsignedEvent) {
    return finalizeEvent(draft, this.key);
  }

  event(data?: Partial<NostrEvent>): NostrEvent {
    return finalizeEvent(
      {
        kind: data?.kind ?? kinds.ShortTextNote,
        content: data?.content || "",
        created_at: data?.created_at ?? unixNow(),
        tags: data?.tags || [],
      },
      this.key,
    );
  }

  note(content = "Hello World", extra?: Partial<NostrEvent>) {
    return this.event({ kind: kinds.ShortTextNote, content, ...extra });
  }

  profile(profile: any, extra?: Partial<NostrEvent>) {
    return this.event({ kind: kinds.Metadata, content: JSON.stringify({ ...profile }), ...extra });
  }

  list(tags: string[][] = [], extra?: Partial<NostrEvent>) {
    return this.event({
      kind: kinds.Bookmarksets,
      content: "",
      tags: [["d", String(Math.round(Math.random() * 10000))], ...tags],
      ...extra,
    });
  }
}
