# D260815e — The README installs from the image, deploy/ runs the server

**Context.** [D64](./D64-the-deployment-procedure-lives-beside-the-scripts-not-in.md)
moved the whole server procedure out of the root README and left it four things
to say: what the application is, what it does, how to run it locally, and where
to go next. That was written when the only way to run it was a clone, a `pnpm
install` and a build — the local path and the install path were the same path.

They stopped being the same when the image was published
([D260811c](./D260811c-a-published-image-with-local-builds-provided-as-an.md)).
From then on, the way an instance actually gets installed appeared nowhere a
prospective user would look: the only Docker instructions in the repository sat
inside a procedure that opens with a sizing table, cloud-init, a mesh VPN and a
Let's Encrypt certificate. Someone with a machine already running Docker found a
development setup on one side, a hardening guide on the other, and nothing
between them.

The Drive half had the same shape. The README explained the **choice** —
a service account, or OAuth, and why the first ages better — without ever naming
the **action** that makes it work. Sharing the album folder with the service
account's address is the one step nobody guesses and the one whose omission is
silent: a folder that was never shared yields an empty album, with no error in
`/admin` and none in the logs.

**Decision.** The root README answers _install it and connect it_;
`deploy/README.md` answers _run it on a server_. The boundary is not the tool —
Docker on one side, pnpm on the other — but **what the reader must already have**.

Everything that assumes a machine of its own stays in `deploy/`: a domain, a
certificate, a firewall, cloud-init, `backup.sh`, `deploy.sh`. Everything that
holds on any machine with Docker moves into the README: the image, a compose file
of a dozen lines, the two secrets, the first administrator, and the Drive folder
shared with the service account. The README stops at `http://localhost:8080`;
TLS is a link.

D64's split is by reader, and that is what this preserves. The person discovering
the project and the person installing it are the same person on the same
afternoon — the person operating a server three weeks later is not.

**Rejected.** _The full Docker procedure in the README_ — Caddy, the certificate,
the backup — is the seven hundred lines D64 removed, arriving by another door,
and it duplicates a file it would then drift from.

_Leaving the install in `deploy/README.md` and linking to it_ is what the previous
README did, and the reason this decision exists. A reader who has no VPS does not
open a directory called `deploy/`, and the three steps that precede the Drive
section there read as prerequisites when they are not.

_A separate INSTALL.md_ adds a fourth document for a reader the README already
has, whose first question is precisely how to install it.

**Consequences.** The README's compose file is **not** the repository's
`docker-compose.yml`: it publishes port 8080 and has no `caddy` service. The two
must nevertheless keep the same volume names — `lukarn-data` and `lukarn-cache`
are named directly by the backup and restore commands in `deploy/README.md`, and
a README that taught a different name would produce archives that restore nothing
([D53](./D53-compose-volumes-have-explicit-names.md)).

The install now depends on the release workflow continuing to publish `latest`,
and states what nothing else stated where a prospective user would read it: the
image is built for `linux/amd64` only.

The update rule in `CLAUDE.md` gains a target. A change to the **installation
surface** — the compose file, a variable required at startup, the command that
creates the first administrator — updates the root README as well as
`specs/06-configuration-and-deployment.md`, because that surface is now
documented in two places instead of one. The first casualty of it not being was
the startup warning telling a container with no pnpm in it to run
`pnpm create-admin`.

Nothing changes for `check:specs`, which reads no README, or for `check:links`,
which already resolved every reference between the three documents.
