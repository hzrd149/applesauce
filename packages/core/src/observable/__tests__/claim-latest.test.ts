import { NostrEvent } from "nostr-tools";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { EventMemory } from "../../event-store/event-memory.js";
import { claimLatest } from "../claim-latest.js";

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
    '{"name":"Cesar Dias","website":"dev.nosotros.app","picture":"https://nostr.build/i/5b0e4387b0fdfff9897ee7f8dcc554761fe377583a5fb71bbf3b915e7c4971c2.jpg","display_name":"Cesar Dias","nip05":"_@nosotros.app","lud16":"cesardias@getalby.com","about":"Developer 🇧🇷, building a client https://dev.nosotros.app and nostr-editor https://github.com/cesardeazevedo/nostr-editor","banner":"https://image.nostr.build/87dbc55a6391d15bddda206561d53867a5679dd95e84fe8ed62bfe2e3adcadf3.jpg\\",\\"ox 87dbc55a6391d15bddda206561d53867a5679dd95e84fe8ed62bfe2e3adcadf3"}',
  created_at: 1727998492,
  id: "c771fe19ac255ea28690c5547258a5e146d2f47805f7f48093b773478bdd137c",
  kind: 0,
  pubkey: "c6603b0f1ccfec625d9c08b753e4f774eaf7d1cf2769223125b5fd4da728019e",
  relays: [""],
  sig: "5220d6a8cdb4837b2569c26a84a2ac6a44427a224cb1602c05c578c6a63fe122a37e16455b09cb38bf297fc8161a8e715d7b444d017624c044d87a77e092c881",
  tags: [["alt", "User profile for Cesar Dias"]],
};
const event3 = {
  content: '{"name":"Test User","about":"Third test event"}',
  created_at: 1738362530,
  id: "a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890",
  kind: 0,
  pubkey: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  relays: [""],
  sig: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  tags: [],
};

describe("claimLatest", () => {
  it("should claim the latest event and unclaim previous ones", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();
    subject.next(database.add(event1)!);
    expect(database.isClaimed(event1)).toBe(true);
    subject.next(database.add(event2)!);
    expect(database.isClaimed(event1)).toBe(false);
    expect(database.isClaimed(event2)).toBe(true);
    sub.unsubscribe();
    expect(database.isClaimed(event1)).toBe(false);
    expect(database.isClaimed(event2)).toBe(false);
  });

  it("should claim only a single event", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    subject.next(database.add(event1)!);
    expect(database.isClaimed(event1)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(event1)).toBe(false);
  });

  it("should handle the same event emitted multiple times (MEMORY LEAK TEST)", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

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

  it("should handle multiple events in sequence", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;
    const evt3 = database.add(event3)!;

    subject.next(evt1);
    expect(database.isClaimed(evt1)).toBe(true);
    expect(database.isClaimed(evt2)).toBe(false);
    expect(database.isClaimed(evt3)).toBe(false);

    subject.next(evt2);
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(true);
    expect(database.isClaimed(evt3)).toBe(false);

    subject.next(evt3);
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
    expect(database.isClaimed(evt3)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
    expect(database.isClaimed(evt3)).toBe(false);
  });

  it("should handle undefined values", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent | undefined>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    // Start with undefined
    subject.next(undefined);

    // Emit an event
    const evt = database.add(event1)!;
    subject.next(evt);
    expect(database.isClaimed(evt)).toBe(true);

    // Emit undefined again - should unclaim the event
    subject.next(undefined);
    expect(database.isClaimed(evt)).toBe(false);

    sub.unsubscribe();
  });

  it("should handle alternating between event and undefined", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent | undefined>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;

    subject.next(evt1);
    expect(database.isClaimed(evt1)).toBe(true);

    subject.next(undefined);
    expect(database.isClaimed(evt1)).toBe(false);

    subject.next(evt2);
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(true);

    subject.next(undefined);
    expect(database.isClaimed(evt2)).toBe(false);

    sub.unsubscribe();
  });

  it("should handle observable completion", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();

    subject.pipe(claimLatest(database)).subscribe();

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

    subject.pipe(claimLatest(database)).subscribe({
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
    const observable = subject.pipe(claimLatest(database));

    const sub1 = observable.subscribe();
    const sub2 = observable.subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;

    subject.next(evt1);

    // Both subscriptions should claim the event
    expect(database.isClaimed(evt1)).toBe(true);

    subject.next(evt2);

    // Now evt2 should be claimed
    expect(database.isClaimed(evt2)).toBe(true);

    // Unsubscribe first subscription
    sub1.unsubscribe();

    // Event might still be claimed by sub2
    const claimedAfterFirstUnsub = database.isClaimed(evt2);

    // Unsubscribe second subscription
    sub2.unsubscribe();

    // After both unsubscribe, claims should be removed
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
  });

  it("should handle rapid event changes", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;
    const evt3 = database.add(event3)!;

    // Rapidly emit events
    subject.next(evt1);
    subject.next(evt2);
    subject.next(evt3);
    subject.next(evt1);
    subject.next(evt2);

    // Only the latest should be claimed
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(true);
    expect(database.isClaimed(evt3)).toBe(false);

    sub.unsubscribe();
    expect(database.isClaimed(evt2)).toBe(false);
  });

  it("should handle event -> same event -> different event sequence (MEMORY LEAK TEST)", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    const evt1 = database.add(event1)!;
    const evt2 = database.add(event2)!;

    subject.next(evt1);
    expect(database.isClaimed(evt1)).toBe(true);

    // Emit the same event again
    subject.next(evt1);
    expect(database.isClaimed(evt1)).toBe(true);

    // Now emit a different event
    subject.next(evt2);
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt1)).toBe(false);
    expect(database.isClaimed(evt2)).toBe(false);
  });

  it("should handle starting with undefined then emitting events", () => {
    const database = new EventMemory();
    const subject = new Subject<NostrEvent | undefined>();
    const sub = subject.pipe(claimLatest(database)).subscribe();

    // Start with multiple undefined emissions
    subject.next(undefined);
    subject.next(undefined);

    const evt = database.add(event1)!;
    subject.next(evt);
    expect(database.isClaimed(evt)).toBe(true);

    sub.unsubscribe();
    expect(database.isClaimed(evt)).toBe(false);
  });
});
