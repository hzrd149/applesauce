import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";

import { ConcordInviteBundle } from "../invite-bundle.js";
import { InviteBundleFactory } from "../../factories/invite-bundle.js";
import type { InviteBundle } from "../../types.js";
import { material } from "./fixtures.js";

describe("invite bundle cast", () => {
  it("casts a live invite bundle and unlocks it with the token", async () => {
    const linkSigner = new PrivateKeySigner(generateSecretKey());
    const store = new EventStore();
    const token = new Uint8Array(16).fill(7);
    const bundle: InviteBundle = { ...material("community-1"), label: "welcome" };

    const event = await InviteBundleFactory.create(bundle, token).sign(linkSigner);
    store.add(event);

    const cast = castEvent(event, ConcordInviteBundle, store);
    expect(cast.vsk).toBe(6);
    expect(cast.live).toBe(true);
    expect(cast.revoked).toBe(false);
    expect(cast.address).toMatch(/^naddr/);

    // Locked until unlock() runs.
    expect(cast.unlocked).toBe(false);
    expect(cast.bundle).toBeUndefined();
    expect(cast.unlock(token).community_id).toBe("community-1");
    expect(cast.unlocked).toBe(true);
    expect(cast.bundle?.label).toBe("welcome");
  });

  it("re-emits the decrypted contents on bundle$ after unlock", async () => {
    const linkSigner = new PrivateKeySigner(generateSecretKey());
    const store = new EventStore();
    const token = new Uint8Array(16).fill(7);
    const bundle: InviteBundle = { ...material("community-1"), label: "welcome" };

    const event = await InviteBundleFactory.create(bundle, token).sign(linkSigner);
    store.add(event);

    const cast = castEvent(event, ConcordInviteBundle, store);
    const emissions: (InviteBundle | undefined)[] = [];
    const sub = cast.bundle$.subscribe((value) => emissions.push(value));

    // Locked: emits undefined until unlocked.
    expect(emissions).toEqual([undefined]);

    cast.unlock(token);

    // Unlock notifies the event, re-emitting the decrypted bundle.
    expect(emissions.at(-1)?.community_id).toBe("community-1");
    sub.unsubscribe();
  });

  it("marks a revoked invite bundle as not live", async () => {
    const linkSigner = new PrivateKeySigner(generateSecretKey());
    const store = new EventStore();

    const event = await InviteBundleFactory.revoke().sign(linkSigner);
    store.add(event);

    const cast = castEvent(event, ConcordInviteBundle, store);
    expect(cast.vsk).toBe(9);
    expect(cast.revoked).toBe(true);
    expect(cast.live).toBe(false);
  });
});
