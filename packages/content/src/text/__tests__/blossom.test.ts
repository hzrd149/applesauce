import { describe, expect, it } from "vitest";

import { blossomURIs } from "../blossom.js";
import { getParsedContent } from "../content.js";

const HASH = "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";
const PUBKEY = "ec4425ff5e9446080d2f70440188e3ca5d6da8713db7bdeef73d0ed54d9093f0";

describe("blossomURIs", () => {
  it("parses a minimal blossom URI", () => {
    expect(getParsedContent(`check this blossom:${HASH}.pdf`, undefined, [blossomURIs]).children)
      .toMatchInlineSnapshot(`
        [
          {
            "type": "text",
            "value": "check this ",
          },
          {
            "authors": [],
            "ext": "pdf",
            "raw": "blossom:b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553.pdf",
            "servers": [],
            "sha256": "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553",
            "size": undefined,
            "type": "blossom",
          },
        ]
      `);
  });

  it("parses a URI with xs, as, and sz parameters", () => {
    const uri = `blossom:${HASH}.pdf?xs=cdn.satellite.earth&as=${PUBKEY}&sz=184292`;
    const [, node] = getParsedContent(`here ${uri}`, undefined, [blossomURIs]).children;

    expect(node).toMatchObject({
      type: "blossom",
      sha256: HASH,
      ext: "pdf",
      size: 184292,
      servers: ["cdn.satellite.earth"],
      authors: [PUBKEY],
      raw: uri,
    });
  });

  it("parses a .bin URI", () => {
    const [node] = getParsedContent(`blossom:${HASH}.bin`, undefined, [blossomURIs]).children;
    expect(node).toMatchObject({ type: "blossom", ext: "bin" });
  });

  it("does not match invalid hashes", () => {
    const children = getParsedContent(`blossom:abc.pdf`, undefined, [blossomURIs]).children;
    expect(children).toEqual([{ type: "text", value: "blossom:abc.pdf" }]);
  });

  it("does not match when extension is missing", () => {
    const content = `blossom:${HASH}`;
    const children = getParsedContent(content, undefined, [blossomURIs]).children;
    expect(children).toEqual([{ type: "text", value: content }]);
  });

  it("preserves surrounding text", () => {
    const uri = `blossom:${HASH}.png`;
    const children = getParsedContent(`look at this image ${uri} cool right?`, undefined, [blossomURIs]).children;
    expect(children).toHaveLength(3);
    expect(children[0]).toEqual({ type: "text", value: "look at this image " });
    expect(children[1]).toMatchObject({ type: "blossom", sha256: HASH, ext: "png" });
    expect(children[2]).toEqual({ type: "text", value: " cool right?" });
  });

  it("parses multiple xs and as parameters", () => {
    const uri = `blossom:${HASH}.pdf?xs=cdn.satellite.earth&xs=blossom.primal.net&as=${PUBKEY}`;
    const [node] = getParsedContent(uri, undefined, [blossomURIs]).children;
    expect(node).toMatchObject({
      type: "blossom",
      servers: ["cdn.satellite.earth", "blossom.primal.net"],
      authors: [PUBKEY],
    });
  });
});
