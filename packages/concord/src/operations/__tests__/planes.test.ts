import { describe, expect, it } from "vitest";

import { JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND } from "../../helpers/guestbook.js";
import { CONTROL_KIND } from "../../helpers/control.js";
import { REKEY_KIND } from "../../helpers/rekey.js";
import { includeInviteAttribution, includeKickTarget, includeSnapshotChunk, setJoinLeave } from "../guestbook.js";
import { includeEdition, setDissolution } from "../control.js";
import { includeRekeyChunk } from "../rekey.js";
import { setInviteBundle, setRevocation } from "../invite-bundle.js";
import { decryptBundle, INVITE_BUNDLE_KIND, newInviteToken } from "../../helpers/invite-bundle.js";
import type { InviteBundle } from "../../types.js";

const blank = (kind: number) => ({ kind, content: "", tags: [] as string[][], created_at: 0 });

describe("guestbook operations", () => {
  it("setJoinLeave sets the verb as content", async () => {
    expect((await setJoinLeave("join")(blank(JOIN_LEAVE_KIND))).content).toBe("join");
    expect((await setJoinLeave("leave")(blank(JOIN_LEAVE_KIND))).content).toBe("leave");
  });

  it("includeInviteAttribution and includeKickTarget add their tags", async () => {
    const join = await includeInviteAttribution("creator", "label")(blank(JOIN_LEAVE_KIND));
    expect(join.tags).toContainEqual(["invite", "creator", "label"]);
    const kick = await includeKickTarget("member", ["eid", "1", "hash"])(blank(KICK_KIND));
    expect(kick.tags).toContainEqual(["p", "member"]);
    expect(kick.tags).toContainEqual(["vac", "eid", "1", "hash"]);
  });

  it("includeSnapshotChunk sets members + snap tag", async () => {
    const snap = await includeSnapshotChunk(["a", "b"], "snapid", 1, 2, { created_at: 12, ms: 500 })(
      blank(SNAPSHOT_KIND),
    );
    expect(JSON.parse(snap.content)).toEqual(["a", "b"]);
    expect(snap.tags).toContainEqual(["snap", "snapid", "1", "2"]);
  });
});

describe("control operations", () => {
  it("includeEdition writes the edition machinery + content", async () => {
    const draft = await includeEdition({
      vsk: 0,
      eid: "eid",
      version: 2,
      prevHash: "prev",
      content: "{}",
      vac: ["e", "1", "h"],
    })(blank(CONTROL_KIND));
    expect(draft.content).toBe("{}");
    expect(draft.tags).toContainEqual(["vsk", "0"]);
    expect(draft.tags).toContainEqual(["eid", "eid"]);
    expect(draft.tags).toContainEqual(["ev", "2"]);
    expect(draft.tags).toContainEqual(["ep", "prev"]);
    expect(draft.tags).toContainEqual(["vac", "e", "1", "h"]);
  });

  it("setDissolution writes the vsk 10 tombstone", async () => {
    const draft = await setDissolution()(blank(CONTROL_KIND));
    expect(draft.tags).toContainEqual(["vsk", "10"]);
    expect(draft.tags).toContainEqual(["eid", "00".repeat(32)]);
  });
});

describe("rekey operations", () => {
  it("includeRekeyChunk writes blobs + rotation tags", async () => {
    const draft = await includeRekeyChunk(
      { scope: { kind: "root" }, newEpoch: 3n, prevEpoch: 2n, prevCommit: "cc" },
      [{ locator: "l", wrapped: "w" }],
      1,
      1,
    )(blank(REKEY_KIND));
    expect(JSON.parse(draft.content)).toEqual([{ locator: "l", wrapped: "w" }]);
    expect(draft.tags).toContainEqual(["newepoch", "3"]);
    expect(draft.tags).toContainEqual(["prevepoch", "2"]);
    expect(draft.tags).toContainEqual(["chunk", "1", "1"]);
  });
});

describe("invite operations", () => {
  const bundle: InviteBundle = {
    community_id: "cid",
    owner: "owner",
    owner_salt: "salt",
    community_root: "root",
    root_epoch: 0,
    channels: [],
    relays: [],
    name: "N",
  };

  it("setInviteBundle encrypts the bundle and forces a single d='' tag", async () => {
    const token = newInviteToken();
    const draft = await setInviteBundle(bundle, token)({ ...blank(INVITE_BUNDLE_KIND), tags: [["d", "stale"]] });
    expect(draft.tags.filter((t) => t[0] === "d")).toEqual([["d", ""]]);
    expect(draft.tags).toContainEqual(["vsk", "6"]);
    expect(decryptBundle(draft.content, token).community_id).toBe("cid");
  });

  it("setRevocation writes an empty vsk 9 edition", async () => {
    const draft = await setRevocation()(blank(INVITE_BUNDLE_KIND));
    expect(draft.content).toBe("");
    expect(draft.tags).toContainEqual(["d", ""]);
    expect(draft.tags).toContainEqual(["vsk", "9"]);
  });
});
