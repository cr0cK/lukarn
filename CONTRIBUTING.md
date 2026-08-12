# Contributing

Thanks for looking. This is a small self-hosted application maintained in the
open; issues and pull requests are welcome, and so is a fork that goes its own
way.

Two things are unusual here and worth knowing before you write any code:
**documentation is part of the build**, and **a design decision is a file**. Both
are enforced by checks, not by memory. Everything else is ordinary.

## Getting it running

Node ≥ 22 and pnpm. Nothing else — no Google account, no domain, no server.

```bash
pnpm install
pnpm --filter @nonni/shared build   # not optional, see below
cp .env.example .env
openssl rand -hex 32                # → SESSION_SECRET
openssl rand -hex 32                # → TOKEN_KEY
pnpm create-admin alice             # password is prompted
pnpm dev                            # API on :8080, front on :5173
```

**Building `shared` first is not a formality.** `@nonni/shared` is exposed
through its `dist/`, not its sources, so on a fresh clone both `pnpm dev` and
`pnpm create-admin` fail with `ERR_MODULE_NOT_FOUND` until it has been built. The
same constraint fixes the order of the full build: `shared` → `web` → `server`.

Without a Drive account, `pnpm --filter @nonni/server seed-demo 300` fills the
index with locally generated media. Restart the server afterwards — the disk
cache is inventoried only at startup, so freshly written thumbnails are invisible
to a running process.

## Before you open a pull request

```bash
pnpm verify
```

Six gates in one command: `typecheck`, `lint`, `check:format`, `test`,
`check:specs`, `check:links`. This is exactly what CI runs, so a green `verify`
means a green pull request. Two of them also run on `pre-push`, installed
automatically by the `prepare` script — a push that would make the documentation
lie is stopped before it reaches the remote.

If `check:format` fails, run `pnpm format`. It is a gate rather than a suggestion
because unformatted code used to reach `main`, and the next person to run
`pnpm format` would reformat someone else's work along with their own — a muddied
diff for a fix that was not theirs.

## Documentation is part of the change

**Any change to behaviour, the API, the data model, configuration, or a technical
choice updates the matching spec in the same piece of work.** A spec updated
"later" never is. `pnpm check:specs` compares what the code exposes — declared
routes, environment variables, migrations, modules — against what the specs
mention, and fails on the gap.

`CLAUDE.md` holds the table of which document follows which file. The short
version:

| If you touch…                                | Update…                                    |
| -------------------------------------------- | ------------------------------------------ |
| `packages/server/src/routes/*.ts`            | `specs/05-api.md`                          |
| `packages/server/src/db.ts`, `repo.ts`       | `specs/03-modele-de-donnees.md`            |
| `env.ts`, `Dockerfile`, `docker-compose.yml` | `specs/06-configuration-et-deploiement.md` |
| Anything under `packages/web/src`            | `specs/07-frontend.md`                     |
| Access rules, sessions, crypto               | `specs/04-securite-et-acces.md`            |
| A trade-off you accepted, an option you cut  | `specs/08-decisions/` — **a new file**     |

The check verifies that a mention **exists**, never that it is still true. It
catches a route added without a word in `05-api.md`; it will never catch a
paragraph that has quietly become false. That part is on you, and it is the more
common case when you change existing behaviour rather than add to it.

If a reported gap is a false positive — a trivial component whose role is
described without its name appearing — add it to `MODULES_TOLERES` in
`tools/check-specs.mjs`, with the reason. A noisy check ends up disabled.

Also note the environment-variable rule: a variable read by `env.ts` must
actually **reach the container**, passed through the `environment:` block of
`docker-compose.yml` or fixed by the `Dockerfile`. Being documented is not
enough — Compose does not forward the host environment, and `.env` only feeds
interpolation. A variable forgotten there is unchangeable in production while
looking adjustable everywhere else.

## A decision is a file

Accepted trade-offs live in `specs/08-decisions/`, one file each, named
`D<YYMMDD>-<slug>.md` and titled `# D<YYMMDD> — <sentence>`. **The identifier is
today's date, not the next number in a sequence** — then a letter (`b`, `c`, …) if
the day already carries one. Sequential numbering required knowing the last
number on `main`, which a branch cannot see, and appending to a single file
conflicted on every parallel merge.

One trap remains, and it has bitten: two branches opened the same day can pick
the same letter, and nothing notices until both have merged. **Before pushing,
`git fetch` and check which letters the day already carries on `main`** — the
duplicate only surfaces afterwards, as a failing check on everyone else's
branches.

Decisions are a journal: they are not rewritten. A decision that recounts how
something used to be keeps the names it had at the time.

## Commits and pull requests

**In English**, both, title included — like the rest of the repository.

Commits follow [Conventional Commits](https://www.conventionalcommits.org):
`feat(admin):`, `fix(web):`, `docs:`, `refactor(media):`. The scope is the
subsystem, taken from the existing history.

A pull request says what it brings or fixes, not what its author went through.
Lead with the intent in one sentence — the goal, the trigger, the bug — then the
problem and the fix. Keep it short: depth goes in one collapsed `<details>` at the
bottom. No file-by-file restatement of the diff; the Files tab does that better.

## Code conventions

- **TypeScript strict**, with `noUncheckedIndexedAccess`. `!` is allowed after a
  check the compiler cannot follow (indexed access, Fastify route params).
- **Comments explain the why, never the what.** A comment that paraphrases the
  next line should be deleted. A good one says what would break if it were done
  differently — that is the prevailing style, please match it.
- **JSDoc on exports**: every exported function, class and type carries a
  sentence saying what it is for.
- **Tests** use Node's built-in runner and `node:assert/strict`, and cover
  invariants — isolation between accounts, reversible migrations, no duplicates
  across pagination — not implementation details.
- **Prettier**, 100 columns, single quotes, trailing commas.
- The API contract lives in `packages/shared`; the front end never redeclares a
  response shape of its own.
- Dates are stored and displayed in **UTC**, because `taken_at` is the camera's
  clock at the shutter, read from EXIF without a timezone. Every displayed date
  goes through `packages/web/src/lib/format.ts`.

**A note on language.** The repository is entirely in English — code, comments,
interface and `specs/`. A few code identifiers predating the rule remain in
French (see `CLAUDE.md`); renaming them is separate work, not to be folded into
a prose-only change.

## Things that will be turned down

- **Presenting any host or third-party service as the right choice.** The
  documentation states what must be achieved; provider-specific commands live in
  a collapsed block, all on equal footing. A component named in the body of the
  text has to be a deliberate architectural choice, documented as replaceable.
- **Anything nominative in what runs.** A system account carries a role
  (`deploy`), not a first name.
- **Modifying a published migration.** Instances in service have already run it;
  touching it makes the real schema diverge from the assumed one. Append to the
  end of `MIGRATIONS` instead.
- **Scope creep beyond a photo viewer.** See
  `specs/01-vision-et-perimetre.md` for what is deliberately out.

## License

Contributions are accepted under the [AGPL-3.0-only](./LICENSE) license of the
project. There is no CLA to sign, and no copyright assignment: you keep yours.
