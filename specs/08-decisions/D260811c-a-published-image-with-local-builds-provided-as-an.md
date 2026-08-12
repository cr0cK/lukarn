# D260811c — A published image, with local builds provided as an override

**Context.** `docker-compose.yml` contained `build: .`, so every instance built
the application on its own machine. The cost was invisible while there was only
one operator: they were the one requiring **4 GB of memory** on the VPS, not to
run a Fastify server and SQLite — for which 1 GB is ample — but to prevent
`tsc`, followed by compilation of `sharp`, `argon2`, and `better-sqlite3` when no
matching prebuilt binary exists, from being killed by the OOM killer. The
message it leaves bears no relation to its cause, and this is the first failure
a new operator encounters.

There was also a lack of control: the `Dockerfile` was **never built by CI**. A
broken image passed `verify` — types, lint, tests, specs, links — and was only
discovered during deployment, on the machine, with the site down.

**Decision.** An image is published to GHCR for every `v*` tag,
`ghcr.io/cr0ck/lukarn:<version>` and `:latest`, and referenced by default in
Compose. **Local builds remain a first-class path**, one override file away:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
./deploy/deploy.sh --build
```

Both appear side by side in `deploy/README.md`, with the sizing requirements for
each, because they serve different people: the image is for someone who wants a
running gallery; the build is for someone who is not on `linux/amd64`, is trying
a modification, or refuses to depend on a third-party registry. **The repository
is the source; the image is a convenience** — stating it this way is the only
way not to turn GHCR into a de facto dependency, which D63 prohibits for hosting
providers and applies just as much to a registry.

CI now builds the image on every pull request, **and starts the container**
until its own `HEALTHCHECK` declares it healthy. Building and starting are two
different assertions: a missing runtime dependency, an incorrect `CMD`, or a
path that exists only in the `builder` stage each produces an image that builds
and dies on startup.

**Rejected.** **Also publishing for `linux/arm64`.** QEMU emulation compiles the
three native modules from source, taking about an hour per publication, for an
architecture nobody has requested. An ARM host is not abandoned: the build
override is exactly its answer, and the README directs it there. This can be
revisited if the need arises, using a native ARM runner rather than emulation.

**Also rejected** was keeping `build: .` as the default and publishing the image
as an addition. This is the smallest change, but leaves the most expensive path
as the default: someone discovering the project compiles native code on a VPS
before seeing a single photo.

**Finally rejected** was making the `package.json` number the source of the
version. The tag is the source, and the only one: nothing in `release.yml` reads
`package.json`, so a publication cannot announce a version absent from its tag.
The cost is having to remember to tag; it is paid once per publication, rather
than as silent divergence whenever the other value is forgotten.

**Consequences.** A running instance does not switch by itself: the
`docker-compose.yml` fetched by `git pull` refers to the image, and
`deploy/deploy.sh` without an argument pulls instead of building. This is the
intended and unsurprising behaviour **provided that D260811's update has been
performed** — the image changes nothing about volumes.

`LUKARN_VERSION` pins a version in `.env`. It is not read by `env.ts`: it is a
Compose interpolation, so D78's check does not monitor it, and it need not reach
the container.

The image's `HEALTHCHECK` becomes part of verification rather than merely
operations: CI reads its verdict instead of writing its own, making disagreement
between the two impossible.
