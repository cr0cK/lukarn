# D260816k — A storage backend is held to account by the server it claims to speak to

**Confidence.** observed — s3.test.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Four storage kinds now sit behind the interface
[D260815f](./D260815f-a-storage-interface-and-drive-as-its-first.md) declared, and
three of them arrived with thorough tests: `s3.test.ts` and `webdav.test.ts` answer
every request from an HTTP stub on localhost, and the S3 one recomputes the
signature of each request as it arrives, which reads a request more strictly than
most buckets do.

They shipped without one line of either backend ever having reached a bucket or a
WebDAV server. The plan that produced them said so in as many words — _"no
environment in which these branches were written had a Drive account, a bucket or a
Nextcloud"_ — and the gap was carried forward rather than closed.

**A stub agrees with whoever wrote it.** That is the whole of the problem, and it
is not fixed by writing a better stub. Every shape it answers with is a shape its
author already believed in, so a listing whose `<CommonPrefixes>` behaves other
than expected, an href in a form nobody anticipated, or a refusal carrying an
unforeseen `<Code>` is invisible: the test and the code are wrong together, and
they agree.

The cost of that is not evenly spread. It falls on exactly the requests hardest to
reason about from a specification — a signed `Range`, a percent-encoded href, a
403 that means the clock rather than the key — and those are the ones an operator
meets on their first large video.

**Decision.** `packages/e2e/storages/compose.yml` runs the servers, and
`storages/contract.test.ts` is one table of claims replayed against each: a probe
that names what it points at, a listing of exactly what was seeded, a folder seen
as a folder, bytes handed back unaltered, a `Range` answered with a 206 covering
exactly that window, a missing reference refused, no preview, and a refused
credential recorded as a revocation.

| Server                             | Why it and not another                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| MinIO                              | What a self-hosted bucket is, and the one `pathStyle` is for |
| Apache `mod_dav`, from `httpd:2.4` | One of the two href forms, from the current official image   |
| rclone `serve webdav`              | The other href form, and a second implementation entirely    |

**Two WebDAV servers, not one.** A listing read correctly from one server proves
the listing; it does not prove the protocol. Apache and rclone disagree about what
an href looks like, which is precisely what `storage/webdav.ts` has to get right
for a server it has never seen (D260816f).

**One table, three backends.** Written as a matrix rather than three suites,
because there is one interface: a claim that holds for a bucket and not for a
WebDAV server is a claim `StorageProvider` does not really make, and the table is
what says so out loud. `specs/07-frontend.md`'s `storage.spec.ts` does the same
thing one level up — the same album, the same three photographs, the same headings,
through a browser.

**The suites stay.** The stubs are faster, need no daemon, and cover what a real
server cannot be made to do on demand: a 503 with a `Retry-After`, a truncated
listing, a `PROPFIND` the server does not implement. The two answer different
questions and neither replaces the other.

**Not in `pnpm verify`, and not in `pnpm test`.** Same reasoning as
[D260814g](./D260814g-a-release-is-gated-by-a-browser.md): `verify` runs on the
22/24 matrix and on `pre-push`, and a gate that needs a Docker daemon is a gate
people work around. `pnpm test`'s glob is `test/*.test.ts`, and this file is
deliberately elsewhere.

**Absent Docker it skips, except where nobody is watching.** A contributor without
a daemon still runs everything else, and the suite says out loud that it ran
nothing. CI and the release workflow set `LUKARN_REQUIRE_STORAGES=1`, where a
missing daemon **fails**. The asymmetry is the point: the cost of an optional suite
is the day it silently stops running, and a machine nobody watches is the one place
where "skipped" and "passed" must not look alike.

**Images are pinned, and two of three come from elsewhere than Docker Hub.**
`latest` would make a green run depend on what a third party released this
morning, and the first failure would be blamed on whichever branch was open. MinIO
is pulled from quay.io and rclone from ghcr.io, neither of which rate-limits an
anonymous pull — a throttled pull fails in a way that reads exactly like a broken
test.

**Seeding goes through `storage/sigv4.ts`**, not through `mc` or an AWS SDK. It
keeps D260816e's "no dependency at all" true of the tests as well as the code, and
it buys a claim nothing else covers: the signer is exercised on a request carrying
a **body**, where every call the backend itself makes has an empty payload.

**What it found immediately.** That a bucket accepts a `Range` header left out of
`SignedHeaders` and serves the window — SigV4 obliges only `host` and `x-amz-*` to
be covered. `storage/s3.ts` claimed in a comment that such a request is "refused
outright", and both the code and its stub were consistent with a rule that does not
exist. Signing the range remains right; the reason recorded for it was wrong, and
only a real bucket was in a position to say so.

**Cost.** About nine seconds for the contract table including starting three
containers, and some ninety seconds added to the browser suite for the three extra
album rows. Both are CI jobs of their own.
