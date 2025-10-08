import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AmberClipboardSigner",
        "ExtensionMissingError",
        "ExtensionSigner",
        "Helpers",
        "NostrConnectProvider",
        "NostrConnectSigner",
        "PasswordSigner",
        "PrivateKeySigner",
        "ReadonlySigner",
        "SerialPortSigner",
        "SimpleSigner",
        "getConnectionMethods",
      ]
    `);
  });
});
