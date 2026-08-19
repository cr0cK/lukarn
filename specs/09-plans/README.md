# Plans

Work that is **decided and not finished**. One file per release-sized piece of
work, describing what remains and where the last session stopped.

## Why this is not a spec

Every other document in `specs/` describes the application **as it is**, so that
somebody taking over the code can understand why it is built that way. A plan
describes what it is about to become, which is a different promise: the moment
the work lands, a plan that stayed here would be a document claiming a future
that already happened.

Hence the one rule of this directory:

> **A plan is deleted in the pull request that finishes it**, and whatever it
> said that is still true has moved into `01` to `08` by then.

A plan is therefore allowed to be provisional, to name files that do not exist
yet, and to record a decision as "to be taken". None of that is allowed
elsewhere.

## Why it exists at all

Because a piece of work spanning several pull requests spans several sessions,
and each one starts by reading the repository. Without this directory, the plan
lives in whoever wrote it — the branch to start from, the six things that changed
since the plan was written, the trade-off already settled and not worth
relitigating. That is exactly the knowledge that costs the most to rediscover and
the least to write down.

**`check:specs` does not read this directory** when looking for module mentions
(`tools/check-specs.mjs`). A plan that names `sync/exif.ts` before it exists would
otherwise satisfy the check the day the file is created, and the module would ship
described by a plan that is about to be deleted. Everything else applies here as
elsewhere: a `(Dxx)` reference must point at a decision that exists, and a
document cited between backticks must be a file.

**The one rule above is checked**, and only in the direction that can be checked:
a plan every one of whose items is ticked fails `check:specs`, naming itself. The
rule used to depend on somebody remembering it, and the last plan here outlived
its work — it stayed on `main` describing two branches as unmerged after both had
landed, with three items unticked for code the architecture spec already
documented. Nothing said so, because nothing was reading.

A half-finished plan is left alone, which is what a plan is for. What cannot be
detected is the other direction — an item still unticked for work that shipped —
so a plan is worth rereading whenever the work it describes moves.

## Current

[1.3.0 — An account can be a person](./1.3.0-personal-accounts.md): an account may
be bound to a verified identity and sign in with a code sent to its address, while
an unbound one stays the shared access key it has always been. Two pull requests,
neither started.
