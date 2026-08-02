import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';

/**
 * Produit le `passwordHash` à coller dans `config/albums.yaml`.
 *
 *   pnpm hash-password              → demande le mot de passe sans l'afficher
 *   pnpm hash-password monSecret    → utile pour un script, mais laisse une
 *                                     trace dans l'historique du shell
 */
async function main(): Promise<void> {
  const fromArgs = process.argv[2];
  const password = fromArgs ?? (await prompt());

  if (!password) {
    console.error('Mot de passe vide, rien à faire.');
    process.exit(1);
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log(`\n  passwordHash: "${hash}"\n`);
}

async function prompt(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  // Neutralise l'écho du terminal le temps de la saisie.
  const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
  const original = output._writeToOutput;
  output._writeToOutput = function (): void {
    /* rien : le mot de passe ne s'affiche pas */
  };

  try {
    const answer = await rl.question('Mot de passe : ');
    return answer.trim();
  } finally {
    output._writeToOutput = original;
    rl.close();
    process.stdout.write('\n');
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
