import { remark } from "remark";
import { describe, expect, it } from "vitest";

import { remarkCashuTokens } from "../cashu.js";

const TOKEN =
  "cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vdGVzdG51dC5jYXNodS5zcGFjZSIsInByb29mcyI6W3sic2VjcmV0IjoiMTFhYmQxZjY1OWI1MzE5MjhjYTEwMmEyYjgxYzQ2MTQxYzY3NTg1MjU2ZmZmZGNlNzRiMWY4NWFmZWRkM2M2NiIsIkMiOiIwM2FmYjZiMzE5YjAyYzkyODc3ZjkxY2VjMjM4NmNiZjcwMzVhZDRkMWFiNWUzNmRjY2VkNDdjZWY4NDRjYzNiMWUiLCJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSJ9XX1dLCJ1bml0Ijoic2F0In0";

function runTransformer(markdown: string) {
  const processor = remark().use(remarkCashuTokens);
  return processor.runSync(processor.parse(markdown));
}

describe("remarkCashuTokens", () => {
  it("replaces a bare cashu token with a link node carrying the decoded token", () => {
    const tree = runTransformer(TOKEN);
    const paragraph = (tree as any).children[0];
    const link = paragraph.children.find((n: any) => n.type === "link");
    expect(link).toMatchObject({
      type: "link",
      url: `cashu:${TOKEN}`,
      data: {
        raw: TOKEN,
        token: expect.objectContaining({ unit: "sat" }),
      },
    });
  });

  it("leaves invalid cashu strings as plain text", () => {
    const tree = runTransformer("cashuAinvalid");
    const paragraph = (tree as any).children[0];
    expect(paragraph.children[0]).toMatchObject({ type: "text", value: "cashuAinvalid" });
  });
});
