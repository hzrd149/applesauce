import type { AsyncRumorStore, RumorStore } from "applesauce-core";

/** A per-plane rumor store — the in-memory {@link RumorStore} or an async-database-backed
 *  {@link AsyncRumorStore}. Mirrors `ConcordRumorStore` in the client without depending on it. */
type PlaneStore = RumorStore | AsyncRumorStore;
import type { Model } from "applesauce-core/event-store";
import type { Rumor } from "applesauce-core/helpers/event";
import { combineLatest, map, Observable } from "rxjs";

import { foldMembers, JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND } from "../helpers/guestbook.js";
import { resolveStanding } from "../helpers/permissions.js";
import type { CommunityState, JoinMaterial, Role } from "../types.js";
import { ConcordControlModel } from "./control.js";
import { ConcordObservedAuthorsModel } from "./observed.js";
import { decodedFromRumor, mergeObserved } from "./utils.js";

export interface ConcordCommunityStores {
  /** The community Guestbook Plane store. */
  guestbook?: PlaneStore;
  /** Additional stores whose authors should count as observably present. */
  observed?: Iterable<PlaneStore>;
}

/** Fold control, guestbook, and observed plane stores into a complete community state. */
export function ConcordCommunityStateModel(
  material: JoinMaterial,
  stores: ConcordCommunityStores = {},
  nowMs: number = Date.now(),
): Model<CommunityState, Rumor> {
  return (controlStore) => {
    const control$ = controlStore.model(ConcordControlModel, material);
    const guestbook$ =
      stores.guestbook?.timeline([{ kinds: [JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND] }]) ??
      new Observable<Rumor[]>((sub) => {
        sub.next([]);
      });
    const observedStores = [controlStore, stores.guestbook, ...(stores.observed ?? [])].filter((s): s is PlaneStore => !!s);
    const observed$ = combineLatest(observedStores.map((store) => store.model(ConcordObservedAuthorsModel))).pipe(
      map(mergeObserved),
    );

    return combineLatest([control$, guestbook$, observed$]).pipe(
      map(([control, guestbook, observed]) => {
        const roles = new Map<string, Role>(control.roles.map((role) => [role.role_id, role]));
        const standing = (member: string) => resolveStanding(member, material.owner, roles, control.grants);
        return {
          ...control,
          members: foldMembers(
            guestbook.map((rumor) => decodedFromRumor(rumor)),
            observed,
            control.banlist,
            standing,
            nowMs,
            material.refounder,
          ),
        };
      }),
    );
  };
}
