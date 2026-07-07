// CORD-04 Control-Plane edition builders.
//
// An edition is a kind 3308 rumor carrying the edition machinery in tags. It
// rides a PLAINTEXT seal (kind 20014) so a Refounding can re-wrap the signed
// edition into a new epoch with its signature intact.

import { editionHash } from "./crypto.js";
import { fromHex, utf8 } from "../bytes.js";
import type { RumorTemplate } from "../types.js";
import { KIND } from "../types.js";

export interface EditionInput {
  vsk: number;
  eid: string; // 32-byte hex
  version: number;
  prevHash?: string; // previous edition_hash hex (omitted on first edition)
  content: string; // entity state as JSON string
  vac?: [string, string, string]; // grant eid, version, edition hash — omitted for owner
}

export function buildEdition(input: EditionInput): RumorTemplate {
  const tags: string[][] = [
    ["vsk", String(input.vsk)],
    ["eid", input.eid],
    ["ev", String(input.version)],
  ];
  if (input.prevHash) tags.push(["ep", input.prevHash]);
  if (input.vac) tags.push(["vac", ...input.vac]);
  return { kind: KIND.CONTROL, content: input.content, tags };
}

/** Compute an edition's hash — what the next edition's `ep` will cite. */
export function computeEditionHash(input: Omit<EditionInput, "vac">): string {
  return editionHash(
    fromHex(input.eid),
    input.version,
    input.prevHash ? fromHex(input.prevHash) : undefined,
    utf8(input.content),
  );
}

/** The chainless dissolution tombstone rumor (vsk 10), published at dissolved_pk. */
export function dissolutionRumor(): RumorTemplate {
  return {
    kind: KIND.CONTROL,
    content: "",
    tags: [["vsk", "10"], ["eid", "00".repeat(32)]],
  };
}
