# D260824e — A share link's page carries the instance's name and nothing else

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** A link arrives at somebody who did not choose this application and
may not know it exists. Show them too little and the message has the shape of
phishing. Show them too much and the page tells a stranger that accounts exist
here, then offers a field to guess one in.

**Decision.** The page carries the instance's name, its logo and the album or
photograph that was shared. It carries no album list, no sign-in control and no
sign that other content exists. It asks search engines not to index it.

**Rejected.** A bare page with no branding. A link whose sender cannot be
identified is the shape of a phishing message, and the recipient's correct
response to one is to not open it. Also rejected: the application as an account
sees it, sign-in included, which turns every share into an advertisement that
this instance has a password field. Also rejected: indexing as a per-link option.
It would be understood by whoever set it up and by nobody else, and the mistake it
invites is the one that cannot be taken back.

**Consequences.** Refusing indexing is a request rather than a boundary. It stops
the crawlers that honour it and does nothing about a link pasted into a public
forum: the link is a capability, and it is exactly as private as the person
holding it. Revocation (D260824h) is the answer to a link that has travelled
further than intended.
