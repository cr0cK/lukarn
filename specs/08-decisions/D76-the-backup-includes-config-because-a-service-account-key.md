# D76 — The backup includes `config/` because a service account key cannot be downloaded again

**Context.** `deploy/backup.sh` backed up the `nonni-data` volume and `.env`. The
two belong together, as D14 explains: the refresh token is encrypted and only
`TOKEN_KEY` decrypts it, so an archive without its `.env` requires new consent.

That reasoning was complete while Drive only used OAuth, with the token stored in
the database. Service account authentication (D50) moved Drive access to a file
mounted from the host, `config/service-account.json` — neither in the volume nor
in `.env`. Yet the script was written three days later and omitted it.

The spec had noticed: the mount table in `06` already says "**Yes, if the key is
there**" for `./config`. This is therefore not a choice being revised, but a gap
between a script and its own spec.

**What it cost.** A restoration returned the database, accounts, albums, and
settings — but no Drive access. Google only provides a key's JSON when it is
created. The failure does not appear during restoration: the application starts,
`/admin` responds, and the albums are present. It appears at the first
synchronisation, when nothing is retrieved.

**Decision.** `backup.sh` archives `config/` as a third piece beside `.env`, under
`nonni-<timestamp>.config.tgz`.

The entire directory rather than a list of files: filtering would require keeping
a pattern aligned with `.gitignore`, and the version-controlled album example
that travels with it weighs two kilobytes.

The `.tgz` extension is not cosmetic. Pruning distinguishes archives by pattern,
and `nonni-*.tar.gz` would include this one: retention would fall from seven real
backups to three without a message. A third `prune` call handles it.

**Rejected.** Merging `config/` into the volume archive. Both trees would have
needed prefixes to prevent overlap, changing the archive's internal layout — and
the documented restoration command (`tar xzf … -C /data`) would no longer work
for existing archives. A backup that can no longer be restored using the
published procedure is the defect this work fixes, not one it introduces.

**Consequences.** An OAuth instance has no `config/` to back up; the script
detects this and does not fail. Archives predating this entry restore unchanged,
without the key: recreating it costs three clicks in the Google console and does
not require sharing any album again — folders are shared with the account, never
with one of its keys.

For a service account instance, the archive now contains what is needed to read
shared Drive folders. This was already true for an OAuth instance, whose archive
carries the encrypted token **and** its key. The difference is that a service
account key does not expire: the backup destination must be treated as a secret
store, as `deploy/README.md` already recommends by encrypting it.
