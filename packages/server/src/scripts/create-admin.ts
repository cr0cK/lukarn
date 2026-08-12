import { dirname } from 'node:path';
import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from '@lukarn/shared';
import argon2 from 'argon2';
import { ConfigRepo } from '../config-repo.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { promptPassword } from './prompt.js';

/**
 * Creates the first administrator of a new installation when neither a database
 * account nor `config/albums.yaml` exists to bootstrap it.
 *
 *   pnpm create-admin alexis              → prompts for the password without displaying it
 *   pnpm create-admin alexis monSecret    → leaves a trace in shell history
 *
 * This is the only entry point outside the application; everything else is administered
 * from `/admin`.
 */
async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Usage: pnpm create-admin <username> [password]');
  }
  if (username.length > USERNAME_MAX_LENGTH || !USERNAME_PATTERN.test(username)) {
    throw new Error(
      `Invalid username: letters, digits, dot, dash and underscore only, ` +
        `${USERNAME_MAX_LENGTH} characters at most.`,
    );
  }

  const password = process.argv[3] ?? (await promptPassword());
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password too short: ${PASSWORD_MIN_LENGTH} characters minimum.`);
  }

  const envFile = loadDotEnv();
  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);

  if (config.user(username)) {
    db.close();
    throw new Error(
      `Account "${username}" already exists. Edit it from /admin, or pick another username.`,
    );
  }

  // The wildcard lets this administrator see albums they create now and later.
  // Without it, they would administer albums they cannot open — `admin` grants no
  // album by itself.
  config.createUser({
    username,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    admin: true,
    albums: [ALL_ALBUMS],
  });
  db.close();

  console.log(`\n  Administrator "${username}" created, with access to every album.`);
  console.log('  Sign in, then create your albums from /admin.\n');
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
