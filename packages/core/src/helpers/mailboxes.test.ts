/// <reference types="jest-extended" />
import { NostrEvent } from "nostr-tools";
import { getInboxes, getOutboxes } from "./mailboxes.js";

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
      ).toIncludeAllMembers(["wss://inbox.com/"]);
    });

    test("should remove bad urls", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "bad://inbox.com"]],
          }),
        ),
      ).toBeArrayOfSize(0);

      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "something that is not a url"]],
          }),
        ),
      ).toBeArrayOfSize(0);

      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com,wss://inbox.org"]],
          }),
        ),
      ).toBeArrayOfSize(0);
    });

    test("without marker", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com/"]],
          }),
        ),
      ).toIncludeAllMembers(["wss://inbox.com/"]);
    });

    test("with marker", () => {
      expect(
        Array.from(
          getInboxes({
            ...emptyEvent,
            tags: [["r", "wss://inbox.com/", "read"]],
          }),
        ),
      ).toIncludeAllMembers(["wss://inbox.com/"]);
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
      ).toIncludeAllMembers(["wss://outbox.com/"]);
    });

    test("should remove bad urls", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "bad://inbox.com"]],
          }),
        ),
      ).toBeArrayOfSize(0);

      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "something that is not a url"]],
          }),
        ),
      ).toBeArrayOfSize(0);

      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com,wss://inbox.org"]],
          }),
        ),
      ).toBeArrayOfSize(0);
    });

    test("without marker", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com/"]],
          }),
        ),
      ).toIncludeAllMembers(["wss://outbox.com/"]);
    });

    test("with marker", () => {
      expect(
        Array.from(
          getOutboxes({
            ...emptyEvent,
            tags: [["r", "wss://outbox.com/", "write"]],
          }),
        ),
      ).toIncludeAllMembers(["wss://outbox.com/"]);
    });
  });
});
