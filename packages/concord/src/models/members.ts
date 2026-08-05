import type { Model } from "applesauce-core/event-store";
import type { Rumor } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { foldMembers, JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND } from "../helpers/guestbook.js";
import { resolveStanding, vacVerifier } from "../helpers/permissions.js";
import { PERM } from "../types.js";
import type { CommunityState, JoinMaterial, Role } from "../types.js";
import { decodedFromRumor } from "./utils.js";

/** Fold a Guestbook Plane RumorStore into the current complete member set. */
export function ConcordMembersModel(
  material: JoinMaterial,
  control: CommunityState,
  observed: Map<string, number> = new Map(),
  nowMs: number = Date.now(),
): Model<Set<string>, Rumor> {
  return (store) =>
    store.timeline([{ kinds: [JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND] }]).pipe(
      map((rumors) => {
        const roles = new Map<string, Role>(control.roles.map((role) => [role.role_id, role]));
        const standing = (member: string) => resolveStanding(member, material.owner, roles, control.grants);
        return foldMembers(
          rumors.map((rumor) => decodedFromRumor(rumor)),
          observed,
          control.banlist,
          standing,
          nowMs,
          material.refounder,
          vacVerifier(control, PERM.KICK),
        );
      }),
    );
}
