// CORD-06 Rekey rumor operations: one chunk of per-recipient rekey blobs.
// Composed into kind 3303 rumor templates by buildRekeyRumors in ../helpers/rekey.js.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations";
import { addNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RekeyBlob, RekeyRotation } from "../helpers/rekey.js";
import { rekeyScopeId } from "../helpers/rekey.js";

/** Guard the 1-based `chunk` index contract (CORD-06 §1). */
function assertChunkIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count)
    throw new RangeError(`chunk index must be 1-based within 1..${count} (got ${index})`);
}

/** Fill one chunk of a rotation: its blobs + the rotation-machinery tags. */
export function includeRekeyChunk(
  rotation: RekeyRotation,
  blobs: RekeyBlob[],
  index: number,
  count: number,
  ms: number = Date.now(),
): EventOperation {
  assertChunkIndex(index, count);
  const scopeHex = bytesToHex(rekeyScopeId(rotation.scope));
  const tags = modifyPublicTags(
    setSingletonTag(["scope", scopeHex]),
    setSingletonTag(["newepoch", rotation.newEpoch.toString()]),
    setSingletonTag(["prevepoch", rotation.prevEpoch.toString()]),
    setSingletonTag(["prevcommit", rotation.prevCommit]),
    addNameValueTag(["chunk", String(index), String(count)], false),
    setSingletonTag(["ms", String(ms % 1000)]),
    // A non-owner rotation cites the Grant it acts under (CORD-04 `vac`, D-08),
    // mirroring includeKickTarget/vacFor; the owner omits it entirely.
    rotation.vac ? addNameValueTag(["vac", ...rotation.vac], false) : undefined,
  );
  return async (draft) => ({ ...(await tags(draft)), content: JSON.stringify(blobs) });
}
