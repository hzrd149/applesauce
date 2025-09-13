import { NostrEvent } from "nostr-tools";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { InMemoryEventDatabase } from "../../event-store/event-database.js";
import { claimEvents } from "../claim-events.js";

const event = {
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

describe("claimEvents", () => {
  it("it should claim events", () => {
    const database = new InMemoryEventDatabase();
    const subject = new Subject<NostrEvent>();
    const sub = subject.pipe(claimEvents(database)).subscribe();
    subject.next(database.add(event)!);
    expect(database.isClaimed(event)).toBe(true);
    sub.unsubscribe();
    expect(database.isClaimed(event)).toBe(false);
  });
});
