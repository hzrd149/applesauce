import { EventTemplate, finalizeEvent, getPublicKey, kinds, NostrEvent, unixNow } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";

export class FakeUser extends PrivateKeySigner {
  pubkey = getPublicKey(this.key);

  event(data?: Partial<EventTemplate>): NostrEvent {
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

  note(content = "Hello World", extra?: Partial<EventTemplate>) {
    return this.event({ kind: kinds.ShortTextNote, content, ...extra });
  }

  profile(profile: any, extra?: Partial<EventTemplate>) {
    return this.event({ kind: kinds.Metadata, content: JSON.stringify({ ...profile }), ...extra });
  }

  contacts(pubkeys: string[] = []) {
    return this.event({ kind: kinds.Contacts, tags: pubkeys.map((p) => ["p", p]) });
  }
}
