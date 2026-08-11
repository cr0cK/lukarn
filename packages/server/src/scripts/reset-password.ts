import { dirname } from 'node:path';
import { PASSWORD_MIN_LENGTH } from '@nonni/shared';
import argon2 from 'argon2';
import { ConfigRepo } from '../config-repo.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { SessionStore } from '../sessions.js';
import { promptPassword } from './prompt.js';

/**
 * Change le mot de passe d'un compte depuis le serveur.
 *
 *   pnpm reset-password alexis              → demande le mot de passe sans l'afficher
 *   pnpm reset-password alexis monSecret    → laisse une trace dans l'historique du shell
 *
 * Sert au seul cas que l'application ne peut pas traiter elle-même : l'unique
 * administrateur a perdu son mot de passe et ne peut donc plus atteindre
 * `/admin`. Sans cette commande, il faudrait éditer la base à la main.
 *
 * Pour tous les autres comptes, passer par `/admin` — c'est tracé et il n'y a
 * pas besoin d'un accès au serveur.
 */
async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Usage : pnpm reset-password <identifiant> [mot de passe]');
  }

  const password = process.argv[3] ?? (await promptPassword());
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Mot de passe trop court : ${PASSWORD_MIN_LENGTH} caractères au minimum.`);
  }

  const envFile = loadDotEnv();
  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);

  const stored = config.user(username);
  if (!stored) {
    db.close();
    throw new Error(
      `Aucun compte "${username}". Les comptes existants se listent depuis /admin, ` +
        'ou se créent avec `pnpm create-admin`.',
    );
  }

  config.updateUser(stored.username, {
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
  });

  // Les sessions ouvertes survivraient au changement : quelqu'un qui naviguait
  // déjà avec ce compte continuerait, alors que réinitialiser un mot de passe
  // vise précisément à reprendre la main.
  new SessionStore(db).destroyForUser(stored.username);
  db.close();

  console.log(`\n  Mot de passe de "${stored.username}" remplacé.`);
  console.log('  Ses sessions ouvertes ont été fermées.\n');
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
