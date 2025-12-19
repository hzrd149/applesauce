import { describe, expect, it } from "vitest";
import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { addBlossomServer, removeBlossomServer } from "../blossom.js";
import { BLOSSOM_SERVER_LIST_KIND } from "../../helpers/blossom.js";

describe("addBlossomServer", () => {
  it("should add a server tag to an empty event", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom.example.com")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["server", "https://blossom.example.com/"]],
      }),
    );
  });

  it("should normalize the URL", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom.example.com/path?query=1")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["server", "https://blossom.example.com/path?query=1"]],
      }),
    );
  });

  it("should handle URL objects", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [],
      created_at: unixNow(),
    };

    const result = await addBlossomServer(new URL("https://blossom.example.com"))(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["server", "https://blossom.example.com/"]],
      }),
    );
  });

  it("should replace existing server with same hostname by default", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/"]],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom.example.com/new-path")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["server", "https://blossom.example.com/new-path"]],
      }),
    );
  });

  it("should not replace existing server when replace is false", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/"]],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom.example.com/new-path", false)(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [
          ["server", "https://blossom.example.com/"],
          ["server", "https://blossom.example.com/new-path"],
        ],
      }),
    );
  });

  it("should add multiple different servers", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom1.example.com/"]],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom2.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [
          ["server", "https://blossom1.example.com/"],
          ["server", "https://blossom2.example.com/"],
        ],
      }),
    );
  });

  it("should preserve other tags", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["d", "my-list"]],
      created_at: unixNow(),
    };

    const result = await addBlossomServer("https://blossom.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [
          ["d", "my-list"],
          ["server", "https://blossom.example.com/"],
        ],
      }),
    );
  });
});

describe("removeBlossomServer", () => {
  it("should remove a server by URL", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/"]],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://blossom.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [],
      }),
    );
  });

  it("should remove a server matching by hostname", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/path"]],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://blossom.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [],
      }),
    );
  });

  it("should handle URL objects", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/"]],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer(new URL("https://blossom.example.com"))(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [],
      }),
    );
  });

  it("should only remove the matching server", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [
        ["server", "https://blossom1.example.com/"],
        ["server", "https://blossom2.example.com/"],
        ["server", "https://blossom3.example.com/"],
      ],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://blossom2.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [
          ["server", "https://blossom1.example.com/"],
          ["server", "https://blossom3.example.com/"],
        ],
      }),
    );
  });

  it("should not affect event when server is not present", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [["server", "https://blossom.example.com/"]],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://other.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["server", "https://blossom.example.com/"]],
      }),
    );
  });

  it("should preserve other tags", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [
        ["d", "my-list"],
        ["server", "https://blossom.example.com/"],
      ],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://blossom.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [["d", "my-list"]],
      }),
    );
  });

  it("should handle empty tags array", async () => {
    const event: EventTemplate = {
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: "",
      tags: [],
      created_at: unixNow(),
    };

    const result = await removeBlossomServer("https://blossom.example.com/")(event, {});

    expect(result).toEqual(
      expect.objectContaining({
        tags: [],
      }),
    );
  });
});
