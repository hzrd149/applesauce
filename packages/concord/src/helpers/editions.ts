// CORD-04 Control-Plane edition hashing.
//
// An edition is a kind 3308 rumor carrying the edition machinery in tags (built
// by ../operations/control.js + ../factories/control.js). It rides a PLAINTEXT
// seal (kind 20014) so a Refounding can re-wrap the signed edition into a new
// epoch with its signature intact.

import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { isHexKey } from "applesauce-core/helpers/string";
import { editionHash } from "./crypto.js";
import type { DecodedEvent } from "../types.js";

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

export type EditionPin = [eid: string, version: string, hash: string];

export type EditionPinResult =
  | { kind: "matched"; edition: DecodedEvent }
  | { kind: "missing"; eid: string; version: number }
  | { kind: "mismatch"; eid: string; version: number }
  | { kind: "malformed" };

/** Resolve an exact CORD-04 `(coordinate, version, edition_hash)` citation. */
export function resolveEditionPin(editions: Iterable<DecodedEvent>, pin: EditionPin): EditionPinResult {
  const [eid, versionText, expectedHash] = pin;
  if (!isHexKey(eid) || !/^\d+$/.test(versionText) || !isHexKey(expectedHash)) return { kind: "malformed" };
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version < 1) return { kind: "malformed" };

  let foundVersion = false;
  for (const edition of editions) {
    const tag = (name: string) => edition.rumor.tags.find((t) => t[0] === name)?.[1];
    if (edition.rumor.kind !== 3308 || tag("eid")?.toLowerCase() !== eid.toLowerCase()) continue;
    const candidateVersionText = tag("ev") ?? "1";
    if (!/^\d+$/.test(candidateVersionText) || Number(candidateVersionText) !== version) continue;
    foundVersion = true;
    const prevHash = tag("ep");
    if (prevHash !== undefined && !isHexKey(prevHash)) continue;
    const actualHash = computeEditionHash({
      vsk: Number(tag("vsk") ?? 0),
      eid,
      version,
      prevHash,
      content: edition.rumor.content,
    });
    if (actualHash === expectedHash.toLowerCase()) return { kind: "matched", edition };
  }
  return foundVersion ? { kind: "mismatch", eid, version } : { kind: "missing", eid, version };
}
