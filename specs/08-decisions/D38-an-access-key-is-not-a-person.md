# D38 — An access key is not a person

**Context.** D33 had the comment signed by the account that opens the album,
with a `display_name` and an `email` placed on `users`. This conflated two
things: `albums.yaml` has always allowed **one** identifier to be entrusted to
several people — a password given to an entire family is the intended use. All
messages from the household would therefore have been signed "famille", and the
administrator would have had to enter and maintain other people's email
addresses.

**Decision.** Two separate levels.

- `users` remains an **access key**: it opens albums, and nothing prevents it
  from being shared. No address is attached to it.
- `commenters` is a **person**: a name and an email address that serves as their
  identity. That person signs the comment.

The session carries a `commenter_id` and **remembers** the identity without
defining it: the address identifies the person, so re-identifying from another
device retrieves their comments and the right to delete them.
`comments.account` still retains the access key used, because that is what gets
changed when a password has circulated too widely.

**Rejected.** Making the email address the sign-in identifier in place of
`username`. It is the primary key of `users`, referenced by `user_albums` and
`comments` without `ON UPDATE CASCADE`: these tables would have had to be
recreated on a live database, and changing an address would have become a
change of identity. Also rejected: having the administrator enter the
addresses, which does not survive the first time someone else changes theirs.

**Consequences.** The address is required to write, never to read. It **never**
appears in a thread — only in moderation, which needs to know who is speaking
behind a declared name. Notifications intended for the owner can no longer
target "the administrators": they go to `settings.moderationEmail`, an instance
setting, since an administrator account is no longer a contactable person.
