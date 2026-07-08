import { setHiddenContentEncryptionMethod } from "applesauce-core/helpers";
import { COMMUNITY_LIST_KIND } from "./community-list.js";
import { INVITE_LIST_KIND } from "./invite-list.js";

// Both lists are replaceable documents a user encrypts to themselves (CORD-02 §8,
// CORD-05 §4), so they register as *hidden* content — the self-encryption family —
// not general encrypted-to-a-pubkey content.
setHiddenContentEncryptionMethod(COMMUNITY_LIST_KIND, "nip44");
setHiddenContentEncryptionMethod(INVITE_LIST_KIND, "nip44");
