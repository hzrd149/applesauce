import { NostrEvent } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import {
  createNostrWebTokenAuthorizationHeader,
  decodeNostrWebToken,
  encodeNostrWebToken,
  getNostrWebTokenAudiences,
  getNostrWebTokenExpiration,
  getNostrWebTokenIssuedAt,
  getNostrWebTokenIssuer,
  getNostrWebTokenNotBefore,
  getNostrWebTokenSubject,
  hasNostrWebTokenAudience,
  isNostrWebTokenActive,
  isValidNostrWebToken,
  NOSTR_WEB_TOKEN_KIND,
  parseNostrWebTokenAuthorizationHeader,
  parseNostrWebTokenClaims,
} from "../nostr-web-token.js";

const HEX = (char: string, length = 64) => char.repeat(length);

function token(tags: string[][] = []): NostrEvent {
  return {
    id: HEX("f"),
    pubkey: HEX("a"),
    created_at: 100,
    kind: NOSTR_WEB_TOKEN_KIND,
    tags,
    content: "authorize upload",
    sig: "not-a-real-signature",
  };
}

describe("nostr web token helpers", () => {
  it("parses registered and custom claims", () => {
    const event = token([
      ["iss", "issuer"],
      ["sub", "subject"],
      ["aud", "api.example.com"],
      ["aud", "cdn.example.com"],
      ["iat", "101"],
      ["exp", "200"],
      ["nbf", "90"],
      ["scope", "upload"],
      ["scope", "delete"],
    ]);

    expect(parseNostrWebTokenClaims(event)).toEqual({
      issuer: "issuer",
      subject: "subject",
      audiences: ["api.example.com", "cdn.example.com"],
      issuedAt: 101,
      expiration: 200,
      notBefore: 90,
      claims: { scope: ["upload", "delete"] },
    });
    expect(getNostrWebTokenIssuer(event)).toBe("issuer");
    expect(getNostrWebTokenSubject(event)).toBe("subject");
    expect(getNostrWebTokenAudiences(event)).toEqual(["api.example.com", "cdn.example.com"]);
    expect(getNostrWebTokenIssuedAt(event)).toBe(101);
    expect(getNostrWebTokenExpiration(event)).toBe(200);
    expect(getNostrWebTokenNotBefore(event)).toBe(90);
  });

  it("defaults issuer, subject, and issued-at claims", () => {
    const event = token();

    expect(parseNostrWebTokenClaims(event)).toMatchObject({
      issuer: event.pubkey,
      subject: event.pubkey,
      issuedAt: event.created_at,
    });
  });

  it("validates token structure without checking signatures", () => {
    expect(isValidNostrWebToken(token())).toBe(true);
  });

  it("rejects invalid token structures", () => {
    expect(isValidNostrWebToken({ ...token(), kind: 1 })).toBe(false);
    expect(isValidNostrWebToken({ ...token(), created_at: 0 })).toBe(false);
    expect(
      isValidNostrWebToken(
        token([
          ["iss", "a"],
          ["iss", "b"],
        ]),
      ),
    ).toBe(false);
    expect(isValidNostrWebToken(token([["aud"]]))).toBe(false);
    expect(isValidNostrWebToken(token([["exp", "1.5"]]))).toBe(false);
    expect(isValidNostrWebToken(token([["nbf", "-1"]]))).toBe(false);
  });

  it("checks active time windows", () => {
    expect(isNostrWebTokenActive(token([["exp", "200"]]), 100, 0)).toBe(true);
    expect(isNostrWebTokenActive(token([["exp", "100"]]), 100, 0)).toBe(false);
    expect(isNostrWebTokenActive(token([["nbf", "101"]]), 100, 0)).toBe(false);
    expect(isNostrWebTokenActive(token([["nbf", "101"]]), 100, 1)).toBe(true);
    expect(isNostrWebTokenActive(token([["exp", "invalid"]]), 100, 0)).toBe(false);
  });

  it("checks audiences", () => {
    const event = token([["aud", "api.example.com"]]);

    expect(hasNostrWebTokenAudience(event, "api.example.com")).toBe(true);
    expect(hasNostrWebTokenAudience(event, "cdn.example.com")).toBe(false);
  });

  it("encodes and decodes transport tokens", () => {
    const event = token([["aud", "api.example.com"]]);
    const encoded = encodeNostrWebToken(event);

    expect(decodeNostrWebToken(encoded)).toEqual(event);
    expect(decodeNostrWebToken("not valid")).toBeUndefined();
  });

  it("creates and parses authorization headers", () => {
    const event = token([["aud", "api.example.com"]]);
    const header = createNostrWebTokenAuthorizationHeader(event);

    expect(header.startsWith("Nostr ")).toBe(true);
    expect(parseNostrWebTokenAuthorizationHeader(header)).toEqual(event);
    expect(parseNostrWebTokenAuthorizationHeader("Bearer abc")).toBeUndefined();
  });
});
