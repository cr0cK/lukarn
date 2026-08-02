import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import type { ConfigRepo } from './config-repo.js';
import type { Env } from './env.js';

export interface BootstrapLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Amorçage d'une installation neuve depuis `config/albums.yaml`.
 *
 * La base fait autorité : ce fichier n'est lu **que** tant qu'aucun compte
 * n'existe. Dès qu'il y en a un, le YAML est ignoré pour toujours — sinon une
 * modification faite dans l'application serait écrasée au redémarrage suivant
 * par un fichier resté figé.
 *
 * C'est aussi le chemin de mise à jour d'une instance en service : au premier
 * démarrage après la migration, ses comptes, albums, droits et réglages sont
 * repris tels quels du fichier qu'elle utilisait déjà. Rien n'est réindexé,
 * l'index média et le jeton OAuth ne sont pas touchés.
 */
export function bootstrapFromYaml(config: ConfigRepo, env: Env, log: BootstrapLogger): void {
  if (config.userCount() > 0) return;

  if (!existsSync(env.configPath)) {
    log.warn(
      `Aucun compte en base et aucun fichier ${env.configPath} : ` +
        'crée le premier administrateur avec « pnpm create-admin <identifiant> », ' +
        'puis connecte-toi sur /admin.',
    );
    return;
  }

  // Un fichier présent mais invalide fait échouer le démarrage, comme avant :
  // laisser passer donnerait une instance sans aucun compte, donc inutilisable,
  // alors que la faute de frappe est sous les yeux de l'installateur.
  const yaml = loadConfig(env.configPath);

  config.seed({
    albums: yaml.albums.map((album) => ({
      id: album.id,
      title: album.title,
      description: album.description ?? null,
      folderId: album.folderId,
      recursive: album.recursive,
    })),
    users: yaml.users.map((user) => ({
      username: user.username,
      passwordHash: user.passwordHash,
      admin: user.admin,
      albums: user.albums,
    })),
    settings: {
      syncIntervalMinutes: yaml.sync.intervalMinutes,
      syncOnStartup: yaml.sync.onStartup,
      cacheMaxSizeGB: yaml.cache.maxSizeGB,
    },
  });

  log.info(
    `Configuration amorcée depuis ${env.configPath} : ` +
      `${yaml.users.length} compte(s), ${yaml.albums.length} album(s). ` +
      "Le fichier ne sera plus relu : l'administration se fait désormais depuis /admin.",
  );
}
