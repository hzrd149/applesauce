import { unixNow } from "applesauce-core/helpers";
import { finalizeEvent, NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import { addPreviousRefs, setGroupPointer } from "../group";

describe("setGroupPointer", () => {
  it('should include "h" tag', async () => {
    expect(
      await setGroupPointer({ id: "group", relay: "groups.relay.com" })(
        { kind: 9, content: "hello world", created_at: unixNow(), tags: [] },
        {},
      ),
    ).toEqual(expect.objectContaining({ tags: expect.arrayContaining([["h", "group", "wss://groups.relay.com/"]]) }));
  });

  it('should override "h" tag if it exists', async () => {
    expect(
      await setGroupPointer({ id: "group", relay: "groups.relay.com" })(
        { kind: 9, content: "hello world", created_at: unixNow(), tags: [["h", "other-group"]] },
        {},
      ),
    ).toEqual(expect.objectContaining({ tags: expect.arrayContaining([["h", "group", "wss://groups.relay.com/"]]) }));
  });
});

describe("addPreviousRefs", () => {
  it('should include "previous" tags from events', async () => {
    const key = generateSecretKey();
    const previous: NostrEvent[] = Array(5)
      .fill("hello world")
      .map((content, i) =>
        finalizeEvent({ kind: 9, content, tags: [["h", "group"]], created_at: unixNow() - i * 50 }, key),
      );

    expect(
      await addPreviousRefs(previous, 5)(
        { kind: 9, content: "hello bots", created_at: unixNow(), tags: [["h", "group"]] },
        {},
      ),
    ).toEqual(
      expect.objectContaining({ tags: expect.arrayContaining(previous.map((e) => ["previous", e.id.slice(0, 8)])) }),
    );
  });
});
