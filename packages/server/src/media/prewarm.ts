import type { MediaRepo } from '../repo.js';
import type { MediaCache } from './cache.js';
import type { MediaRenderer } from './renderer.js';

/**
 * Rend les photos avant qu'on les ouvre.
 *
 * Le constat qui le justifie : une photo jamais ouverte coûte environ trois
 * secondes et demie au premier clic — deux de téléchargement Drive, une et
 * demie de décodage et d'encodage WebP — contre cinq millisecondes une fois en
 * cache. Le préchauffage déplace cette attente hors de la présence de
 * quelqu'un ; il ne consomme pas plus de quota Drive, il le consomme plus tôt.
 *
 * Trois précautions le rendent acceptable, et ce sont elles qui expliquent sa
 * lenteur volontaire — voir D45.
 */

/**
 * Une seule photo à la fois. Le limiteur de rendu a quatre places : en
 * n'occupant jamais qu'une seule, le préchauffage laisse toujours passer
 * quelqu'un qui navigue.
 */
const PAUSE_MS = 1_000;

/**
 * Part du cache que le préchauffage s'autorise à occuper. L'éviction est LRU
 * **globale**, pas par album : remplir le cache de rendus pleine page
 * (~1 Mo pièce) évincerait les vignettes de la grille (~15 Ko), c'est-à-dire ce
 * qu'on regarde le plus, pour des photos que personne n'a demandées.
 */
const BUDGET_RATIO = 0.7;

/**
 * Rendus par passage. Le ménage est horaire : au-delà, un passage empiéterait
 * sur le suivant sans rien apporter, l'album se remplissant de toute façon
 * heure après heure.
 */
const MAX_PER_RUN = 400;

/** Photos lues d'un coup dans l'index. Bornée : `listItems` est synchrone. */
const PAGE_SIZE = 200;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface PrewarmDeps {
  /** Relu à chaque passage : un album créé depuis le démarrage compte aussi. */
  albums: () => { id: string }[];
  media: MediaRepo;
  cache: MediaCache;
  renderer: MediaRenderer;
  /** Lu à chaque passage : couper le réglage doit arrêter le passage en cours. */
  enabled: () => boolean;
  log: Logger;
}

export interface PrewarmResult {
  rendered: number;
  skipped: number;
  failed: number;
  stopped: 'termine' | 'budget' | 'plafond' | 'arret';
}

export class CachePrewarmer {
  private running = false;
  private stopping = false;

  constructor(private readonly deps: PrewarmDeps) {}

  /** Demande l'arrêt du passage en cours. Appelé à l'extinction du serveur. */
  stop(): void {
    this.stopping = true;
  }

  /**
   * Un passage, du plus récent au plus ancien.
   *
   * L'ordre n'est pas cosmétique : ce sont les photos des derniers albums qu'on
   * ouvre, et le LRU purgera les anciennes de lui-même. Préchauffer dans
   * l'ordre chronologique reviendrait à remplir le cache de ce que personne ne
   * regarde plus.
   */
  async run(): Promise<PrewarmResult> {
    const result: PrewarmResult = { rendered: 0, skipped: 0, failed: 0, stopped: 'termine' };

    // Deux passages concurrents doubleraient l'occupation du limiteur et le
    // débit vers Drive, ce que toute la conception cherche à éviter.
    if (this.running || !this.deps.enabled()) return result;
    this.running = true;
    this.stopping = false;

    try {
      for (const album of this.deps.albums()) {
        let cursor: string | null = null;

        do {
          const page = this.deps.media.listItems(album.id, PAGE_SIZE, cursor, 'desc');
          cursor = page.nextCursor;

          for (const item of page.items) {
            if (this.stopping) return { ...result, stopped: 'arret' };
            if (!this.deps.enabled()) return { ...result, stopped: 'arret' };
            if (result.rendered >= MAX_PER_RUN) return { ...result, stopped: 'plafond' };

            const { bytes, maxBytes } = this.deps.cache.stats();
            if (bytes >= maxBytes * BUDGET_RATIO) return { ...result, stopped: 'budget' };

            // Les vidéos n'ont pas de rendu, et `hd` ne sert qu'au zoom : seule
            // la variante du premier clic vaut d'être payée d'avance.
            if (item.kind !== 'photo') continue;

            const md5 = this.deps.media.getFileMeta(item.id)?.md5 ?? null;
            if (this.deps.renderer.isCached(item.id, { kind: 'full' }, md5)) {
              result.skipped++;
              continue;
            }

            try {
              await this.deps.renderer.render(item.id, { kind: 'full' }, md5);
              result.rendered++;
            } catch (error) {
              // Un fichier illisible ou un refus de Drive ne doit pas arrêter
              // le passage : les photos suivantes n'y sont pour rien, et le
              // prochain tour réessaiera celle-ci.
              result.failed++;
              this.deps.log.debug(
                `Préchauffage de ${item.id} en échec : ${(error as Error).message}`,
              );
            }

            await this.wait(PAUSE_MS);
          }
        } while (cursor !== null);
      }

      return result;
    } finally {
      this.running = false;
      if (result.rendered > 0 || result.failed > 0) {
        this.deps.log.info(
          `Préchauffage : ${result.rendered} rendus, ${result.skipped} déjà en cache, ` +
            `${result.failed} en échec (${result.stopped})`,
        );
      }
    }
  }

  /**
   * `protected` pour la même raison que dans `DriveService` : c'est la couture
   * qui permet aux tests de vérifier le rythme sans le subir.
   */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
