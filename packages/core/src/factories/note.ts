import { kinds } from "nostr-tools";
import { EventFactory } from "./event.js";
import { KnownEventTemplate } from "../helpers/event.js";
import { unixNow } from "../helpers/time.js";
import { repairNostrLinks } from "../operations/content.js";

export class NoteFactory<T extends KnownEventTemplate<kinds.ShortTextNote>> extends EventFactory<
  kinds.ShortTextNote,
  T
> {
  override chain<RT extends T = T>(
    onfulfilled?: ((value: T) => RT | PromiseLike<RT>) | undefined | null,
  ): NoteFactory<RT> {
    return new NoteFactory((res) => res(this.then(onfulfilled)));
  }

  /** Creates a new note factory from a content string */
  static fromContent(content: string): NoteFactory<KnownEventTemplate<kinds.ShortTextNote>> {
    return new NoteFactory((res) =>
      res({ kind: kinds.ShortTextNote, content, created_at: unixNow(), tags: [] }),
    ).content(content);
  }

  repair() {
    return this.chain<T>((draft) => ({
      ...draft,
      content: draft.content.replaceAll(
        /(?<=^|\s)(?:@)?((?:npub|note|nprofile|nevent|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58,})/gi,
        "nostr:$1",
      ),
    }));
  }
}
