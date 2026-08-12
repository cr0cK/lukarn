# D72 — The instance name lives in `.env`, and the server puts it in the shell

**Context.** Once installed, the application was named "Photos" under its icon,
whatever the instance. This is the most important name in the entire project: it
is the only one seen by someone who did not install it themselves, and two
galleries on the same phone would have the same one. The name appears in four
places — `<title>`, `apple-mobile-web-app-title`, `application-name`, and the
manifest's `name`/`short_name`.

**Choice.** `APP_NAME`, defaulting to `Photos`. `index.html` and
`manifest.webmanifest` keep that default hard-coded, and the server substitutes
the configured value **at startup**, once, in memory (`shell.ts`). Both files
become exact routes with priority over `@fastify/static`. The frontend reads the
name back from the DOM's `application-name` meta tag.

**Rejected.** A build constant (`import.meta.env`): one image serves all
installations, and rebuilding a container to rename a gallery is out of
proportion. Also rejected: a database setting alongside accounts and albums — it
would have to apply before any account exists, since the first page served is the
login screen, and `ConfigRepo` does not answer that question. Finally rejected:
exposing the name in an API response read by the frontend at startup. This would
add a contract field, a loading state, and above all a moment when the page appears
without its name — while the server can simply write it into the returned HTML.

Also rejected: replacing the string "Photos" everywhere in the file. Substitution
targets three named locations because a global replacement would also rename a
comment or future interface text containing the word.

**Consequences.** Substituting into HTML with a regular expression is defensible
only because the repository owns the template: this is not HTML parsing but a
template whose holes are known. The real risk is silent — add an attribute to the
`<title>` tag or reverse `name` and `content` in a `<meta>`, and the pattern no
longer matches without anything breaking: the server starts, the page displays,
and it carries the wrong name. `test/shell.test.ts` therefore runs substitution
against the **real** `index.html`, not an example string.

The name is escaped before entering HTML. It comes from the operator's `.env`,
not a visitor, but a `"` is enough to escape an attribute, and nobody rereads
their `.env` wondering whether it is valid HTML.

The icon is **not** configurable: that would be a file mounted in the container,
therefore another Compose volume and a procedure in `deploy/README.md`, for a
need nobody has expressed. If it arises, `WEB_DIR` can already be overridden.
