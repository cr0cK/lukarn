import argon2 from 'argon2';
import { promptPassword } from './prompt.js';

/**
 * Produit une empreinte argon2id isolée.
 *
 *   pnpm hash-password              → demande le mot de passe sans l'afficher
 *   pnpm hash-password monSecret    → utile pour un script, mais laisse une
 *                                     trace dans l'historique du shell
 *
 * Les comptes s'administrent désormais depuis `/admin` (ou `pnpm create-admin`
 * pour le tout premier) : cette commande ne sert plus qu'à préparer le
 * `passwordHash` d'un `config/albums.yaml` d'amorçage.
 */
async function main(): Promise<void> {
  const fromArgs = process.argv[2];
  const password = fromArgs ?? (await promptPassword());

  if (!password) {
    console.error('Mot de passe vide, rien à faire.');
    process.exit(1);
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log(`\n  passwordHash: "${hash}"\n`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
