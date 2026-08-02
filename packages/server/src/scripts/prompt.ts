import { createInterface } from 'node:readline/promises';

/**
 * Saisie d'un mot de passe sans écho terminal. Partagé par `hash-password` et
 * `create-admin` : passer le mot de passe en argument est possible mais laisse
 * une trace dans l'historique du shell.
 */
export async function promptPassword(label = 'Mot de passe : '): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  // Neutralise l'écho du terminal le temps de la saisie.
  const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
  const original = output._writeToOutput;
  output._writeToOutput = function (): void {
    /* rien : le mot de passe ne s'affiche pas */
  };

  try {
    const answer = await rl.question(label);
    return answer.trim();
  } finally {
    output._writeToOutput = original;
    rl.close();
    process.stdout.write('\n');
  }
}
