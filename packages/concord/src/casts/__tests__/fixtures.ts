import type { JoinMaterial } from "../../types.js";

export function material(id: string): JoinMaterial {
  return {
    community_id: id,
    owner: "owner",
    owner_salt: "salt",
    community_root: "root",
    root_epoch: 1,
    channels: [],
    relays: ["wss://relay.example"],
    name: "Test Community",
  };
}
