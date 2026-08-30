# Specs

Design documentation for the viewer. The root `README.md` explains how to install
and operate the application; these documents explain **why** it is built this way,
so that a developer who was not involved in its design can take it over.

## Documents

| Document                                                                  | Contents                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [01 — Vision and scope](./01-vision-and-scope.md)                         | The problem solved, the intended audience, deliberate exclusions, and constraints     |
| [02 — Architecture](./02-architecture.md)                                 | The role of each package, and the flow of a thumbnail and a synchronisation           |
| [03 — Data model](./03-data-model.md)                                     | Tables, indexes, migrations, and cursor-based pagination                              |
| [04 — Security and access](./04-security-and-access.md)                   | Both authentication methods, sessions, media access control, and token encryption     |
| [05 — API](./05-api.md)                                                   | Exhaustive route inventory                                                            |
| [06 — Configuration and deployment](./06-configuration-and-deployment.md) | Environment variables, bootstrapping, Docker, `deploy/`, and the Google Cloud console |
| [07 — Frontend](./07-frontend.md)                                         | Routing, state, justified layout, virtualisation, keyboard, and theme                 |
| [08 — Decisions](./08-decisions/)                                         | Log of technical decisions and rejected alternatives, one per file                    |
| [09 — Plans](./09-plans/)                                                 | Work decided and not finished, one file per release. Deleted when it lands            |
| [10 — Product intents](./10-prds/Index.md)                                | What has been decided to build, before the code and in the language of whoever asked  |

## Where to start

| What you want to do                 | Reading order                     |
| ----------------------------------- | --------------------------------- |
| Understand the project from scratch | 01 → 02 → 08                      |
| Add or change a route               | 05 → 04 → 03                      |
| Change the SQLite schema            | 03 → 02                           |
| Work on the grid or viewer          | 07 → 02                           |
| Deploy or diagnose an OAuth failure | 06 → 04                           |
| Change a technical decision         | 08 → the relevant domain document |
| Continue work already under way     | 09 → the relevant domain document |

## Keeping these documents up to date

The rule and the "if you change X, update Y" table are in the root
[`AGENTS.md`](../AGENTS.md). In short: update the spec as part of the same work as
the code, never afterwards.
