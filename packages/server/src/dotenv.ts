import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Charge le `.env` de la racine du dépôt.
 *
 * Node sait lire un `.env` nativement, mais seulement relatif au répertoire
 * courant : un script lancé depuis `packages/server` ne le trouverait pas. On
 * remonte donc l'arborescence depuis le cwd puis depuis ce module.
 *
 * L'absence de fichier n'est pas une erreur — en conteneur, les variables
 * viennent de l'environnement.
 */
export function loadDotEnv(): string | null {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];

  for (const start of starts) {
    let directory = resolve(start);

    while (true) {
      const candidate = join(directory, '.env');
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return candidate;
      }

      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return null;
}
