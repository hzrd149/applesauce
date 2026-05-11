import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core/event-store";
import { NostrEvent, kinds } from "applesauce-core/helpers";
import { beforeEach, describe, expect, it } from "vitest";
import { Note } from "../../casts/note.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { RepliesModel } from "../thread.js";

const user = new FakeUser();

let eventStore: EventStore;

beforeEach(() => {
  eventStore = new EventStore();
});

describe("RepliesModel", () => {
  function expectNoteReplies(parent: NostrEvent, reply: NostrEvent) {
    eventStore.add(parent);
    eventStore.add(reply);

    const note = new Note(parent, eventStore);
    const spy = subscribeSpyTo(note.replies$);

    expect(spy.getLastValue()?.map((note) => note.event)).toEqual([reply]);
  }

  it("returns direct NIP-10 replies", () => {
    const parent = user.note("Parent");
    const reply = user.note("Reply", { tags: [["e", parent.id, "", "reply"]] });

    expectNoteReplies(parent, reply);
  });

  it("returns direct NIP-10 replies with author hints", () => {
    const parent = user.note("Parent");
    const reply = user.note("Reply", { tags: [["e", parent.id, "", "reply", parent.pubkey]] });

    expectNoteReplies(parent, reply);
  });

  it("honors overrideKinds", () => {
    const parent = user.note("Parent");
    const reply = user.event({ kind: 42, content: "Reply", tags: [["e", parent.id, "", "reply"]] });
    eventStore.add(parent);
    eventStore.add(reply);

    const spy = subscribeSpyTo(eventStore.model(RepliesModel, parent, [kinds.ShortTextNote]));

    expect(spy.getLastValue()).toEqual([]);
  });
});
