# D260811 — The repository is called nonni and is published under AGPL-3.0

**Confidence.** observed — deploy/backup.sh, git ls-files → exit 0 · 2026-08-23

**Context.** The repository is becoming open source, and two omissions prevented
that. The first is legal: without a licence file, the code remains fully
copyrighted, and nobody can legally run, modify, or redistribute it — a public
repository without a licence is not free software; it is readable code. The
second is the name. `googledrive-viewer` and "Google Drive Photo Viewer" use a
trade mark in the product name, which Google's trade mark usage rules prohibit;
the accepted form names the service without claiming it — "for Google Drive",
never "Google Drive something".

**Decision.** The project is called **nonni** — grandparents in Italian: the
people for whom the application was written, and who wanted to see the photos
without first being given a Google account. A short name with no trade mark that
says who it served before saying what it does.

The licence is **AGPL-3.0-only**. This is a server application: GPL copyleft is
triggered only by distribution of a binary, which never happens here, so it
would allow a third party to turn it into a closed hosted service without giving
anything back. Section 13 of the AGPL is the only provision that covers this
case — anyone hosting a modified version and opening it to users must offer them
the sources. There is no burden on someone who self-hosts it unchanged.

**Rejected.** MIT and Apache-2.0, which maximise adoption and occasional
contributions but allow exactly what the AGPL prevents. GPL-3.0 was also
rejected, because its reciprocity does not apply to software that is not
shipped. Finally, retaining the name with a simple non-affiliation notice was
rejected: the notice is necessary — `README.md` carries it — but it does not fix
a product name built on the trade mark.

**Consequences.** The rename does not stop at the `README.md` title: it crosses
the packages (`@nonni/{shared,server,web}`), the Compose image, the volumes
(`nonni-data`, `nonni-cache`), the database file (`nonni.db`), the cookies
(`nonni_session`, `nonni_oauth_state`), the `localStorage` keys (`nonni:*`), the
CSS slots (`--nonni-*`), the user agent sent to the geocoder, the systemd backup
units, and the default rclone remote.

Three of these renames carry a cost when updating a running instance:

- **Volumes and the database are not adopted automatically.** Without the
  migration described in `deploy/README.md`, the first `docker compose up`
  starts with an empty database, including accounts and indexes — the same trap
  as D53, for the same reason, and it therefore had to be documented in the same
  place.
- **The session cookie changes name**, so all open sessions cease to be
  recognised: everyone logs in once again. The database rows survive and remain
  revocable; only the cookie that identified them has disappeared.
- **Read markers start again from zero** (D55, D82, D99): they live in the
  browser under a renamed key. Previously read comments therefore appear as new
  again, once.

Existing backup archives retain their `gdv-` prefix, which the pruning in
`deploy/backup.sh` no longer recognises: they will not be deleted automatically.

**What this does not do.** D53 is not rewritten. It describes the time when
volume names came from the clone directory, and replacing `gdv-data` with
`nonni-data` in its context would make its account incomprehensible — a log
names what was replaced. Decisions that cited an identifier **still present**
in the code, however, use the new name; otherwise, they would describe code that
cannot be found.

Section 13 is not yet honoured in the interface. It applies only to those who
modify and host the application, but convention calls for a web application to
offer its own source link; the natural place is the footer of `/diagnostic`, and
this remains to be done.
