import { describe, expect, it } from "vitest";
import { EventTemplate, kinds } from "nostr-tools";
import { addInboxRelay, addOutboxRelay, addMailboxRelay, setInboxRelays, setOutboxRelays } from "../mailboxes.js";

describe("setInboxRelays", () => {
  it("should set inbox relays on an empty event", async () => {
    const draft = await setInboxRelays(["wss://relay1.example.com", "wss://relay2.example.com"])(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    expect(draft.tags).toContainEqual(["r", "wss://relay1.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://relay2.example.com/", "read"]);
  });

  it("should replace existing inbox-only relays", async () => {
    const initial = await addInboxRelay("wss://old-inbox.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setInboxRelays(["wss://new-inbox1.example.com", "wss://new-inbox2.example.com"])(initial, {});

    expect(draft.tags).not.toContainEqual(["r", "wss://old-inbox.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-inbox1.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-inbox2.example.com/", "read"]);
  });

  it("should preserve outbox-only relays when setting inboxes", async () => {
    const initial = await addOutboxRelay("wss://outbox.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setInboxRelays(["wss://inbox.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
  });

  it("should convert both relay to outbox-only when removed from inbox list", async () => {
    const initial = await addMailboxRelay("wss://relay.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setInboxRelays(["wss://other.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://relay.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://other.example.com/", "read"]);
  });

  it("should convert outbox-only relay to both when included in inbox list", async () => {
    const initial = await addOutboxRelay("wss://relay.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setInboxRelays(["wss://relay.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://relay.example.com/", "read"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://relay.example.com/", "write"]);
  });

  it("should remove all inbox relays when given an empty array", async () => {
    let draft = await addInboxRelay("wss://inbox1.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );
    draft = await addInboxRelay("wss://inbox2.example.com")(draft);
    draft = await addOutboxRelay("wss://outbox.example.com")(draft);

    draft = await setInboxRelays([])(draft);

    expect(draft.tags).not.toContainEqual(["r", "wss://inbox1.example.com/", "read"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://inbox2.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
  });

  it("should preserve non-r tags", async () => {
    const initial = {
      kind: kinds.RelayList,
      content: "",
      tags: [
        ["other", "tag"],
        ["r", "wss://old-inbox.example.com/", "read"],
      ],
      created_at: 0,
    };

    const draft = await setInboxRelays(["wss://new-inbox.example.com"])(initial);

    expect(draft.tags).toContainEqual(["other", "tag"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-inbox.example.com/", "read"]);
  });
});

describe("setOutboxRelays", () => {
  it("should set outbox relays on an empty event", async () => {
    const draft = await setOutboxRelays(["wss://relay1.example.com", "wss://relay2.example.com"])(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    expect(draft.tags).toContainEqual(["r", "wss://relay1.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://relay2.example.com/", "write"]);
  });

  it("should replace existing outbox-only relays", async () => {
    const initial = await addOutboxRelay("wss://old-outbox.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setOutboxRelays(["wss://new-outbox1.example.com", "wss://new-outbox2.example.com"])(
      initial,
      {},
    );

    expect(draft.tags).not.toContainEqual(["r", "wss://old-outbox.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-outbox1.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-outbox2.example.com/", "write"]);
  });

  it("should preserve inbox-only relays when setting outboxes", async () => {
    const initial = await addInboxRelay("wss://inbox.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setOutboxRelays(["wss://outbox.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://outbox.example.com/", "write"]);
  });

  it("should convert both relay to inbox-only when removed from outbox list", async () => {
    const initial = await addMailboxRelay("wss://relay.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setOutboxRelays(["wss://other.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://relay.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://other.example.com/", "write"]);
  });

  it("should convert inbox-only relay to both when included in outbox list", async () => {
    const initial = await addInboxRelay("wss://relay.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );

    const draft = await setOutboxRelays(["wss://relay.example.com"])(initial);

    expect(draft.tags).toContainEqual(["r", "wss://relay.example.com/"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://relay.example.com/", "read"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://relay.example.com/", "write"]);
  });

  it("should remove all outbox relays when given an empty array", async () => {
    let draft = await addOutboxRelay("wss://outbox1.example.com")(
      { kind: kinds.RelayList, content: "", tags: [], created_at: 0 },
      {},
    );
    draft = await addOutboxRelay("wss://outbox2.example.com")(draft);
    draft = await addInboxRelay("wss://inbox.example.com")(draft);

    draft = await setOutboxRelays([])(draft);

    expect(draft.tags).not.toContainEqual(["r", "wss://outbox1.example.com/", "write"]);
    expect(draft.tags).not.toContainEqual(["r", "wss://outbox2.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://inbox.example.com/", "read"]);
  });

  it("should preserve non-r tags", async () => {
    const initial = {
      kind: kinds.RelayList,
      content: "",
      tags: [
        ["other", "tag"],
        ["r", "wss://old-outbox.example.com/", "write"],
      ],
      created_at: 0,
    };

    const draft = await setOutboxRelays(["wss://new-outbox.example.com"])(initial);

    expect(draft.tags).toContainEqual(["other", "tag"]);
    expect(draft.tags).toContainEqual(["r", "wss://new-outbox.example.com/", "write"]);
  });
});

describe("setInboxRelays and setOutboxRelays together", () => {
  it("should allow setting both independently", async () => {
    let draft: EventTemplate = { kind: kinds.RelayList, content: "", tags: [], created_at: 0 };

    draft = await setInboxRelays(["wss://inbox1.example.com", "wss://inbox2.example.com"])(draft);
    draft = await setOutboxRelays(["wss://outbox1.example.com", "wss://outbox2.example.com"])(draft);

    expect(draft.tags).toContainEqual(["r", "wss://inbox1.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://inbox2.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://outbox1.example.com/", "write"]);
    expect(draft.tags).toContainEqual(["r", "wss://outbox2.example.com/", "write"]);
  });

  it("should create both relays when setting overlapping inboxes and outboxes", async () => {
    let draft: EventTemplate = { kind: kinds.RelayList, content: "", tags: [], created_at: 0 };

    draft = await setInboxRelays(["wss://relay1.example.com", "wss://relay2.example.com"])(draft);
    draft = await setOutboxRelays(["wss://relay2.example.com", "wss://relay3.example.com"])(draft);

    expect(draft.tags).toContainEqual(["r", "wss://relay1.example.com/", "read"]);
    expect(draft.tags).toContainEqual(["r", "wss://relay2.example.com/"]); // both
    expect(draft.tags).toContainEqual(["r", "wss://relay3.example.com/", "write"]);
  });

  it("should handle complex scenario with multiple operations", async () => {
    let draft: EventTemplate = { kind: kinds.RelayList, content: "", tags: [], created_at: 0 };

    // Start with some relays
    draft = await addMailboxRelay("wss://both.example.com")(draft);
    draft = await addInboxRelay("wss://inbox-only.example.com")(draft);
    draft = await addOutboxRelay("wss://outbox-only.example.com")(draft);

    // Set new inboxes - should preserve outbox-only, convert both to outbox-only
    draft = await setInboxRelays(["wss://new-inbox.example.com", "wss://outbox-only.example.com"])(draft);

    expect(draft.tags).not.toContainEqual(["r", "wss://inbox-only.example.com/", "read"]); // should be removed
    expect(draft.tags).toContainEqual(["r", "wss://both.example.com/", "write"]); // became outbox-only
    expect(draft.tags).toContainEqual(["r", "wss://outbox-only.example.com/"]); // became both
    expect(draft.tags).toContainEqual(["r", "wss://new-inbox.example.com/", "read"]);

    // Set new outboxes - should preserve inbox-only, convert both to inbox-only
    draft = await setOutboxRelays(["wss://new-outbox.example.com"])(draft);

    expect(draft.tags).toContainEqual(["r", "wss://new-inbox.example.com/", "read"]); // preserved
    expect(draft.tags).not.toContainEqual(["r", "wss://both.example.com/", "read"]); // should be removed
    expect(draft.tags).toContainEqual(["r", "wss://outbox-only.example.com/", "read"]); // became inbox-only
    expect(draft.tags).toContainEqual(["r", "wss://new-outbox.example.com/", "write"]);
  });
});
