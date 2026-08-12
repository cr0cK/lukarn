# D47 — The TLS frontend joins Compose; headers remain in the code

**Context.** The selected hosting is an ordinary VPS (rejected: Fly.io, whose
volumes at $0.15/GB/month charge thirty times the price of Drive to store what a
VPS disk includes — and whose egress billing does not reward the media proxy,
since ingress is already free). The `compose` file then exposed only a port on
`127.0.0.1`, leaving the installer to add a reverse proxy. Rereading the
deployment revealed three consequences: TLS was unfinished homework, no security
header was set anywhere, and `trustProxy: true` held only by virtue of the
`127.0.0.1:` prefix.

**Choice.** Caddy becomes a service in `docker-compose.yml`, and `app` no longer
publishes any port. The **security headers remain in the application**
(`plugins/headers.ts`), not in the `Caddyfile`.

That second half is the decision. The instinct is to put CSP and HSTS at the
frontend, where TLS already lives. But the frontend is the component most likely
to be replaced — an existing nginx, Traefik because something else is hosted, a
tunnel in front of it all — and it is absent in development and tests. Headers
set there only protect one topology; set in the application, they follow the
binary, can be tested with `server.inject`, and survive the `Caddyfile` that
someone will replace. The `Caddyfile` therefore keeps only what it alone can do:
terminate TLS and reject an oversized body before it occupies Node.

`trustProxy` changes from `true` to `['loopback', 'uniquelocal']` at the same
time. `true` trusts every `X-Forwarded-For`, including forged ones: the login
throttle, indexed by IP, no longer slowed anyone down once the port was reachable
by any route other than the proxy. Protection no longer depends on how the
instance is deployed.

**Rejected.** Traefik, whose label-based discovery is a benefit when hosting
multiple services and another layer to understand when hosting only one. Also
rejected: `@fastify/helmet`, one more dependency for around fifteen lines whose
every value should be chosen — helmet's default sets `max-age` to two years,
which the end of this entry rejects, and a CSP that would have to be rewritten
entirely anyway. Finally rejected: `Permissions-Policy`, which would only forbid
APIs the application does not call and whose use would require the visitor's
explicit consent anyway.

**Consequences.** `PUBLIC_URL` gains a fourth role: the `Caddyfile` uses it as
the site address (`{$PUBLIC_URL}`). This is deliberate — the domain served and
the domain declared to Google now come from the same line, eliminating the most
common failure in this installation. In return, the variable must be a complete,
exact public URL: `https://` in production, with no trailing `/`.

The `caddy-data` volume is added to desirable backups but is not irreplaceable:
losing it forces certificate reissuance, and Let's Encrypt caps their number per
domain per week.

Finally, `HSTS` is only set if `PUBLIC_URL` uses `https` — otherwise, a browser
that opened a development instance would demand HTTPS from `localhost` for six
months.
