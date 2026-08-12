# D52 — A VPS and `docker compose`, not a self-hosted PaaS

**Context.** The repository could build an image and serve HTTPS (D47), but
nothing described how to arrive at a running machine. `README.md` targeted a
generic VPS: undersized specification, SSH open to the world, and updates through
`git pull && docker compose up` with no subsequent checks. The open question was
therefore: what fills this gap?

**Choice.** A Scaleway VPS provisioned with the `scw` CLI, bootstrapped by a
version-controlled cloud-init file (`deploy/cloud-init.yaml`), and two bash
scripts — `deploy/backup.sh` and `deploy/deploy.sh`. Nothing more.

**Rejected.** Coolify, Dokku, CapRover, and other self-hosted PaaS products: most
of what they provide — automatic TLS, reverse proxy, redeployment on push — is
already in this repository and works. Adopting them means replacing a thirty-line
`Caddyfile` that can be read in full with a component that must be hosted, updated,
and troubleshot, whose failure takes the gallery down with it. Also rejected:
Kamal, which is closer to the need but assumes an image registry where this
project builds on the machine, and whose value — interruption-free multi-host
deployment — is irrelevant for a single instance whose restart takes a few
seconds. Finally rejected: deployment through GitHub Actions pushing to the
machine, which would require storing a deployment key there and opening an
inbound path while administrative access is being closed behind Tailscale.

**Consequences.** Deployment remains a command run manually on the machine, and
that is accepted for a family gallery: the update frequency does not justify
automating the trigger. In return, `deploy.sh` must be reliable on its own — hence
the systematic backup before migration and active waiting for the return to
`healthy`, instead of an `up -d` that returns control while a container restarts
in a loop.

The advertised specification increases from "1 GB is enough" to 2 vCPU / 4 GB /
60 GB. This was not comfort headroom: the build runs on the machine (`build: .`,
therefore Vite, `tsc`, and any native modules to compile) and the disk cache
targets 20 GB by default. With 1 GB of RAM, the build is killed before completion.
