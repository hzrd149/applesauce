// CORD-02 §5 Guestbook rumor operations: membership motion (join / leave),
// authorised kicks, and refounder snapshots. Composed into rumor templates by
// ../factories/guestbook.js.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations";
import { addNameValueTag, addProfilePointerTag, setSingletonTag } from "applesauce-core/operations/tag/common";

import type { JoinLeaveVerb } from "../helpers/guestbook.js";

/** Guard the 1-based `snap`/`chunk` index contract (CORD-02 §5, CORD-06 §1). */
function assertChunkIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count)
    throw new RangeError(`chunk index must be 1-based within 1..${count} (got ${index})`);
}

/** Set a join/leave rumor's verb as its content (CORD-02 §5). */
export function setJoinLeave(verb: JoinLeaveVerb): EventOperation {
  return (draft) => ({ ...draft, content: verb });
}

/** Attribute a join to the invite link that produced it (CORD-05). */
export function includeInviteAttribution(creatorNpub: string, label = ""): EventOperation {
  return modifyPublicTags(addNameValueTag(["invite", creatorNpub, label], false));
}

/** Point a kick at its target, optionally carrying the actor's `vac` proof. */
export function includeKickTarget(member: string, vac?: [string, string, string]): EventOperation {
  return modifyPublicTags(
    addProfilePointerTag(member, undefined, false),
    vac ? addNameValueTag(["vac", ...vac], false) : undefined,
  );
}

/**
 * Fill one chunk of a refounder snapshot: present members + the `snap` tag.
 * `time` is a pre-computed `{ created_at, ms }` pair (CORD-02 §4/§5,
 * TIME-02/D-08) — the caller (`buildSnapshotFactories`) reads the clock
 * exactly once for the whole snapshot and threads the same pair to every
 * chunk. This operation stamps `draft.created_at` and the `ms` tag from that
 * pair and never reads `Date.now()` itself, so N chunks of one snapshot can
 * never straddle a second boundary.
 */
export function includeSnapshotChunk(
  members: string[],
  snapshotIdHex: string,
  index: number,
  count: number,
  time: { created_at: number; ms: number },
): EventOperation {
  assertChunkIndex(index, count);
  const tags = modifyPublicTags(
    addNameValueTag(["snap", snapshotIdHex, String(index), String(count)], false),
    setSingletonTag(["ms", String(time.ms)]),
  );
  return async (draft) => ({
    ...(await tags(draft)),
    created_at: time.created_at,
    content: JSON.stringify(members),
  });
}
