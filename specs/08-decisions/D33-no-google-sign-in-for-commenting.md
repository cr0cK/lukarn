# D33 — No Google sign-in for commenting

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Comments needed an identity attached to them. The initial
assumption was "sign in with Google", as consumer services do.

**Decision.** The identity remains internal to the application. See D38 for the
form it eventually took — what matters here is what was rejected.

**Rejected.** Google OAuth for visitors. Three reasons, in this order.

First, it is **unnecessary**: every media route already requires a session, so
by the time someone can see a photo, the server knows their identity. Google's
only distinct contribution would be a verified email address — for which a form
field completed by the owner does the same job on an instance with a handful of
accounts.

Second, it **opens an authorisation hole**. Permissions live in `user_albums`,
attached to `users.username`. A Google account that presents itself exists in
neither of these tables: it would require an allowlist of addresses per album,
which means reinventing the existing accounts, or accepting any Google account
holder.

Finally, it **contradicts the scope**: "a visitor never has a Google account and
never sees a Google URL" ([01](../01-vision-and-scope.md)), and public
registration has been excluded from the outset.

**Consequences.** Commenting presupposes the ability to open the album. If the
instance ever needs to open up to people without an account, the entire access
model will need revisiting, not the comments.
