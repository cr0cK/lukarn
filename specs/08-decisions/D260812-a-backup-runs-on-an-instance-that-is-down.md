# D260812 — A backup runs on an instance that is down

**Confidence.** observed — backup.sh, git ls-files → exit 0 · 2026-08-23

**Context.** `backup.sh` stopped `app`, archived the volume and started `app`
again, in that order and unconditionally. The order is right; the assumption
underneath it was not. `docker compose start app` exits **1** when the service
has no container at all — not when the container is stopped, when it does not
exist — and the script runs under `set -euo pipefail`. A backup on an instance
that had never come up, or that a failed deployment had left with nothing
created, therefore died on its last line but one, after having written a perfectly
valid archive.

That exit code propagates. `deploy.sh` calls `backup.sh --local` before touching
anything, and stops at the first failure. The result is a loop with no way out:
the update refuses to run because the application is not running, and the
application is not running because the update cannot run. It cost a production
instance forty minutes of downtime the day the published image turned out to be
unreachable — the first failure left no container behind, and every subsequent
attempt to deploy hit the backup instead.

The moment a backup matters most is precisely the moment the instance is on the
floor. A script that only works on a healthy instance is not a backup script.

**Decision.** `backup.sh` reads the state before changing it, and restores the
state it found. If `app` is running it is stopped, archived and started again; if
it is not, the volume is archived as it stands and nothing is started. The
`trap` that guarantees a restart is armed only in the first case, since there is
nothing to restore in the second.

An instance deliberately stopped therefore stays stopped after a backup — the
previous behaviour would have restarted it, which is a surprise on a machine
someone had quiesced on purpose.

**Ruled out: `docker compose start app || true`.** One character shorter and
wrong for a different reason: it also swallows a genuine failure to start, which
is the one thing the `trap` exists to catch. A backup that leaves the instance
down without saying so is worse than one that refuses to run.

**Ruled out: creating the container to be able to stop it.** `up --no-start`
would make the flow uniform, but it makes a backup script write to the state of
the instance it is supposed to observe, and it needs a usable image — which is
exactly what was missing in the incident above.

The check that the archive contains `lukarn.db` (D53) is unchanged and covers the
new path as well: an instance that is down still has its volume, and an empty
archive is still refused.
