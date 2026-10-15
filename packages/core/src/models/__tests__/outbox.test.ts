import { BehaviorSubject } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { kinds } from "../../helpers/event.js";
import { OutboxModel } from "../outbox.js";

describe("OutboxModel", () => {
  it("should not select blacklisted relays from a contact's relay list", () => {
    const store = new EventStore();
    const user = new FakeUser();
    const contact = new FakeUser();

    store.add(user.event({ kind: kinds.Contacts, tags: [["p", contact.pubkey]] }));
    store.add(contact.event({ kind: kinds.RelayList, tags: [["r", "wss://blocked.example.com/"]] }));

    let selection: { pubkey: string; relays?: string[] }[] | undefined;
    store
      .model(OutboxModel, user.pubkey, { maxConnections: 10, blacklist: ["wss://blocked.example.com/"] })
      .subscribe((v) => (selection = v));

    expect(selection).toEqual([{ pubkey: contact.pubkey, relays: [] }]);
  });
});

describe("OutboxModel.getKey", () => {
  const base = { maxConnections: 10, maxRelaysPerUser: 2 };

  it("should share a key for identical options", () => {
    expect(OutboxModel.getKey("a", { ...base, blacklist: ["wss://x.com/"] })).toBe(
      OutboxModel.getKey("a", { ...base, blacklist: ["wss://x.com/"] }),
    );
  });

  it("should use different keys for different blacklists", () => {
    expect(OutboxModel.getKey("a", { ...base, blacklist: ["wss://x.com/"] })).not.toBe(
      OutboxModel.getKey("a", { ...base, blacklist: ["wss://y.com/"] }),
    );
    expect(OutboxModel.getKey("a", { ...base, blacklist: new BehaviorSubject(["wss://x.com/"]) })).not.toBe(
      OutboxModel.getKey("a", { ...base, blacklist: new BehaviorSubject(["wss://x.com/"]) }),
    );
  });

  it("should use different keys for different score functions", () => {
    expect(OutboxModel.getKey("a", { ...base, score: (_r, coverage) => coverage })).not.toBe(
      OutboxModel.getKey("a", { ...base, score: (_r, _c, popularity) => popularity }),
    );
  });
});
