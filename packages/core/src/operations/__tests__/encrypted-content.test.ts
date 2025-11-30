import { beforeEach, describe, expect, it } from "vitest";
import { setEncryptedContent } from "../encrypted-content.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { buildEvent } from "../../event-factory/methods";
import { EncryptedContentSymbol, setEncryptedContentEncryptionMethod } from "../../helpers";

let user: FakeUser;

beforeEach(() => {
  user = new FakeUser();
});

describe("setEncryptedContent", () => {
  it("should set the encrypted content", async () => {
    const draft = await buildEvent(
      { kind: 4 },
      { signer: user },
      setEncryptedContent(user.pubkey, "Hello, world!", "nip04"),
    );

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

    const nip04Draft = await buildEvent(
      { kind: 50004 },
      { signer: user },
      setEncryptedContent(user.pubkey, "Hello, world!"),
    );

    expect(nip04Draft).toEqual(
      expect.objectContaining({
        kind: 50004,
        [EncryptedContentSymbol]: "Hello, world!",
      }),
    );
    expect(await user.nip04.decrypt(user.pubkey, nip04Draft.content)).toBe("Hello, world!");

    const nip44Draft = await buildEvent(
      { kind: 50044 },
      { signer: user },
      setEncryptedContent(user.pubkey, "Hello, world!"),
    );

    expect(nip44Draft).toEqual(
      expect.objectContaining({
        kind: 50044,
        [EncryptedContentSymbol]: "Hello, world!",
      }),
    );
    expect(await user.nip44.decrypt(user.pubkey, nip44Draft.content)).toBe("Hello, world!");
  });

  it("should set EncryptedContentSymbol with plaintext content for nip04", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", "nip04");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: user });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe("secret message");
  });

  it("should set EncryptedContentSymbol with plaintext content for nip44", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", "nip44");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: user });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe("secret message");
  });

  it("should throw error if no signer provided", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", "nip04");
    await expect(operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: undefined })).rejects.toThrow(
      "Signer required for encrypted content",
    );
  });

  it("should throw error if signer does not support encryption method", async () => {
    const operation = setEncryptedContent(user.pubkey, "secret message", "nip44");

    // @ts-expect-error
    delete user.nip44;

    await expect(operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: user })).rejects.toThrow(
      "Signer does not support nip44 encryption",
    );
  });
});
