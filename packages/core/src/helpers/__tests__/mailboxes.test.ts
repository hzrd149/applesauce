import { describe, test, expect } from "vitest";
import { NostrEvent } from "../event";
import { getInboxes, getOutboxes } from "../mailboxes";

const emptyEvent: NostrEvent = {
  kind: 10002,
  content: "",
  tags: [],
  created_at: 0,
  sig: "",
  id: "",
  pubkey: "",
};

describe("Mailboxes", () => {
  describe("getInboxes", () => {
    test("should transform urls", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://inbox.com/"]));
    });

    test("should remove bad urls", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "bad://inbox.com"]],
          }),
        ),
      ).toHaveLength(0);

      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "something that is not a url"]],
          }),
        ),
      ).toHaveLength(0);

      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com,wss://inbox.org"]],
          }),
        ),
      ).toHaveLength(0);
    });

    test("without marker", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com/"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://inbox.com/"]));
    });

    test("with marker", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com/", "read"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://inbox.com/"]));
    });
  });

  describe("getOutboxes", () => {
    test("should transform urls", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://outbox.com/"]));
    });

    test("should remove bad urls", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "bad://inbox.com"]],
          }),
        ),
      ).toHaveLength(0);

      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "something that is not a url"]],
          }),
        ),
      ).toHaveLength(0);

      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com,wss://inbox.org"]],
          }),
        ),
      ).toHaveLength(0);
    });

    test("without marker", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com/"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://outbox.com/"]));
    });

    test("with marker", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com/", "write"]],
          }),
        ),
      ).toEqual(expect.arrayContaining(["wss://outbox.com/"]));
    });
  });
});
