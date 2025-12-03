import { unixNow } from "applesauce-core/helpers";
import { finalizeEvent, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";

export class FakeUser extends PrivateKeySigner {
  pubkey = getPublicKey(this.key);

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

  contacts(pubkeys: string[] = []) {
    return this.event({ kind: kinds.Contacts, tags: pubkeys.map((p) => ["p", p]) });
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
