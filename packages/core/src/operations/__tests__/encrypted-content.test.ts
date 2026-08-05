import { beforeEach, describe, expect, it } from "vitest";
import { setEncryptedContent } from "../encrypted-content.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { eventPipe } from "../../helpers/pipeline.js";
import { EncryptedContentSymbol, getEncryptedContent, setEncryptedContentEncryptionMethod } from "../../helpers";
import { unixNow } from "../../helpers/time.js";
import { includeAltTag, sign } from "../event.js";

let user: FakeUser;

beforeEach(() => {
  user = new FakeUser();
});

describe("setEncryptedContent", () => {
  it("should set the encrypted content", async () => {
    const draft = await setEncryptedContent(
      user.pubkey,
      "Hello, world!",
      user,
      "nip04",
    )({
      kind: 4,
      content: "",
      tags: [],
      created_at: 0,
    });

    expect(draft).toEqual(
      expect.objectContaining({
        kind: 4,
        [EncryptedContentSymbol]: "Hello, world!",
      }),
    );
    expect(await user.nip04.decrypt(user.pubkey, draft.content)).toBe("Hello, world!");
  });

  it("should pick encryption method based on kind", async () => {
    setEncryptedContentEncryptionMethod(50004, "nip04");
    setEncryptedContentEncryptionMethod(50044, "nip44");

    const nip04Draft = await setEncryptedContent(
      user.pubkey,
      "Hello, world!",
      user,
    )({
      kind: 50004,
      content: "",
      tags: [],
      created_at: 0,
    });

    expect(nip04Draft).toEqual(
      expect.objectContaining({
        kind: 50004,
        [EncryptedContentSymbol]: "Hello, world!",
      }),
    );
    expect(await user.nip04.decrypt(user.pubkey, nip04Draft.content)).toBe("Hello, world!");

    const nip44Draft = await setEncryptedContent(
      user.pubkey,
      "Hello, world!",
      user,
    )({
      kind: 50044,
      content: "",
      tags: [],
      created_at: 0,
    });

    expect(nip44Draft).toEqual(
      expect.objectContaining({
        kind: 50044,
        [EncryptedContentSymbol]: "Hello, world!",
      }),
    );
    expect(await user.nip44.decrypt(user.pubkey, nip44Draft.content)).toBe("Hello, world!");
  });

  it("should set EncryptedContentSymbol with plaintext content for nip04", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", user, "nip04");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe("secret message");
  });

  it("should set EncryptedContentSymbol with plaintext content for nip44", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", user, "nip44");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe("secret message");
  });

  it("should throw error if no signer provided", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", undefined, "nip04");
    await expect(operation({ kind: 1, content: "", tags: [], created_at: 0 })).rejects.toThrow(
      "Signer required for encrypted content",
    );
  });

  it("should throw error if signer does not support encryption method", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", user, "nip44");

    // @ts-expect-error
    delete user.nip44;

    await expect(operation({ kind: 1, content: "", tags: [], created_at: 0 })).rejects.toThrow(
      "Signer does not support nip44 encryption",
    );
  });

  it("writes EncryptedContentSymbol non-enumerably (construct-then-setCachedValue, not an object-literal computed key)", async () => {
    const draft = await setEncryptedContent(
      user.pubkey,
      "secret message",
      user,
      "nip04",
    )({ kind: 4, content: "", tags: [], created_at: 0 });

    const descriptor = Object.getOwnPropertyDescriptor(draft, EncryptedContentSymbol);
    expect(descriptor?.enumerable).toBe(false);
  });

  it("full-pipe survival: plaintext survives an intervening spread step and signing, read back off the signed event", async () => {
    const template = { kind: 4, content: "", tags: [] as string[][], created_at: unixNow() };
    // Expected plaintext derived from the fixture's own input, not from the operation's own output.
    const expectedPlaintext = "secret message";

    const signed = await eventPipe(
      setEncryptedContent(user.pubkey, expectedPlaintext, user, "nip04"),
      includeAltTag("test-alt"), // intervening spread: modifyPublicTags's `{ ...draft, tags }`
      sign(user),
    )(template);

    expect(signed.sig).toBeTruthy();
    expect(signed.tags).toContainEqual(["alt", "test-alt"]);
    expect(getEncryptedContent(signed)).toBe(expectedPlaintext);
  });
});
