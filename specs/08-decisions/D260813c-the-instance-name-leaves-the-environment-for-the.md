# D260813c — The instance name leaves the environment for the database

**Confidence.** observed — context.ts, git ls-files → exit 0 · 2026-08-23

**Context.** D72 put the instance name in `APP_NAME` and had the server
substitute it into `index.html` and the manifest at startup. The reasoning still
holds in part: the name must exist before any account does, because the first
page served is the sign-in screen and it already carries it.

What has changed is that it is no longer alone. The colour and the logo are
settings (D260813, D260813b), edited from /admin by someone looking at the
gallery they are naming. Leaving the name in `.env` would split one screen's
worth of decisions across two places, one of which requires shell access to the
server and a restart — while the two beside it apply immediately.

**Choice.** `AppSettings.instanceName`, edited from `/admin/identity` like the
rest. `APP_NAME` becomes a **bootstrap value**: it seeds the setting while
nothing has been saved, and is ignored afterwards. This is exactly what
`config/albums.yaml` does for accounts (D24), and it means an existing instance
keeps its name across the upgrade without anyone doing anything.

`DEFAULT_SETTINGS` stops being a module constant and becomes
`defaultSettings(instanceName)`, taking the environment value at `ConfigRepo`
construction. Command-line tools construct the repository without one — they
render no page.

**Consequence for the shell.** The shell and the manifest could be rendered once
at startup precisely because their only variable came from the environment. Now
the name, the colour and the logo all change while the server runs. They cannot
be rendered per navigation either: every URL of the application returns the
shell, and re-reading a file from disk for each of them to substitute three
values would be a real cost for a page that changes a few times a year.

So a cache of one, dropped by the `SettingsListener` that `context.ts` already
defines — `main.ts` uses the same mechanism to reschedule the synchronisation
timer without a restart. The substitution slots in `index.html` are untouched and
`shell.test.ts` still reads the real template.

**What stays in the environment, and why.** `APP_NAME` remains declared,
documented and wired to the container. Removing it would leave a brand-new
installation with a hard-coded "Photos" in its tab before an administrator
exists, and would break every instance whose `.env` already carries a name. Its
meaning is now narrower and its documentation says so: it is read on a database
with no saved name, and nowhere else.
