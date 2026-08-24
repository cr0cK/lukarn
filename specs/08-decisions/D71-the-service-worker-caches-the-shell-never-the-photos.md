# D71 — The service worker caches the shell, never the photos

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** The application is viewed in a tab: its URL must be remembered and
retyped, while the browser bar consumes part of a phone screen. A relative should
be able to place its icon on their home screen and open photos like any other
application. Making it installable requires declaring a service worker — and
once a service worker exists, it invites making albums available offline.

**Choice.** It caches HTML, JS, and CSS, and **nothing else**. `/api/…`, non-GET
requests, and other origins go to the network without being intercepted. Photos
remain served over the network, with the private HTTP cache the server already
sets on derivatives (`private, max-age=31536000, immutable`).

**Rejected.** Making albums available offline. Three reasons, in this order.
First, partitioning: an application cache is indexed by nothing — neither session
nor cookie — whereas the HTTP cache is indexed by the cookie value. On a family
phone where two accounts are used in succession, the second would reopen a photo
from an album they had never had the right to see, without any request reaching
`authorize()`. Next, quota: a holiday album weighs more than a mobile browser
allows one origin. Finally, eviction: when the quota is reached, the browser
clears the cache **entirely**, including the shell — the application would become
less reliable offline as it was asked to do more.

Also rejected: Workbox. Three rules fit in eighty readable lines, whereas a
generator would add a build dependency, a generated file nobody rereads, and a
layer for the next maintainer to understand. This repository already writes its
own dotenv and throttle.

Finally rejected: `skipWaiting()`. Replacing the service worker while live makes
an open tab request bundles the deployment has just removed, in mid-session. The
new version takes control at the next launch, exactly the expected behaviour for
an application placed on a home screen.

**Consequences.** Offline, the application opens and displays its shell; albums
do not load. This is accepted: the useful fallback is not viewing photos on the
underground, but ensuring the icon does not lead to a browser error page when the
network falters.

In concrete terms, what appears then is **the login screen**: `RequireAuth` does
not distinguish a network failure in `useMe()` from an absent session, and
redirects to `/login` in both cases. This is unsatisfactory, but it is existing
behaviour and does not depend on the service worker — fixing it would require
separating "not logged in" from "server unreachable" throughout the application,
which is not the subject here.

The asset cache requires purging on activation, otherwise it grows by one build
with every deployment indefinitely — names carry a hash, so nothing ever
overwrites anything.

**The iOS trap**, unrelated to caching and otherwise discovered in use: an
application placed on the home screen has its **own** cookie storage, separate
from Safari's. Its first launch therefore requests login again even if the user
has just logged in through the browser. Once, for the year-long session — but it
must be known so it is not mistaken for a regression.
