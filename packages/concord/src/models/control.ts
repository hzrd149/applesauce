import type { Model } from "applesauce-core/event-store";
import type { Rumor } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { CONTROL_KIND, foldControl } from "../helpers/control.js";
import { PLAINTEXT_SEAL_KIND } from "../helpers/gift-wrap.js";
import type { CommunityState, JoinMaterial } from "../types.js";
import { decodedFromRumor } from "./utils.js";

/** Fold a Control Plane RumorStore into Concord community state. */
export function ConcordControlModel(material: JoinMaterial): Model<CommunityState, Rumor> {
  return (store) =>
    store.timeline([{ kinds: [CONTROL_KIND] }]).pipe(
      map((rumors) =>
        foldControl(
          rumors.map((rumor) => decodedFromRumor(rumor, PLAINTEXT_SEAL_KIND)),
          material,
        ),
      ),
    );
}

/** Select the folded banlist from a Control Plane store. */
export function ConcordBanlistModel(material: JoinMaterial): Model<Set<string>, Rumor> {
  return (store) => store.model(ConcordControlModel, material).pipe(map((state) => state.banlist));
}

/** Select the folded channels from a Control Plane store. */
export function ConcordChannelsModel(material: JoinMaterial): Model<CommunityState["channels"], Rumor> {
  return (store) => store.model(ConcordControlModel, material).pipe(map((state) => state.channels));
}

/** Select the folded roles from a Control Plane store. */
export function ConcordRolesModel(material: JoinMaterial): Model<CommunityState["roles"], Rumor> {
  return (store) => store.model(ConcordControlModel, material).pipe(map((state) => state.roles));
}
