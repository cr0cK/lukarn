import argon2 from 'argon2';
import { promptPassword } from './prompt.js';

/**
 * Produces a standalone argon2id hash.
 *
 *   pnpm hash-password              → prompts for the password without displaying it
 *   pnpm hash-password monSecret    → useful in a script, but leaves a trace in
 *                                     shell history
 *
 * Accounts are now administered from `/admin` (or `pnpm create-admin` for the first):
 * this command only prepares `passwordHash` for a bootstrapping `config/albums.yaml`.
 */
async function main(): Promise<void> {
  const fromArgs = process.argv[2];
  const password = fromArgs ?? (await promptPassword());

  if (!password) {
    console.error('Empty password, nothing to do.');
    process.exit(1);
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log(`\n  passwordHash: "${hash}"\n`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
