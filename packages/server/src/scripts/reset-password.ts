import { dirname } from 'node:path';
import { PASSWORD_MIN_LENGTH } from '@lukarn/shared';
import argon2 from 'argon2';
import { ConfigRepo } from '../config-repo.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { SessionStore } from '../sessions.js';
import { promptPassword } from './prompt.js';

/**
 * Changes an account password from the server.
 *
 *   pnpm reset-password alexis              → prompts for the password without displaying it
 *   pnpm reset-password alexis monSecret    → leaves a trace in shell history
 *
 * Handles the one case the application cannot: the sole administrator lost their
 * password and can no longer reach `/admin`. Without this command, the database would
 * need manual editing.
 *
 * For every other account, use `/admin` — it is audited and requires no server access.
 */
async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Usage: pnpm reset-password <username> [password]');
  }

  const password = process.argv[3] ?? (await promptPassword());
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password too short: ${PASSWORD_MIN_LENGTH} characters minimum.`);
  }

  const envFile = loadDotEnv();
  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);

  const stored = config.user(username);
  if (!stored) {
    db.close();
    throw new Error(
      `No account "${username}". Existing accounts are listed from /admin, ` +
        'or are created with `pnpm create-admin`.',
    );
  }

  config.updateUser(stored.username, {
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
  });

  // Open sessions would survive the change: someone already browsing with the account
  // would continue, while password reset specifically aims to regain control.
  new SessionStore(db).destroyForUser(stored.username);
  db.close();

  console.log(`\n  Password of "${stored.username}" replaced.`);
  console.log('  Its open sessions have been closed.\n');
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
