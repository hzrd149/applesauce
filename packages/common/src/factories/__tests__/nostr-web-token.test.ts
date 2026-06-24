import { NostrEvent } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { NOSTR_WEB_TOKEN_KIND } from "../../helpers/nostr-web-token.js";
import { NostrWebTokenFactory } from "../nostr-web-token.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("NostrWebTokenFactory", () => {
  it("builds a kind 27519 event", async () => {
    const event = await NostrWebTokenFactory.create()
      .audiences(["api.example.com", "cdn.example.com"])
      .expiration(200)
      .notBefore(90)
      .addClaim("scope", "upload")
      .addClaim("scope", "delete", false)
      .message("authorize upload");

    expect(event.kind).toBe(NOSTR_WEB_TOKEN_KIND);
    expect(event.content).toBe("authorize upload");
    expect(event.tags).toEqual([
      ["aud", "api.example.com"],
      ["aud", "cdn.example.com"],
      ["exp", "200"],
      ["nbf", "90"],
      ["scope", "upload"],
      ["scope", "delete"],
    ]);
  });

  it("applies claims in bulk", async () => {
    const event = await NostrWebTokenFactory.create({
      issuer: "issuer",
      subject: "subject",
      audiences: ["api.example.com"],
      issuedAt: 100,
      expiration: 200,
      claims: { scope: ["upload", "delete"] },
    });

    expect(event.tags).toEqual([
      ["iss", "issuer"],
      ["sub", "subject"],
      ["aud", "api.example.com"],
      ["iat", "100"],
      ["exp", "200"],
      ["scope", "upload"],
      ["scope", "delete"],
    ]);
  });

  it("modifies an existing Nostr Web Token", async () => {
    const existing: NostrEvent = {
      id: HEX("f"),
      pubkey: HEX("a"),
      created_at: 100,
      kind: NOSTR_WEB_TOKEN_KIND,
      tags: [
        ["aud", "old.example.com"],
        ["scope", "upload"],
      ],
      content: "old",
      sig: HEX("c", 128),
    };

    const result = await NostrWebTokenFactory.modify(existing)
      .audiences(["api.example.com"])
      .removeClaim("scope")
      .message("new");

    expect(result.content).toBe("new");
    expect(result.tags).toEqual([["aud", "api.example.com"]]);
  });
});
