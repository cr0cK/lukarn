# D260815 — The instance names its version, and asks about a newer one only when someone is looking

**Context.** A running instance could not say what it was. The version existed in
three places — the tag that triggered `release.yml`, the section of `CHANGELOG.md`
that became the release body, the OCI labels on the image — and in none of them
that the application could read. `package.json` says `1.0.0` and always will:
`release.yml` deliberately reads nothing from it, so the file is not maintained
and the number in it is a coincidence, not a fact.

The practical cost is on the two people this repository writes for. Whoever
operates an instance has no way to tell, from the machine, which image it is
running or whether the release they half-remember reading about is already
installed; they read `docker compose images` and a registry digest. Whoever reads
a bug report has to ask. And an instance can sit six months behind a release
containing a fix for exactly what its operator is complaining about, with nothing
anywhere saying so.

**Decision.** The version reaches the process as `APP_VERSION`, set by the
`Dockerfile` from the same `VERSION` build argument the labels already carry —
the tag, still the single source. `/api/version` reports it to anyone signed in,
and the interface prints "Powered by Lukarn v1.2.3" at the foot of the account
menu with a link to the changelog. For an administrator, and only for one, the
server asks a release feed whether something newer exists and turns a positive
answer into a badge linking to that release.

**Nothing updates itself, and nothing offers to.** The badge is a link. Replacing
the image an instance runs on means pulling it, restarting, and having taken a
backup first — `deploy.sh` does those three in that order and waits for the health
check. An "Update" button in a web page that did any of that would be a button
that can leave a gallery down while its owner is away from the machine, and the
database is the part nobody can regenerate.

**`APP_VERSION`, not `package.json`.** Reading the manifest would report `1.0.0`
from every instance ever built, which is worse than reporting nothing: a wrong
version in a bug report costs more than an absent one. The tag is what the image,
the release and the changelog section already agree on, so it is what the process
is told. Keeping `package.json` in step instead would add a bump commit before
every tag and a way to forget it.

**`dev` is a value, not a placeholder.** Every build outside a release — a local
`docker build`, the compose overlay that builds from source, `pnpm dev` — reads
`dev`, and `parseVersion` refuses anything that is not exactly three numbers.
That refusal is what makes the rest safe: a version that cannot be read is never
compared, so no such build is ever told it is out of date, and none of them
contacts the release feed at all. A developer's machine calling GitHub on every
page load would be a surprising thing for a repository to do to a contributor.

**Only an administrator's request can cause a network call.** An access key
cannot update a machine. Telling one about a release would be an interruption
with no available action behind it, and it would also mean every visitor opening
a menu spends a request on somebody else's rate limit. Both the check and the
`update` field are therefore gated on `admin`, in the route, not in the front end.

**At most one call every six hours, thirty minutes after a failure, none when
nobody asks.** There is no background timer: the question is asked inside the
request that would display the answer, cached in memory for six hours, and
answered by a shared promise when two screens ask at once. A release happens a few
times a year — polling on a schedule would spend requests to learn the same thing,
and would do it on instances nobody is looking at. Nothing is persisted: a table
for one row would be a migration for it, and the answer is worthless after a
restart anyway.

**`UPDATE_CHECK_URL=` disables it, and disables it for real.** Empty means the
instance opens no socket for this — not that it asks and discards the answer. That
is a test, not a sentence in a document, because this is the second setting in the
application whose entire purpose is that nothing leaves the machine, and
`GEOCODING_URL` set the form: an empty value is meaningful, an invalid one stops
startup. A silent failure here is indistinguishable from being up to date.

**Signed in, not public.** The version an instance runs is what a scanner
collects, and the sign-in screen has no use for it. Everyone past that screen sees
it: an interface that names the AGPL software serving it, with a link to what
changed in it, is what the licence is for.

**Consequences.**

**The check is a failure nobody is told about.** An unreachable feed is logged at
`warn` and answered as "nothing to report". Not knowing whether an update exists
changes nothing about serving photos, and an administration page that shows a red
error because GitHub was slow teaches its reader to ignore red errors. The
negative cache means the line appears at most twice an hour rather than once per
click, and the five-second timeout is there because an administrator is waiting on
the response.

**A pre-release is never offered.** `1.2.3-rc.1` does not parse, so it is not a
newer version. Comparison is number by number and never as text — `1.10.0` is
above `1.9.0`, and the string comparison says the opposite, which is how a version
check goes quiet exactly when a project reaches its tenth minor release.

**The feed's shape is a contract with two fields.** `tag_name` and `html_url`,
validated with zod, everything else ignored. Anything unexpected is a failed
check, not a crash — and a self-hoster pointing the variable at a mirror, a
private forge or a static JSON file only has to produce those two.

**`APP_VERSION` is absent from `docker-compose.yml`, deliberately.** Every other
variable the schema reads is passed through the `environment:` block so it can be
changed on the machine (D78); this one must not be, or an instance could claim a
version it is not running. `check:specs` accepts it because the `Dockerfile` sets
it, which is exactly the case that rule was written to allow.

**Rejected: a badge on the account button.** A dot on the avatar would be seen
without opening anything, and it would also be seen by everyone who cannot act on
it, permanently, until somebody with server access updates the machine. The tab
bar already carries one unread indicator that means something has arrived; a
second one meaning "the software could be newer" would devalue it.

**Rejected: reading the running image's OCI labels.** The version is already
inside the container as a label, and `org.opencontainers.image.version` could be
read back through the Docker socket. Mounting the socket into the application to
learn a string it can be handed for free would give a photo gallery control of the
host's containers — a trade with nothing on its side.
