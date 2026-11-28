# D4 — Media proxy rather than signed Google links

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Images stored in Drive must be displayed to visitors who do not have a
Google account.

**Decision.** All images pass through `/api/media/...`. No Google URL reaches the browser.

**Rejected.** Returning Drive's `webContentLink` / `thumbnailLink`, or a 302 redirect to
a signed URL. Three problems: a leaked signed link permanently bypasses access control;
it expires, breaking the browser cache and the `ETag`; and it would indirectly expose
the owner's Drive folder structure.

**Consequences.** All bandwidth passes through the VPS. This is the accepted cost —
mitigated by the disk cache and WebP derivatives that are considerably lighter than the
originals.
