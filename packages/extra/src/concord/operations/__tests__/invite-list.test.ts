import { describe, expect, it } from "vitest";

import { mintInvite, revokeInvite } from "../invite-list.js";
import type { InviteListInvite } from "../../types.js";

const entry = (token: string): InviteListInvite => ({
  token,
  signer_sk: "sk-" + token,
  community_id: "cid",
  url: "https://x/invite/" + token,
  created_at: 1,
});

describe("invite list operations", () => {
  it("mintInvite merges an entry, leaving tombstones untouched", () => {
    const next = mintInvite(entry("a"))([], []);
    expect(next.invites.map((e) => e.token)).toEqual(["a"]);
    expect(next.tombstones).toEqual([]);
  });

  it("mintInvite is immutable — re-minting the same token keeps the first", () => {
    const invites = mintInvite(entry("a"))([], []).invites;
    const next = mintInvite({ ...entry("a"), url: "https://evil/x" })(invites, []);
    expect(next.invites).toHaveLength(1);
    expect(next.invites[0].url).toBe("https://x/invite/a");
  });

  it("revokeInvite unions a terminal tombstone, leaving entries untouched", () => {
    const invites = mintInvite(entry("a"))([], []).invites;
    const next = revokeInvite("a", "cid")(invites, []);
    expect(next.invites.map((e) => e.token)).toEqual(["a"]);
    expect(next.tombstones).toEqual([{ token: "a", community_id: "cid" }]);
  });
});
