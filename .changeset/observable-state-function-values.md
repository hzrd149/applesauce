---
"applesauce-react": patch
---

Fix `useObservableState` calling function values such as timeline loaders as React state updaters instead of returning them unchanged.
