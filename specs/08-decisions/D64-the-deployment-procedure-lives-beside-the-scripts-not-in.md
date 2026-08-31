# D64 — The deployment procedure lives beside the scripts, not in the root README

**Confidence.** observed — backup.sh, git ls-files → exit 0 · 2026-08-23

**Context.** As missing pieces were added — hardening (D47), scripts and
cloud-init (D52), provider neutrality (D63) — the root `README.md` reached seven
hundred lines, over three quarters of them only concerning server installation.
Someone discovering the project had to cross a Let's Encrypt procedure, a Google
Cloud console, and a volume restoration to find `pnpm dev`.

**Choice.** The root `README.md` says what the application is, what it does, how
to run it locally, and nothing else — plus three links. The entire server
procedure, operations, and backup move to `deploy/README.md`, in the directory of
the scripts it describes. Three documents, three readers: the person discovering
it, the person operating it, and the person taking over the code (`specs/`).

**Rejected.** Keeping one file and merely adding a table of contents: navigation
is not the problem, weight is — a long README makes a project look complicated,
whatever its table of contents. Also rejected: a `docs/` directory, which moves
the procedure away from the scripts it describes, whereas the point of
`deploy/README.md` is precisely to be read alongside `cloud-init.yaml` and
`backup.sh`, and updated in the same change.

**Consequences.** The update rule in `AGENTS.md` changes target: a modification
to `deploy/` updates `specs/06` **and `deploy/README.md`**, not the root. Links
from `deploy/cloud-init.yaml` and `specs/06` now point to `deploy/README.md`.
`tools/check-specs.mjs` is unaffected: it reads no README; it compares code with
specs.

The announced cost of the split was that nothing would report a dead link. That
is no longer true: `tools/check-links.mjs` resolves every relative link and every
anchor in the three documents, and runs in `pnpm verify` as well as on `pre-push`.
Links nevertheless remain few and all relative — a check that catches broken
links does not make writing more of them desirable.
