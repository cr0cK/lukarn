# D260811b — The entire repository moves to English, and governance is written down

**Context.** The existing rule divided languages by audience: English for what
was read from GitHub — the two `README.md` files, commits, and PRs — and French
for everything else, including code, comments, tests, interface, logs, and
`specs/`. This division was defensible while the code's only reader was its
author.

Publication under the AGPL (D260811) makes it wrong on two fronts. The first is
immediate: what a stranger must **edit** to install the application is not a
README, but `.env.example`, the `environment:` block in `docker-compose.yml`,
and the `Caddyfile`, while they read the output of `deploy/*.sh` as it runs. All
of this was in French, including the error messages that stop startup
(`:?définis PUBLIC_URL dans .env`). The second is slower: 96,000 words of
`specs/` and 8,500 lines of comments explain why the code is shaped this way,
and a contributor who cannot read them will repeat the mistakes they document.
A design written in a language the reader does not speak protects nothing.

None of this was visible while the repository remained private, and the
audience-based rule already contained the right intuition. It simply placed the
boundary where the readership was at the time.

**Decision.** One language, English, everywhere: code, comments, test names,
interface labels, error messages, logs, example configuration files, `specs/`,
and `CLAUDE.md` included. The rule applies **from now on** to everything that is
written, with no requirement to translate the surrounding text when making a
change — otherwise the smallest fix would entail a translation, and nobody
would propose anything again.

The migration proceeded from most-read to least-read: the installation surface
first, then the interface and server messages, then comments, test names, and
`specs/`. It is now complete, and `CLAUDE.md` states the rule in the present
tense rather than as a crossing under way. What remains in French is a handful of
code identifiers, listed there — renaming a symbol is a different kind of change
from translating a sentence, and it earns its own piece of work.

The missing governance is written down in the same effort because it answers the
same questions a newcomer asks: `CONTRIBUTING.md` (how to work here and what will
be rejected), `SECURITY.md`, `CODE_OF_CONDUCT.md` — the unmodified Contributor
Covenant 2.1 —, a PR template, and two issue templates.

**Rejected.** A `fr`/`en` **i18n** system with catalogues and browser detection:
French would remain available, but every new string would then have to exist
twice for ever, and the application has only one maintainer. The debt is
permanent, whereas translation is a one-off cost. Also rejected was **stopping
at the installation surface**: it is the cheapest step and makes the project
installable, but leaves its code and design out of reach, making the project
open to use and closed to contribution.

**One reporting address rather than another.** `SECURITY.md` points to GitHub's
private vulnerability reporting, not to an email address in plain text in the
repository. An address committed there is harvested within days, and a report
received in a personal inbox has no thread, history, or means of publication
once fixed. `CODE_OF_CONDUCT.md`, by contrast, cannot use that channel — it is
not designed for this — and therefore points to the address on the maintainer's
GitHub profile, which remains under their control.

**Consequences.** The repository briefly lived with two example domains: the
READMEs used `photos.example.com` while the specs said `photos.exemple.fr`.
That divergence closed once the specs were translated: they now use
`photos.example.com` and `gallery@example.com` too, matching the READMEs.

Three names that were paths rather than text change with the rest because an
English-speaking operator sees them:

- the local backup directory, `sauvegardes/` → `backups/`, and the default
  rclone remote, `sauvegardes:nonni` → `backups:nonni`.
  `NONNI_BACKUP_DIR` and `NONNI_BACKUP_REMOTE` allow the old values to remain.
  Pruning considers only the specified directory: archives left in the old one
  remain there;
- the SSH hardening file installed by cloud-init,
  `99-durcissement.conf` → `99-hardening.conf`. There is nothing to migrate,
  for the reason already given by D63 about the system account: cloud-init
  applies only to machines created afterwards;
- the identifiers in `config/albums.example.yaml`, which becomes a neutral
  example (`alice`, `family`, `holidays-2025`). Those in the specs and tests
  remain unchanged: they are not addressed to someone installing the project.

Code identifiers never changed language: they were already in English, which is
what makes the migration mechanical rather than risky. No symbol is being
renamed, so there is no silent regression to fear from a translation — at worst,
an awkward sentence.

**What this does not entail.** Commits already on `main` are not rewritten, for
the reason already given: rewriting the main branch history breaks every
existing clone. Past decisions are not translated one by one outside the batch
that handles them.
