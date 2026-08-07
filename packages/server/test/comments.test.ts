import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ALL_ALBUMS,
  type AlbumCommentCounts,
  type Comment,
  type CommentsPage,
  type MediaDetail,
} from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Commentaires : cloisonnement, profondeur, modération et droits de
 * suppression.
 *
 * Ces tests portent sur les invariants, pas sur la forme des payloads. Le
 * cloisonnement est le plus important : un fil appartient au couple (album,
 * média), et un album qu'on ne voit pas doit rester indistinguable d'un album
 * qui n'existe pas — y compris à travers les commentaires, qui sont un chemin
 * de lecture de plus vers le même contenu.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'gdv-comments-'));

let server: FastifyInstance;
let context: AppContext;

function media(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt: '2024-06-01T12:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2024-06-01T12:00:00.000Z',
    durationMs: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5: null,
  };
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `connexion de ${username} refusée`);
  const cookie = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(cookie, 'cookie de session absent');
  return `gdv_session=${cookie.value}`;
}

/**
 * Déclare une identité sur cette session et valide le code reçu.
 *
 * Le code n'est jamais rendu par l'API : il part par email. Le test le récupère
 * donc dans le message capturé par le faux transport, ce qui vérifie au passage
 * qu'il est bien envoyé.
 */
async function identify(cookie: string, email: string, displayName: string): Promise<void> {
  envoyes.length = 0;
  const asked = await server.inject({
    method: 'POST',
    url: '/api/identity/request-code',
    headers: { cookie },
    payload: { email, displayName },
  });
  assert.equal(asked.statusCode, 202, asked.body);
  await context.mailer.drain();

  const message = envoyes.at(-1);
  assert.ok(message, 'aucun code envoyé');
  // Le code est dans le corps, pas dans le sujet — voir D65.
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, `code introuvable dans le corps du message « ${message.subject} »`);

  const verified = await server.inject({
    method: 'POST',
    url: '/api/identity/verify',
    headers: { cookie },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
}

/** Poste un commentaire et rend l'objet créé, en vérifiant le code de retour. */
async function post(
  cookie: string,
  albumId: string,
  mediaId: string,
  body: string,
  parentId: number | null = null,
): Promise<Comment> {
  const response = await server.inject({
    method: 'POST',
    url: `/api/comments/${albumId}/${mediaId}`,
    headers: { cookie },
    payload: { body, parentId },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Comment>();
}

async function read(cookie: string, albumId: string, mediaId: string): Promise<CommentsPage> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/comments/${albumId}/${mediaId}`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<CommentsPage>();
}

let adminCookie: string;
let familleCookie: string;
/** Messages capturés : l'instance de test n'ouvre évidemment pas de SMTP. */
const envoyes: MailMessage[] = [];

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

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

  // Sans transport, aucun code ne peut partir et personne ne peut commenter :
  // c'est le comportement voulu, mais il rendrait ces tests inertes.
  context.mailer = new Mailer(async (message) => {
    envoyes.push(message);
  }, silencieux);

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'folder-vacances',
    recursive: true,
  });
  context.config.createAlbum({
    id: 'prive',
    title: 'Privé',
    folderId: 'folder-prive',
    recursive: true,
  });

  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  // Une seule clé d'accès pour tout le foyer : c'est l'usage prévu, et c'est
  // pour ça que l'identité ne peut pas venir du compte.
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['vacances'],
  });

  // La même photo Drive indexée dans les deux albums : c'est le cas qui rend le
  // cloisonnement des fils nécessaire.
  context.media.upsertMany(
    [media('vacances', 'photo-partagee'), media('prive', 'photo-partagee')],
    '2025-01-01T00:00:00.000Z',
  );

  adminCookie = await login('alexis');
  familleCookie = await login('famille');

  await identify(adminCookie, 'chef@exemple.fr', 'Alexis');
  await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('cloisonnement des fils', () => {
  it('sépare les conversations d’un même fichier indexé sous deux albums', async () => {
    await post(adminCookie, 'vacances', 'photo-partagee', 'Vu depuis les vacances');
    await post(adminCookie, 'prive', 'photo-partagee', 'Vu depuis le privé');

    const publique = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.equal(publique.total, 1);
    assert.equal(publique.threads[0]!.root.body, 'Vu depuis les vacances');
  });

  it('répond 404 sur le fil d’un album non attribué, comme pour un album inexistant', async () => {
    const interdit = await server.inject({
      method: 'GET',
      url: '/api/comments/prive/photo-partagee',
      headers: { cookie: familleCookie },
    });
    const inexistant = await server.inject({
      method: 'GET',
      url: '/api/comments/inconnu/photo-partagee',
      headers: { cookie: familleCookie },
    });

    assert.equal(interdit.statusCode, 404);
    assert.equal(inexistant.statusCode, 404);
    // Indistinguables : c'est tout l'intérêt du 404 (D12).
    assert.deepEqual(interdit.json(), inexistant.json());
  });

  it('refuse de rattacher une réponse à un fil d’un autre album', async () => {
    const ailleurs = await post(adminCookie, 'prive', 'photo-partagee', 'Racine privée');

    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      headers: { cookie: familleCookie },
      payload: { body: 'Greffe interdite', parentId: ailleurs.id },
    });

    assert.equal(response.statusCode, 404);
  });

  it('refuse un commentaire anonyme', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      payload: { body: 'Bonjour' },
    });
    assert.equal(response.statusCode, 401);
  });
});

describe('profondeur limitée à un niveau', () => {
  it('rattache la réponse d’une réponse à la racine du fil', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Réponse', racine.id);
    // On répond à la réponse : le serveur doit remonter à la racine plutôt que
    // de créer un second niveau.
    const petiteFille = await post(
      adminCookie,
      'vacances',
      'photo-partagee',
      'Réponse à la réponse',
      reponse.id,
    );

    assert.equal(reponse.parentId, racine.id);
    assert.equal(petiteFille.parentId, racine.id, 'un second niveau a été créé');

    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    const thread = page.threads.find((entry) => entry.root.id === racine.id);
    assert.ok(thread);
    assert.equal(thread.replies.length, 2);
    assert.ok(thread.replies.every((reply) => reply.parentId === racine.id));
  });
});

describe('identité de l’auteur', () => {
  it('signe du nom déclaré, pas de la clé d’accès partagée', async () => {
    const parMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Signé');
    const parAdmin = await post(adminCookie, 'vacances', 'photo-partagee', 'Signé aussi');

    assert.equal(parMamie.author.displayName, 'Mamie');
    assert.equal(parAdmin.author.displayName, 'Alexis');
  });

  it('n’expose jamais l’adresse email dans un fil', async () => {
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    // L'adresse identifie et notifie ; elle n'a pas à circuler auprès des autres
    // lecteurs du fil.
    assert.ok(!JSON.stringify(page).includes('@exemple.fr'));
  });

  it('refuse de commenter tant qu’aucune identité n’est vérifiée', async () => {
    const anonyme = await login('famille');
    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      headers: { cookie: anonyme },
      payload: { body: 'Sans identité' },
    });

    // 403 et non 404 : le refus porte sur l'état de son propre compte, pas sur
    // une ressource d'autrui dont il faudrait cacher l'existence.
    assert.equal(response.statusCode, 403);
    assert.equal(response.json<{ error: string }>().error, 'identity_required');
  });

  it('retrouve ses commentaires en se ré-identifiant avec la même adresse', async () => {
    const mien = await post(familleCookie, 'vacances', 'photo-partagee', 'À retrouver');

    // Nouvel appareil : session neuve, aucune identité.
    const autreAppareil = await login('famille');
    // Le délai anti-renvoi refuse un second code dans la minute — ce qui est
    // voulu en service, mais rendrait ce test tributaire d'une attente réelle.
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(autreAppareil, 'mamie@exemple.fr', 'Mamie');

    const page = await read(autreAppareil, 'vacances', 'photo-partagee');
    const retrouve = page.threads.find((thread) => thread.root.id === mien.id);
    assert.ok(retrouve, 'le commentaire a disparu');
    // L'adresse identifie la personne : elle garde la main sur ses messages.
    assert.equal(retrouve.root.canDelete, true);
  });

  it('ne renomme personne tant que le code n’est pas validé', async () => {
    const signe = await post(familleCookie, 'vacances', 'photo-partagee', 'Écrit par Mamie');
    assert.equal(signe.author.displayName, 'Mamie');

    // Quelqu'un d'autre derrière la même clé partagée demande un code pour
    // l'adresse de Mamie, en déclarant le nom de son choix. Le code part chez
    // elle : il ne le verra jamais.
    const usurpateur = await login('famille');
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    const demande = await server.inject({
      method: 'POST',
      url: '/api/identity/request-code',
      headers: { cookie: usurpateur },
      payload: { email: 'mamie@exemple.fr', displayName: 'Sale gosse' },
    });
    assert.equal(demande.statusCode, 202, demande.body);

    // La signature est relue à chaque requête : si la demande avait écrit le
    // nom, tout l'historique de Mamie porterait déjà celui de l'usurpateur.
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const apres = page.threads.find((thread) => thread.root.id === signe.id);
    assert.equal(apres?.root.author.displayName, 'Mamie');
  });

  it('applique le nouveau nom une fois le code validé', async () => {
    const avant = await post(familleCookie, 'vacances', 'photo-partagee', 'Avant le renommage');
    assert.equal(avant.author.displayName, 'Mamie');

    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(familleCookie, 'mamie@exemple.fr', 'Grand-mère');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const apres = page.threads.find((thread) => thread.root.id === avant.id);
    assert.equal(apres?.root.author.displayName, 'Grand-mère');

    // Remis en état : les tests suivants attendent « Mamie ».
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');
  });
});

describe('suppression', () => {
  it('laisse l’auteur supprimer son commentaire', async () => {
    const mien = await post(familleCookie, 'vacances', 'photo-partagee', 'À supprimer');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${mien.id}`,
      headers: { cookie: familleCookie },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(mien.canDelete, true);
  });

  it('refuse en 404 la suppression du commentaire d’un autre', async () => {
    const autrui = await post(adminCookie, 'vacances', 'photo-partagee', 'Pas touche');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${autrui.id}`,
      headers: { cookie: familleCookie },
    });

    assert.equal(response.statusCode, 404);
    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    assert.ok(page.threads.some((thread) => thread.root.id === autrui.id));
  });

  it('laisse un administrateur supprimer n’importe quel commentaire', async () => {
    const dUnAutre = await post(familleCookie, 'vacances', 'photo-partagee', 'Supprimé par admin');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${dUnAutre.id}`,
      headers: { cookie: adminCookie },
    });

    assert.equal(response.statusCode, 204);
  });
});

describe('modération', () => {
  it('retire un commentaire masqué de la lecture, y compris pour son auteur', async () => {
    const gênant = await post(familleCookie, 'vacances', 'photo-partagee', 'À modérer');

    const masquage = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${gênant.id}/hide`,
      headers: { cookie: adminCookie },
    });
    assert.equal(masquage.statusCode, 200);

    const vuParAuteur = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.ok(
      !vuParAuteur.threads.some((thread) => thread.root.id === gênant.id),
      'un commentaire masqué reste visible pour son auteur',
    );

    // Rendu visible, il revient — masquer est réversible, c'est ce qui distingue
    // la modération de la suppression.
    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${gênant.id}/show`,
      headers: { cookie: adminCookie },
    });
    const revenu = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.ok(revenu.threads.some((thread) => thread.root.id === gênant.id));
  });

  it('refuse la modération à un visiteur, en 403 et non en 404', async () => {
    const cible = await post(familleCookie, 'vacances', 'photo-partagee', 'Tentative');

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${cible.id}/hide`,
      headers: { cookie: familleCookie },
    });

    // L'espace d'administration est la seule exception assumée au 404 (D12).
    assert.equal(response.statusCode, 403);
  });

  it('remonte une réponse en tête de fil quand sa racine est masquée', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine à masquer');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Orpheline', racine.id);

    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${racine.id}/hide`,
      headers: { cookie: adminCookie },
    });

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const promue = page.threads.find((thread) => thread.root.id === reponse.id);
    assert.ok(promue, 'la réponse a disparu avec sa racine');
    // Elle est devenue une racine : son parent ne doit plus être annoncé.
    assert.equal(promue.root.parentId, null);
  });
});

describe('compteur servi avec le détail du média', () => {
  it('compte les commentaires visibles, réponses comprises, masqués exclus', async () => {
    const detail = await server.inject({
      method: 'GET',
      url: '/api/albums/vacances/items/photo-partagee',
      headers: { cookie: familleCookie },
    });
    assert.equal(detail.statusCode, 200);

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.equal(detail.json<MediaDetail>().commentCount, page.total);
  });
});

describe('correction dans la fenêtre qui suit la publication', () => {
  async function patch(cookie: string, id: number, body: string) {
    return server.inject({
      method: 'PATCH',
      url: `/api/comments/${id}`,
      headers: { cookie },
      payload: { body },
    });
  }

  it('accepte la correction de son auteur', async () => {
    const publie = await post(familleCookie, 'vacances', 'photo-partagee', 'Boujour');
    const corrige = await patch(familleCookie, publie.id, 'Bonjour');

    assert.equal(corrige.statusCode, 200, corrige.body);
    assert.equal(corrige.json<Comment>().body, 'Bonjour');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const relu = page.threads.find((thread) => thread.root.id === publie.id);
    assert.equal(relu?.root.body, 'Bonjour');
    // La date de publication ne bouge pas : le message doit rester à sa place
    // dans un fil que d'autres lisaient déjà.
    assert.equal(relu?.root.createdAt, publie.createdAt);
  });

  it('refuse une fois le délai passé, et le dit', async () => {
    // La fenêtre se lit sur `created_at` : antidater le commentaire la franchit
    // sans faire attendre le test trente secondes.
    const vieux = await post(familleCookie, 'vacances', 'photo-partagee', 'Trop tard');
    context.db
      .prepare('UPDATE comments SET created_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', vieux.id);

    const tentative = await patch(familleCookie, vieux.id, 'Corrigé');

    // 409 et non 404 : le refus porte sur l'état du message, pas sur un droit
    // d'accès — son auteur le voit déjà, il n'y a rien à lui cacher.
    assert.equal(tentative.statusCode, 409);
    assert.equal(tentative.json<{ error: string }>().error, 'edit_window_closed');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const inchange = page.threads.find((thread) => thread.root.id === vieux.id);
    assert.equal(inchange?.root.body, 'Trop tard');
    assert.equal(inchange?.root.canEdit, false);
  });

  it('refuse la correction du commentaire de quelqu’un d’autre', async () => {
    const dautrui = await post(adminCookie, 'vacances', 'photo-partagee', 'À moi');
    const tentative = await patch(familleCookie, dautrui.id, 'Volé');

    // 404 et non 403 : rien ne doit distinguer « pas à toi » de « n'existe pas ».
    assert.equal(tentative.statusCode, 404);

    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    assert.ok(
      page.threads.some((thread) => thread.root.body === 'À moi'),
      'le commentaire a été réécrit par quelqu’un d’autre',
    );
  });

  it('ne donne aucun privilège de réécriture à l’administrateur', async () => {
    // Modérer, c'est masquer ou supprimer. Mettre d'autres mots sous le nom de
    // quelqu'un est un pouvoir d'une autre nature.
    const deMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Mot de Mamie');
    const tentative = await patch(adminCookie, deMamie.id, 'Mot réécrit');

    assert.equal(tentative.statusCode, 404);
  });

  it('refuse un corps vide', async () => {
    const publie = await post(familleCookie, 'vacances', 'photo-partagee', 'Quelque chose');
    const vide = await patch(familleCookie, publie.id, '   ');

    assert.equal(vide.statusCode, 400);
  });

  it('n’annonce pas la correction sur le message d’un autre', async () => {
    const deMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Frais');
    const vuParAlexis = await read(adminCookie, 'vacances', 'photo-partagee');
    const trouve = vuParAlexis.threads.find((thread) => thread.root.id === deMamie.id);

    assert.equal(trouve?.root.canEdit, false);
    // Il peut en revanche le supprimer : les deux droits ne se confondent pas.
    assert.equal(trouve?.root.canDelete, true);
  });
});

describe('compteurs de tout un album', () => {
  async function counts(cookie: string, albumId: string): Promise<AlbumCommentCounts> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/comments/${albumId}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<AlbumCommentCounts>();
  }

  it('dit la même chose que le fil, photo par photo', async () => {
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const groupe = await counts(familleCookie, 'vacances');

    // L'invariant qui compte : la pastille et le fil ne peuvent pas diverger,
    // sinon on annonce des commentaires que le panneau ne montre pas.
    assert.equal(groupe.counts['photo-partagee'], page.total);
  });

  it('n’expose pas les commentaires d’un album qu’on ne voit pas', async () => {
    // `photo-partagee` est indexée dans les deux albums : si le cloisonnement
    // cédait ici, le compte de l'album privé fuirait sous la même clé.
    const groupe = await counts(familleCookie, 'vacances');
    const prive = await read(adminCookie, 'prive', 'photo-partagee');

    assert.ok(prive.total > 0, 'le fil privé est vide, le test ne prouve rien');
    assert.notEqual(groupe.counts['photo-partagee'], prive.total);

    const refus = await server.inject({
      method: 'GET',
      url: '/api/comments/prive',
      headers: { cookie: familleCookie },
    });
    assert.equal(refus.statusCode, 404);
  });

  it('omet les photos sans commentaire', async () => {
    context.media.upsertMany([media('vacances', 'photo-muette')], '2025-01-01T00:00:00.000Z');

    const groupe = await counts(familleCookie, 'vacances');
    assert.equal(groupe.counts['photo-muette'], undefined);
  });

  it('laisse passer le désabonnement malgré la route paramétrique', async () => {
    // `/:albumId` et `/unsubscribe` cohabitent sous le même préfixe. Si le
    // paramètre l'emportait, le lien des emails déjà partis répondrait 401 —
    // impossible à rattraper une fois les messages envoyés.
    const response = await server.inject({ method: 'GET', url: '/api/comments/unsubscribe' });
    assert.equal(response.statusCode, 400, 'la route sans session n’est plus atteinte');
  });
});
