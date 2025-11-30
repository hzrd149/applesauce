import { beforeEach, describe, expect, it } from "vitest";
import { includeContentHashtags, repairNostrLinks, setContent } from "../content.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { buildEvent } from "../../event-factory/methods";
import { EncryptedContentSymbol } from "../../helpers";

let user: FakeUser;

beforeEach(() => {
  user = new FakeUser();
});

describe("repairNostrLinks", () => {
  it("should repair @npub mentions", async () => {
    expect(
      await buildEvent(
        { kind: 1, content: "GM @npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6" },
        {},
        repairNostrLinks(),
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

describe("includeContentHashtags", () => {
  it("should include all content hashtags", async () => {
    expect(
      await buildEvent({ kind: 1 }, {}, setContent("hello world #growNostr #nostr"), includeContentHashtags()),
    ).toEqual(
      expect.objectContaining({
        tags: [
          ["t", "grownostr"],
          ["t", "nostr"],
        ],
      }),
    );
  });
});
