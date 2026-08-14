# Development shortcuts. `just` on its own lists them.
#
# Each recipe wraps the pnpm commands README.md documents, and adds what is easy
# to forget: `shared` built before anything imports it, a `.env` carrying the two
# secrets the server refuses to start without, and — for the demo — an instance
# that exists before there is anything to seed into it.

# The demo lives entirely in `.demo/`, and never touches the `./data` and
# `./cache` of the instance you develop against. Forgetting it is then the
# removal of one directory rather than a surgical delete inside a database.
demo_dir := justfile_directory() / ".demo"
demo_data := demo_dir / "data"
demo_cache := demo_dir / "cache"
demo_config := demo_dir / "albums.yaml"
demo_seeded := demo_dir / "seeded"
demo_user := "demo"
demo_password := "demo1234"

default:
    @just --list

# The stack against your own instance: API on :8080, front end on :5173.
dev: _ready
    pnpm dev

# The stack against a demo instance holding COUNT media per album.
demo count="60": (_seed count)
    #!/usr/bin/env bash
    set -euo pipefail
    export DATA_DIR="{{ demo_data }}" CACHE_DIR="{{ demo_cache }}" CONFIG_PATH="{{ demo_config }}"
    echo "Demo instance — sign in as {{ demo_user }} / {{ demo_password }} on http://localhost:5173"
    pnpm dev

# Forget the demo instance: the next `just demo` builds and seeds it again.
demo-reset:
    rm -rf "{{ demo_dir }}"

# First administrator of the instance `just dev` serves; the password is prompted.
admin username:
    pnpm create-admin {{ username }}

# Dependencies, `.env` and the built `shared`, each skipped once it is there.
[private]
_ready:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d node_modules ] || pnpm install
    if [ ! -f .env ]; then
      # Written rather than reported: the two secrets are the only fields of
      # .env.example a local instance has to fill in, and the server refuses to
      # start without them.
      sed -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" \
          -e "s|^TOKEN_KEY=.*|TOKEN_KEY=$(openssl rand -hex 32)|" \
          .env.example > .env
      echo ".env created from .env.example, with two fresh secrets."
    fi
    # `@lukarn/shared` is consumed through its dist/, not its sources: without
    # this build everything fails with ERR_MODULE_NOT_FOUND on a fresh clone.
    [ -d packages/shared/dist ] || pnpm --filter @lukarn/shared build

# The demo database, built the way an installation is: a bootstrap
# `albums.yaml` read once, by the server's own code. The alternative — a
# committed SQLite file — stops proving that a fresh install works and goes
# stale on the next migration. Nothing happens once the instance has an account,
# so `just demo` costs nothing the second time.
[private]
_instance: _ready
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ demo_data }}" "{{ demo_cache }}"
    export DATA_DIR="{{ demo_data }}" CACHE_DIR="{{ demo_cache }}" CONFIG_PATH="{{ demo_config }}"
    export DEMO_USER="{{ demo_user }}" DEMO_PASSWORD="{{ demo_password }}"
    cd packages/server
    # `--input-type=module`: without it the snippet is transpiled to CommonJS,
    # where the `await` below is a syntax error.
    pnpm exec tsx --input-type=module -e "$(cat <<'TS'
    import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
    import { dirname } from 'node:path';
    import argon2 from 'argon2';
    import { bootstrapFromYaml } from './src/bootstrap.js';
    import { ConfigRepo } from './src/config-repo.js';
    import { openDb } from './src/db.js';
    import { loadDotEnv } from './src/dotenv.js';
    import { loadEnv } from './src/env.js';

    const envFile = loadDotEnv();
    const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
    const db = openDb(env.dataDir);
    const config = new ConfigRepo(db);

    if (config.userCount() === 0) {
      if (!existsSync(env.configPath)) {
        mkdirSync(dirname(env.configPath), { recursive: true });
        // Hashed here rather than committed: a fixed argon2 hash in a repository
        // is a password, and exactly the shape of thing that gets copied into an
        // installation where that matters.
        const passwordHash = await argon2.hash(process.env.DEMO_PASSWORD, {
          type: argon2.argon2id,
        });

        writeFileSync(
          env.configPath,
          `# Written by "just demo". Read once, while this instance has no account.
    users:
      - username: ${process.env.DEMO_USER}
        passwordHash: '${passwordHash}'
        admin: true
        albums: ['*']

    albums:
      # Two albums, split differently: only a "day" album shows the notes and the
      # places the demo writes, and only a "month" one shows the other heading.
      - id: trip
        title: 'A trip'
        description: 'Corsica, July and August'
        folderId: 'demo-no-such-drive-folder'
        recursive: true
        groupBy: day
        sortOrder: desc

      - id: family
        title: 'Family photos'
        folderId: 'demo-no-such-drive-folder-either'
        recursive: true
        groupBy: month
        sortOrder: desc

    sync:
      # Nothing to synchronise: the folders above do not exist and no Drive
      # account is connected. A sync would only log its failure.
      intervalMinutes: 0
      onStartup: false

    cache:
      maxSizeGB: 2
    `,
        );
      }

      bootstrapFromYaml(config, env, {
        info: (message) => console.log(message),
        warn: (message) => console.warn(message),
      });
      // Both passes reach for the Drive account this instance does not have.
      // Off, it does nothing but answer requests.
      config.updateSettings({ prewarmCache: false, transcodeVideos: false });
    }

    db.close();
    TS
    )"

# Media in the index, renders in the cache — the command README.md documents.
# Seeding is skipped when the count has not changed: a medium is five sharp
# renders, close to a second each, and re-running `just demo` has to cost
# nothing. Raising COUNT reseeds; `just demo-reset` starts over.
[private]
_seed count: _instance
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "$(cat "{{ demo_seeded }}" 2>/dev/null || true)" = "{{ count }}" ]; then exit 0; fi
    export DATA_DIR="{{ demo_data }}" CACHE_DIR="{{ demo_cache }}" CONFIG_PATH="{{ demo_config }}"
    pnpm --filter @lukarn/server seed-demo "{{ count }}"
    echo "{{ count }}" > "{{ demo_seeded }}"
