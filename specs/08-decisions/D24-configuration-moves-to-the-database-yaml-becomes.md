# D24 — Configuration moves to the database, YAML becomes bootstrap data

**Context.** Accounts and albums lived in `config/albums.yaml`, read again at
startup or via a button. The owner wants to administer their instance from the
application, without editing a file on the VPS or restarting a container.

**Decision.** Four tables (`users`, `albums`, `user_albums`, `settings`, migration
3), a `ConfigRepo` that is their sole writer, and an administration API under
`/api/admin`. `config/albums.yaml` is now read only while no account exists: it
**bootstraps** a fresh installation, and is the upgrade path for live instances.

**Rejected.** Having the application write YAML: it is mounted read-only in the
container, serialisation would have to preserve comments and order, and two
concurrent writes would be lost. Also rejected: keeping the file as the source of
truth with writes back to it, which would have left two truths to reconcile — and
a restart could have overwritten a change made in the application.

**Consequences.** The `lukarn-data` volume now contains the accounts: it is the
only thing that needs backing up, and losing it means losing access as well as the
index. `POST /api/admin/reload` and `AppContext.reloadConfig()` disappear. A fresh
installation without a file needs `pnpm create-admin`, otherwise nobody can log
in.
