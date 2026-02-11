import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { MailboxesFactory } from "../mailboxes.js";
import { kinds } from "nostr-tools";

const user = new FakeUser();

describe("MailboxesFactory", () => {
  describe("create", () => {
    it("should create a mailboxes factory with kind 10002", async () => {
      const factory = MailboxesFactory.create();
      expect(factory).toBeInstanceOf(MailboxesFactory);
      expect((await factory).kind).toBe(kinds.RelayList);
    });
  });

  describe("addOutbox", () => {
    it("should add an outbox relay", async () => {
      const factory = MailboxesFactory.create().addOutbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/", "write"]);
    });
  });

  describe("addInbox", () => {
    it("should add an inbox relay", async () => {
      const factory = MailboxesFactory.create().addInbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/", "read"]);
    });
  });

  describe("addRelay", () => {
    it("should add a relay as both inbox and outbox", async () => {
      const factory = MailboxesFactory.create().addRelay("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    });
  });

  describe("removeOutbox", () => {
    it("should remove an outbox relay", async () => {
      const factory = MailboxesFactory.create()
        .addOutbox("wss://relay.example.com")
        .removeOutbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).not.toContainEqual(["r", "wss://relay.example.com/", "write"]);
    });

    it("should convert both relay to inbox when removing outbox", async () => {
      const factory = MailboxesFactory.create()
        .addRelay("wss://relay.example.com")
        .removeOutbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/", "read"]);
    });
  });

  describe("removeInbox", () => {
    it("should remove an inbox relay", async () => {
      const factory = MailboxesFactory.create()
        .addInbox("wss://relay.example.com")
        .removeInbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).not.toContainEqual(["r", "wss://relay.example.com/", "read"]);
    });

    it("should convert both relay to outbox when removing inbox", async () => {
      const factory = MailboxesFactory.create()
        .addRelay("wss://relay.example.com")
        .removeInbox("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/", "write"]);
    });
  });

  describe("removeRelay", () => {
    it("should completely remove a relay", async () => {
      const factory = MailboxesFactory.create()
        .addRelay("wss://relay.example.com")
        .removeRelay("wss://relay.example.com");
      const template = await factory;
      expect(template.tags).not.toContainEqual(["r", "wss://relay.example.com/"]);
    });
  });

  describe("chaining operations", () => {
    it("should handle multiple relay operations", async () => {
      const factory = MailboxesFactory.create()
        .addRelay("wss://relay1.example.com")
        .addOutbox("wss://relay2.example.com")
        .addInbox("wss://relay3.example.com");

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay1.example.com/"]);
      expect(template.tags).toContainEqual(["r", "wss://relay2.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://relay3.example.com/", "read"]);
    });
  });

  describe("signing", () => {
    it("should sign the mailboxes event", async () => {
      const factory = MailboxesFactory.create().addRelay("wss://relay.example.com").as(user);

      const signed = await factory.sign();
      expect(signed.kind).toBe(kinds.RelayList);
      expect(signed.pubkey).toBe(user.pubkey);
      expect(signed.id).toBeDefined();
      expect(signed.sig).toBeDefined();
    });
  });

  describe("fromRelayList", () => {
    it("should create a factory from an existing event", async () => {
      const existingEvent = await MailboxesFactory.create().addRelay("wss://relay.example.com").as(user).sign();

      const factory = MailboxesFactory.modify(existingEvent);
      expect(factory).toBeInstanceOf(MailboxesFactory);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    });

    it("should allow modifications to the event", async () => {
      const existingEvent = await MailboxesFactory.create().addRelay("wss://relay1.example.com").as(user).sign();

      const factory = MailboxesFactory.modify(existingEvent).addRelay("wss://relay2.example.com");

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay1.example.com/"]);
      expect(template.tags).toContainEqual(["r", "wss://relay2.example.com/"]);
    });

    it("should throw error for non-relay-list events", async () => {
      const wrongEvent = await user.note("hello");
      expect(() => MailboxesFactory.modify(wrongEvent as any)).toThrow("Event is not a relay list");
    });
  });

  describe("inboxes", () => {
    it("should set multiple inbox relays", async () => {
      const factory = MailboxesFactory.create().inboxes([
        "wss://relay1.example.com",
        "wss://relay2.example.com",
        "wss://relay3.example.com",
      ]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay1.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://relay2.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://relay3.example.com/", "read"]);
    });

    it("should replace existing inbox relays", async () => {
      const factory = MailboxesFactory.create()
        .addInbox("wss://old-inbox.example.com")
        .inboxes(["wss://new-inbox1.example.com", "wss://new-inbox2.example.com"]);

      const template = await factory;
      expect(template.tags).not.toContainEqual(["r", "wss://old-inbox.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://new-inbox1.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://new-inbox2.example.com/", "read"]);
    });

    it("should preserve outbox-only relays when setting inboxes", async () => {
      const factory = MailboxesFactory.create()
        .addOutbox("wss://outbox.example.com")
        .inboxes(["wss://inbox.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
    });

    it("should preserve both relays when setting inboxes", async () => {
      const factory = MailboxesFactory.create().addRelay("wss://both.example.com").inboxes(["wss://inbox.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://both.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
    });

    it("should convert existing outbox-only relay to both if in new inbox list", async () => {
      const factory = MailboxesFactory.create()
        .addOutbox("wss://relay.example.com")
        .inboxes(["wss://relay.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    });

    it("should work with empty array and remove only inbox-only relays", async () => {
      const factory = MailboxesFactory.create()
        .addInbox("wss://inbox.example.com")
        .addRelay("wss://both.example.com")
        .inboxes([]);

      const template = await factory;
      // Should have no inbox-only relays
      const inboxOnlyTags = template.tags.filter((t) => t[0] === "r" && t[2] === "read");
      expect(inboxOnlyTags).toEqual([]);
      // But should still have both relay
      expect(template.tags).toContainEqual(["r", "wss://both.example.com/", "write"]);
    });
  });

  describe("outboxes", () => {
    it("should set multiple outbox relays", async () => {
      const factory = MailboxesFactory.create().outboxes([
        "wss://relay1.example.com",
        "wss://relay2.example.com",
        "wss://relay3.example.com",
      ]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay1.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://relay2.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://relay3.example.com/", "write"]);
    });

    it("should replace existing outbox relays", async () => {
      const factory = MailboxesFactory.create()
        .addOutbox("wss://old-outbox.example.com")
        .outboxes(["wss://new-outbox1.example.com", "wss://new-outbox2.example.com"]);

      const template = await factory;
      expect(template.tags).not.toContainEqual(["r", "wss://old-outbox.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://new-outbox1.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://new-outbox2.example.com/", "write"]);
    });

    it("should preserve inbox-only relays when setting outboxes", async () => {
      const factory = MailboxesFactory.create()
        .addInbox("wss://inbox.example.com")
        .outboxes(["wss://outbox.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
    });

    it("should preserve both relays when setting outboxes", async () => {
      const factory = MailboxesFactory.create()
        .addRelay("wss://both.example.com")
        .outboxes(["wss://outbox.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://both.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
    });

    it("should convert existing inbox-only relay to both if in new outbox list", async () => {
      const factory = MailboxesFactory.create()
        .addInbox("wss://relay.example.com")
        .outboxes(["wss://relay.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    });

    it("should work with empty array and remove only outbox-only relays", async () => {
      const factory = MailboxesFactory.create()
        .addOutbox("wss://outbox.example.com")
        .addRelay("wss://both.example.com")
        .outboxes([]);

      const template = await factory;
      // Should have no outbox-only relays
      const outboxOnlyTags = template.tags.filter((t) => t[0] === "r" && t[2] === "write");
      expect(outboxOnlyTags).toEqual([]);
      // But should still have both relay
      expect(template.tags).toContainEqual(["r", "wss://both.example.com/", "read"]);
    });
  });

  describe("combined usage", () => {
    it("should handle setting both inboxes and outboxes", async () => {
      const factory = MailboxesFactory.create()
        .inboxes(["wss://read1.example.com", "wss://read2.example.com"])
        .outboxes(["wss://write1.example.com", "wss://write2.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://read1.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://read2.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://write1.example.com/", "write"]);
      expect(template.tags).toContainEqual(["r", "wss://write2.example.com/", "write"]);
    });

    it("should handle overlapping relays in inboxes and outboxes", async () => {
      const factory = MailboxesFactory.create()
        .inboxes(["wss://relay1.example.com", "wss://relay2.example.com"])
        .outboxes(["wss://relay2.example.com", "wss://relay3.example.com"]);

      const template = await factory;
      expect(template.tags).toContainEqual(["r", "wss://relay1.example.com/", "read"]);
      expect(template.tags).toContainEqual(["r", "wss://relay2.example.com/"]); // both
      expect(template.tags).toContainEqual(["r", "wss://relay3.example.com/", "write"]);
    });
  });
});
