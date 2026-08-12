import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the `.env` file from the repository root.
 *
 * Node can read a `.env` file natively, but only relative to the current
 * directory: a script launched from `packages/server` would not find it. The
 * directory tree is therefore searched upwards from the cwd and then from this
 * module.
 *
 * A missing file is not an error — in a container, the variables come from the
 * environment.
 */
export function loadDotEnv(): string | null {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];

  for (const start of starts) {
    let directory = resolve(start);

    while (true) {
      const candidate = join(directory, '.env');
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return candidate;
      }

      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return null;
}
