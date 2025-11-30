import { beforeEach, describe, expect, it } from "vitest";
import { EncryptedContentSymbol, setEncryptedContentEncryptionMethod, unixNow } from "applesauce-core/helpers";
import { buildEvent as build } from "applesauce-core/event-factory";

import { includeContentHashtags, repairNostrLinks, setContent } from "applesauce-core/operations/content";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { FakeUser } from "../../__tests__/fixtures.js";

let user: FakeUser;

beforeEach(() => {
  user = new FakeUser();
});

describe("repairNostrLinks", () => {
  it("should repair @npub mentions", async () => {
    expect(
      await repairNostrLinks()(
        {
          kind: 1,
          content: "GM @npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
          tags: [],
          created_at: 0,
        },
        {},
      ),
    ).toEqual(
      expect.objectContaining({
        content: "GM nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
      }),
    );
  });

  it("should repair bare npub mentions", async () => {
    expect(
      await repairNostrLinks()(
        {
          kind: 1,
          content: "GM npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
          tags: [],
          created_at: 0,
        },
        {},
      ),
    ).toEqual(
      expect.objectContaining({
        content: "GM nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
      }),
    );
  });

  it("should repair bare naddr mention", async () => {
    expect(
      await repairNostrLinks()(
        {
          kind: 1,
          content:
            "check this out naddr1qvzqqqrkvupzqefcjf0tldnp7svd337swjlw96906au8q8wcjpcv9k5nd4t3u4wrqyv8wumn8ghj7un9d3shjtnxda6kuarpd9hzuend9uqzgdpcxf3rvvnrvcknser9vcknge33xskkyvmzvykkgvmrxvcnqvnpxpsnwcsdvl9jq",
          tags: [],
          created_at: 0,
        },
        {},
      ),
    ).toEqual(
      expect.objectContaining({
        content:
          "check this out nostr:naddr1qvzqqqrkvupzqefcjf0tldnp7svd337swjlw96906au8q8wcjpcv9k5nd4t3u4wrqyv8wumn8ghj7un9d3shjtnxda6kuarpd9hzuend9uqzgdpcxf3rvvnrvcknser9vcknge33xskkyvmzvykkgvmrxvcnqvnpxpsnwcsdvl9jq",
      }),
    );
  });
});

describe("setContent", () => {
  it("should remove EncryptedContentSymbol", async () => {
    const operation = setContent("secret message");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: user });
    expect(Reflect.has(draft, EncryptedContentSymbol)).toBe(false);
  });

  it("should set content", async () => {
    const operation = setContent("message");
    const draft = await operation({ kind: 1, content: "", tags: [], created_at: 0 }, { signer: user });
    expect(draft.content).toBe("message");
  });
});

describe("setEncryptedContent", () => {
  it("should set the encrypted content", async () => {
    const draft = await build(
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

    const nip04Draft = await build(
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

    const nip44Draft = await build(
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

describe("includeContentHashtags", () => {
  it("should include all content hashtags", async () => {
    expect(await build({ kind: 1 }, {}, setContent("hello world #growNostr #nostr"), includeContentHashtags())).toEqual(
      expect.objectContaining({
        tags: [
          ["t", "grownostr"],
          ["t", "nostr"],
        ],
      }),
    );
  });
});
