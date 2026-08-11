<!--
Lead with why this exists. A reviewer who reads only the first line should know
why the pull request is on their screen. Keep the visible part short — depth goes
in the <details> at the bottom.
-->

## Why

<!-- The goal, the trigger, or the bug. One or two sentences. -->

## What changes

<!-- The fix, at the scale of the subsystem. Two to four bullets, not a
file-by-file restatement of the diff. -->

-

## Specs updated

<!-- Which spec follows the files you touched? The table is in CONTRIBUTING.md.
`pnpm check:specs` fails on the gap, so this is a reminder rather than a
formality. Write "none — no behaviour, API, model, configuration or technical
choice changed" if that is genuinely the case. -->

-

## Breaking changes and migration

<!-- Anything an instance in service has to do by hand, in one line each: a
renamed volume, a new required environment variable, a manual step before the
first `docker compose up`. Write "none" if there are none. -->

none

## Verification

- [ ] `pnpm verify` passes locally
- [ ] Behaviour checked by hand, or covered by a new test

<details>
<summary>Depth</summary>

<!-- Alternatives rejected and why, benchmark figures, verification verdicts
("pnpm test → 490 pass", not the transcript), anything a reviewer may want and
most will skip. -->

</details>
