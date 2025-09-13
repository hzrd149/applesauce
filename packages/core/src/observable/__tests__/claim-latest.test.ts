import { NostrEvent } from "nostr-tools";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { InMemoryEventDatabase } from "../../event-store/event-database.js";
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

describe("claimLatest", () => {
  it("it should claim events", () => {
    const database = new InMemoryEventDatabase();
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
});
