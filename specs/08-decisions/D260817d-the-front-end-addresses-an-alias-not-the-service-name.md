# D260817d — The front end addresses the `lukarn` alias, never the service name

**Context.** The `Caddyfile` proxied to `app:8080`, which is the name of the service in
`docker-compose.yml`. That is unambiguous for as long as lukarn is alone on its compose
network, and it stops being so the moment the front end is shared: a machine hosting a
second application, behind one Caddy that serves both domains, puts both containers on the
same network — and compose gives **every** container its service name as an alias, on
every network it joins. `app` is the name most compose files give their service.

The failure that follows is not a startup error. Docker's embedded DNS returns one record
per container holding the name, so `app` resolves to either application, round-robin, per
request. The site keeps working most of the time, and serves the neighbour's application
the rest of it.

**Decision.** `app` gains the network alias `lukarn`, declared in `docker-compose.yml`, and
the `Caddyfile` proxies to `lukarn:8080`. The alias is declared on the default network, so
the same `Caddyfile` is correct whether Caddy is the one this repository ships or a front
end shared with other applications that imports this file from the clone.

**Why.** The alias belongs to the application; the service name belongs to the compose
file, and every compose file in the world is free to pick the same one. Naming the
application is therefore the only form that stays true when the network is shared, and it
costs three lines and no behaviour: with a single application on the network, `lukarn` and
`app` resolve to the same container.

Declaring it on the default network rather than only where it is needed is what keeps one
`Caddyfile` valid in both arrangements. The alternative — a second `Caddyfile` for shared
front ends — is two files that must be kept saying the same thing about everything else.

**What it costs.** Anyone who reverse-proxies to this container by hand, from an nginx
outside compose or from a script, addressed `app` and must now address `lukarn` — or keep
using `app`, which still resolves as long as nothing else on that network claims it. The
change is additive: no name was removed.

**Rejected alternatives.**

- **Rename the service to `lukarn`.** It reads the same and breaks every
  `docker compose exec app …` in `deploy/README.md`, in the scripts and in whatever an
  operator has in their shell history — for a property an alias already provides.
- **Leave `app:8080` and rely on the shared front end to sort it out.** A Caddyfile cannot
  disambiguate a DNS name; the only fix on that side is to stop importing this file, which
  moves lukarn's routing into a repository that is not lukarn's.
- **Put each application on its own network with the front end.** The front end is then
  attached to both, and resolves `app` against all the networks it belongs to — the
  ambiguity is unchanged.
