import { NostrEvent } from "applesauce-core/helpers/event";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { EventMemory } from "../../event-store/event-memory.js";
import { claimEvents } from "../claim-events.js";

const event1 = {
  content:
    '{"name":"hzrd149","picture":"https://cdn.hzrd149.com/5ed3fe5df09a74e8c126831eac999364f9eb7624e2b86d521521b8021de20bdc.png","about":"JavaScript developer working on some nostr stuff\\n- noStrudel https://nostrudel.ninja/ \\n- Blossom https://github.com/hzrd149/blossom \\n- Applesauce https://hzrd149.github.io/applesauce/","website":"https://hzrd149.com","nip05":"_@hzrd149.com","lud16":"hzrd1499@minibits.cash","pubkey":"266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5","display_name":"hzrd149","displayName":"hzrd149","banner":""}',
  created_at: 1738362529,
  id: "e9df8d5898c4ccfbd21fcd59f3f48abb3ff0ab7259b19570e2f1756de1e9306b",
  kind: 0,
  pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
  relays: [""],
  sig: "465a47b93626a587bf81dadc2b306b8f713a62db31d6ce1533198e9ae1e665a6eaf376a03250bf9ffbb02eb9059c8eafbd37ae1092d05d215757575bd8357586",
  tags: [],
};

const event2 = {
  content:
    '{"name":"Cesar Dias","website":"dev.nosotros.app","picture":"https://nostr.build/i/5b0e4387b0fdfff9897ee7f8dcc554761fe377583a5fb71bbf3b3915e7c4971c2.jpg","display_name":"Cesar Dias"}',
  created_at: 1727998492,
  id: "c771fe19ac255ea28690c5547258a5e146d2f47805f7f48093b773478bdd137c",
  kind: 0,
  pubkey: "c6603b0f1ccfec625d9c08b753e4f774eaf7d1cf2769223125b5fd4da728019e",
  relays: [""],
  sig: "5220d6a8cdb4837b2569c26a84a2ac6a44427a224cb1602c05c578c6a63fe122a37e16455b09cb38bf297fc8161a8e715d7b444d017624c044d87a77e092c881",
  tags: [],
};

describe("claimEvents", () => {
  it("should claim a single event", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    subject.next(database.add(event1)!);
    expect(database.isClaimed(event1)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(event1)).toBe(false);
  });

  it("should claim multiple different events", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    subject.next(database.add(event1)!);
    subject.next(database.add(event2)!);

    expect(database.isClaimed(event1)).toBe(true);
    expect(database.isClaimed(event2)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(event1)).toBe(false);
    expect(database.isClaimed(event2)).toBe(false);
  });

  it("should handle the same event emitted multiple times (MEMORY LEAK TEST)", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    const evt = database.add(event1)!;

    // Emit the same event multiple times
    subject.next(evt);
    expect(database.isClaimed(evt)).toBe(true);

    subject.next(evt);
    expect(database.isClaimed(evt)).toBe(true);

    subject.next(evt);
    expect(database.isClaimed(evt)).toBe(true);

    // When unsubscribed, the event should be unclaimed
    sub.unsubscribe();
    expect(database.isClaimed(evt)).toBe(false);
  });

  it("should handle arrays of events", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent[]>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;

    subject.next([evt1, evt2]);

    expect(database.isClaimed(evt1)).toBe(true);
    expect(database.isClaimed(evt2)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
  });

  it("should handle arrays with duplicate events (MEMORY LEAK TEST)", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent[]>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    const evt = database.add(event1)!;

    // Emit array with the same event multiple times
    subject.next([evt, evt, evt]);

    expect(database.isClaimed(evt)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt)).toBe(false);
  });

  it("should handle undefined values", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent | undefined>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    subject.next(undefined);
    subject.next(database.add(event1)!);
    subject.next(undefined);

    expect(database.isClaimed(event1)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(event1)).toBe(false);
  });

  it("should handle empty arrays", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent[]>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    subject.next([]);

    sub.unsubscribe();
    // Should not throw
  });

  it("should handle observable completion", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();

    subject.pipe(claimEvents(database)).subscribe();

    const evt = database.add(event1)!;
    subject.next(evt);

    expect(database.isClaimed(evt)).toBe(true);

    // Complete the observable
    subject.complete();

    // Claims should be removed on completion
    expect(database.isClaimed(evt)).toBe(false);
  });

  it("should handle observable error", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();

    subject.pipe(claimEvents(database)).subscribe({
      error: () => {
        // Ignore error
      },
    });

    const evt = database.add(event1)!;
    subject.next(evt);

    expect(database.isClaimed(evt)).toBe(true);

    // Error the observable
    subject.error(new Error("test error"));

    // Claims should be removed on error
    expect(database.isClaimed(evt)).toBe(false);
  });

  it("should handle multiple subscriptions to the same observable", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const observable = subject.pipe(claimEvents(database));

    const sub1 = observable.subscribe();
    const sub2 = observable.subscribe();

    const evt = database.add(event1)!;
    subject.next(evt);

    // Both subscriptions should claim the event
    expect(database.isClaimed(evt)).toBe(true);

    // Unsubscribe first subscription
    sub1.unsubscribe();

    // Event might still be claimed by sub2 depending on implementation
    // This tests the behavior
    const claimedAfterFirstUnsub = database.isClaimed(evt);

    // Unsubscribe second subscription
    sub2.unsubscribe();

    // After both unsubscribe, at least one should have removed the claim
    // The actual behavior depends on how the claim system handles multiple claims
    expect(database.isClaimed(evt)).toBe(false);
  });

  it("should handle mixed arrays with events and same event appearing multiple times", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent[]>();
    const sub = subject.pipe(claimEvents(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;

    // First emission
    subject.next([evt1, evt2]);
    expect(database.isClaimed(evt1)).toBe(true);
    expect(database.isClaimed(evt2)).toBe(true);

    // Second emission with overlapping events
    subject.next([evt1, evt2]);
    expect(database.isClaimed(evt1)).toBe(true);
    expect(database.isClaimed(evt2)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
  });
});
