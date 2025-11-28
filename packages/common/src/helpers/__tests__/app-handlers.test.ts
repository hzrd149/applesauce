import { describe, it, expect } from "vitest";
import { NostrEvent, kinds } from "nostr-tools";
import {
  getHandlerSupportedKinds,
  getHandlerName,
  getHandlerPicture,
  getHandlerDescription,
  getHandlerLinkTemplate,
  createHandlerProfileLink,
  createHandlerEventLink,
  createHandlerAddressLink,
  createHandlerLink,
} from "../app-handler.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { naddrEncode, neventEncode, noteEncode, nprofileEncode, npubEncode } from "nostr-tools/nip19";

// Create a fake user for testing
const user = new FakeUser();

// Mock handler event based on NIP-89 specification
const mockHandler: NostrEvent = user.event({
  kind: kinds.Handlerinformation,
  tags: [
    ["d", "app-handler"],
    ["k", "0"], // supports profiles
    ["k", "1"], // supports notes
    ["k", "30023"], // supports long-form content
    ["web", "https://example.com/npub/<bech32>", "npub"],
    ["web", "https://example.com/profile?nprofile=<bech32>", "nprofile"],
    ["web", "https://example.com/note?id=<bech32>", "note"],
    ["web", "https://example.com/event?nevent=<bech32>", "nevent"],
    ["web", "https://example.com/article?naddr=<bech32>", "naddr"],
    ["ios", "testhandler://<bech32>"],
    ["android", "testhandler://<bech32>"],
  ],
  content: JSON.stringify({
    name: "Test Handler",
    display_name: "Test Handler App",
    picture: "https://example.com/logo.png",
    about: "A test handler for NIP-89",
  }),
});

describe("getHandlerSupportedKinds", () => {
  it("should return an array of supported kinds", () => {
    expect(getHandlerSupportedKinds(mockHandler)).toEqual([0, 1, 30023]);
  });

  it("should return an empty array when no kinds are specified", () => {
    const handlerWithoutKinds = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags.filter((tag) => tag[0] !== "k"),
      content: mockHandler.content,
    });
    expect(getHandlerSupportedKinds(handlerWithoutKinds)).toEqual([]);
  });
});

describe("getHandlerName", () => {
  it("should return the handler name", () => {
    expect(getHandlerName(mockHandler)).toBe("Test Handler App");
  });
});

describe("getHandlerPicture", () => {
  it("should return the handler picture", () => {
    const picture = getHandlerPicture(mockHandler);
    expect(picture).toBe("https://example.com/logo.png");
  });

  it("should return the fallback when no picture is available", () => {
    const handlerWithoutPicture = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags,
      content: JSON.stringify({
        name: "Test Handler",
        display_name: "Test Handler App",
        about: "A test handler for NIP-89",
      }),
    });
    const fallback = "https://fallback.com/default.png";
    const picture = getHandlerPicture(handlerWithoutPicture, fallback);
    expect(picture).toBe(fallback);
  });
});

describe("getHandlerDescription", () => {
  it("should return the handler description", () => {
    const description = getHandlerDescription(mockHandler);
    expect(description).toBe("A test handler for NIP-89");
  });
});

describe("getHandlerLinkTemplate", () => {
  it("should return the web link template for a specific type", () => {
    const template = getHandlerLinkTemplate(mockHandler, "web", "npub");
    expect(template).toBe("https://example.com/npub/<bech32>");
  });

  it("should return the ios link template", () => {
    const template = getHandlerLinkTemplate(mockHandler, "ios");
    expect(template).toBe("testhandler://<bech32>");
  });

  it("should return undefined when no template exists", () => {
    // @ts-expect-error - unknown-type is not a valid type
    const template = getHandlerLinkTemplate(mockHandler, "web", "unknown-type");
    expect(template).toBeUndefined();
  });
});

describe("createHandlerProfileLink", () => {
  it("should create a profile link using nprofile format", () => {
    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerProfileLink(mockHandler, pointer)).toEqual(
      `https://example.com/profile?nprofile=${nprofileEncode(pointer)}`,
    );
  });

  it("should fallback to npub when nprofile template is not available", () => {
    const handlerWithoutNprofile = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags.filter((tag) => !(tag[0] === "web" && tag[2] === "nprofile")),
      content: mockHandler.content,
    });
    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerProfileLink(handlerWithoutNprofile, pointer)).toEqual(
      `https://example.com/npub/${npubEncode(pointer.pubkey)}`,
    );
  });

  it("should use default when link type is not available", () => {
    const handlerWithoutNprofile = user.event({
      kind: kinds.Handlerinformation,
      tags: [...mockHandler.tags.filter((tag) => !tag[2]), ["web", "https://example.com/<bech32>"]],
      content: mockHandler.content,
    });

    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerProfileLink(handlerWithoutNprofile, pointer)).toEqual(
      `https://example.com/${nprofileEncode(pointer)}`,
    );
  });
});

describe("createHandlerEventLink", () => {
  it("should create an event link using nevent format", () => {
    const pointer = { id: user.event({ kind: 1111, content: "hello" }).id, relays: ["wss://relay.example.com"] };
    expect(createHandlerEventLink(mockHandler, pointer)).toEqual(
      `https://example.com/event?nevent=${neventEncode(pointer)}`,
    );
  });

  it("should fallback to note when nevent template is not available", () => {
    const handlerWithoutNevent = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags.filter((tag) => tag[2] !== "nevent"),
      content: mockHandler.content,
    });
    const pointer = { id: user.note("hello").id, relays: ["wss://relay.example.com"] };
    expect(createHandlerEventLink(handlerWithoutNevent, pointer)).toEqual(
      `https://example.com/note?id=${noteEncode(pointer.id)}`,
    );
  });

  it("should use default when link type is not available", () => {
    const handlerWithoutNevent = user.event({
      kind: kinds.Handlerinformation,
      tags: [...mockHandler.tags.filter((tag) => !tag[2]), ["web", "https://example.com/<bech32>"]],
      content: mockHandler.content,
    });

    const pointer = { id: user.note("hello").id, relays: ["wss://relay.example.com"] };
    expect(createHandlerEventLink(handlerWithoutNevent, pointer)).toEqual(
      `https://example.com/${neventEncode(pointer)}`,
    );
  });
});

describe("createHandlerAddressLink", () => {
  it("should create an address link using naddr format", () => {
    const pointer = { identifier: "article1", pubkey: user.pubkey, kind: 30023, relays: ["wss://relay.example.com"] };
    expect(createHandlerAddressLink(mockHandler, pointer)).toEqual(
      `https://example.com/article?naddr=${naddrEncode(pointer)}`,
    );
  });

  it("should use default when link type is not available", () => {
    const handlerWithoutNaddr = user.event({
      kind: kinds.Handlerinformation,
      tags: [...mockHandler.tags.filter((tag) => !tag[2]), ["web", "https://example.com/<bech32>"]],
      content: mockHandler.content,
    });

    const pointer = { identifier: "article1", pubkey: user.pubkey, kind: 30023, relays: ["wss://relay.example.com"] };
    expect(createHandlerAddressLink(handlerWithoutNaddr, pointer)).toEqual(
      `https://example.com/${naddrEncode(pointer)}`,
    );
  });
});

describe("createHandlerLink", () => {
  it("should create a profile link for profile pointers", () => {
    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerLink(mockHandler, pointer)).toEqual(
      `https://example.com/profile?nprofile=${nprofileEncode(pointer)}`,
    );
  });

  it("should create an event link for event pointers", () => {
    const pointer = { id: user.event({ kind: 1111, content: "hello" }).id, relays: ["wss://relay.example.com"] };
    expect(createHandlerLink(mockHandler, pointer)).toEqual(
      `https://example.com/event?nevent=${neventEncode(pointer)}`,
    );
  });

  it("should create an address link for address pointers", () => {
    const pointer = { identifier: "article1", pubkey: user.pubkey, kind: 30023, relays: ["wss://relay.example.com"] };
    expect(createHandlerLink(mockHandler, pointer)).toEqual(
      `https://example.com/article?naddr=${naddrEncode(pointer)}`,
    );
  });

  it("should fallback to web platform when specified platform has no template", () => {
    const handlerWithoutAndroid = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags.filter((tag) => tag[0] !== "android"),
      content: mockHandler.content,
    });
    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerLink(handlerWithoutAndroid, pointer, "android")).toContain(
      "https://example.com/profile?nprofile=",
    );
  });

  it("should not fallback to web platform when webFallback is false", () => {
    const handlerWithoutAndroid = user.event({
      kind: kinds.Handlerinformation,
      tags: mockHandler.tags.filter((tag) => tag[0] !== "android"),
      content: mockHandler.content,
    });
    const pointer = { pubkey: user.pubkey, relays: ["wss://relay.example.com"] };
    expect(createHandlerLink(handlerWithoutAndroid, pointer, "android", false)).toBeUndefined();
  });
});
