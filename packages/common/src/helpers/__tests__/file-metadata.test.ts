import { describe, expect, it } from "vitest";
import { FileMetadata, getFileMetadataFromImetaTag, parseFileMetadataTags } from "../file-metadata.js";

describe("file metadata helpers", () => {
  describe("parseFileMetadataTags", () => {
    it("should parse a simple 1060 event", () => {
      const tags = [
        ["url", "https://image.nostr.build/30696696e57a2732d4e9f1b15ff4d4d4eaa64b759df6876863f436ff5d736eae.gif"],
        ["ox", "30696696e57a2732d4e9f1b15ff4d4d4eaa64b759df6876863f436ff5d736eae"],
        ["fallback", "https://media.tenor.com/wpvrkjn192gAAAAC/daenerys-targaryen.gif"],
        ["x", "77fcf42b2b720babcdbe686eff67273d8a68862d74a2672db672bc48439a3ea5"],
        ["m", "image/gif"],
        ["dim", "360x306"],
        ["bh", "L38zleNL00~W^kRj0L-p0KM_^kx]"],
        ["blurhash", "L38zleNL00~W^kRj0L-p0KM_^kx]"],
        [
          "thumb",
          "https://image.nostr.build/thumb/30696696e57a2732d4e9f1b15ff4d4d4eaa64b759df6876863f436ff5d736eae.gif",
        ],
        ["t", "gifbuddy"],
        ["summary", "Khaleesi call dragons Daenerys Targaryen"],
        ["alt", "a woman with blonde hair and a brooch on her shoulder"],
        [
          "thumb",
          "https://media.tenor.com/wpvrkjn192gAAAAx/daenerys-targaryen.webp",
          "5d92423664fc15874b1d26c70a05a541ec09b5c438bf157977a87c8e64b31463",
        ],
        [
          "image",
          "https://media.tenor.com/wpvrkjn192gAAAAe/daenerys-targaryen.png",
          "5d92423664fc15874b1d26c70a05a541ec09b5c438bf157977a87c8e64b31463",
        ],
      ];

      expect(parseFileMetadataTags(tags)).toEqual({
        url: "https://image.nostr.build/30696696e57a2732d4e9f1b15ff4d4d4eaa64b759df6876863f436ff5d736eae.gif",
        type: "image/gif",
        dimensions: "360x306",
        blurhash: "L38zleNL00~W^kRj0L-p0KM_^kx]",
        sha256: "77fcf42b2b720babcdbe686eff67273d8a68862d74a2672db672bc48439a3ea5",
        originalSha256: "30696696e57a2732d4e9f1b15ff4d4d4eaa64b759df6876863f436ff5d736eae",
        thumbnail: "https://media.tenor.com/wpvrkjn192gAAAAx/daenerys-targaryen.webp",
        image: "https://media.tenor.com/wpvrkjn192gAAAAe/daenerys-targaryen.png",
        summary: "Khaleesi call dragons Daenerys Targaryen",
        fallback: ["https://media.tenor.com/wpvrkjn192gAAAAC/daenerys-targaryen.gif"],
        alt: "a woman with blonde hair and a brooch on her shoulder",
      } satisfies FileMetadata);
    });
  });

  describe("getFileMetadataFromImetaTag", () => {
    it("should parse simple imeta tag", () => {
      expect(
        getFileMetadataFromImetaTag([
          "imeta",
          "url https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
          "x 3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
          "dim 1024x1024",
          "m image/jpeg",
          "blurhash ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
        ]),
      ).toEqual({
        url: "https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
        sha256: "3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
        dimensions: "1024x1024",
        type: "image/jpeg",
        blurhash: "ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
      });
    });

    it("should parse thumbnail url", () => {
      expect(
        getFileMetadataFromImetaTag([
          "imeta",
          "url https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
          "x 3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
          "dim 1024x1024",
          "m image/jpeg",
          "blurhash ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
          "thumb https://exmaple.com/thumb.jpg",
        ]),
      ).toEqual({
        url: "https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
        sha256: "3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
        dimensions: "1024x1024",
        type: "image/jpeg",
        blurhash: "ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
        thumbnail: "https://exmaple.com/thumb.jpg",
      });
    });

    it("should parse multiple fallback urls", () => {
      expect(
        getFileMetadataFromImetaTag([
          "imeta",
          "url https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
          "x 3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
          "dim 1024x1024",
          "m image/jpeg",
          "blurhash ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
          "fallback https://exmaple.com/image2.jpg",
          "fallback https://exmaple.com/image3.jpg",
        ]),
      ).toEqual({
        url: "https://blossom.primal.net/3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c.jpg",
        sha256: "3f4dbf2797ac4e90b00bcfe2728e5c8367ed909c48230ac454cc325f1993646c",
        dimensions: "1024x1024",
        type: "image/jpeg",
        blurhash: "ggH{Aws:RPWBRjaeay?^ozV@aeRjaej[$gt7kCofWVofkCrrofxuofa|ozbHx]s:tRofaet7ay",
        fallback: ["https://exmaple.com/image2.jpg", "https://exmaple.com/image3.jpg"],
      });
    });
  });
});
