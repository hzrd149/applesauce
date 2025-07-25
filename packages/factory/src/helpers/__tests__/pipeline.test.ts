import { EncryptedContentSymbol, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { includeAltTag } from "../../operations";
import { setEncryptedContent } from "../../operations/content";
import { eventPipe } from "../pipeline.js";

const user = new FakeUser();

describe("eventPipe", () => {
  it("should preserve plaintext encrypted content", async () => {
    const draft = await eventPipe(
      setEncryptedContent(user.pubkey, "hello world", "nip04"),
      includeAltTag("direct message"),
    )({ kind: 4, content: "", tags: [], created_at: unixNow() }, { signer: user });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toEqual("hello world");
  });
});
