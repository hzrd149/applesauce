import { describe, expect, it } from "vitest";
import {
  getCommentAddressPointer,
  getCommentEventPointer,
  getCommentExternalPointer,
  getCommentReplyPointer,
  getCommentRootPointer,
} from "../comment.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();

describe("getCommentRootPointer", () => {
  it("should return null if event is not a comment", () => {
    expect(getCommentRootPointer(user.note("testing"))).toBe(null);
  });
});

describe("getCommentReplyPointer", () => {
  it("should return null if event is not a comment", () => {
    expect(getCommentReplyPointer(user.note("testing"))).toBe(null);
  });
});

describe("getCommentEventPointer", () => {
  it("should get pubkey from P tag when root=true", () => {
    const tags = [
      ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
      ["K", "1621"],
      ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
      ["k", "1621"],
      ["p", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
      ["e", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
    ];
    expect(getCommentEventPointer(tags, true)).toEqual({
      type: "event",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 1621,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      relay: undefined,
    });
  });

  it("should default to pubkey in E tag when root pubkey do not match", () => {
    const tags = [
      [
        "E",
        "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
        "",
        "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      ],
      ["K", "1621"],
      ["P", "bad-pubkey"],
    ];
    expect(getCommentEventPointer(tags, true)).toEqual({
      type: "event",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 1621,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      relay: undefined,
    });
  });

  it("should get pubkey from E tag", () => {
    const tags = [
      [
        "E",
        "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
        "",
        "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      ],
      ["K", "1621"],
    ];
    expect(getCommentEventPointer(tags, true)).toEqual({
      type: "event",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 1621,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      relay: undefined,
    });
  });

  it("should get relay from E tag", () => {
    const tags = [
      ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f", "wss://relay.io/"],
      ["K", "1621"],
      ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
    ];
    expect(getCommentEventPointer(tags, true)).toEqual({
      type: "event",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 1621,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      relay: "wss://relay.io/",
    });
  });

  it("should return null if K tag is missing", () => {
    const tags = [
      ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f", "wss://relay.io/"],
      ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
    ];
    expect(getCommentEventPointer(tags, true)).toBe(null);
  });

  it("should return null if missing E tag", () => {
    const tags: string[][] = [
      ["K", "1621"],
      ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
    ];

    expect(getCommentEventPointer(tags, true)).toBe(null);
    expect(getCommentEventPointer(tags)).toBe(null);
  });
});

describe("getCommentAddressPointer", () => {
  it("should get event id from E tag", () => {
    // root
    expect(
      getCommentAddressPointer(
        [
          ["A", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
          ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
          ["K", "30000"],
        ],
        true,
      ),
    ).toEqual({
      type: "address",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
    });

    // reply
    expect(
      getCommentAddressPointer([
        ["a", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
        ["e", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
        ["k", "30000"],
      ]),
    ).toEqual({
      type: "address",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
    });
  });

  it("should get relay from A tag", () => {
    // root
    expect(
      getCommentAddressPointer(
        [
          ["A", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list", "wss://relay.io/"],
          ["K", "30000"],
        ],
        true,
      ),
    ).toEqual({
      type: "address",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
      relay: "wss://relay.io/",
    });

    // reply
    expect(
      getCommentAddressPointer([
        ["a", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list", "wss://relay.io/"],
        ["k", "30000"],
      ]),
    ).toEqual({
      type: "address",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
      relay: "wss://relay.io/",
    });
  });

  it("should get relay from E tag", () => {
    // root
    expect(
      getCommentAddressPointer(
        [
          ["A", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
          ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f", "wss://relay.io/"],
          ["K", "30000"],
        ],
        true,
      ),
    ).toEqual({
      type: "address",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
      relay: "wss://relay.io/",
    });

    // reply
    expect(
      getCommentAddressPointer([
        ["a", "30000:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
        ["e", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f", "wss://relay.io/"],
        ["k", "30000"],
      ]),
    ).toEqual({
      type: "address",
      id: "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
      kind: 30000,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
      relay: "wss://relay.io/",
    });
  });

  it("should return A tag kind over K tag", () => {
    // root
    expect(
      getCommentAddressPointer(
        [
          ["A", "30010:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
          ["K", "30000"],
        ],
        true,
      ),
    ).toEqual({
      type: "address",
      kind: 30010,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
    });

    // reply
    expect(
      getCommentAddressPointer([
        ["a", "30010:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"],
        ["k", "30000"],
      ]),
    ).toEqual({
      type: "address",
      kind: 30010,
      pubkey: "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
      identifier: "list",
    });
  });

  it("should throw if missing K tag", () => {
    // root
    expect(
      getCommentAddressPointer(
        [["A", "30010:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"]],
        true,
      ),
    ).toBe(null);

    // reply
    expect(
      getCommentAddressPointer([["a", "30010:e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10:list"]]),
    ).toBe(null);
  });

  it("should return null if missing A tag", () => {
    const tags = [
      ["K", "1621"],
      ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
    ];

    expect(getCommentEventPointer(tags, true)).toBe(null);
    expect(getCommentEventPointer(tags)).toBe(null);
  });
});

describe("getCommentExternalPointer", () => {
  it("should get kind prefix from I tag", () => {
    // root
    expect(
      getCommentExternalPointer(
        [
          ["I", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"],
          ["K", "podcast:item:guid"],
        ],
        true,
      ),
    ).toEqual({
      type: "external",
      identifier: "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f",
      kind: "podcast:item:guid",
    });

    // reply
    expect(
      getCommentExternalPointer([
        ["i", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"],
        ["k", "podcast:item:guid"],
      ]),
    ).toEqual({
      type: "external",
      identifier: "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f",
      kind: "podcast:item:guid",
    });
  });

  it("should not return null if missing K tag", () => {
    // root
    expect(getCommentExternalPointer([["I", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"]], true)).not.toBe(
      null,
    );

    // reply
    expect(getCommentExternalPointer([["i", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"]])).not.toBe(null);
  });
});
