// nbunksec encoding/decoding adapted from @sandwichfarm/encoded-entities
// https://github.com/sandwichfarm/encoded-entities (src/encoders/nbunksec.ts)

import { bech32 } from "@scure/base";
import { bytesToHex, hexToBytes } from "applesauce-core/helpers/event";

/** The decoded contents of an nbunksec encoded NIP-46 signer session */
export interface BunkerInfo {
  pubkey: string;
  local_key: string;
  relays: string[];
  secret?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// TLV types used in the nbunksec encoding
const TYPE_PUBKEY = 0;
const TYPE_LOCAL_KEY = 1;
const TYPE_RELAY = 2;
const TYPE_SECRET = 3;

/** Encodes a {@link BunkerInfo} object into an nbunksec string */
export function encodeNbunksec(info: BunkerInfo): string {
  try {
    const parts: Uint8Array[] = [];

    const pubkeyBytes = hexToBytes(info.pubkey);
    parts.push(new Uint8Array([TYPE_PUBKEY, pubkeyBytes.length]), pubkeyBytes);

    const localKeyBytes = hexToBytes(info.local_key);
    parts.push(new Uint8Array([TYPE_LOCAL_KEY, localKeyBytes.length]), localKeyBytes);

    for (const relay of info.relays) {
      const relayBytes = encoder.encode(relay);
      parts.push(new Uint8Array([TYPE_RELAY, relayBytes.length]), relayBytes);
    }

    if (info.secret) {
      const secretBytes = encoder.encode(info.secret);
      parts.push(new Uint8Array([TYPE_SECRET, secretBytes.length]), secretBytes);
    }

    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const data = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }

    return bech32.encode("nbunksec", bech32.toWords(data), false);
  } catch (error) {
    throw new Error(`Failed to encode bunker info: ${error}`);
  }
}

/** Decodes an nbunksec string into a {@link BunkerInfo} object */
export function decodeNbunksec(encoded: string): BunkerInfo {
  try {
    const { prefix, words } = bech32.decode(encoded as `nbunksec1${string}`, false);
    if (prefix !== "nbunksec") throw new Error(`Invalid prefix: ${prefix}`);

    const bytes = bech32.fromWords(words);
    let offset = 0;

    const info: BunkerInfo = { pubkey: "", local_key: "", relays: [] };

    while (offset < bytes.length) {
      const type = bytes[offset];
      const length = bytes[offset + 1];
      offset += 2;
      const value = bytes.slice(offset, offset + length);
      offset += length;

      switch (type) {
        case TYPE_PUBKEY:
          info.pubkey = bytesToHex(value);
          break;
        case TYPE_LOCAL_KEY:
          info.local_key = bytesToHex(value);
          break;
        case TYPE_RELAY:
          info.relays.push(decoder.decode(value));
          break;
        case TYPE_SECRET:
          info.secret = decoder.decode(value);
          break;
        default:
          throw new Error(`Unknown type: ${type}`);
      }
    }

    return info;
  } catch (error) {
    throw new Error(`Failed to decode bunker info: ${error}`);
  }
}
