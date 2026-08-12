# D78 — An environment variable must reach the container, and this is checked

**Context.** `APP_NAME` (D72) and `GEOCODING_URL` were declared in the zod schema
in `env.ts`, in `.env.example`, and described in `05`, `06`, and `08`. Neither
reached the production process.

Compose does not propagate the host environment: only what the `environment:`
block lists reaches the container. The `.env` read by Compose is only used to
**interpolate** this block — writing a variable there that is referenced nowhere
has strictly no effect. Both variables therefore always fell back to their zod
defaults.

**What this disproved.** `06` claimed that a restart was enough to rename the
instance; that was false, as the name was fixed to `Photos`. `deploy/README.md`
said that an empty `GEOCODING_URL` disabled geocoding; that was also false, and
this is the application's only privacy setting — EXIF coordinates rounded to a
kilometre were sent to a third party with no documented way to prevent it.

This defect is invisible: nothing fails, nothing is logged, and the variable
appears configurable everywhere it is read. `check:specs` could not catch it —
it checked that a variable was **mentioned in the specs**, not that it was
**wired through to the container**. Two distinct properties, of which the second
determines what the operator can actually change.

**Decision.** Both variables are added to the `environment:` block, and
`check:specs` now compares the zod schema with `docker-compose.yml` and the
`Dockerfile`: any variable read by the server without being passed by one or set
by the other fails CI. The check looks for the form `NAME: ${NAME…}`, not the
mere presence of the name — a variable cited in a comment is not wiring.

**The nuance carrying the entire meaning: `-`, not `:-`.** `${VAR:-default}`
substitutes the default for an absent **or empty** value. But empty has meaning:
for `GEOCODING_URL`, it means "call no service" — with `:-`, disabling would
remain impossible and the fix would only address half the defect.
`${VAR-default}` only substitutes when the variable is absent. It is used for
both, including `APP_NAME`, whose empty value must reach zod and be rejected
rather than silently replaced.

**Consequences.** The Compose default duplicates the zod default for these two
variables — two places to keep aligned. This is the price of substitution for an
absent variable, which Compose's map form cannot express otherwise: it cannot
omit a key conditionally. The check does not compare these defaults; it verifies
wiring, the class of defect observed.

**Rejected.** The `environment: - NAME` form, which passes the variable through
unchanged and avoids duplicating the default. It forbids mixing both forms in one
block, which would require converting the eleven existing entries — three of
which use `:?` to refuse startup with a message, something list form cannot
express.
