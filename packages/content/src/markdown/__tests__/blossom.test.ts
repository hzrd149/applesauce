import { remark } from "remark";
import { describe, expect, it } from "vitest";

import { remarkBlossomURIs } from "../blossom.js";

const HASH = "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";
const PUBKEY = "ec4425ff5e9446080d2f70440188e3ca5d6da8713db7bdeef73d0ed54d9093f0";

function parse(markdown: string) {
  return remark().use(remarkBlossomURIs).parse(markdown);
}

function runTransformer(markdown: string) {
  const processor = remark().use(remarkBlossomURIs);
  return processor.runSync(processor.parse(markdown));
}

describe("remarkBlossomURIs", () => {
  it("replaces a bare blossom URI with a link node carrying parsed data", () => {
    const tree = runTransformer(`blossom:${HASH}.pdf`);
    const paragraph = (tree as any).children[0];
    expect(paragraph.children[0]).toMatchObject({
      type: "link",
      url: `blossom:${HASH}.pdf`,
      data: {
        sha256: HASH,
        ext: "pdf",
        servers: [],
        authors: [],
      },
    });
  });

  it("parses query parameters into the data payload", () => {
    const uri = `blossom:${HASH}.png?xs=cdn.example.com&as=${PUBKEY}&sz=184292`;
    const tree = runTransformer(`see ${uri}`);
    const link = (tree as any).children[0].children.find((n: any) => n.type === "link");
    expect(link).toMatchObject({
      type: "link",
      url: uri,
      data: {
        sha256: HASH,
        ext: "png",
        size: 184292,
        servers: ["cdn.example.com"],
        authors: [PUBKEY],
      },
    });
  });

  it("leaves non-matching text alone", () => {
    const tree = parse(`nothing here`);
    expect((tree as any).children[0].children).toEqual([
      { type: "text", value: "nothing here", position: expect.any(Object) },
    ]);
  });
});
