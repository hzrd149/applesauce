import { finalizeEvent } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { unixNow } from "applesauce-core/helpers/time";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { nanoid } from "nanoid";

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
    if (tags.some((t) => t[0] === "d") === false) tags = [["d", nanoid()], ...tags];
    return this.event({
      kind: kinds.Bookmarksets,
      content: "",
      tags,
      ...extra,
    });
  }
}
