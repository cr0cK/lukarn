# D260824l — A visit notification goes to the instance's moderation address

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** D38 took from administrator accounts the quality of being a
contactable person: an account is an access key a household may share, so
everything addressed to whoever runs the instance goes to
`settings.moderationEmail`. D260819 has since allowed an account to be bound to a
real person holding an address of their own, which reopens the question for a
notification that a specific administrator switched on.

**Decision.** The message goes to `settings.moderationEmail`, the address the
instance already uses for its owner.

**Rejected.** The address of the administrator who created the link, when their
account is bound to a person, falling back to the moderation address. It is more
accurate on an instance with several administrators, and it is two rules and a
fallback to document for a situation the typical instance here does not have. It
also splits the answer to "where does mail for the owner go", which D38 made
single on purpose. Also rejected: an address chosen link by link, which would send
a record of somebody's visits to an arbitrary third party and adds a field to a
creation form that already carries several.

**Consequences.** Where several people administer one instance, they all receive
every notification or none. If that becomes a complaint rather than a hypothesis,
the answer is to make the destination a property of the switch rather than of the
instance, which is a change to one setting.

Where no moderation address is configured there is nothing to send to and the
switch has nothing to do, which is the shape D37 already gives an instance with no
mail server.
