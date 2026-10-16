import { EventStore } from "applesauce-core";
import { User } from "applesauce-common/casts";
import { kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import { ClearUserStatus, SetUserStatus } from "../user-status.js";

const user = new FakeUser();

let events: EventStore;
let publish: () => Promise<void>;
let hub: ActionRunner;
beforeEach(async () => {
  events = new EventStore();
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionRunner(events, user, publish);
  User.cache.clear();

  events.add(user.event({ kind: kinds.RelayList, tags: [["r", "wss://relay.example.com/"]] }));
});

describe("SetUserStatus", () => {
  it("publishes a general status to the outboxes", async () => {
    await hub.run(SetUserStatus, "Working", { link: "https://nostr.world" });

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.UserStatuses,
        content: "Working",
        tags: [
          ["d", "general"],
          ["r", "https://nostr.world"],
        ],
      }),
      ["wss://relay.example.com/"],
    );
  });

  it("publishes a music status with an expiration", async () => {
    await hub.run(SetUserStatus, "Intergalatic - Beastie Boys", { type: "music", expiration: 1692845589 });

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          ["d", "music"],
          ["expiration", "1692845589"],
        ]),
      }),
      ["wss://relay.example.com/"],
    );
  });
});

describe("ClearUserStatus", () => {
  it("publishes an empty status", async () => {
    await hub.run(ClearUserStatus, "music");

    expect(publish).toBeCalledWith(
      expect.objectContaining({ kind: kinds.UserStatuses, content: "", tags: [["d", "music"]] }),
      ["wss://relay.example.com/"],
    );
  });
});
