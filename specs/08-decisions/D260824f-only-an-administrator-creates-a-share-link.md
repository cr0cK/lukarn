# D260824f — Only an administrator creates a share link

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** D38 settled that an account is an access key rather than a person,
and that nothing prevents one from being shared: a password given to a whole
family is the intended use. A share link removes the password altogether, so who
may mint one is a different question from who may open an album.

**Decision.** Creating, renaming and revoking a share link belongs to an
administrator. No other role can do any of the three.

**Rejected.** Any account, on the albums it can already see. The family password
circulates further than intended, which is D38's own premise; letting it publish
an album without a password turns a leak into a public gallery, and the
administrator finds out by looking. Also rejected: extending the right to accounts
bound to a person (D260819), which sign in with a code rather than a password
(D260819b) and are therefore genuinely individual. That rule is defensible and it
is a second rule to explain, on a gallery whose administrator is usually the only
person who puts anything in it. It stays available if somebody asks for it.

**Consequences.** Sharing passes through whoever runs the instance. On an instance
with one administrator, that is the person taking the photographs, which is the
ordinary case here.
