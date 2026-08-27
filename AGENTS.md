# AGENTS.md

Self-hosted Google Drive photo viewer: pnpm monorepo (`shared`, `server`, `web`),
one container, with Fastify serving the API and the built front end.

The design is documented in [`specs/`](./specs/). Read
[`specs/README.md`](./specs/README.md) first; it gives the reading order for each
kind of task. By default: `01-vision-and-scope` → `02-architecture` →
`08-decisions`.

## Documentation update rule

**Every change to behaviour, the API, the data model, configuration or a
technical choice updates the corresponding spec IN THE SAME piece of work as the
code.** A spec deferred until "later" is never updated. A code change without a
spec change is not complete.

This rule **is enforced** rather than left to memory: `pnpm check:specs` compares
what the code exposes—declared routes, environment variables, migrations and
modules—with what the specs mention, and fails on any discrepancy. It runs in
`pnpm verify`, in CI and on `pre-push`.

It also verifies that every variable read by `env.ts` **actually reaches the
container**—either passed through the `environment:` block in `docker-compose.yml`
or set by the `Dockerfile`. Documentation alone is not enough: Compose does not
forward the host environment, and `.env` is used only for interpolation. A
variable omitted there cannot be changed in production even though it appears
configurable everywhere else (D78). Wire in every new variable as part of the
same change.

**One decision, one file**: `specs/08-decisions/D<YYMMDD>-<slug>.md`, whose
identifier is **today's date**, not the next ordinal: `D260809`, followed by a
letter—`b`, `c`—if that date already has a decision. An ordinal required knowing
the latest number on `main`, which one branch cannot see on another, and
appending to a single file caused a conflict on every parallel merge even when
the numbers differed (D260809). D1 to D99 keep their ordinals: renaming them
would cross the three hundred references to them in the code.

`check:specs` checks the identifier format, agreement between the title and the
file name, the absence of duplicates across all sources, and the absence of a
reference `(Dxx)`—in the specs or the code—to a decision that does not exist.
These defects have occurred before (D75).

It also verifies that a **spec document cited as text** between backticks—
`specs/05-api.md`, `08-decisions/`—points to an existing file. Neither Markdown
links nor `(Dxx)` references cover this case, and a renamed directory once left
a stale path that nothing reported (D260809d). The decisions directory is
excluded: a log names what it replaced.

Two rules stated on this page used to depend on being remembered, and both were
broken on `main` at the same time. They are now checked.

**A finished plan is deleted, and a plan with every item ticked fails.** The
1.2.0 storage plan survived the work it described: it named two branches as
unmerged after both had landed, and left three items unticked for code
`specs/02-architecture.md` already documented. Only the one direction can be
detected—all boxes ticked—so a plan whose items lie in the other direction is
still yours to notice.

**The README names every storage kind `SUPPORTED_KINDS` offers.** The anchor is
that list paired with the label `messages-en.ts` gives each kind, so adding a
backend forces the front door to mention it. The README claimed "Drive is the
first storage it reads, and the only one it reads today" for as long as three
other backends shipped—nothing breaks when the front door goes stale, which is
exactly why nothing caught it. A paraphrase does not satisfy the check on
purpose: the words a reader meets in the README are then the words they find in
the form.

**A decision states the rule in force, and is rewritten when that rule changes**
(D260822). This directory answers "why is it built this way", in the present
tense: `D6 — No video transcoding` sat on file while the application transcoded,
and a reader had to reconstruct the truth from a chain of three documents. The
history is in `git log`, complete and dated; restating it here is the duplication
every other rule on this page forbids. What survives a rewrite is **why an
alternative was rejected** — that does not age.

**One question, one decision.** When the reasoning that changed a rule already
lives in a newer file, fold it into the older one and delete the newer, replacing
its identifier wherever it was cited. D6 absorbed D260809b and D92 absorbed
D260816 that way. The identifier never moves: it is what a hundred code comments
say, and it means "the current rule on this question".

The title is the sentence stating the rule, so rewriting one changes the title and
renames the file. `check:specs` notices, lists every paragraph of `specs/` and
every source file citing that decision, and asks for a `Swept: D92 — <what you
checked>` line in the commit body — the shape `check:changelog` already uses.

This exists because every other check here proves that a mention **exists**, and
none of them looks at the paragraph the new mention contradicts. D92 said a video
poster comes from Drive; ffmpeg made that false; seven paragraphs across five
documents went on saying it, three of them surviving a deliberate review of the
whole corpus a week later. The pull request responsible had updated all seven
specs — so "were the specs touched?" is worth nothing as a gate.

What the sweep forces is **seeing the list**, not reading each paragraph, and it
reaches only prose that cites a decision. A claim that names nothing is a claim
nothing can hold to account, which is an argument for citing.

**Rereading a whole document is `/spec-sync`.** The skill in
`.claude/skills/spec-sync/` reads a document in `specs/` end to end against the
code and corrects only what is false, citing the `file:line` that settles each
correction. Bare it audits `01` through `07`, which is the full sync; named —
`/spec-sync 04` — it audits those. **Nothing triggers it: it is run by hand**, and
the anchor is a release, where the corpus is already open (D260822b). It never
improves prose: an audit that also rewrites what is merely worded oddly cannot be
reviewed.

`pnpm check:changelog` guards a third reader. The specs are for whoever takes
over the code; `CHANGELOG.md` is for whoever **runs** the application, and the
section matching a `v*` tag becomes the body of its GitHub release — a feature
absent from it is a feature nobody is told about.

It triggers on the **commit type**, not on the paths touched. A rule reading
`packages/web/src/**` would demand an entry for a rename, and a check that fires
on work nobody would report gets disabled — the reason `MODULES_TOLERES` exists.
Conventional Commits already carry the answer: `feat`, `fix` and `perf` claim
somebody will notice, and the section `## [Unreleased]` must have moved with
them. Every other type says the opposite and is believed. For the `fix` nobody
outside the repository could observe, a `Changelog: none — <reason>` line in the
commit body excuses it; stating the reason is the point.

Write the entry **in the voice of the file**: what it does for the reader, and
why it is better, never a restatement of the diff. That is the one thing this
check cannot verify.

`pnpm check:links` complements these checks by catching the other silent defect:
a reference between the three documents that no longer leads anywhere. It
resolves every relative link and anchor without calling the network—a check that
fails because a third-party site is slow eventually gets disabled.

The check verifies that a mention **exists**, not that it is accurate: it catches
a route added without a word in `05-api.md`, but never a paragraph that has
become false. The latter remains your responsibility—and is more common when
changing existing behaviour than when adding it.

If a reported omission is a false positive—a trivial component whose role is
described without its name appearing—add it to `MODULES_TOLERES` in
`tools/check-specs.mjs`, with the reason. A noisy check eventually gets disabled.

| If you change…                                                             | Update…                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/server/src/routes/*.ts` (route, status code, payload)            | `specs/05-api.md`                                                                        |
| `packages/shared/src/index.ts`                                             | `specs/05-api.md`, and `03` if the model changes                                         |
| `packages/server/src/db.ts` (`MIGRATIONS`, indexes, pragmas)               | `specs/03-data-model.md`                                                                 |
| `packages/server/src/repo.ts` (cursors, queries)                           | `specs/03-data-model.md`                                                                 |
| `packages/server/src/comments.ts` (threads, moderation)                    | `specs/03-data-model.md`, `specs/04-security-and-access.md`                              |
| `packages/server/src/commenters.ts` (identities, code verification)        | `specs/03-data-model.md`, `specs/04-security-and-access.md`                              |
| `packages/server/src/mail.ts` (transport, queue, composition)              | `specs/06-configuration-and-deployment.md`, and `08` if a trade-off changes              |
| `packages/server/src/env.ts`, `config.ts` or `bootstrap.ts`                | `specs/06-configuration-and-deployment.md`, and `README.md` if startup requires it       |
| `packages/server/src/config-repo.ts` (accounts, albums, settings)          | `specs/03-data-model.md`, `specs/04-security-and-access.md`                              |
| `Dockerfile`, `docker-compose.yml`, volumes                                | `specs/06-configuration-and-deployment.md`, and the install in `README.md`               |
| `deploy/` (cloud-init, `backup.sh`, `deploy.sh`)                           | `specs/06-configuration-and-deployment.md`, and `deploy/README.md`                       |
| `plugins/auth.ts`, `sessions.ts`, `crypto.ts`, `throttle.ts`, access rules | `specs/04-security-and-access.md`                                                        |
| `storage/provider.ts` (the interface, an error)                            | `specs/02-architecture.md` (the storage interface), `specs/05-api.md`                    |
| `storage/connections.ts`, `storage/registry.ts` (a connection, a kind)     | `specs/03-data-model.md`, `specs/04-security-and-access.md`, `specs/05-api.md`           |
| `storage/drive.ts`, `sync/sync.ts`, `sync/metadata.ts`                     | `specs/02-architecture.md` (sync flow)                                                   |
| `media/renderer.ts`, `media/cache.ts`, `media/range.ts`                    | `specs/02-architecture.md`, and `08` if a trade-off changes                              |
| `packages/web/src/lib/justify.ts`, `useGridLayout.ts`, components          | `specs/07-frontend.md`                                                                   |
| `packages/e2e/` (a spec, the fixture, a project)                           | `specs/07-frontend.md`, and `08` if a trade-off changes                                  |
| `packages/e2e/storages/` (a container, a backend, a claim)                 | `specs/07-frontend.md`, and `08` if a trade-off changes                                  |
| `packages/server/src/shell.ts` (instance name, shell, manifest)            | `specs/05-api.md`, `specs/07-frontend.md`                                                |
| A message shown to a person (interface, HTTP, email, page)                 | **both** catalogues of the pair, and `07` if the mechanism changes                       |
| `plugins/locale.ts`, `i18n/`, `lib/i18n/` (how a language is resolved)     | `specs/05-api.md`, `specs/07-frontend.md`                                                |
| `packages/web/src/styles.css` (`@theme` tokens)                            | `specs/07-frontend.md`                                                                   |
| An accepted trade-off, rejected alternative or "why not X"                 | `specs/08-decisions/`—a new file per question; a rule that changed is rewritten in place |
| Work spanning several pull requests, between two of them                   | `specs/09-plans/`—the plan; the request that finishes it deletes it                      |
| The scope: a feature enters or leaves                                      | `specs/01-vision-and-scope.md`                                                           |

`specs/09-plans/` is the one directory that describes what does not exist yet: a
piece of work spanning several pull requests, so the next session starts from the
branch and the open questions rather than from the beginning. It is **deleted by
the pull request that finishes it**, and `check:specs` does not read it when
looking for module mentions — a plan naming a file before it exists would
otherwise satisfy the check the day it is created.

It is also where a **decision still to be taken** lives: an open question with its
options, which is a different thing from an answered one.

**An answered one is a decision file, and it may be written before its code
exists.** A plan's constraints each cite a decision, and a rule nobody can cite is a
rule nothing counts, so the work that decides what a unit binds on writes those
decisions before the first line is typed. What keeps such a file from describing an
instance nobody is running is a line on the file itself:

```markdown
**Not built yet.** Decided 2026-08-25; no code implements this.
```

It is mandatory on any decision written ahead of its code. It goes when the
implementation lets the file be rewritten to `observed`, and that rewrite is the
only thing that removes it. So `grep -rl 'Not built yet' specs/08-decisions`
answers "what has been decided and is not built", and the present tense the rest of
this directory is written in stays true of every file without that line.

The rule this replaces sent the reasoning to a plan and let the pull request that
made it true write the decision, as the 1.2.0 storage work did. It protected the
right property by the wrong means: absence leaves nothing to grep, so nothing could
tell a decision waiting for its code from one nobody ever wrote. A marker can be
read, and a marker left behind on shipped code is a defect somebody can find.

Five documents, five readers, no duplication between them:

| File               | Reader                          | Answers                                               |
| ------------------ | ------------------------------- | ----------------------------------------------------- |
| `README.md`        | Someone discovering the project | What it is, how to install it, how to run it locally  |
| `deploy/README.md` | Someone operating a server      | How to run it on a machine of its own, and keep it up |
| `specs/`           | Someone taking over the code    | Why it is built this way                              |
| `CONTRIBUTING.md`  | Someone proposing a patch       | How to work here and what will be rejected            |
| `SECURITY.md`      | Someone finding a vulnerability | Where to report it and what counts as a vulnerability |

The root `README.md` stays **short**: what the application is, what it does, how
to install it from the published image, how to connect it to a Drive, how to run
it from source, and the link table. The boundary with `deploy/README.md` is not
the tool but what the reader must already have: everything assuming a machine of
its own—domain, certificate, firewall, backup—belongs beside the scripts that do
it (D64, D260815e).

## Commands

```bash
pnpm install

pnpm --filter @lukarn/server dev      # API on port 8080 (tsx watch)
pnpm --filter @lukarn/web dev         # front end on port 5173, proxy /api to port 8080
pnpm dev                             # both in parallel

pnpm build                           # shared, then web, then server—order matters
pnpm typecheck
pnpm lint                            # eslint .
pnpm format                          # prettier --write .
pnpm test                            # native Node runner, all packages
pnpm test:e2e                        # Playwright, the built artefact in two browsers
pnpm test:storages                   # the storage backends against MinIO, Apache and rclone
pnpm check:format                    # prettier --check .—does formatting match the repository?
pnpm check:specs                     # have the specs drifted from the code?
pnpm check:links                     # do references between documents lead anywhere?
pnpm check:changelog                 # does a visible change say so in CHANGELOG.md?
pnpm check:prose                     # do the public documents still read as written?
pnpm verify                          # shared compiled, then all eight—the gate before publishing

just dev                             # the stack, prerequisites checked first
just demo [count]                    # the stack, against a seeded instance in .demo/
just demo-reset                      # forget that instance
just admin <identifier>              # first administrator, on the ./data instance

pnpm create-admin <identifier>       # first administrator of an empty database
pnpm reset-password <identifier>     # lost password: last resort outside /admin
pnpm hash-password                   # argon2id hash for a bootstrap config/albums.yaml
pnpm --filter @lukarn/server seed-demo 300   # demo dataset, no Drive account
```

The `just` recipes wrap the `pnpm` ones and add what is easy to forget: `shared`
built before anything imports it, a `.env` carrying the two secrets the server
refuses to start without, and—for the demo—an instance that exists before there
is anything to seed into it. `just demo` keeps that instance under `.demo/`, its
own database and its own cache, so it never touches the `./data` a real one uses.
`just` is a shortcut: no check, hook or workflow depends on it.

Before declaring work complete, run **`pnpm verify`**—typecheck, lint,
formatting, tests, and the four documentation checks (specs, links, prose,
changelog). CI runs the same command, and those four also run on `pre-push`:
divergence blocks publication before it reaches the remote repository.

It compiles `shared` first, and that step is part of the gate rather than a
prerequisite left to whoever runs it (D260817). Everything downstream typechecks
against `dist`, so a working copy whose `dist` predates the last change to
`packages/shared/src` reports missing exports for code that is correct. CI never
saw it—a fresh clone has no `dist` to be stale—which is exactly why the
compilation belongs inside the command both of them run.

**A change under `packages/web/src` is not finished until `pnpm test:e2e` has
also passed, and a new screen or control is not finished until a spec in
`packages/e2e/specs/` holds it to account.** Both halves are the gate, not
advice: the command proves nothing regressed, the new spec is what will prove it
again next month. Report the work as done only after quoting the run—`pnpm
verify` **and** `pnpm test:e2e`, both green. "It compiles" is not the claim being
made.

`verify` compiles the front end and never loads it: the whole of 1.1.0—a tab bar,
sheets, a bare viewer, a pinch—lived in that gap. The suite (`packages/e2e`)
builds a throwaway instance, starts the **built** server on it and drives the
real page on a phone (WebKit) and a desktop (Chromium). Reckon two minutes, most
of it seeding, and `pnpm exec playwright install chromium webkit` once.

The command builds `dist/` before driving it (D260817c), so there is no ordering
to remember: it is the artefact the image carries, and a `dist` left over from an
earlier release fails _plausibly_—every screen added since simply absent, which
reads as a regression in the branch under test rather than as the wrong build on
the port.

It is **not** part of `verify`, and must not be added to it: `verify` runs on the
22/24 matrix and on `pre-push`, and a gate that downloads two browsers is a gate
people bypass (D260814g). CI runs it as a job of its own and again in
`release.yml` before the image is pushed.

`pnpm format` rewrites; `pnpm check:format` only checks. The latter belongs in
`verify` because the former runs only when someone remembers: before the check
existed, unformatted code reached `main`, and the next person to run
`pnpm format` also reformatted someone else's work—a noisy diff for an unrelated
fix (D75).

## Code conventions

- **English everywhere**: comments, error messages, interface labels, test names
  and logs. See "Language" below for the completed translation record.
- **Comments explain why, never what.** Delete a comment that paraphrases the
  following line. A useful comment says what would break if the code worked
  differently—this is the style throughout the repository; preserve it.
- **Strict TypeScript**, with `noUncheckedIndexedAccess`. The `!` operator is
  allowed after a check the compiler cannot follow (indexed access, Fastify
  route parameters); `@typescript-eslint/no-non-null-assertion` is disabled for
  that reason.
- **JSDoc on exports**: every exported function, class and type has one sentence
  describing its role and, where useful, why it exists.
- **Tests** use the native Node runner and `node:assert/strict`. They cover
  invariants (isolation, migration reversibility, no pagination duplicates),
  not implementation details.
- **Formatting**: Prettier, 100 columns, single quotes, trailing commas.
- The API contract lives in `packages/shared`; the front end never redeclares a
  response shape locally.

## Language

**The repository is written in English; the interface is translated from it.**
Two different questions, settled separately.

**The repository.** It is public under the AGPL (D260811): splitting language by
audience—English for what is read on GitHub and French for the rest—does not work
when an unknown contributor must read the code, its comments and the specs that
explain it, then edit a `.env.example`. The repository therefore uses the single
language accessible to the greatest number of potential readers. Code, comments,
test names, logs, commits, pull requests and `specs/` are English, with no
exception.

**What a reader sees.** Someone opening an album did not choose this project's
language. Every message shown to a person—interface labels, the text beside an
HTTP refusal, emails, the two unsubscribe pages—therefore lives in a **catalogue**
and exists in English and French (D260812c).

| Surface           | Catalogues                                                      |
| ----------------- | --------------------------------------------------------------- |
| Interface         | `packages/web/src/lib/i18n/messages-en.ts` and `messages-fr.ts` |
| Server and emails | `packages/server/src/i18n/messages-en.ts` and `messages-fr.ts`  |

**English declares the keys; French is typed against them.** A key missing from
the French file, or one whose parameters no longer match, fails `pnpm typecheck`.
Adding a visible message therefore means editing **both** files, in that order,
and never writing the sentence in the component.

A message is a sentence, or a function of what varies inside it. Never assemble
one from fragments at the call site: `${count}` followed by `"items"` cannot be
translated into a language that agrees the noun differently.

**A message with a recipient addresses them; a message on a screen does not.**
An email, and the page a link in an email opens, are read by one person who was
written to: they say `you` in English and `vous` in French. A button, a field
label or a hint sits on a screen nobody was addressed on, and French writes it in
the impersonal infinitive the interface catalogue already uses — `Se connecter`,
`Corriger l'adresse`, `À écrire le premier`.

The two are one catalogue pair per surface, and applying the interface register to
an email is what produced `Ouvrir cette page, qui connaît déjà l'adresse` and
`Ne le transmettre à personne` — administrative prose nobody writes to a relative.
Read a new email aloud as if sending it to someone. Both registers are correct;
only one of them is correct for a letter.

`t` carries its language (`t.locale`), so anything producing text for a human
takes it and nothing else: `formatDate(iso, t)`, `dayLabel(key, t)`,
`validateTitle(value, t)`. The browser announces the language in force with
`Accept-Language`, and the server records it against the commenter identity so
emails arrive in the language their recipient reads (D260812d).

The move to English was completed in the following batches, from the most-read
surface to the least-read—**before** the interface became translatable, which is
why "in English" below means "in the source language":

| Batch | Scope                                                       | Status |
| ----- | ----------------------------------------------------------- | ------ |
| 4     | Installation surface—see below                              | done   |
| 5a    | Server: HTTP messages, logs, exceptions, commands and demo  | done   |
| 5b    | Emails, unsubscribe pages and interface (`packages/web`)    | done   |
| 6     | Code comments, test names, `specs/` and this file           | done   |
| 7     | Both catalogues, and French restored as a choice (D260812c) | done   |

**Batch 5b was not verifiable through `pnpm verify`.** About fifteen labels were
found only by walking through the application in a browser: they were short and
unaccented, alone on a JSX line or buried in an interpolated template. No
literal-text search found them, and no test failed. The browser also revealed
that a global replacement had put "Username" on the **album identifier** field,
where it made no sense.

Batch 7 caught four of those survivors—"Corriger l’adresse", "masquer", "Lieu"
as an EXIF label, and a hint left in French under the account username field—
because moving every string into a catalogue reads every string. Extraction is
the check that batch 5b lacked: what stays behind in a component is, by
definition, what nobody translated.

Some code identifiers remain in French (`titre` in `SearchBox`,
`Mesure`/`valeur`/`unite`/`visiteur` in `VisitsSection`, `elaguer`, `accord`).
They predate the repository-wide language rule. Do not introduce new French
identifiers; renaming the existing ones is separate work and must not be folded
into prose-only changes.

The English surface includes both `README.md` files, `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, the `.github/` templates and
workflows, commits and pull requests, the installation surface—`.env.example`,
`Dockerfile`, both `docker-compose*.yml` files, `Caddyfile`,
`config/albums.example.yaml`, all of `deploy/`, `.gitignore`, `eslint.config.js`
and `pnpm-workspace.yaml`—as well as the code's human-facing text, `specs/` and
this file.

> **PRs #1 to #11 were retitled in English on 2026-08-07, but their corresponding
> commits remain in French on `main`.** The PR list and `git log` therefore differ
> for those eleven entries, and this is **intentional**: aligning them would
> require rewriting the main branch history, breaking every existing clone for a
> cosmetic gain. Do not "fix" this discrepancy.

## Documentation and pull request tone

This repository is open source. Its writing addresses a stranger, not the team
that wrote it. `CONTRIBUTING.md` tells that reader what this page tells an agent;
keep them aligned.

**Write plainly, and factually.** The five documents a stranger reads—`README.md`,
`CHANGELOG.md`, `deploy/README.md`, `CONTRIBUTING.md`, `SECURITY.md`—had drifted
into a register that reads as machine-written, and `pnpm check:prose` now holds
them to this. What it caught, and what to avoid:

- **The em dash is rationed**, to a budget per file rather than banned outright.
  A comma, a colon or a full stop carries almost every one of them, and prose
  broken by a dash every few lines is the single loudest tell. Reach for a second
  sentence before reaching for a dash.
- **No `and nothing else`, `not just X`, `it is not X, it is Y`, `never a photo`.**
  Each states a thing by denying its opposite. Say what the thing is.
- **A heading states what changed**, not what it means. `Three new storage
backends alongside Google Drive`, not `Photographs no longer have to live in
Google Drive`. The evocative version reads as marketing, and a reader scanning
  a release page for what is new has to translate it first.
- No `at its core`, `the real question is`, `it is worth noting that`, and no
  announcing what the next paragraph will do.

The register to aim for is a colleague explaining the change: specific, ordered,
unhurried, with no sentence performing. The check reads the newest changelog
section only—notes for a version that shipped are the body of a release page
that already exists, and editing them would make the two disagree.

**A pull request says what it adds or fixes, not what its author went through.**
In practice:

- No `I`, no `we`, no account of the session. The grammatical subject is the
  code, the behaviour or the user—never the person who typed it.
- **Keep it short.** Lead with the intent in one sentence; state the problem and
  then the fix; use two to four bullets at subsystem scale. Depth—rejected
  alternatives, checks, figures—belongs in a single collapsed `<details>` block.
- Do not restate the diff file by file; the Files tab does that better.

**No hosting provider or third-party service is presented as the right choice**
(D63). Documentation states the required outcome; provider-specific commands
belong in a collapsed block alongside equal alternatives. A component named in
the body—Tailscale, Caddy, Let's Encrypt—must be a deliberate, documented and
replaceable architectural choice, not a habit.

**Nothing personal belongs in executable material.** A system account carries a
role (`deploy`), not a person's name. Example identifiers in specs and tests are
different: keep them unchanged.

## Pitfalls

- **The server inventories the disk cache at startup** (`MediaCache.load()`). A
  file placed in `CACHE_DIR` while the server is running remains invisible until
  restart—which is why `seed-demo` requires one.
- **`index.html` and the manifest are read once at startup** (`shell.ts`
  substitutes `APP_NAME` into them). Rebuilding the front end while the server
  is running leaves it serving old HTML that refers to deleted bundles: a blank
  page. Restart it. This does not apply in production or under `pnpm dev`.
- **`PUBLIC_URL` must exactly match the redirect URI declared in Google Cloud**
  (`PUBLIC_URL + /api/oauth/callback`). A trailing `/`, `http` instead of
  `https`, or an extra `www.` causes `redirect_uri_mismatch`. `PUBLIC_URL` also
  determines whether cookies are `secure`.
- **Never modify a published migration.** Running instances have already applied
  it; changing it makes the real schema diverge from the assumed one. Append an
  entry to `MIGRATIONS`.
- **Dates are stored and displayed in UTC** because `taken_at` represents the
  device's clock time when the picture was taken, read from EXIF data without a
  time zone. Every displayed date goes through
  `packages/web/src/lib/format.ts`, whose formatters all set
  `timeZone: 'UTC'`. Displaying it in the local time zone would shift the photo
  and move end-of-month shots into another month.
- **The database is authoritative for accounts, albums and settings.**
  `config/albums.yaml` is read only while no account exists (bootstrapping a new
  installation or upgrading a running instance); it is ignored thereafter. All
  writes go through `ConfigRepo`, which maintains an in-memory snapshot—a direct
  `UPDATE` on those tables **in the same process** would serve stale state. A
  write from another process (the command-line tools) is safe: `read()` monitors
  `PRAGMA data_version`, which changes only for external writes, and rebuilds the
  snapshot when needed.
- **Media access control is a prefix `preHandler`** in `routes/media.ts`. Every
  new media route inherits it automatically—do not mount it elsewhere.
- **An access denial returns 404, never 403** (albums and media). Only
  `/api/admin/*` returns 403.
- **`better-sqlite3` is synchronous**: keep queries indexed and bounded.
- **`threadpool.ts` must remain the first import in `main.ts`.** Node fixes the
  size of the libuv pool on first use, and in ESM every import is evaluated before
  the module body: one earlier import that opened a file would freeze the default
  value. Measured result: with four threads, a cached thumbnail takes 2 seconds
  to serve while rendering is under way (D32).
- **Image decoding is throttled** (`media/semaphore.ts`). Do not call sharp
  outside `MediaRenderer` without going through this limiter: it prevents a cold
  grid from tripling the process's memory usage.
- **Build order is enforced**: `shared` before `web` before `server`.
