# D260813e — The compose project carries its own name

**Confidence.** observed — deploy.sh, git ls-files → exit 0 · 2026-08-23

**Context.** D53 gave the four volumes an explicit `name:` so they would stop
depending on the clone directory. The project name itself was left alone, and it
is derived the same way: compose names it after the directory holding the
compose file, then prefixes every container with it. An instance cloned before
the rename therefore still reports `googledrive-viewer-app-1` and
`googledrive-viewer-caddy-1` on each deployment, long after every other trace of
that name had gone from the repository.

Nothing about it is load-bearing. `deploy.sh` resolves the container through
`docker compose ps -q app`, by service, and `backup.sh` mounts volumes by their
explicit names. The stale name reaches no data path — it reaches the reader, in
`docker ps` and in the output of every deployment, where it contradicts the
documentation standing next to it.

**Choice.** A top-level `name: lukarn` in `docker-compose.yml`. The project no
longer depends on where it was cloned, which is D53's argument applied to the one
identifier that escaped it.

**Rejected.** `COMPOSE_PROJECT_NAME` in the `.env`, for the reason D53 already
gave: one more variable nobody remembers, for a result a single line achieves
unconditionally. Also rejected: renaming the server's directory instead. It
corrects the instance at hand and leaves the next clone free to reintroduce the
problem under a new name — and the machine would still need the same edit for
its systemd units, which the compose line does not.

**Consequences.** The first deployment after this change recreates both
containers under their new names. Nothing is lost: the data lives in volumes that
are named independently, and Caddy's certificates with it. The recreation costs
the few seconds `deploy.sh` already waits on its health gate.

The units in `deploy/README.md` set `WorkingDirectory=/home/deploy/lukarn`, which
a machine bootstrapped under the old directory does not match. That divergence
predates this decision and is unaffected by it: the project name is now fixed
regardless of the directory, so the two need no longer agree.
