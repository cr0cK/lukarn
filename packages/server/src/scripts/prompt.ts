import { createInterface } from 'node:readline/promises';

/**
 * Password input without terminal echo. Shared by `hash-password` and `create-admin`:
 * passing a password as an argument is possible but leaves it in shell history.
 */
export async function promptPassword(label = 'Mot de passe : '): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  // Disables terminal echo during input.
  const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
  const original = output._writeToOutput;
  output._writeToOutput = function (): void {
    /* nothing: the password is not displayed */
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
