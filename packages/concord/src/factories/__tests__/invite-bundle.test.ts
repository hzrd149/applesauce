import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { INVITE_BUNDLE_KIND } from "../../helpers/invite-bundle.js";
import type { InviteBundle } from "../../types.js";
import { InviteBundleFactory } from "../invite-bundle.js";

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

describe("InviteBundleFactory", () => {
  it("emits exactly one d='' tag and vsk 6", async () => {
    const t = await InviteBundleFactory.create(bundle, new Uint8Array(16));
    expect(t.kind).toBe(INVITE_BUNDLE_KIND);
    expect(t.tags.filter((tag) => tag[0] === "d")).toEqual([["d", ""]]);
    expect(t.tags).toContainEqual(["vsk", "6"]);
  });

  it("revoke emits an empty vsk 9 edition", async () => {
    const t = await InviteBundleFactory.revoke();
    expect(t.content).toBe("");
    expect(t.tags).toContainEqual(["vsk", "9"]);
  });

  it("exposes fluent bundle + revoke methods", async () => {
    const bundleInput: InviteBundle = {
      community_id: "cid",
      owner: "owner",
      owner_salt: "salt",
      community_root: "root",
      root_epoch: 0,
      channels: [],
      relays: [],
      name: "N",
    };
    const t = await new InviteBundleFactory((res) =>
      res({ kind: INVITE_BUNDLE_KIND, created_at: 0, tags: [], content: "" }),
    ).bundle(bundleInput, new Uint8Array(16));
    expect(t.tags).toContainEqual(["vsk", "6"]);
    const rev = await new InviteBundleFactory((res) =>
      res({ kind: INVITE_BUNDLE_KIND, created_at: 0, tags: [], content: "" }),
    ).revoke();
    expect(rev.tags).toContainEqual(["vsk", "9"]);
  });

  it("modify re-issues an existing bundle at its coordinate", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const live = await InviteBundleFactory.create(bundle, new Uint8Array(16)).sign(signer);
    const updated = await InviteBundleFactory.modify(live).bundle({ ...bundle, name: "renamed" }, new Uint8Array(16));
    expect(updated.tags.filter((t) => t[0] === "d")).toEqual([["d", ""]]);
    expect(updated.tags).toContainEqual(["vsk", "6"]);
  });

  it("modify tombstones an existing bundle", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const live = await InviteBundleFactory.create(bundle, new Uint8Array(16)).sign(signer);
    const revoked = await InviteBundleFactory.modify(live).revoke();
    expect(revoked.content).toBe("");
    expect(revoked.tags).toContainEqual(["vsk", "9"]);
    expect(revoked.tags.filter((t) => t[0] === "d")).toEqual([["d", ""]]);
  });

  it("rejects a non-bundle event", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const note = await signer.signEvent({ kind: 1, content: "", tags: [], created_at: 0 });
    expect(() => InviteBundleFactory.modify(note)).toThrow();
  });
});
