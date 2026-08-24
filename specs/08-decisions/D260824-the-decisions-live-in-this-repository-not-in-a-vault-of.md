# D260824 — The decisions live in this repository, not in a vault of their own

**Confidence.** stated — owner: Alexis Mineaud, /do-init topology · 2026-08-24

**Context.** A decision log can sit inside the repository it describes, or in a
separate store shared by several repositories that receive code from the same
intentions. The second shape exists so that a plan spanning two repositories can
cite a decision without reaching inside one of them. Nothing on disk settled which
shape applies here: no configuration named this project, and a scan of the sibling
directories found no such store, so the question went to the owner.

**Decision.** The decisions stay in `specs/08-decisions/`, versioned with the code
they explain. One repository receives the code, which is the whole of the reason.
`packages/shared`, `packages/server`, `packages/web` and `packages/e2e` are pnpm
workspaces inside a single repository rather than four repositories, so there is
nothing for a shared store to sit between.

`README.md` in that directory carries a `type: decision-store` marker saying it is
the store, so a tool identifies the directory instead of scoring candidates and
guessing at one. The marker travels with the clone and holds on any machine, which
is why the path is recorded there and in no second place.

**What would change this.** A second repository receiving code from the same
intentions: a native client, an ingestion service, anything planned in the same
breath as this. At that point the decisions have to become reachable from outside
this tree, and the move is a `git mv` and a re-stamp of the marker.

**Rejected.** **Opening a shared store now, against the possibility of that second
repository.** A store built for a repository that never arrives is a directory
nobody opens, and every `(Dxx)` in the code would point outside the tree holding
it. The migration is cheap and the speculation is not.

**Consequences.** A branch that changes a rule carries the rewritten decision in
the same pull request, which is what `check:specs` already requires and what makes
the identifier in a code comment mean the rule in force. It also means every
decision is public with the repository under the AGPL, and there is nowhere private
to record one.
