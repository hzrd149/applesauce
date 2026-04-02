---
"applesauce-core": patch
"applesauce-common": patch
"applesauce-actions": patch
---

Fix stale symbol caches leaking between EventFactory chain steps; replace removed buildEvent in gift-wrap operations

`EventFactory.chain()` was piping operations via plain Promise `.then()`, which spread all symbol-keyed properties (including cached `HiddenTagsSymbol`) onto each intermediate draft. When `modifyHiddenTags` ran multiple times in a chain (e.g. setting both mints and a private key on a wallet event), the stale `HiddenTagsSymbol` from the first step was carried into later steps, causing `unlockHiddenTags` to return the outdated tag set and silently drop tags. The fix applies the same `PRESERVE_EVENT_SYMBOLS` whitelist stripping inside `chain()` that `eventPipe` / `pipeFromAsyncArray` already used.

Additionally replaces the removed `buildEvent` calls in `gift-wrap.ts` and its test with equivalent `eventPipe` + `blankEventTemplate` calls, and fixes a stale `User` cache issue in the bookmarks action test.
