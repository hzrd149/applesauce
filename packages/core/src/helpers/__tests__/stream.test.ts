const TEST_EVENTS: Record<string, NostrEvent> = {
  radio: {
    content: "",
    created_at: unixNow() - 60 * 20, // 20 minutes ago
    id: "a5183a031ddd91b5fcd8b8cabd42b4bcae8357a9f5ce7b428d65b529db4d5ef6",
    kind: 30311,
    pubkey: "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5",
    sig: "6f2d0009419527a3ad26c6149eb525ed75ec63651731d7ece3cf9d10a9222d6e5e642f87667752c0011e15e21d843503a4d39ab42c7545af567b27cfa1504169",
    tags: [
      ["d", "ce8c44dd-7a4b-4c03-a7a9-a0498aab81ae"],
      ["title", "You are the DJ!"],
      [
        "summary",
        "Here on Noderunners Radio, you decide what music should be listened too!\nJust use our web-interface, here: https://jukebox.lighting/jukebox/web/-1001672416970\nOr join t.me/noderunnersradio and find the JukeboxBot in the chat there. \n",
      ],
      [
        "image",
        "https://s3.us-west-002.backblazeb2.com/zap-stream/ce8c44dd-7a4b-4c03-a7a9-a0498aab81ae/thumb.jpg?X-Amz-Expires=600000&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=002f50d8a7a69be0000000006/20250729/us-west-002/s3/aws4_request&X-Amz-Date=20250729T125018Z&X-Amz-SignedHeaders=host&X-Amz-Signature=9722f7e82f132f7a660be796c7058df7c4ba33edc6d0be6a4cfd3942e8939797",
      ],
      ["status", "live"],
      ["p", "e774934cb65e2b29e3b34f8b2132df4492bc346ba656cc8dc2121ff407688de0", "wss://relay.zap.stream", "host"],
      [
        "relays",
        "wss://relay.snort.social",
        "wss://nos.lol",
        "wss://relay.damus.io",
        "wss://relay.nostr.band",
        "wss://nostr.land",
        "wss://nostr-pub.wellorder.net",
        "wss://nostr.wine",
        "wss://relay.nostr.bg",
        "wss://nostr.oxtr.dev",
        "wss://relay.fountain.fm",
      ],
      ["starts", String(unixNow() - 60 * 25)], // 25 minutes ago
      ["service", "https://api.zap.stream/api/nostr"],
      ["streaming", "https://data.zap.stream/stream/ce8c44dd-7a4b-4c03-a7a9-a0498aab81ae.m3u8"],
      ["current_participants", "0"],
      ["t", "Play"],
      ["t", "Music"],
      ["t", "DJ"],
    ],
  },
  simple: {
    content: "",
    created_at: unixNow() - 60 * 20, // 20 minutes ago
    id: "ecff7f978bf7a4f3411a0ab4065e9f4857827cbb3df5f42e7a74cb51ccf27814",
    kind: 30311,
    pubkey: "88cc134b1a65f54ef48acc1df3665063d3ea45f04eab8af4646e561c5ae99079",
    sig: "30b46df812d37cfc21ae42eeafcf13695f78edcdbd1e7df40192ce83644182ccca84be6d36321ed9c82ed0012fdc000bd9476ea84766239fc90938979028abac",
    tags: [
      ["d", "1752870546"],
      ["image", ""],
      ["starts", String(unixNow() - 60 * 25)], // 25 minutes ago
      ["status", "live"],
      [
        "streaming",
        "https://euc12.playlist.ttvnw.net/v1/playlist/CtAEeR_P-sD0dfNJfHz_xuJ9ppAe8F8IDMgfTsKtE8Hp62yCtapqxTb4KBqluUgUTlyCi7GhIBi1JRPORvkBMDApn_WzevfirdFkHZxU95PepevolAPN8m9aAPMRLxIpZTSnjhHOs0cGxASjk6uTmBNmgvmKVPyDlxih0zc8UXPsi356gcf7o8VBe1kKQ1rerMLNYqfQbe1FY8GRhQV9WPsD15lrGAovA_uiA7qRYBM_2nfXrx0ClfBajPBHuRsiXfDZmVvaphtbUM5DGx_vIg95G95MRUsHv9eqwUQCew5Q8qx3OmK5XB7SHymoKLuhMykdC7iIkck7ycCCy0mlPWgmkzYrtNFFoJCIAFd2okmrY05SRRyBFbcbgxbmZR5eojvpUWV3QnRMTmMFUvu5XFM5kHeN48FfW7LsplqJBdupwAvTprIAuDYwIGth1yQz_HbINMAqcRW_Dr48NzuEwhRrGYusQornzdZseIJUSKLk-TrFVurzrhkkBea_QWu3NCIC5RLivR9wNL3S1DKLXlNCCOkSRmrV5Ot_dP4zHZMtDm_Ns_x0Mu_zIEYSsBcFNgD-nrFfHgMkVtSIEe7Ifty_lhJp26ScW4imOB2nya_uZ9TvMKug1itPMMaynZ2AFToEvayJu5mF6gWeavsmmSiR99dUQh6KK9Fya_jqyb2dlscN-if6gmyfjVWGo4D9BAE4PvGZeCZ8X6M9mH3PCsC-3mXlM7173qr4UrHDtNqiSbLpDqN2dPzItRujAIwHgiwnWP4EH6K8Ocg33BVRPhPyRBoMyOvvQnDZWDGUc7nRIAEqCWV1LXdlc3QtMjDvDA.m3u8",
      ],
      ["summary", "fresh testing"],
      ["title", "fresh test!"],
      ["client", "stream-refresher", "v0.0.1"],
    ],
  },
  ended: {
    content: "",
    created_at: 1751376408,
    id: "f6f37f8d124df2f4162655ef8fb6dfa95d5820d59e1e9f4acca3a67dde5dbc6f",
    kind: 30311,
    pubkey: "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5",
    sig: "4ba10e5bda2ebf460b1d9293e768606a91031d091d55eb4ac6858a9be9318d34db753e8cfc2acf27d6d9126cccafddb8d141d024d5ca658ff2b6a390c0aa3f3f",
    tags: [
      ["d", "6016b12d-ebaf-4af4-b301-afe3da023851"],
      ["title", "NIP-17 Messages in noStrudel"],
      ["summary", ""],
      [
        "image",
        "https://s3.us-west-002.backblazeb2.com/zap-stream/6016b12d-ebaf-4af4-b301-afe3da023851/thumb.jpg?X-Amz-Expires=600000&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=002f50d8a7a69be0000000006/20250609/us-west-002/s3/aws4_request&X-Amz-Date=20250609T160158Z&X-Amz-SignedHeaders=host&X-Amz-Signature=63e1815806e2bf3dfe2323817816c62091a21be89a2f3fd97bcd14d4391b6f8e",
      ],
      ["status", "ended"],
      ["p", "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5", "wss://relay.zap.stream", "host"],
      [
        "relays",
        "wss://relay.snort.social",
        "wss://nos.lol",
        "wss://relay.damus.io",
        "wss://relay.nostr.band",
        "wss://nostr.land",
        "wss://nostr-pub.wellorder.net",
        "wss://nostr.wine",
        "wss://relay.nostr.bg",
        "wss://nostr.oxtr.dev",
        "wss://relay.fountain.fm",
      ],
      ["starts", "1749478022"],
      ["service", "https://api.zap.stream/api/nostr"],
      ["ends", "1751376408"],
      ["t", "nostr"],
      ["t", "development"],
      ["t", "noStrudel"],
    ],
  },
};

import { describe, expect, it } from "vitest";
import {
  getStreamTitle,
  getStreamSummary,
  getStreamImage,
  getStreamStatus,
  getStreamHost,
  getStreamGoalPointer,
  getStreamStreamingURLs,
  getStreamRecording,
  getStreamRelays,
  getStreamStartTime,
  getStreamEndTime,
  getStreamViewers,
  getStreamMaxViewers,
  getStreamHashtags,
} from "../stream.js";
import { NostrEvent } from "nostr-tools";
import { unixNow } from "../time";

describe("getStreamTitle", () => {
  it("should return the title from title tag", () => {
    expect(getStreamTitle(TEST_EVENTS.radio)).toBe("You are the DJ!");
    expect(getStreamTitle(TEST_EVENTS.simple)).toBe("fresh test!");
    expect(getStreamTitle(TEST_EVENTS.ended)).toBe("NIP-17 Messages in noStrudel");
  });

  it("should return undefined when no title tag exists", () => {
    const eventWithoutTitle = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamTitle(eventWithoutTitle)).toBeUndefined();
  });
});

describe("getStreamSummary", () => {
  it("should return the summary from summary tag", () => {
    expect(getStreamSummary(TEST_EVENTS.radio)).toBe(
      "Here on Noderunners Radio, you decide what music should be listened too!\nJust use our web-interface, here: https://jukebox.lighting/jukebox/web/-1001672416970\nOr join t.me/noderunnersradio and find the JukeboxBot in the chat there. \n",
    );
    expect(getStreamSummary(TEST_EVENTS.simple)).toBe("fresh testing");
  });

  it("should return empty string when summary tag is empty", () => {
    expect(getStreamSummary(TEST_EVENTS.ended)).toBe("");
  });

  it("should return undefined when no summary tag exists", () => {
    const eventWithoutSummary = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamSummary(eventWithoutSummary)).toBeUndefined();
  });
});

describe("getStreamImage", () => {
  it("should return the image URL from image tag", () => {
    expect(getStreamImage(TEST_EVENTS.radio)).toBe(
      "https://s3.us-west-002.backblazeb2.com/zap-stream/ce8c44dd-7a4b-4c03-a7a9-a0498aab81ae/thumb.jpg?X-Amz-Expires=600000&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=002f50d8a7a69be0000000006/20250729/us-west-002/s3/aws4_request&X-Amz-Date=20250729T125018Z&X-Amz-SignedHeaders=host&X-Amz-Signature=9722f7e82f132f7a660be796c7058df7c4ba33edc6d0be6a4cfd3942e8939797",
    );
    expect(getStreamImage(TEST_EVENTS.ended)).toBe(
      "https://s3.us-west-002.backblazeb2.com/zap-stream/6016b12d-ebaf-4af4-b301-afe3da023851/thumb.jpg?X-Amz-Expires=600000&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=002f50d8a7a69be0000000006/20250609/us-west-002/s3/aws4_request&X-Amz-Date=20250609T160158Z&X-Amz-SignedHeaders=host&X-Amz-Signature=63e1815806e2bf3dfe2323817816c62091a21be89a2f3fd97bcd14d4391b6f8e",
    );
  });

  it("should return empty string when image tag is empty", () => {
    expect(getStreamImage(TEST_EVENTS.simple)).toBe("");
  });

  it("should return undefined when no image tag exists", () => {
    const eventWithoutImage = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamImage(eventWithoutImage)).toBeUndefined();
  });
});

describe("getStreamStatus", () => {
  it("should return the status from status tag", () => {
    expect(getStreamStatus(TEST_EVENTS.radio)).toBe("live");
    expect(getStreamStatus(TEST_EVENTS.simple)).toBe("live");
    expect(getStreamStatus(TEST_EVENTS.ended)).toBe("ended");
  });

  it("should return 'ended' when no status tag exists", () => {
    const eventWithoutStatus = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamStatus(eventWithoutStatus)).toBe("ended");
  });

  it("should return 'ended' for events older than 2 weeks", () => {
    const oldEvent = {
      ...TEST_EVENTS.radio,
      created_at: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 15, // 15 days ago
    };
    expect(getStreamStatus(oldEvent)).toBe("ended");
  });
});

describe("getStreamHost", () => {
  it("should return host from p tag with host role", () => {
    const host = getStreamHost(TEST_EVENTS.radio);
    expect(host.pubkey).toBe("e774934cb65e2b29e3b34f8b2132df4492bc346ba656cc8dc2121ff407688de0");
    expect(host.relays).toEqual(["wss://relay.zap.stream/"]);
  });

  it("should prioritize p tag with 'host' role over other p tags", () => {
    const eventWithMultipleP = {
      ...TEST_EVENTS.radio,
      tags: [
        ["p", "84410a211dd32c56aef8a8a69bdd864babf02baca5bd5b70b89df6d6a4a45053", "wss://relay1.com"],
        ["p", "e774934cb65e2b29e3b34f8b2132df4492bc346ba656cc8dc2121ff407688de0", "wss://relay2.com", "host"],
        ["p", "99e96bcdd47322d3760457b187f6c28634ce3d99ee1b6d514e112ab77e02afb9", "wss://relay3.com"],
      ],
    };
    const host = getStreamHost(eventWithMultipleP);
    expect(host.pubkey).toBe("e774934cb65e2b29e3b34f8b2132df4492bc346ba656cc8dc2121ff407688de0");
  });

  it("should fallback to event pubkey when no p tags exist", () => {
    const eventWithoutP = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    const host = getStreamHost(eventWithoutP);
    expect(host.pubkey).toBe(TEST_EVENTS.radio.pubkey);
    expect(host.relays).toBeUndefined();
  });

  it("should return first p tag when no host role specified", () => {
    const eventWithPNoRole = {
      ...TEST_EVENTS.radio,
      tags: [["p", "84410a211dd32c56aef8a8a69bdd864babf02baca5bd5b70b89df6d6a4a45053", "wss://relay1.com"]],
    };
    const host = getStreamHost(eventWithPNoRole);
    expect(host.pubkey).toBe("84410a211dd32c56aef8a8a69bdd864babf02baca5bd5b70b89df6d6a4a45053");
  });
});

describe("getStreamGoalPointer", () => {
  it("should return undefined when no goal tag exists", () => {
    expect(getStreamGoalPointer(TEST_EVENTS.radio)).toBeUndefined();
    expect(getStreamGoalPointer(TEST_EVENTS.simple)).toBeUndefined();
    expect(getStreamGoalPointer(TEST_EVENTS.ended)).toBeUndefined();
  });

  it("should return goal pointer when goal tag exists", () => {
    const eventWithGoal = {
      ...TEST_EVENTS.radio,
      tags: [
        ...TEST_EVENTS.radio.tags,
        ["goal", "5994ef682f5b0797c8670ffe3a3c3549a8cf81eac185dda220e66530ccc254b1", "wss://relay.example.com/"],
      ],
    };
    const goalPointer = getStreamGoalPointer(eventWithGoal);
    expect(goalPointer?.id).toBe("5994ef682f5b0797c8670ffe3a3c3549a8cf81eac185dda220e66530ccc254b1");
    expect(goalPointer?.relays).toContain("wss://relay.example.com/");
  });
});

describe("getStreamStreamingURLs", () => {
  it("should return all streaming URLs", () => {
    const radioURLs = getStreamStreamingURLs(TEST_EVENTS.radio);
    expect(radioURLs).toEqual(["https://data.zap.stream/stream/ce8c44dd-7a4b-4c03-a7a9-a0498aab81ae.m3u8"]);

    const simpleURLs = getStreamStreamingURLs(TEST_EVENTS.simple);
    expect(simpleURLs).toEqual([
      "https://euc12.playlist.ttvnw.net/v1/playlist/CtAEeR_P-sD0dfNJfHz_xuJ9ppAe8F8IDMgfTsKtE8Hp62yCtapqxTb4KBqluUgUTlyCi7GhIBi1JRPORvkBMDApn_WzevfirdFkHZxU95PepevolAPN8m9aAPMRLxIpZTSnjhHOs0cGxASjk6uTmBNmgvmKVPyDlxih0zc8UXPsi356gcf7o8VBe1kKQ1rerMLNYqfQbe1FY8GRhQV9WPsD15lrGAovA_uiA7qRYBM_2nfXrx0ClfBajPBHuRsiXfDZmVvaphtbUM5DGx_vIg95G95MRUsHv9eqwUQCew5Q8qx3OmK5XB7SHymoKLuhMykdC7iIkck7ycCCy0mlPWgmkzYrtNFFoJCIAFd2okmrY05SRRyBFbcbgxbmZR5eojvpUWV3QnRMTmMFUvu5XFM5kHeN48FfW7LsplqJBdupwAvTprIAuDYwIGth1yQz_HbINMAqcRW_Dr48NzuEwhRrGYusQornzdZseIJUSKLk-TrFVurzrhkkBea_QWu3NCIC5RLivR9wNL3S1DKLXlNCCOkSRmrV5Ot_dP4zHZMtDm_Ns_x0Mu_zIEYSsBcFNgD-nrFfHgMkVtSIEe7Ifty_lhJp26ScW4imOB2nya_uZ9TvMKug1itPMMaynZ2AFToEvayJu5mF6gWeavsmmSiR99dUQh6KK9Fya_jqyb2dlscN-if6gmyfjVWGo4D9BAE4PvGZeCZ8X6M9mH3PCsC-3mXlM7173qr4UrHDtNqiSbLpDqN2dPzItRujAIwHgiwnWP4EH6K8Ocg33BVRPhPyRBoMyOvvQnDZWDGUc7nRIAEqCWV1LXdlc3QtMjDvDA.m3u8",
    ]);
  });

  it("should return empty array when no streaming tags exist", () => {
    const eventWithoutStreaming = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamStreamingURLs(eventWithoutStreaming)).toEqual([]);
  });

  it("should handle multiple streaming URLs", () => {
    const eventWithMultipleStreaming = {
      ...TEST_EVENTS.radio,
      tags: [
        ["streaming", "https://stream1.example.com"],
        ["streaming", "https://stream2.example.com"],
        ["streaming", "https://stream3.example.com"],
      ],
    };
    const urls = getStreamStreamingURLs(eventWithMultipleStreaming);
    expect(urls).toEqual(["https://stream1.example.com", "https://stream2.example.com", "https://stream3.example.com"]);
  });
});

describe("getStreamRecording", () => {
  it("should return undefined when no recording tag exists", () => {
    expect(getStreamRecording(TEST_EVENTS.radio)).toBeUndefined();
    expect(getStreamRecording(TEST_EVENTS.simple)).toBeUndefined();
    expect(getStreamRecording(TEST_EVENTS.ended)).toBeUndefined();
  });

  it("should return recording URL when recording tag exists", () => {
    const eventWithRecording = {
      ...TEST_EVENTS.radio,
      tags: [...TEST_EVENTS.radio.tags, ["recording", "https://example.com/recording.mp4"]],
    };
    expect(getStreamRecording(eventWithRecording)).toBe("https://example.com/recording.mp4");
  });
});

describe("getStreamRelays", () => {
  it("should return relays from relays tag", () => {
    const radioRelays = getStreamRelays(TEST_EVENTS.radio);
    expect(radioRelays).toEqual([
      "wss://relay.snort.social/",
      "wss://nos.lol/",
      "wss://relay.damus.io/",
      "wss://relay.nostr.band/",
      "wss://nostr.land/",
      "wss://nostr-pub.wellorder.net/",
      "wss://nostr.wine/",
      "wss://relay.nostr.bg/",
      "wss://nostr.oxtr.dev/",
      "wss://relay.fountain.fm/",
    ]);

    const endedRelays = getStreamRelays(TEST_EVENTS.ended);
    expect(endedRelays).toEqual([
      "wss://relay.snort.social/",
      "wss://nos.lol/",
      "wss://relay.damus.io/",
      "wss://relay.nostr.band/",
      "wss://nostr.land/",
      "wss://nostr-pub.wellorder.net/",
      "wss://nostr.wine/",
      "wss://relay.nostr.bg/",
      "wss://nostr.oxtr.dev/",
      "wss://relay.fountain.fm/",
    ]);
  });

  it("should return undefined when no relays tag exists", () => {
    expect(getStreamRelays(TEST_EVENTS.simple)).toBeUndefined();
  });
});

describe("getStreamStartTime", () => {
  it("should return start time as number from starts tag", () => {
    expect(getStreamStartTime(TEST_EVENTS.radio)).toBe(
      parseInt(TEST_EVENTS.radio.tags.find((t) => t[0] === "starts")?.[1] ?? "0"),
    );
    expect(getStreamStartTime(TEST_EVENTS.simple)).toBe(
      parseInt(TEST_EVENTS.simple.tags.find((t) => t[0] === "starts")?.[1] ?? "0"),
    );
    expect(getStreamStartTime(TEST_EVENTS.ended)).toBe(
      parseInt(TEST_EVENTS.ended.tags.find((t) => t[0] === "starts")?.[1] ?? "0"),
    );
  });

  it("should return undefined when no starts tag exists", () => {
    const eventWithoutStarts = { ...TEST_EVENTS.radio, tags: [["d", "test"]] };
    expect(getStreamStartTime(eventWithoutStarts)).toBeUndefined();
  });

  it("should handle invalid start time strings", () => {
    const eventWithInvalidStarts = {
      ...TEST_EVENTS.radio,
      tags: [["starts", "invalid-number"]],
    };
    expect(getStreamStartTime(eventWithInvalidStarts)).toBeNaN();
  });
});

describe("getStreamEndTime", () => {
  it("should return end time from ends tag", () => {
    expect(getStreamEndTime(TEST_EVENTS.ended)).toBe(1751376408);
  });

  it("should return created_at for ended streams without ends tag", () => {
    const endedStreamWithoutEnds = {
      ...TEST_EVENTS.radio,
      tags: [...TEST_EVENTS.radio.tags.filter((t) => t[0] !== "status"), ["status", "ended"]],
    };
    expect(getStreamEndTime(endedStreamWithoutEnds)).toBe(TEST_EVENTS.radio.created_at);
  });

  it("should return undefined for live streams without ends tag", () => {
    expect(getStreamEndTime(TEST_EVENTS.radio)).toBeUndefined();
    expect(getStreamEndTime(TEST_EVENTS.simple)).toBeUndefined();
  });

  it("should handle invalid end time strings", () => {
    const eventWithInvalidEnds = {
      ...TEST_EVENTS.ended,
      tags: [...TEST_EVENTS.ended.tags.filter((t) => t[0] !== "ends"), ["ends", "invalid-number"]],
    };
    expect(getStreamEndTime(eventWithInvalidEnds)).toBeNaN();
  });
});

describe("getStreamViewers", () => {
  it("should return current participants as number", () => {
    expect(getStreamViewers(TEST_EVENTS.radio)).toBe(0);
  });

  it("should return undefined when no current_participants tag exists", () => {
    expect(getStreamViewers(TEST_EVENTS.simple)).toBeUndefined();
    expect(getStreamViewers(TEST_EVENTS.ended)).toBeUndefined();
  });

  it("should handle invalid participant count strings", () => {
    const eventWithInvalidViewers = {
      ...TEST_EVENTS.radio,
      tags: [
        ...TEST_EVENTS.radio.tags.filter((t) => t[0] !== "current_participants"),
        ["current_participants", "invalid-number"],
      ],
    };
    expect(getStreamViewers(eventWithInvalidViewers)).toBeNaN();
  });
});

describe("getStreamMaxViewers", () => {
  it("should return undefined when no total_participants tag exists", () => {
    expect(getStreamMaxViewers(TEST_EVENTS.radio)).toBeUndefined();
    expect(getStreamMaxViewers(TEST_EVENTS.simple)).toBeUndefined();
    expect(getStreamMaxViewers(TEST_EVENTS.ended)).toBeUndefined();
  });

  it("should return max participants as number when tag exists", () => {
    const eventWithMaxViewers = {
      ...TEST_EVENTS.radio,
      tags: [...TEST_EVENTS.radio.tags, ["total_participants", "42"]],
    };
    expect(getStreamMaxViewers(eventWithMaxViewers)).toBe(42);
  });

  it("should handle invalid max participant count strings", () => {
    const eventWithInvalidMaxViewers = {
      ...TEST_EVENTS.radio,
      tags: [...TEST_EVENTS.radio.tags, ["total_participants", "invalid-number"]],
    };
    expect(getStreamMaxViewers(eventWithInvalidMaxViewers)).toBeNaN();
  });
});

describe("getStreamHashtags", () => {
  it("should return all hashtags from t tags", () => {
    const radioHashtags = getStreamHashtags(TEST_EVENTS.radio);
    expect(radioHashtags).toEqual(["Play", "Music", "DJ"]);

    const endedHashtags = getStreamHashtags(TEST_EVENTS.ended);
    expect(endedHashtags).toEqual(["nostr", "development", "noStrudel"]);
  });

  it("should return empty array when no t tags exist", () => {
    expect(getStreamHashtags(TEST_EVENTS.simple)).toEqual([]);
  });

  it("should handle multiple hashtag tags", () => {
    const eventWithManyHashtags = {
      ...TEST_EVENTS.radio,
      tags: [
        ["t", "music"],
        ["t", "streaming"],
        ["t", "live"],
        ["t", "radio"],
        ["t", "nostr"],
      ],
    };
    const hashtags = getStreamHashtags(eventWithManyHashtags);
    expect(hashtags).toEqual(["music", "streaming", "live", "radio", "nostr"]);
  });
});
