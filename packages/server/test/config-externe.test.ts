import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { ConfigRepo } from '../src/config-repo.js';
import { openDb, type Db } from '../src/db.js';

/**
 * Écritures venues d'un autre processus.
 *
 * `ConfigRepo` tient un instantané mémoire pour que `canSee()` reste une lecture
 * de `Map` — il est appelé sur chaque vignette d'une grille. Cet instantané est
 * invalidé par les écritures du dépôt lui-même, mais les commandes en ligne
 * (`reset-password`, `create-admin`) écrivent depuis un **autre** processus,
 * pendant que le serveur tourne.
 *
 * Sans détection, le serveur continuerait d'authentifier avec l'ancienne
 * empreinte jusqu'au redémarrage — ce qui viderait de son sens une commande
 * faite précisément pour reprendre la main quand on a perdu son mot de passe.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-externe-'));
after(() => rmSync(root, { recursive: true, force: true }));

let serveur: Db;
let commande: Db;
let config: ConfigRepo;

beforeEach(() => {
  serveur?.close();
  commande?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });

  // Deux connexions distinctes sur le même fichier : le serveur qui tourne, et
  // la commande lancée à côté.
  serveur = openDb(join(root, 'data'));
  commande = openDb(join(root, 'data'));
  config = new ConfigRepo(serveur);

  new ConfigRepo(commande).createUser({
    username: 'alexis',
    passwordHash: 'empreinte-initiale',
    admin: true,
    albums: ['*'],
  });
});

after(() => {
  serveur?.close();
  commande?.close();
});

describe('écriture depuis un autre processus', () => {
  it('voit un compte créé à côté', () => {
    assert.equal(config.user('alexis')?.passwordHash, 'empreinte-initiale');
  });

  it('voit un mot de passe changé à côté, sans redémarrage', () => {
    // L'instantané est chargé avant la modification : c'est le cas qui piège.
    assert.ok(config.user('alexis'));

    new ConfigRepo(commande).updateUser('alexis', { passwordHash: 'empreinte-remplacée' });

    assert.equal(config.user('alexis')?.passwordHash, 'empreinte-remplacée');
  });

  it('voit un album créé à côté', () => {
    assert.deepEqual(config.albums(), []);

    new ConfigRepo(commande).createAlbum({
      id: 'vacances',
      title: 'Vacances',
      folderId: 'dossier-1',
      recursive: true,
    });

    assert.deepEqual(
      config.albums().map((album) => album.id),
      ['vacances'],
    );
  });

  it('voit un droit retiré à côté', () => {
    const externe = new ConfigRepo(commande);
    externe.createAlbum({ id: 'prive', title: 'Privé', folderId: 'd', recursive: true });
    assert.equal(config.canSee('alexis', 'prive'), true);

    externe.updateUser('alexis', { albums: [] });

    assert.equal(config.canSee('alexis', 'prive'), false);
  });

  it('ne reconstruit pas son instantané sans raison', () => {
    // La détection ne doit pas dégrader le chemin chaud : sans écriture
    // extérieure, les lectures successives réutilisent le même instantané.
    const premier = config.albums();
    const second = config.albums();
    assert.equal(premier, second, "l'instantané doit être réutilisé tel quel");
  });
});
