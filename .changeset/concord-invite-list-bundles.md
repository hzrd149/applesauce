---
"applesauce-concord": minor
---

Add a `bundles$` observable to the `ConcordInviteList` cast (and a `getInviteBundleLocator` helper) that resolves each invite entry's kind 33301 bundle event from the store, so invite links can be shown alongside their live/revoked bundle state.
