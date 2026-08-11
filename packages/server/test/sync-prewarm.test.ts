import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';

/**
 * Une synchronisation prépare les vignettes de ce qu'elle vient d'indexer, et
 * nomme les journées que ses photos géolocalisées permettent de nommer.
 *
 * C'est le seul moment où l'instance sait qu'il y a du neuf, et le neuf est
 * précisément ce qu'on ouvre. Sans cet enchaînement, un album fraîchement
 * synchronisé reste froid jusqu'au ménage horaire : sa grille demande une
 * plusieurs dizaines de vignettes d'un coup, le serveur n'en rend que deux à
 * quatre à la fois selon les cœurs, et chacune commence par un téléchargement
 * Drive de deux secondes. Les lieux ont le même défaut sous une autre forme :
 * l'en-tête d'une journée resterait muet une heure alors que l'EXIF qu'on vient
 * d'indexer dit déjà où elle s'est passée (D91).
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-sync-prewarm-'));

let server: FastifyInstance;
let context: AppContext;
let cookie: string;

before(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: join(root, 'albums-absent.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createUser({
    username: 'patron',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: ['*'],
  });
  context.config.createAlbum({ id: 'vacances', title: 'Vacances', folderId: 'dossier-1' });

  // La route refuse de synchroniser sans Drive : c'est la seule chose qu'on
  // simule, tout le reste du chemin est le vrai.
  Object.defineProperty(context.drive, 'connected', { get: () => true });

  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'patron', password: PASSWORD },
  });
  cookie = `nonni_session=${response.cookies.find((c) => c.name === 'nonni_session')!.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

/** Remplace les trois collaborateurs et note l'ordre dans lequel ils sont appelés. */
function espionner(): string[] {
  const ordre: string[] = [];
  const remplacable = context as unknown as {
    syncer: { syncAll: (albums: unknown[]) => Promise<unknown[]> };
    prewarmer: { run: () => Promise<unknown> };
    places: { run: () => Promise<unknown> };
  };
  remplacable.syncer = {
    syncAll: async () => {
      ordre.push('sync');
      await Promise.resolve();
      return [];
    },
  };
  remplacable.prewarmer = {
    run: () => {
      ordre.push('prechauffage');
      return Promise.resolve({});
    },
  };
  remplacable.places = {
    run: () => {
      ordre.push('lieux');
      return Promise.resolve({});
    },
  };
  return ordre;
}

describe('synchronisation puis préchauffage', () => {
  it('préchauffe après la sync, jamais avant', async () => {
    const ordre = espionner();

    await context.syncThenPrewarm([]);

    // L'ordre est le fond du sujet : préchauffer d'abord passerait sur l'index
    // d'avant, c'est-à-dire sur tout sauf les photos qui viennent d'arriver.
    // Les lieux s'intercalent parce qu'ils sont détachés — le préchauffage
    // n'attend pas leur géocodage, qui dure des minutes.
    assert.deepEqual(ordre, ['sync', 'lieux', 'prechauffage']);
  });

  it('déduit les lieux des photos qui viennent d’arriver', async () => {
    const ordre = espionner();

    await context.syncThenPrewarm([]);

    // Le cas qui motive le déclencheur : on verse dans le Drive des photos
    // géolocalisées, et la journée porte son lieu sans attendre le ménage
    // horaire. Les lieux après la sync et jamais avant, pour la même raison que
    // le préchauffage : avant, ils agrégeraient les positions d'hier.
    assert.equal(ordre.indexOf('lieux'), ordre.indexOf('sync') + 1);
  });

  it('une resynchronisation demandée depuis /admin y passe aussi', async () => {
    const ordre = espionner();

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/resync',
      headers: { cookie },
      payload: {},
    });
    assert.equal(response.statusCode, 202);

    // Le déclenchement est en tâche de fond : la réponse part avant la fin.
    await new Promise((resolve) => setImmediate(resolve));

    // Le cas qui a motivé tout ça : on crée un album, on le synchronise depuis
    // /admin, et on l'ouvre dans la foulée. Une route qui appellerait `syncer`
    // en direct rendrait cet album froid sans que rien ne le signale.
    assert.deepEqual(ordre, ['sync', 'lieux', 'prechauffage']);
  });
});
