import { readFileSync } from 'node:fs';
import { DEFAULT_GROUP_BY, DEFAULT_SORT_ORDER } from '@nonni/shared';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Lecture de `config/albums.yaml` : comptes, albums, droits et réglages.
 *
 * Ce fichier n'est plus la source de vérité — la base l'est, et l'application
 * s'administre depuis `/admin`. Il ne sert qu'à **amorcer** une installation
 * neuve (voir `bootstrap.ts`) : dès qu'un compte existe en base, il n'est plus
 * jamais relu. Le schéma reste donc figé sur ce que les installations
 * existantes ont pu écrire.
 */

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'lettres, chiffres, point, tiret et underscore uniquement');

const userSchema = z.object({
  username: identifier,
  /** Hash argon2id produit par `pnpm hash-password`. */
  passwordHash: z.string().startsWith('$argon2', 'doit être un hash argon2 (pnpm hash-password)'),
  admin: z.boolean().default(false),
  /** Liste d'ids d'albums, ou `["*"]` pour tous. */
  albums: z.array(z.string().min(1)).default([]),
});

const albumSchema = z.object({
  id: identifier,
  title: z.string().min(1),
  description: z.string().optional(),
  /** Id du dossier Drive : le segment après /folders/ dans son URL. */
  folderId: z.string().min(1),
  /** Descendre dans les sous-dossiers. */
  recursive: z.boolean().default(true),
  /** Découpage de la grille à l'ouverture : un séjour se lit par jour. */
  groupBy: z.enum(['month', 'day']).default(DEFAULT_GROUP_BY),
  /** Sens de lecture à l'ouverture : un séjour se lit du premier jour au dernier. */
  sortOrder: z.enum(['desc', 'asc']).default(DEFAULT_SORT_ORDER),
});

const configSchema = z
  .object({
    users: z.array(userSchema).min(1, 'au moins un utilisateur est nécessaire'),
    albums: z.array(albumSchema).min(1, 'au moins un album est nécessaire'),
    sync: z
      .object({
        intervalMinutes: z.number().int().min(0).default(30),
        /** Resynchroniser tous les albums au démarrage du serveur. */
        onStartup: z.boolean().default(true),
      })
      .default({}),
    cache: z
      .object({
        maxSizeGB: z.number().positive().default(20),
      })
      .default({}),
  })
  .superRefine((config, ctx) => {
    const albumIds = new Set(config.albums.map((a) => a.id));

    const seenAlbum = new Set<string>();
    config.albums.forEach((album, index) => {
      if (seenAlbum.has(album.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['albums', index, 'id'],
          message: `album en double : "${album.id}"`,
        });
      }
      seenAlbum.add(album.id);
    });

    const seenUser = new Set<string>();
    config.users.forEach((user, index) => {
      const key = user.username.toLowerCase();
      if (seenUser.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['users', index, 'username'],
          message: `utilisateur en double : "${user.username}"`,
        });
      }
      seenUser.add(key);

      // Une référence à un album inexistant est presque toujours une faute de
      // frappe qui prive silencieusement l'utilisateur de son accès.
      user.albums.forEach((albumId, albumIndex) => {
        if (albumId !== '*' && !albumIds.has(albumId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['users', index, 'albums', albumIndex],
            message: `album inconnu : "${albumId}"`,
          });
        }
      });
    });
  });

export type AppConfig = z.infer<typeof configSchema>;
export type ConfigUser = AppConfig['users'][number];
export type ConfigAlbum = AppConfig['albums'][number];

export function parseConfig(raw: string): AppConfig {
  let document: unknown;
  try {
    document = yaml.load(raw);
  } catch (error) {
    throw new Error(`YAML invalide : ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(document ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(racine)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return parsed.data;
}

export function loadConfig(path: string): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(
        `Fichier de configuration introuvable : ${path}\n` +
          'Copie config/albums.example.yaml vers config/albums.yaml pour démarrer.',
      );
    }
    throw error;
  }
  return parseConfig(raw);
}
