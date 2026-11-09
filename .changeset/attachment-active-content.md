---
"applesauce-extra": minor
---

Return script-capable attachment types (`text/html`, `image/svg+xml`, XML, JavaScript) from `loadAttachment` as `application/octet-stream`, since the type is chosen by the sender. Pass `allowActiveContent: true` to keep them, for example to render SVG in an `<img>`.
