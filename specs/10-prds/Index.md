# 10 — Product intents

What somebody has decided to build, written **before** the code and in the
language of whoever asked for it. A document here says what a person will be able
to do and why that is worth doing. It names no route, no table and no file: the
moment it does, it is describing an implementation that has not been designed yet,
and the design is `specs/09-plans/`'s job.

This is the one directory addressed to the person commissioning the work rather
than to the person taking over the code. Everything else under `specs/` describes
the application as it stands.

`check:specs` does not read these documents when looking for module mentions, for
the same reason it skips `specs/09-plans/`: a document naming a file before that
file exists satisfies the check the day it is written, and the module then ships
documented by nothing. Everything else applies, so a `(Dxx)` reference must lead
to a decision that exists.

A row is **appended and never edited**. What changes is the link, when the work
that a document describes lands and the document moves.

| Intent                                                        | Written    | The need                                                                                                |
| ------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| [Sharing without an account](./Sharing-without-an-account.md) | 2026-08-24 | Show an album, or one photograph, to somebody who has no password, and take it back without an argument |
