# D53 — Compose volumes have explicit names

**Context.** The volumes were declared as `gdv-data`, `gdv-cache`, `caddy-data`,
and `caddy-config`. Compose prefixes them with the project name, meaning the
working directory: they were actually named `googledrive-viewer_gdv-data`, and
something else again depending on the clone's name. Meanwhile, the backup
procedure in `README.md` used
`docker run --rm -v gdv-data:/data … tar czf`.

Docker silently creates a named volume that does not exist. This command
therefore mounted a **new, empty** volume, produced an empty archive, and returned 0. The documented backup backed up nothing, with no error message, and the issue
was only discovered during restoration.

**Choice.** An explicit `name:` on all four volumes. The name no longer depends
on the clone directory, and all existing commands become correct.
`deploy/backup.sh` additionally checks that the archive contains `gdv.db` before
keeping it.

**Rejected.** Only correcting `README.md` to use
`googledrive-viewer_gdv-data`: that assumes everyone clones under that name and
leaves the trap intact for any command written from memory. Also rejected:
`COMPOSE_PROJECT_NAME` in `.env` — one more variable not to forget, for a result
that four lines of `docker-compose.yml` achieve unconditionally.

**Consequences.** A live instance already runs on prefixed volumes, which the new
declaration **does not adopt**: without migration, the first `docker compose up`
starts with an empty database — including accounts, albums, and index. Copying
`<projet>_gdv-data` to `gdv-data`, and `<projet>_caddy-data` to `caddy-data` to
avoid certificate reissuance, is therefore a mandatory step documented in a box
in `README.md`. `gdv-cache` is not worth copying.

This is also why end-to-end verification of these scripts produces a real
archive and lists its contents: the original error was visible in the file's
contents, not in an exit code.
