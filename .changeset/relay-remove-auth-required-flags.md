---
"applesauce-relay": major
---

Remove the `authRequiredForRead$` and `authRequiredForPublish$` observables and their `RelayStatus` fields, since auth-required refusals are now handled per request and watching `challenge$` is the way to authenticate proactively.
