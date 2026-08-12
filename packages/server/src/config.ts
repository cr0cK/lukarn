import { readFileSync } from 'node:fs';
import { DEFAULT_GROUP_BY, DEFAULT_SORT_ORDER } from '@lukarn/shared';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Reads `config/albums.yaml`: accounts, albums, permissions and settings.
 *
 * This file is no longer the source of truth — the database is, and the application
 * is administered from `/admin`. It is only used to **bootstrap** a new installation
 * (see `bootstrap.ts`): as soon as an account exists in the database, it is never
 * read again. The schema therefore remains fixed to what existing installations
 * may have written.
 */

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'letters, digits, dot, hyphen and underscore only');

const userSchema = z.object({
  username: identifier,
  /** argon2id hash produced by `pnpm hash-password`. */
  passwordHash: z.string().startsWith('$argon2', 'must be an argon2 hash (pnpm hash-password)'),
  admin: z.boolean().default(false),
  /** List of album IDs, or `["*"]` for all of them. */
  albums: z.array(z.string().min(1)).default([]),
});

const albumSchema = z.object({
  id: identifier,
  title: z.string().min(1),
  description: z.string().optional(),
  /** Drive folder ID: the segment after /folders/ in its URL. */
  folderId: z.string().min(1),
  /** Descend into subfolders. */
  recursive: z.boolean().default(true),
  /** Grid grouping on opening: a trip is read day by day. */
  groupBy: z.enum(['month', 'day']).default(DEFAULT_GROUP_BY),
  /** Reading order on opening: a trip is read from its first day to its last. */
  sortOrder: z.enum(['desc', 'asc']).default(DEFAULT_SORT_ORDER),
});

const configSchema = z
  .object({
    users: z.array(userSchema).min(1, 'at least one user is required'),
    albums: z.array(albumSchema).min(1, 'at least one album is required'),
    sync: z
      .object({
        intervalMinutes: z.number().int().min(0).default(30),
        /** Resynchronise all albums when the server starts. */
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
          message: `duplicate album: "${album.id}"`,
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
          message: `duplicate user: "${user.username}"`,
        });
      }
      seenUser.add(key);

      // A reference to a non-existent album is almost always a typo that silently
      // deprives the user of access.
      user.albums.forEach((albumId, albumIndex) => {
        if (albumId !== '*' && !albumIds.has(albumId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['users', index, 'albums', albumIndex],
            message: `unknown album: "${albumId}"`,
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
    throw new Error(`Invalid YAML: ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(document ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(racine)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
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
        `Configuration file not found: ${path}\n` +
          'Copy config/albums.example.yaml to config/albums.yaml to get started.',
      );
    }
    throw error;
  }
  return parseConfig(raw);
}
