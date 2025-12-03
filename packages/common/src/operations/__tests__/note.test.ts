import { describe, expect, it } from "vitest";
import { includePubkeyNotificationTags } from "../note.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();

describe("includePubkeyNotificationTags", () => {
  it('should copy all "p" tags', async () => {
    const parent = user.note("what are you talking about?", { tags: [["p", "pubkey"]] });

    expect(
      await includePubkeyNotificationTags(parent)({ kind: 1, content: "Im not sure", created_at: 0, tags: [] }, {}),
    ).toEqual(
      expect.objectContaining({
        tags: [
          ["p", "pubkey"],
          ["p", user.pubkey],
        ],
      }),
    );
  });

  it('should not copy "mention" "p" tags', async () => {
    const parent = user.note("what are you talking about?", { tags: [["p", "pubkey", "", "mention"]] });

    expect(
      await includePubkeyNotificationTags(parent)({ kind: 1, content: "Im not sure", created_at: 0, tags: [] }, {}),
    ).toEqual(
      expect.objectContaining({
        tags: [["p", user.pubkey]],
      }),
    );
  });

  it('should not add duplicate "p" tags', async () => {
    const parent = user.note("what are you talking about?", { tags: [["p", user.pubkey]] });

    expect(
      await includePubkeyNotificationTags(parent)({ kind: 1, content: "Im not sure", created_at: 0, tags: [] }, {}),
    ).toEqual(
      expect.objectContaining({
        tags: [["p", user.pubkey]],
      }),
    );
  });
});
