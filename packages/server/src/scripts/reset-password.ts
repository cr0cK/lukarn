import { dirname } from 'node:path';
import { PASSWORD_MIN_LENGTH } from '@lukarn/shared';
import argon2 from 'argon2';
import { CommenterRepo } from '../commenters.js';
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

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  if (stored.commenterId !== null) {
    // A bound account holds no password, and `ConfigRepo` refuses to give it one: the
    // way through is to unbind, which is what this command is for when the person who
    // was that account can no longer read the address their code is sent to. It is
    // said out loud because the account stops being somebody and becomes a key again,
    // which nobody would deduce from "password replaced".
    const identity = new CommenterRepo(db).byId(stored.commenterId);
    config.unbindUser(stored.username, passwordHash);
    db.close();

    console.log(`\n  Password of "${stored.username}" replaced.`);
    console.log(`  It is no longer the person behind ${identity?.email ?? 'its address'}:`);
    console.log('  it is a shared key again, and signs no comment until somebody is invited');
    console.log('  to it once more. Its comments keep the name they were signed with.');
    console.log('  Its open sessions have been closed and its paired screens forgotten.\n');
    return;
  }

  config.updateUser(stored.username, { passwordHash });

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
