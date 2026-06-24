import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { NOSTR_WEB_TOKEN_KIND } from "../../helpers/nostr-web-token.js";
import {
  addAudience,
  addClaim,
  clearAudiences,
  clearClaim,
  removeAudience,
  removeClaim,
  setAudiences,
  setClaim,
  setExpiration,
  setIssuedAt,
  setIssuer,
  setNotBefore,
  setSubject,
} from "../nostr-web-token.js";

const baseEvent = (): EventTemplate => ({
  kind: NOSTR_WEB_TOKEN_KIND,
  content: "",
  tags: [],
  created_at: unixNow(),
});

describe("nostr web token operations", () => {
  it.each([
    ["issuer", setIssuer("issuer"), [["iss", "issuer"]]],
    ["subject", setSubject("subject"), [["sub", "subject"]]],
    ["issued-at", setIssuedAt(100), [["iat", "100"]]],
    ["expiration", setExpiration(200), [["exp", "200"]]],
    ["not-before", setNotBefore(90), [["nbf", "90"]]],
    ["claim", setClaim("scope", "upload"), [["scope", "upload"]]],
  ])("sets %s", async (_label, operation, expectedTags) => {
    const result = await operation(baseEvent());
    expect(result.tags).toEqual(expectedTags);
  });

  it.each([
    ["issuer", setIssuer(null), ["iss", "issuer"]],
    ["subject", setSubject(null), ["sub", "subject"]],
    ["issued-at", setIssuedAt(null), ["iat", "100"]],
    ["expiration", setExpiration(null), ["exp", "200"]],
    ["not-before", setNotBefore(null), ["nbf", "90"]],
    ["claim", setClaim("scope", null), ["scope", "upload"]],
  ])("clears %s", async (_label, operation, tag) => {
    const result = await operation({ ...baseEvent(), tags: [tag as [string, string]] });
    expect(result.tags).toEqual([]);
  });

  it("adds, removes, clears, and replaces audiences", async () => {
    const first = await addAudience("api.example.com")(baseEvent());
    expect(first.tags).toEqual([["aud", "api.example.com"]]);

    const duplicate = await addAudience("api.example.com")(first);
    expect(duplicate.tags).toEqual([["aud", "api.example.com"]]);

    const second = await addAudience("cdn.example.com", false)(duplicate);
    expect(second.tags).toEqual([
      ["aud", "api.example.com"],
      ["aud", "cdn.example.com"],
    ]);

    const removed = await removeAudience("api.example.com")(second);
    expect(removed.tags).toEqual([["aud", "cdn.example.com"]]);

    const replaced = await setAudiences(["one.example.com", "two.example.com"])(removed);
    expect(replaced.tags).toEqual([
      ["aud", "one.example.com"],
      ["aud", "two.example.com"],
    ]);

    const cleared = await clearAudiences()(replaced);
    expect(cleared.tags).toEqual([]);
  });

  it("adds and removes custom claims", async () => {
    const first = await addClaim("scope", "upload")(baseEvent());
    const second = await addClaim("scope", "delete", false)(first);

    expect(second.tags).toEqual([
      ["scope", "upload"],
      ["scope", "delete"],
    ]);

    const removed = await removeClaim("scope", "upload")(second);
    expect(removed.tags).toEqual([["scope", "delete"]]);

    const cleared = await clearClaim("scope")(removed);
    expect(cleared.tags).toEqual([]);
  });
});
