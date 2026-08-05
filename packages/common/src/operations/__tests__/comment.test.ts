import { describe, expect, it } from "vitest";
import { blankEventTemplate } from "applesauce-core/factories";
import { getCommentReplyPointer, getCommentRootPointer } from "../../helpers/comment.js";
import { setParent } from "../comment.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();
const COMMENT_KIND = 1111;

/** Runs `setParent` over a blank 1111 draft and returns the resulting event-ish object. */
async function build(parent: Parameters<typeof setParent>[0]) {
  const draft = await setParent(parent)(blankEventTemplate(COMMENT_KIND));
  return { ...draft, id: "0".repeat(64), pubkey: user.pubkey };
}

describe("setParent", () => {
  it("should root a comment on a signed parent event", async () => {
    const root = user.note("hello");
    const comment = await build(root);

    expect(getCommentRootPointer(comment)).toMatchObject({ type: "event", id: root.id, kind: root.kind });
    expect(getCommentReplyPointer(comment)).toMatchObject({ type: "event", id: root.id, kind: root.kind });
  });

  it("should accept an unsigned rumor as the parent", async () => {
    const root = user.rumor({ kind: 9, content: "hello" });
    const comment = await build(root);

    expect(getCommentRootPointer(comment)).toMatchObject({ type: "event", id: root.id, kind: 9 });
    expect(getCommentReplyPointer(comment)).toMatchObject({ type: "event", id: root.id, kind: 9 });
  });

  it("should keep a reply to a comment rumor rooted on the original rumor", async () => {
    // The regression: a rumor has no `sig`, so a signature-based check misreads it
    // as a bare pointer and throws on the comment kind instead of inheriting the
    // root pointer. Mirrors applesauce-concord, whose planes are all rumors.
    const root = user.rumor({ kind: 9, content: "hello" });
    const reply = { ...(await build(root)), kind: COMMENT_KIND, id: "a".repeat(64) };

    const nested = await build(reply);

    // Root stays the original kind-9 rumor, reply points at the comment.
    expect(getCommentRootPointer(nested)).toMatchObject({ type: "event", id: root.id, kind: 9 });
    expect(getCommentReplyPointer(nested)).toMatchObject({ type: "event", id: reply.id, kind: COMMENT_KIND });
  });

  it("should throw when given a bare pointer to a comment", async () => {
    // A pointer carries no root tags, so the thread root is unrecoverable.
    await expect(build({ type: "event", id: "b".repeat(64), kind: COMMENT_KIND, pubkey: user.pubkey })).rejects.toThrow(
      /full nip-22 comment event/,
    );
  });

  it("should root a comment on a bare pointer to a non-comment event", async () => {
    const pointer = { type: "event", id: "c".repeat(64), kind: 9, pubkey: user.pubkey } as const;
    const comment = await build(pointer);

    expect(getCommentRootPointer(comment)).toMatchObject({ type: "event", id: pointer.id, kind: 9 });
    expect(getCommentReplyPointer(comment)).toMatchObject({ type: "event", id: pointer.id, kind: 9 });
  });
});
