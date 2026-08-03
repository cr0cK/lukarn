import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Semaphore, renderConcurrencyFor } from '../src/media/semaphore.js';
import { threadPoolSize } from '../src/threadpool.js';

/**
 * Limitation des rendus simultanés.
 *
 * Sans elle, ouvrir une grille dont les vignettes ne sont pas en cache lance
 * autant de traitements que de photos visibles, chacun chargeant l'original
 * entier en mémoire. Mesuré : plus de 300 Mo pour vingt-quatre rendus, contre
 * 117 Mo une fois bridés — à débit identique.
 */

/** Promesse dont on décide du moment de résolution, pour piloter les tests. */
function differee(): { promesse: Promise<void>; resoudre: () => void } {
  let resoudre!: () => void;
  const promesse = new Promise<void>((ok) => {
    resoudre = ok;
  });
  return { promesse, resoudre };
}

describe('Semaphore', () => {
  it("n'exécute pas plus de tâches que la limite", async () => {
    const semaphore = new Semaphore(2);
    const portes = [differee(), differee(), differee(), differee()];
    let demarrees = 0;
    let maxSimultanees = 0;
    let enCours = 0;

    const taches = portes.map((porte) =>
      semaphore.run(async () => {
        demarrees++;
        enCours++;
        maxSimultanees = Math.max(maxSimultanees, enCours);
        await porte.promesse;
        enCours--;
      }),
    );

    // Laisse les tâches admises démarrer.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(demarrees, 2, 'seules deux tâches doivent avoir commencé');
    assert.equal(semaphore.enAttente, 2);

    for (const porte of portes) porte.resoudre();
    await Promise.all(taches);

    assert.equal(maxSimultanees, 2);
    assert.equal(semaphore.enCours, 0);
  });

  it('libère la place même quand la tâche échoue', async () => {
    // Sans ce filet, une suite d'erreurs — un Drive injoignable, par exemple —
    // réduirait la limite jusqu'à bloquer définitivement tous les rendus.
    const semaphore = new Semaphore(1);

    await assert.rejects(() => semaphore.run(() => Promise.reject(new Error('échec'))));
    assert.equal(semaphore.enCours, 0);

    assert.equal(await semaphore.run(() => Promise.resolve('passé')), 'passé');
  });

  it('sert les tâches dans leur ordre d’arrivée', async () => {
    // Une pile ferait attendre indéfiniment les premières vignettes d'une
    // grille pendant que les suivantes défilent devant elles.
    const semaphore = new Semaphore(1);
    const ordre: number[] = [];
    const porte = differee();

    const premiere = semaphore.run(async () => {
      await porte.promesse;
      ordre.push(0);
    });
    const suivantes = [1, 2, 3].map((n) =>
      semaphore.run(async () => {
        ordre.push(n);
      }),
    );

    porte.resoudre();
    await Promise.all([premiere, ...suivantes]);

    assert.deepEqual(ordre, [0, 1, 2, 3]);
  });

  it('refuse une limite absurde', () => {
    assert.throws(() => new Semaphore(0));
  });
});

describe('renderConcurrencyFor', () => {
  it('laisse deux cœurs au reste du service', () => {
    // Servir les fichiers en cache, l'API et la synchronisation ne doivent pas
    // attendre derrière les traitements d'images.
    assert.equal(renderConcurrencyFor(8), 4);
    assert.equal(renderConcurrencyFor(6), 4);
    assert.equal(renderConcurrencyFor(4), 2);
  });

  it('garde au moins deux places sur une machine minuscule', () => {
    // À une seule place, une photo lente retarderait toute la file derrière
    // elle, y compris des vignettes bien plus rapides.
    assert.equal(renderConcurrencyFor(1), 2);
    assert.equal(renderConcurrencyFor(2), 2);
  });

  it('ne s’emballe pas sur une grosse machine', () => {
    // Au-delà, le gain s'arrête — le décodage occupe déjà plusieurs cœurs par
    // image — alors que la mémoire, elle, continue de croître.
    assert.equal(renderConcurrencyFor(32), 4);
  });
});

describe('pool de fils', () => {
  it('est agrandi par rapport au défaut de Node', () => {
    // Quatre fils, le défaut, sont saturés par quelques rendus : une vignette
    // déjà en cache attend alors derrière eux, mesurée à 2 s au 95e centile.
    assert.ok(threadPoolSize >= 8, `pool trop petit : ${threadPoolSize}`);
    assert.equal(process.env.UV_THREADPOOL_SIZE, String(threadPoolSize));
  });
});
