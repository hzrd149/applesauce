---
"applesauce-loaders": patch
---

Parse relationship tags once per arrival in `createTagValueLoader` instead of rescanning them for each waiting caller.
