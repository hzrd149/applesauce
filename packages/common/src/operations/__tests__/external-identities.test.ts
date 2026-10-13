import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { EXTERNAL_IDENTITIES_KIND } from "../../helpers/external-identities.js";
import { addExternalIdentity, removeExternalIdentity, setExternalIdentities } from "../external-identities.js";

function createDraft(tags: string[][] = []): EventTemplate {
  return { kind: EXTERNAL_IDENTITIES_KIND, content: "", tags, created_at: unixNow() };
}

describe("external identities operations", () => {
  it("adds, replaces, and removes identities", async () => {
    const added = await addExternalIdentity({ platform: "github", identity: "alice", proof: "a" })(createDraft());
    expect(added.tags).toEqual([["i", "github:alice", "a"]]);

    const replaced = await addExternalIdentity({ platform: "github", identity: "alice", proof: "b" })(added);
    expect(replaced.tags).toEqual([["i", "github:alice", "b"]]);

    const removed = await removeExternalIdentity("github", "alice")(replaced);
    expect(removed.tags).toEqual([]);
  });

  it("sets identities", async () => {
    const draft = await setExternalIdentities([{ platform: "bluesky", identity: "alice.bsky.social", proof: "x" }])(
      createDraft([["i", "github:old", "p"]]),
    );
    expect(draft.tags).toEqual([["i", "bluesky:alice.bsky.social", "x"]]);
  });
});
