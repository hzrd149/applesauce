import { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getPollEndsAt,
  getPollOptions,
  getPollQuestion,
  getPollRelays,
  getPollResponseOptions,
  getPollResponsePollId,
  getPollType,
  POLL_KIND,
  POLL_RESPONSE_KIND,
} from "../poll.js";

const user1 = new FakeUser();
const user2 = new FakeUser();
const pollAuthor = new FakeUser();

// Create poll event using FakeUser
const mockPoll: NostrEvent = pollAuthor.event({
  kind: POLL_KIND,
  content: "What's your favorite color?",
  tags: [
    ["option", "opt1", "Red"],
    ["option", "opt2", "Blue"],
    ["option", "opt3", "Green"],
    ["relay", "wss://relay1.com"],
    ["relay", "wss://relay2.com"],
    ["polltype", "singlechoice"],
    ["endsAt", String(unixNow() + 3600)], // expires in 1 hour
  ],
});

// Create poll response events using FakeUser
const mockResponse1: NostrEvent = user1.event({
  kind: POLL_RESPONSE_KIND,
  content: "",
  tags: [
    ["e", mockPoll.id],
    ["response", "opt1"],
  ],
});

const mockResponse2: NostrEvent = user2.event({
  kind: POLL_RESPONSE_KIND,
  content: "",
  tags: [
    ["e", mockPoll.id],
    ["response", "opt2"],
  ],
});

const mockResponse3: NostrEvent = user1.event({
  kind: POLL_RESPONSE_KIND,
  content: "",
  created_at: mockResponse1.created_at + 600, // 10 minutes later
  tags: [
    ["e", mockPoll.id],
    ["response", "opt3"], // changed vote
  ],
});

describe("NIP-88 Poll Helpers", () => {
  it("should extract poll question from content", () => {
    expect(getPollQuestion(mockPoll)).toBe("What's your favorite color?");
  });

  it("should extract poll options correctly", () => {
    const options = getPollOptions(mockPoll);
    expect(options).toEqual([
      { id: "opt1", label: "Red" },
      { id: "opt2", label: "Blue" },
      { id: "opt3", label: "Green" },
    ]);
  });

  it("should extract relay URLs from poll", () => {
    const relays = getPollRelays(mockPoll);
    expect(relays).toEqual(["wss://relay1.com", "wss://relay2.com"]);
  });

  it("should extract poll type with default fallback", () => {
    expect(getPollType(mockPoll)).toBe("singlechoice");

    // Test default value when polltype tag is missing
    const pollWithoutType = pollAuthor.event({
      kind: POLL_KIND,
      content: "Test poll",
      tags: [
        ["option", "opt1", "Option 1"],
        ["option", "opt2", "Option 2"],
      ],
    });
    expect(getPollType(pollWithoutType)).toBe("singlechoice");
  });

  it("should extract poll expiration timestamp", () => {
    const endsAt = getPollEndsAt(mockPoll);
    expect(typeof endsAt).toBe("number");
    expect(endsAt).toBeGreaterThan(unixNow());

    // Test poll without expiration
    const pollWithoutExpiration = pollAuthor.event({
      kind: POLL_KIND,
      content: "Test poll",
      tags: [
        ["option", "opt1", "Option 1"],
        ["option", "opt2", "Option 2"],
      ],
    });
    expect(getPollEndsAt(pollWithoutExpiration)).toBeUndefined();
  });

  it("should extract poll ID from response", () => {
    expect(getPollResponsePollId(mockResponse1)).toBe(mockPoll.id);
    expect(getPollResponsePollId(mockResponse2)).toBe(mockPoll.id);
    expect(getPollResponsePollId(mockResponse3)).toBe(mockPoll.id);
  });

  it("should extract selected options from response", () => {
    expect(getPollResponseOptions(mockResponse1)).toEqual(["opt1"]);
    expect(getPollResponseOptions(mockResponse2)).toEqual(["opt2"]);
    expect(getPollResponseOptions(mockResponse3)).toEqual(["opt3"]);

    // Test response with multiple options
    const multipleOptionsResponse = user1.event({
      kind: POLL_RESPONSE_KIND,
      content: "",
      tags: [
        ["e", mockPoll.id],
        ["response", "opt1"],
        ["response", "opt2"],
      ],
    });
    expect(getPollResponseOptions(multipleOptionsResponse)).toEqual(["opt1", "opt2"]);
  });

  it("should handle empty options and relays", () => {
    const minimalPoll = pollAuthor.event({
      kind: POLL_KIND,
      content: "Minimal poll",
      tags: [],
    });

    expect(getPollOptions(minimalPoll)).toEqual([]);
    expect(getPollRelays(minimalPoll)).toEqual([]);
    expect(getPollType(minimalPoll)).toBe("singlechoice");
    expect(getPollEndsAt(minimalPoll)).toBeUndefined();
  });

  it("should handle multiplechoice poll type", () => {
    const multiChoicePoll = pollAuthor.event({
      kind: POLL_KIND,
      content: "Multiple choice poll",
      tags: [
        ["option", "opt1", "Option 1"],
        ["option", "opt2", "Option 2"],
        ["polltype", "multiplechoice"],
      ],
    });

    expect(getPollType(multiChoicePoll)).toBe("multiplechoice");
  });
});
