# D260816d — A local root is declared by the environment, not chosen in /admin

**Context.** `storage/local.ts` reads a folder on the machine. Unlike Drive, whose
references are opaque identifiers issued by a service that already enforces its own
access rules, this backend resolves paths itself, on the same filesystem that holds
`lukarn.db`, `TOKEN_KEY`'s process environment and the container's own source. A
reference it accepts is a file it opens.

Every other connection setting so far has been typed into `/admin`: a label, a
Drive folder identifier, and — from PR 4 — an endpoint and a bucket. The obvious
shape for a folder was the same one: a **Folder** field taking `/mnt/photos`, and
the connection reads it.

**Decision.** The directory is `STORAGE_LOCAL_ROOT`, an environment variable read
at startup and empty by default. Empty means the kind does not exist: it is absent
from `SUPPORTED_KINDS`'s effect on this instance — `/admin` offers the form, and
every connection made through it reports that no folder was declared. A connection
chooses a **subpath under that root**, never an absolute path, and never one
containing `..`.

Two different populations, two different powers. Whoever runs the container decides
which part of the disk this application may see, by writing one variable and
mounting one volume `:ro`. Whoever administers albums decides which folder inside it
an album reads. An administrator password is then worth exactly what it should be:
the ability to publish photographs, not to read files.

The alternative gives it away. With `/admin` naming an absolute path, the
administrator session becomes a file-read primitive over everything the container
can reach — `/app/data/lukarn.db` first, which holds every session and every
encrypted secret, and `/proc/self/environ` after it, which holds the key that
decrypts them. The application would then be one stolen admin cookie away from
handing over the Drive connection it was protecting. No amount of validating the
typed path fixes that, because the typed path is not the problem: the absence of a
boundary is.

**`realpath`, not `resolve`.** The fence is only worth what its check is worth, and
the check that suggests itself — normalise the path, then compare its prefix
against the root — is the one that does not work. `path.resolve` removes `..`
segments and knows nothing about links: a symlink named `holidays` inside the root
and pointing at `/etc` passes it without a mark. Every path is therefore resolved
with `realpath` and only then compared, separator included, so `/photos-private`
does not count as inside `/photos`.

The check happens at three moments and the listing one matters most: an escaping
entry is **dropped from the listing**, so it never enters the index. Refusing it
only at `fetch` would put the check downstream of the database, where the request
arrives carrying a legitimate-looking media id.

**Rejected.** _Validating an absolute path against a denylist_ — refuse `/etc`,
`/proc`, the data directory — is the shape this decision exists to avoid. A
denylist of dangerous paths is unbounded and unwinnable; a single allowed root is
one comparison, and it is the operator's to set.

_Resolving the root once at startup and caching it_ was rejected for the reason a
session is revalidated rather than trusted: a root replaced by a link after startup
must be caught the next time it is used. One `realpath` on a local filesystem costs
nothing beside the file read that follows it.

_Chrooting or dropping privileges around the read_ answers a wider threat than this
one and would constrain how the image runs, for a gain the fence already provides
against the attack that actually exists — a path typed or symlinked into the
storage.

**Consequences.** A hard link inside the root pointing at a file outside it is
**not** detected, and is not claimed to be: it is indistinguishable from the file
itself. The boundary there is the mount, which is why `docker-compose.yml` mounts
the folder `:ro` and why the volume is the operator's decision.

Changing which part of the disk is readable requires a restart, as it requires a
volume change anyway. Moving an album inside the root does not.

`/admin` gains one field, shown for the `local` kind only, and it holds a relative
path. The hint under it names `STORAGE_LOCAL_ROOT` rather than hiding it: somebody
who cannot see the folder they expected needs to know which variable to look at, and
which machine to look at it on.
