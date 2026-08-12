# D63 — The repository favours no hosting provider and creates no personal account

**Context.** D52 gave the repository cloud-init and two scripts, but wrote them
for the machine at hand: `README.md` presented a Scaleway procedure as if it were
the only one, cloud-init mentioned `scw` in its header, the rescue console was
called the "Scaleway serial console", the default backup remote was named
`scaleway:`, and the system account used the author's first name. None of this is
wrong; all of it becomes awkward once the repository is public, where a reader
sees a default choice where there was only a habit.

**Choice.** The body of the procedure names no provider. It states what must be
obtained — a Debian 12+ or Ubuntu LTS image, cloud-init supplied as "user data",
ports 80/443 open and port 22 during bootstrapping, and a DNS record — while the
CLIs of three providers appear equally in a `<details>` block as illustrations of
the same operation. The system account becomes `deploy`: a role, not a person.
The default backup remote becomes `backups:lukarn`, with no brand.

**Rejected.** Keeping no provider command: the most neutral option, but it loses
the ready-to-paste path, including for a first deployment — and documentation
that must be completed elsewhere is documentation that is not followed. Also
rejected: a generic provider example (`<provider-cli>`), apparently neutral but
not executable and therefore never verified.

**What this does not entail.** Tailscale remains named, deliberately: it is not
a hosting provider but an access architecture choice, the one that allows port
22 to be closed without opening anything in return. `README.md` explicitly says
that plain WireGuard, a bastion, or source-IP filtering provides the same service,
and that only step 2 changes in that case.

**Consequences.** An instance already bootstrapped by the previous cloud-init
runs under the `alexis` account: the rename only applies to subsequently created
machines, and there is nothing to migrate — paths in `deploy/backup.sh` and
`deploy/deploy.sh` are relative to the repository, not the home directory. Only
the `crontab` line in `README.md`, which names an absolute path, must be read using
the machine's actual account name.
