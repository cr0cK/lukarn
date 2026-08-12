# D5 — `@googleapis/drive` rather than `googleapis`

**Context.** A Drive v3 client and an OAuth2 client are needed.

**Decision.** The targeted `@googleapis/drive` and `@googleapis/oauth2` packages.

**Rejected.** The `googleapis` meta-package, which includes every Google API — around
**114 MB** installed, compared with **2.5 MB** for the two targeted packages. With a
Docker image rebuilt on every deployment, the difference comes at a cost in build time,
image size and dependency surface.

**Consequences.** `google-auth-library` is not a direct dependency: the `OAuth2Client`
type is derived from `InstanceType<typeof auth.OAuth2>` (`drive/service.ts`).
