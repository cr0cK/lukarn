# D62 — Administration commands run in the container, not on the host

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** `deploy/cloud-init.yaml` (D52) sets up a machine with Docker,
`rclone`, Tailscale, and `ufw` — and nothing else. Meanwhile, `README.md` created
the first administrator with `pnpm install && pnpm create-admin alexis` on the
server. Both could not be true at once: this machine has neither Node nor pnpm,
so installation stopped with a database containing no accounts at the very step
that was meant to make it usable.

**Choice.** Add nothing to the machine, and document the compiled form of the
script, which `tsc` writes to `dist/scripts/` and the `Dockerfile` copies into the
image:

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js <identifier>
```

`docker compose run --rm app node …` provides the same service before first
startup — useful for creating the administrator in a database that does not yet
exist. `pnpm create-admin` remains the local development form, where pnpm is
present by construction.

**Rejected.** Installing Node and pnpm in cloud-init: a second runtime to keep
updated on the host, possible version drift from the image, and the need for
`pnpm install` on the server — for a command run twice in an instance's lifetime.
Also rejected: a `deploy/create-admin.sh` wrapping `docker compose exec`; it hides
a path that must be known anyway when another script needs to be run, and adds a
file to maintain to save one line.

**What makes the call safe.** The write comes from a **separate process** from
the server. `ConfigRepo`'s in-memory snapshot is rebuilt on
`PRAGMA data_version`, which only changes for writes from elsewhere: an account
created while the application is running therefore becomes visible without a
restart. The same command executed _inside_ the server process would serve stale
state — this is why no equivalent administration route exists.

**Consequences.** Any command later added to `packages/server/src/scripts/`
inherits this constraint: if it is meaningful in production, documenting its
`pnpm` invocation is not enough. `hash-password` is an effortless exception — it
only prepares a bootstrap `albums.yaml`, so it runs before any deployment.
