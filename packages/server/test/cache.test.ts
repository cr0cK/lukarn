import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { MediaCache } from '../src/media/cache.js';

const root = mkdtempSync(join(tmpdir(), 'gdv-cache-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Laisse l'éviction asynchrone se terminer avant d'observer le cache. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe('cache disque', () => {
  it('rend une entrée écrite et rate sur une clé inconnue', async () => {
    const cache = new MediaCache(join(root, 'basic'), 1024 * 1024);
    await cache.load();

    assert.equal(cache.hit('a:t320'), null);
    const path = await cache.put('a:t320', Buffer.alloc(64, 1));

    assert.ok(existsSync(path));
    assert.equal(cache.hit('a:t320'), path);
    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 64);
  });

  it('retrouve ses entrées après un redémarrage', async () => {
    const dir = join(root, 'reload');
    const first = new MediaCache(dir, 1024 * 1024);
    await first.load();
    await first.put('photo:t640', Buffer.alloc(128, 2));

    const second = new MediaCache(dir, 1024 * 1024);
    await second.load();

    assert.equal(second.stats().entryCount, 1);
    assert.equal(second.stats().bytes, 128);
    assert.ok(second.hit('photo:t640'));
  });

  it('évince les entrées les moins récemment utilisées', async () => {
    // Limite volontairement basse : 4 entrées de 100 o suffisent à la dépasser.
    const cache = new MediaCache(join(root, 'lru'), 300);
    await cache.load();

    await cache.put('vieux', Buffer.alloc(100, 1));
    await cache.put('moyen', Buffer.alloc(100, 2));
    await cache.put('recent', Buffer.alloc(100, 3));

    // Remet « vieux » en tête de la file d'usage : c'est « moyen » qui doit
    // partir en premier, pas lui.
    cache.hit('vieux');

    await cache.put('nouveau', Buffer.alloc(100, 4));
    await settle();

    assert.ok(cache.stats().bytes <= 300, 'la limite doit être respectée');
    assert.ok(cache.hit('nouveau'), 'la dernière écriture doit survivre');
    assert.equal(cache.hit('moyen'), null, 'la moins récemment utilisée doit partir');
  });

  it('remplace une entrée sans compter sa taille deux fois', async () => {
    const cache = new MediaCache(join(root, 'replace'), 1024 * 1024);
    await cache.load();

    await cache.put('k', Buffer.alloc(100, 1));
    await cache.put('k', Buffer.alloc(250, 2));

    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 250);
  });

  it('se vide entièrement', async () => {
    const cache = new MediaCache(join(root, 'clear'), 1024 * 1024);
    await cache.load();
    await cache.put('k', Buffer.alloc(100, 1));

    await cache.clear();

    assert.equal(cache.stats().entryCount, 0);
    assert.equal(cache.stats().bytes, 0);
    assert.equal(cache.hit('k'), null);
  });

  it('range un fichier déjà écrit sans le charger en mémoire', async () => {
    const dir = join(root, 'putfile');
    const cache = new MediaCache(dir, 1024 * 1024);
    await cache.load();

    const source = join(dir, 'sortie.tmp');
    writeFileSync(source, Buffer.alloc(4096, 7));

    const path = await cache.putFile('clip:empreinte', source);

    assert.ok(existsSync(path));
    // Déplacé, pas copié : un dérivé vidéo pèse des dizaines de Mo, le laisser
    // derrière doublerait la place occupée.
    assert.equal(existsSync(source), false);
    assert.equal(cache.hit('clip:empreinte'), path);
    assert.equal(cache.stats().bytes, 4096);
  });

  it('évince aussi ce qui est entré par renommage', async () => {
    const dir = join(root, 'putfile-lru');
    const cache = new MediaCache(dir, 300);
    await cache.load();

    for (const nom of ['vieux', 'moyen', 'recent', 'nouveau']) {
      const source = join(dir, `${nom}.tmp`);
      writeFileSync(source, Buffer.alloc(100, 1));
      await cache.putFile(nom, source);
    }
    await settle();

    // La taille est comptée à l'entrée : sans ça, le magasin grossirait sans
    // limite et le budget des vidéos ne voudrait rien dire.
    assert.ok(cache.stats().bytes <= 300, 'la limite doit être respectée');
    assert.equal(cache.hit('vieux'), null, 'la moins récemment utilisée doit partir');
    assert.ok(cache.hit('nouveau'), 'la dernière écriture doit survivre');
  });

  it('n’inventorie ni ne vide ce qui n’est pas à lui', async () => {
    // Le magasin vidéo vit sous `CACHE_DIR/video` : un cache qui compterait ses
    // octets dans son budget les évincerait, et « vider le cache » depuis
    // /admin emporterait des heures de transcodage avec les vignettes.
    const dir = join(root, 'voisin');
    const cache = new MediaCache(dir, 1024 * 1024);
    await cache.load();
    await cache.put('vignette', Buffer.alloc(100, 1));

    const voisin = join(dir, 'video');
    mkdirSync(join(voisin, 'ab'), { recursive: true });
    const etranger = join(voisin, 'ab', 'film.bin');
    writeFileSync(etranger, Buffer.alloc(9000, 2));

    const relu = new MediaCache(dir, 1024 * 1024);
    await relu.load();
    assert.equal(relu.stats().bytes, 100, 'seul son propre rayon est inventorié');

    await relu.clear();
    assert.ok(existsSync(etranger), 'le magasin voisin doit survivre au vidage');
  });

  it("épargne une entrée réclamée pendant que l'éviction tourne", async () => {
    const cache = new MediaCache(join(root, 'lru-course'), 300);
    await cache.load();

    await cache.put('a', Buffer.alloc(100, 1));
    await cache.put('b', Buffer.alloc(100, 2));
    await cache.put('c', Buffer.alloc(100, 3));

    // La quatrième écriture dépasse la limite et lance l'éviction, qui a déjà
    // figé son ordre — « a » puis « b » — quand la ligne suivante s'exécute.
    await cache.put('d', Buffer.alloc(100, 4));

    // Une requête réclame « b » à cet instant précis. Elle va en lire le
    // fichier : le supprimer maintenant lui rendrait un ENOENT.
    const reclame = cache.hit('b');
    assert.ok(reclame, 'la mise en scène suppose que « b » est encore là');

    await settle();

    assert.ok(cache.stats().bytes <= 300, 'la limite doit rester respectée');
    assert.ok(cache.hit('b'), 'une entrée réclamée pendant l’éviction doit survivre');
    assert.ok(existsSync(reclame), 'son fichier doit exister quand on va le lire');
  });

  it('poursuit son ménage quand une suppression échoue', async () => {
    const avertissements: string[] = [];
    const cache = new MediaCache(join(root, 'rm-ko'), 300, {
      warn: (msg) => avertissements.push(msg),
    });
    await cache.load();

    // Un répertoire à la place du fichier : `rm` le refuse, comme le ferait un
    // volume remonté en lecture seule ou une erreur d'E/S.
    const bloque = await cache.put('bloque', Buffer.alloc(100, 1));
    rmSync(bloque);
    mkdirSync(join(bloque, 'occupe'), { recursive: true });

    await cache.put('b', Buffer.alloc(100, 2));
    await cache.put('c', Buffer.alloc(100, 3));
    await cache.put('d', Buffer.alloc(100, 4));

    await settle();

    // Sans traitement de l'échec, l'éviction s'arrêtait sur « bloque » : rien
    // n'était libéré et le rejet non géré pouvait terminer le process.
    assert.equal(cache.hit('b'), null, 'les entrées suivantes doivent partir quand même');
    assert.ok(avertissements.length > 0, "l'échec doit être journalisé");
    // L'entrée récalcitrante reste inventoriée : son fichier est toujours là.
    assert.ok(cache.hit('bloque'), "l'inventaire doit continuer de décrire le disque");
  });
});
