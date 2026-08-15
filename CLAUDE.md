# CLAUDE.md

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

| If you change…                                                             | Update…                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/server/src/routes/*.ts` (route, status code, payload)            | `specs/05-api.md`                                                           |
| `packages/shared/src/index.ts`                                             | `specs/05-api.md`, and `03` if the model changes                            |
| `packages/server/src/db.ts` (`MIGRATIONS`, indexes, pragmas)               | `specs/03-data-model.md`                                                    |
| `packages/server/src/repo.ts` (cursors, queries)                           | `specs/03-data-model.md`                                                    |
| `packages/server/src/comments.ts` (threads, moderation)                    | `specs/03-data-model.md`, `specs/04-security-and-access.md`                 |
| `packages/server/src/commenters.ts` (identities, code verification)        | `specs/03-data-model.md`, `specs/04-security-and-access.md`                 |
| `packages/server/src/mail.ts` (transport, queue, composition)              | `specs/06-configuration-and-deployment.md`, and `08` if a trade-off changes |
| `packages/server/src/env.ts`, `config.ts` or `bootstrap.ts`                | `specs/06-configuration-and-deployment.md`                                  |
| `packages/server/src/config-repo.ts` (accounts, albums, settings)          | `specs/03-data-model.md`, `specs/04-security-and-access.md`                 |
| `Dockerfile`, `docker-compose.yml`, volumes                                | `specs/06-configuration-and-deployment.md`                                  |
| `deploy/` (cloud-init, `backup.sh`, `deploy.sh`)                           | `specs/06-configuration-and-deployment.md`, and `deploy/README.md`          |
| `plugins/auth.ts`, `sessions.ts`, `crypto.ts`, `throttle.ts`, access rules | `specs/04-security-and-access.md`                                           |
| `drive/service.ts`, `drive/sync.ts`, `drive/metadata.ts`                   | `specs/02-architecture.md` (sync flow)                                      |
| `media/renderer.ts`, `media/cache.ts`, `media/range.ts`                    | `specs/02-architecture.md`, and `08` if a trade-off changes                 |
| `packages/web/src/lib/justify.ts`, `useGridLayout.ts`, components          | `specs/07-frontend.md`                                                      |
| `packages/e2e/` (a spec, the fixture, a project)                           | `specs/07-frontend.md`, and `08` if a trade-off changes                     |
| `packages/server/src/shell.ts` (instance name, shell, manifest)            | `specs/05-api.md`, `specs/07-frontend.md`                                   |
| A message shown to a person (interface, HTTP, email, page)                 | **both** catalogues of the pair, and `07` if the mechanism changes          |
| `plugins/locale.ts`, `i18n/`, `lib/i18n/` (how a language is resolved)     | `specs/05-api.md`, `specs/07-frontend.md`                                   |
| `packages/web/src/styles.css` (`@theme` tokens)                            | `specs/07-frontend.md`                                                      |
| An accepted trade-off, rejected alternative or "why not X"                 | `specs/08-decisions/`—**a new file**; never rewrite old ones                |
| The scope: a feature enters or leaves                                      | `specs/01-vision-and-scope.md`                                              |

Five documents, five readers, no duplication between them:

| File               | Reader                          | Answers                                               |
| ------------------ | ------------------------------- | ----------------------------------------------------- |
| `README.md`        | Someone discovering the project | What it is and how to run it locally                  |
| `deploy/README.md` | Someone operating a server      | How to install, update, back up and restore           |
| `specs/`           | Someone taking over the code    | Why it is built this way                              |
| `CONTRIBUTING.md`  | Someone proposing a patch       | How to work here and what will be rejected            |
| `SECURITY.md`      | Someone finding a vulnerability | Where to report it and what counts as a vulnerability |

The root `README.md` stays **short**: what the application is, what it does, how
to run it locally and the link table. Every server procedure belongs in
`deploy/README.md`, next to the scripts it describes (D64).

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
pnpm check:format                    # prettier --check .—does formatting match the repository?
pnpm check:specs                     # have the specs drifted from the code?
pnpm check:links                     # do references between documents lead anywhere?
pnpm check:changelog                 # does a visible change say so in CHANGELOG.md?
pnpm verify                          # all seven at once—the gate before publishing

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
formatting, tests, spec checks and link checks. CI runs the same command, and the
two documentation checks also run on `pre-push`: divergence blocks publication
before it reaches the remote repository.

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
