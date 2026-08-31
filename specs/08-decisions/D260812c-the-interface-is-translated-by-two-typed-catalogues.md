# D260812c — The interface is translated by two typed catalogues, not by a library

**Confidence.** observed — messages-en.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The repository had just settled on a single language, English,
because splitting by audience — English on GitHub, French in the interface —
fails as soon as an unknown contributor has to read the code, its comments and
the specs that explain it (D260811). That rule is about the **repository**. It
says nothing about the person opening an album from a sofa, who did not choose
this project's language and will not learn it to read "Newest first".

So the interface needed two languages. The usual reflex is `react-i18next`.

**Decision.** Two catalogues per side — `messages-en.ts` and `messages-fr.ts`,
in `packages/web/src/lib/i18n/` for the interface and
`packages/server/src/i18n/` for what the server writes — plus one hook and one
provider. No library.

**English is the source, and the French file is typed against it.** `Messages`
is `typeof en`: a key forgotten in French, one left behind after a rename, or a
message whose parameters no longer match, fails `pnpm typecheck`. That is the
entire mechanism a two-language gallery needs, and it catches at build time what
a runtime fallback would have hidden behind an English word in a French sentence.

**What a library would have added.** Namespaces, lazy-loaded bundles, plural
rules for languages with six of them, backends, interpolation with its own
syntax, a React integration and a detection chain. This gallery has around five
hundred short messages in two closely related languages: the whole catalogue
weighs less than the loader that would fetch it, so splitting it costs a request
to save nothing. The rest is configuration to maintain — and every one of those
features is a place where behaviour can be wrong without the compiler noticing,
which is precisely what the typed contract removes.

**A message is a sentence, or a function of what varies inside it.** Never a
fragment assembled at the call site: `${count} + " items"` cannot be translated
into a language that agrees the noun differently, and it leaves the catalogue
holding words without the sentence that explains them. This is why the catalogue
holds `(count) => …` for anything that counts, and why "3 elements" is written
once per language rather than composed twice in the components.

**The translation function carries its language** (`t.locale`). Everything that
produces text for a human then takes one parameter instead of two —
`formatDate(iso, t)`, `dayLabel(key, t)`, `exifRows(detail, day, t)` — where a
separate `locale` argument threaded through forty call sites would eventually be
passed the wrong way round, silently.

**Rejected.**

_`react-i18next`_ — see above: the features that justify it are the ones this
project does not have, and its runtime fallback replaces a compile error with a
wrong word on screen.

_JSON catalogues loaded at runtime_, so translations could be edited without a
build. Nobody edits a gallery's translations without also editing its code, and
JSON gives up the type contract: the missing key comes back at runtime, in
production, in the one language the author does not read.

_Keeping the French strings in the components and extracting only what changes._
Half a translation is worse than none: the interface then mixes both languages
on the same screen, and there is no way to tell what remains untranslated other
than reading every file — which is exactly how batch 5b was found wanting
(AGENTS.md, "Language and internationalization").
