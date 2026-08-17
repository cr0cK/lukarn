# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability
reporting instead: the **Security** tab of this repository → **Report a
vulnerability**. It opens a private thread with the maintainer, and the report
stays invisible until a fix is published.

If that form is unavailable to you, email the address on the maintainer's GitHub
profile with `SECURITY` in the subject.

What helps, in rough order of usefulness: what an attacker gains, the smallest
sequence of steps that reproduces it, the version or commit you tested, and
whether the instance was reachable from the internet. A proof of concept is
welcome but not required. A precise description of the flaw is worth more than a
script that only works on your setup.

Expect an acknowledgement within a week. This is a spare-time project with a
single maintainer, so please read that as an honest estimate rather than a
service commitment. You will be credited in the release notes unless you would
rather not be.

## Supported versions

The latest release only. There are no maintenance branches: a fix ships in the
next release, and the upgrade path is `git pull` and `./deploy/deploy.sh`.

## What is in scope

The application as this repository deploys it, meaning the Fastify server, the
front
end, the SQLite schema, the Docker composition and the deployment scripts.
Anything that lets someone:

- see an album, a photo or a comment they have no right to;
- act as another user, or keep a session that should have been revoked;
- read the Google refresh token, or use it outside the application;
- get code to execute in a visitor's browser or on the server;
- extract mail addresses or IP addresses of visitors.

**Two properties this application deliberately claims**, so a break in either is
a vulnerability rather than a design choice:

- **A denied access answers 404, never 403** for albums and media: the existence
  of what you cannot see must not be observable. Only `/api/admin/*` answers 403.
- **No Google URL ever reaches the browser.** Every photo is served through the
  server, under its own access control. A path that leaks a Drive URL is a
  vulnerability even if the URL is short-lived.

## What is out of scope

- **Vulnerabilities in dependencies** with no exploitable path in this
  application. Report them upstream; if the path here is real, that is in scope.
- **Anything requiring an administrator account.** An administrator can already
  read every album, change every setting and connect a Drive: that is the role,
  not a flaw.
- **A misconfigured deployment**: secrets committed to a repository, a `.env`
  world-readable, an instance published without TLS, `PUBLIC_URL` on `http` in
  production. The documentation covers these; a way to make the application
  _silently_ accept such a configuration is in scope.
- **Rate-limit tuning.** Login backoff is deliberately progressive rather than
  locking accounts. A bypass of the backoff itself is in scope.
- **Denial of service by volume**, and reports produced solely by an automated
  scanner with no analysis attached.

## What the application does to protect itself

Documented in [`specs/04-security-and-access.md`](./specs/04-security-and-access.md),
summarised in the [README](./README.md#security). In short: argon2id password
hashing, sessions in the database and revocable immediately, per-album
authorisation on every media request, the Google refresh token encrypted with
AES-256-GCM under a key that is absent from the database, and security headers
(CSP included) set by the application rather than the proxy, so they hold in
development and behind an unconfigured front end as well.
