import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core/event-store";
import { NostrEvent, kinds } from "applesauce-core/helpers";
import { beforeEach, describe, expect, it } from "vitest";
import { Note } from "../../casts/note.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { COMMENT_KIND } from "../../helpers/comment.js";
import { RepliesModel, ThreadModel } from "../thread.js";

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

describe("ThreadModel", () => {
  const comment = (root: NostrEvent, parent: NostrEvent, content = "Comment") =>
    user.event({
      kind: COMMENT_KIND,
      content,
      tags: [
        ["E", root.id, "", root.pubkey],
        ["K", String(root.kind)],
        ["e", parent.id, "", parent.pubkey],
        ["k", String(parent.kind)],
      ],
    });

  function thread(root: NostrEvent, ...events: NostrEvent[]) {
    for (const event of [root, ...events]) eventStore.add(event);
    return subscribeSpyTo(eventStore.model(ThreadModel, root.id)).getLastValue()!;
  }

  it("links NIP-10 replies to their parents", () => {
    const root = user.note("Root");
    const reply = user.note("Reply", { tags: [["e", root.id, "", "root"]] });
    const nested = user.note("Nested", {
      tags: [
        ["e", root.id, "", "root"],
        ["e", reply.id, "", "reply"],
      ],
    });

    const { all } = thread(root, reply, nested);

    expect(all.get(reply.id)?.parent?.event).toBe(root);
    expect(all.get(nested.id)?.parent?.event).toBe(reply);
  });

  it("links nested NIP-22 comments to their parents", () => {
    const root = user.note("Root");
    const top = comment(root, root);
    const nested = comment(root, top);

    const { all } = thread(root, nested, top);

    expect(all.get(top.id)?.parent?.event).toBe(root);
    expect(all.get(nested.id)?.parent?.event).toBe(top);
    expect(all.get(nested.id)?.refs.root?.e?.id).toBe(root.id);
  });

  it("mixes NIP-10 replies and NIP-22 comments", () => {
    const root = user.note("Root");
    const reply = user.note("Reply", { tags: [["e", root.id, "", "root"]] });
    const answer = comment(root, reply);

    const { root: item } = thread(root, reply, answer);

    expect([...item!.replies].map((r) => r.event)).toEqual([reply]);
    expect([...[...item!.replies][0].replies].map((r) => r.event)).toEqual([answer]);
  });

  it("ignores NIP-22 comments when comments is false", () => {
    const root = user.note("Root");
    const top = comment(root, root);
    eventStore.add(root);
    eventStore.add(top);

    const spy = subscribeSpyTo(eventStore.model(ThreadModel, root.id, { comments: false }));

    expect(spy.getLastValue()?.all.has(top.id)).toBe(false);
  });
});
