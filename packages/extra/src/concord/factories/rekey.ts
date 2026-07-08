// CORD-06 Rekey rumor factories: the chunked kind 3303 rekey-blob events for one
// rotation. Sealing/wrapping at the rekey address is done by ../stream.js.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { REKEY_KIND } from "../helpers/rekey.js";
import { REKEY_BLOBS_PER_EVENT } from "../helpers/rekey.js";
import type { RekeyBlob, RekeyRotation } from "../helpers/rekey.js";
import { includeRekeyChunk } from "../operations/rekey.js";

/** A factory for a single chunk of a kind 3303 rekey rotation (CORD-06 §1). */
export class RekeyFactory extends EventFactory<typeof REKEY_KIND> {
  static create(
    rotation: RekeyRotation,
    blobs: RekeyBlob[],
    index: number,
    count: number,
    ms: number = Date.now(),
  ): RekeyFactory {
    return new RekeyFactory((res) => res(blankEventTemplate(REKEY_KIND))).chunk(rotation, blobs, index, count, ms);
  }

  /** Fills one chunk of the rotation: its blobs + the rotation-machinery tags */
  chunk(rotation: RekeyRotation, blobs: RekeyBlob[], index: number, count: number, ms?: number) {
    return this.chain(includeRekeyChunk(rotation, blobs, index, count, ms));
  }
}

/** Build the chunked kind 3303 rekey factories for one rotation (CORD-06 §1). */
export function buildRekeyFactories(
  rotation: RekeyRotation,
  blobs: RekeyBlob[],
  ms: number = Date.now(),
): RekeyFactory[] {
  const chunks: RekeyBlob[][] = [];
  for (let i = 0; i < blobs.length; i += REKEY_BLOBS_PER_EVENT) chunks.push(blobs.slice(i, i + REKEY_BLOBS_PER_EVENT));
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  return chunks.map((chunk, i) => RekeyFactory.create(rotation, chunk, i + 1, n, ms));
}
