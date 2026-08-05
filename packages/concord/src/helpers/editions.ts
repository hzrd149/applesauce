// CORD-04 Control-Plane edition hashing.
//
// An edition is a kind 3308 rumor carrying the edition machinery in tags (built
// by ../operations/control.js + ../factories/control.js). It rides a PLAINTEXT
// seal (kind 20014) so a Refounding can re-wrap the signed edition into a new
// epoch with its signature intact.

import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { editionHash } from "./crypto.js";

export interface EditionInput {
  vsk: number;
  eid: string; // 32-byte hex
  version: number;
  prevHash?: string; // previous edition_hash hex (omitted on first edition)
  content: string; // entity state as JSON string
  vac?: [string, string, string]; // grant eid, version, edition hash — omitted for owner
}

/** Compute an edition's hash — what the next edition's `ep` will cite. */
export function computeEditionHash(input: Omit<EditionInput, "vac">): string {
  return editionHash(
    hexToBytes(input.eid),
    input.version,
    input.prevHash ? hexToBytes(input.prevHash) : undefined,
    utf8ToBytes(input.content),
  );
}
