---
"applesauce-core": patch
---

Bound logger object inspection by depth, entry count, and output size, and stop re-expanding shared references so logging large or DOM-backed objects no longer freezes the main thread.
