import { describe, expect, it } from "vitest";
import { ForumThreadFactory, CommentFactory } from "applesauce-common/factories";

import { KIND } from "../../types.js";
import type { DecodedEvent } from "../../types.js";
import { foldThreads } from "../forum-thread.js";

// Wrap a rumor template into a minimal DecodedEvent for folding.
const decoded = (rumor: { kind: number; content: string; tags: string[][] }, id: string, author: string, ms: number): DecodedEvent =>
  ({ rumor: { ...rumor, id, pubkey: author, created_at: 0 }, author, ms, wrapId: id, sealKind: 0 }) as unknown as DecodedEvent;

describe("foldThreads", () => {
  it("folds kind 11 threads and attaches their kind 1111 replies to the root", async () => {
    const thread = await ForumThreadFactory.create("GM", "Good morning");
    const reply = await CommentFactory.create(
      { type: "event", id: "thread-1", kind: KIND.THREAD, pubkey: "alice" },
      "Cool beans",
    );

    const threads = foldThreads([
      decoded(thread, "thread-1", "alice", 1),
      decoded(reply, "reply-1", "bob", 2),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: "thread-1", author: "alice", title: "GM", content: "Good morning" });
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0]).toMatchObject({ id: "reply-1", author: "bob", content: "Cool beans" });
  });

  it("ignores replies whose root thread is absent", async () => {
    const reply = await CommentFactory.create(
      { type: "event", id: "missing", kind: KIND.THREAD, pubkey: "alice" },
      "orphan",
    );
    expect(foldThreads([decoded(reply, "reply-1", "bob", 1)])).toEqual([]);
  });

  it("orders threads by ms", async () => {
    const a = await ForumThreadFactory.create("A");
    const b = await ForumThreadFactory.create("B");
    const threads = foldThreads([decoded(b, "b", "x", 5), decoded(a, "a", "x", 1)]);
    expect(threads.map((t) => t.title)).toEqual(["A", "B"]);
  });
});
