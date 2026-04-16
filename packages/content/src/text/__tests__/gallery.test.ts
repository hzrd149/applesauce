import { describe, expect, it } from "vitest";
import { IMAGE_EXT } from "applesauce-core/helpers/url";
import { getParsedContent } from "../content.js";
import { galleries } from "../gallery.js";
import { links } from "../links.js";
import { blossomURIs } from "../blossom.js";

const HASH_A = "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";
const HASH_B = "a7b3c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";

const galleriesWithBlossom = () => galleries(IMAGE_EXT, { includeBlossom: true });

describe("gallery", () => {
  it("should group image urls into galleries", () => {
    expect(
      getParsedContent("Hello https://example.com/image.png https://example.com/image2.png", undefined, [
        links,
        galleries,
      ]).children,
    ).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: ["https://example.com/image.png", "https://example.com/image2.png"],
      }),
    ]);
  });

  it("should not match a single image link", () => {
    expect(getParsedContent("Hello https://example.com/image.png", undefined, [links, galleries]).children).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({ type: "link" }),
    ]);
  });

  it("should match multiple galleries", () => {
    expect(
      getParsedContent(
        "Hello https://example.com/image.png\nhttps://example.com/image2.png\n\nAnd here are the other images https://example.com/image3.png\n\nhttps://example.com/image4.png",
        undefined,
        [links, galleries],
      ).children,
    ).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: ["https://example.com/image.png", "https://example.com/image2.png"],
      }),
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: ["https://example.com/image3.png", "https://example.com/image4.png"],
      }),
    ]);
  });

  it("should match content with mixed protocols", () => {
    expect(
      getParsedContent("Hello http://example.com/image.png https://example.com/image2.png", undefined, [
        links,
        galleries,
      ]).children,
    ).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: ["http://example.com/image.png", "https://example.com/image2.png"],
      }),
    ]);
  });

  it("should match a note with only http links", () => {
    expect(
      getParsedContent(
        `http://localhost:3000/asdfa.jpeg http://localhost:3000/adf.jpeg\nhttp://localhost:3000/asdf.jpeg\nhttp://localhost:3000/asdf.jpeg`,
        undefined,
        [links, galleries],
      ).children,
    ).toEqual([expect.objectContaining({ type: "gallery", links: expect.arrayContaining([expect.any(String)]) })]);
  });

  it("should match content with ip addresses", () => {
    expect(
      getParsedContent("Hello http://192.168.1.1/image.png https://192.168.1.2/image2.png", undefined, [
        links,
        galleries,
      ]).children,
    ).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: ["http://192.168.1.1/image.png", "https://192.168.1.2/image2.png"],
      }),
    ]);
  });

  it("should group blossom image URIs into galleries when opted in", () => {
    expect(
      getParsedContent(`Hello blossom:${HASH_A}.png blossom:${HASH_B}.jpg`, undefined, [
        blossomURIs,
        galleriesWithBlossom,
      ]).children,
    ).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "gallery",
        links: [`blossom:${HASH_A}.png`, `blossom:${HASH_B}.jpg`],
      }),
    ]);
  });

  it("should mix blossom and http image URIs in a gallery when opted in", () => {
    expect(
      getParsedContent(`blossom:${HASH_A}.png https://example.com/image2.png`, undefined, [
        blossomURIs,
        links,
        galleriesWithBlossom,
      ]).children,
    ).toEqual([
      expect.objectContaining({
        type: "gallery",
        links: [`blossom:${HASH_A}.png`, "https://example.com/image2.png"],
      }),
    ]);
  });

  it("should not group non-image blossom URIs", () => {
    expect(
      getParsedContent(`blossom:${HASH_A}.pdf blossom:${HASH_B}.pdf`, undefined, [blossomURIs, galleriesWithBlossom])
        .children,
    ).toEqual([
      expect.objectContaining({ type: "blossom", ext: "pdf" }),
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({ type: "blossom", ext: "pdf" }),
    ]);
  });

  it("should not group blossom image URIs by default", () => {
    expect(
      getParsedContent(`blossom:${HASH_A}.png blossom:${HASH_B}.jpg`, undefined, [blossomURIs, galleries]).children,
    ).toEqual([
      expect.objectContaining({ type: "blossom", ext: "png" }),
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({ type: "blossom", ext: "jpg" }),
    ]);
  });
});
