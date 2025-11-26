import { EventStore } from "applesauce-core";
import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import { EventFactory } from "applesauce-core";
import { firstValueFrom, lastValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionHub } from "../../action-hub.js";
import { AddBlossomServer, NewBlossomServers, RemoveBlossomServer, SetDefaultBlossomServer } from "../blossom.js";

const user = new FakeUser();

let events: EventStore;
let factory: EventFactory;
let hub: ActionHub;
beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
  hub = new ActionHub(events, factory);
});

describe("NewBlossomServers", () => {
  it("should publish a kind 10063 blossom server list", async () => {
    const result = await lastValueFrom(hub.exec(NewBlossomServers, ["https://cdn.example.com/"]).pipe(toArray()));

    expect(result[0]).toMatchObject({ kind: BLOSSOM_SERVER_LIST_KIND, tags: [["server", "https://cdn.example.com/"]] });
  });

  it("should throw if a blossom servers event already exists", async () => {
    // Create the initial event
    await hub.exec(NewBlossomServers, ["https://cdn.example.com/"]).forEach((e) => events.add(e));

    // Attempt to create another one
    await expect(
      lastValueFrom(hub.exec(NewBlossomServers, ["https://other.example.com/"]).pipe(toArray())),
    ).rejects.toThrow("Blossom servers event already exists");
  });
});

describe("AddBlossomServer", () => {
  beforeEach(async () => {
    // Create an initial empty server list
    await hub.exec(NewBlossomServers, ["https://cdn.example.com/"]).forEach((e) => events.add(e));
  });

  it("should add a single server to the list", async () => {
    const result = await firstValueFrom(hub.exec(AddBlossomServer, "https://other.example.com/"));

    expect(result).toMatchObject({
      kind: BLOSSOM_SERVER_LIST_KIND,
      tags: expect.arrayContaining([["server", expect.stringContaining("other.example.com")]]),
    });
  });

  it("should add multiple servers to the list", async () => {
    const result = await firstValueFrom(
      hub.exec(AddBlossomServer, ["https://other.example.com/", "https://other2.example.com/"]),
    );

    expect(result).toMatchObject({
      kind: BLOSSOM_SERVER_LIST_KIND,
      tags: expect.arrayContaining([
        ["server", expect.stringContaining("other.example.com")],
        ["server", expect.stringContaining("other2.example.com")],
      ]),
    });
  });
});

describe("RemoveBlossomServer", () => {
  beforeEach(async () => {
    // Create an initial server list with two servers
    await hub
      .exec(NewBlossomServers, ["https://cdn.example.com/", "https://other.example.com/"])
      .forEach((e) => events.add(e));
  });

  it("should remove a server from the list", async () => {
    const result = await firstValueFrom(hub.exec(RemoveBlossomServer, "https://cdn.example.com/"));

    expect(result).toMatchObject({
      kind: BLOSSOM_SERVER_LIST_KIND,
      tags: expect.arrayContaining([["server", expect.stringContaining("other.example.com")]]),
    });
  });

  it("should remove multiple servers from the list", async () => {
    const result = await firstValueFrom(
      hub.exec(RemoveBlossomServer, ["https://cdn.example.com/", "https://other.example.com/"]),
    );

    expect(result).toMatchObject({
      kind: BLOSSOM_SERVER_LIST_KIND,
      tags: [],
    });
  });
});

describe("SetDefaultBlossomServer", () => {
  beforeEach(async () => {
    // Create an initial server list with two servers
    await hub
      .exec(NewBlossomServers, ["https://cdn.example.com/", "https://other.example.com/"])
      .forEach((e) => events.add(e));
  });

  it("should move the specified server to the top of the list", async () => {
    const result = await firstValueFrom(hub.exec(SetDefaultBlossomServer, "https://other.example.com/"));

    expect(result).toMatchObject({
      kind: BLOSSOM_SERVER_LIST_KIND,
      tags: expect.arrayContaining([
        ["server", expect.stringContaining("other.example.com")],
        ["server", expect.stringContaining("cdn.example.com")],
      ]),
    });
  });
});
