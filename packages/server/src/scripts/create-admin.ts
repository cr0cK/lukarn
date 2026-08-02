import { dirname } from 'node:path';
import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from '@gdv/shared';
import argon2 from 'argon2';
import { ConfigRepo } from '../config-repo.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { promptPassword } from './prompt.js';

/**
 * Crée le premier administrateur d'une installation neuve, quand il n'y a ni
 * compte en base ni `config/albums.yaml` pour l'amorcer.
 *
 *   pnpm create-admin alexis              → demande le mot de passe sans l'afficher
 *   pnpm create-admin alexis monSecret    → laisse une trace dans l'historique du shell
 *
 * C'est la seule porte d'entrée hors application : tout le reste s'administre
 * depuis `/admin`.
 */
async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Usage : pnpm create-admin <identifiant> [mot de passe]');
  }
  if (username.length > USERNAME_MAX_LENGTH || !USERNAME_PATTERN.test(username)) {
    throw new Error(
      `Identifiant invalide : lettres, chiffres, point, tiret et underscore uniquement, ` +
        `${USERNAME_MAX_LENGTH} caractères au plus.`,
    );
  }

  const password = process.argv[3] ?? (await promptPassword());
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Mot de passe trop court : ${PASSWORD_MIN_LENGTH} caractères au minimum.`);
  }

  const envFile = loadDotEnv();
  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);

  if (config.user(username)) {
    db.close();
    throw new Error(
      `Le compte "${username}" existe déjà. Modifie-le depuis /admin, ou choisis un autre identifiant.`,
    );
  }

  // Le joker : cet administrateur voit les albums qu'il va créer, y compris
  // ceux d'après. Sans lui, il administrerait des albums qu'il ne peut pas
  // ouvrir — `admin` n'accorde aucun album par lui-même.
  config.createUser({
    username,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    admin: true,
    albums: [ALL_ALBUMS],
  });
  db.close();

  console.log(`\n  Administrateur "${username}" créé, avec accès à tous les albums.`);
  console.log('  Connecte-toi, puis crée tes albums depuis /admin.\n');
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
