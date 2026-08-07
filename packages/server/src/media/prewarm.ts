import { THUMB_SIZES } from '@gdv/shared';
import type { MediaRepo } from '../repo.js';
import type { MediaCache } from './cache.js';
import type { MediaRenderer, Variant } from './renderer.js';

/**
 * Prépare les vignettes des photos avant qu'on ouvre l'album.
 *
 * Le constat qui le justifie : une photo jamais rendue coûte environ deux
 * secondes au premier affichage — presque tout en téléchargement de l'original
 * depuis Drive, le rendu d'une vignette étant négligeable devant lui — contre
 * cinq millisecondes une fois en cache. Une grille froide en demande plusieurs
 * dizaines d'un coup, et le limiteur n'en sert que deux à quatre à la fois selon
 * le nombre de cœurs : l'album met alors des dizaines de secondes à s'afficher.
 * Le préchauffage déplace cette attente hors de la présence de quelqu'un ; il ne
 * consomme pas plus de quota Drive, il le consomme plus tôt.
 *
 * Les précautions qui le rendent acceptable expliquent sa lenteur volontaire —
 * voir D45.
 */

/**
 * Ce que le préchauffage prépare : les trois tailles de vignette, et **rien
 * d'autre**.
 *
 * C'est la grille qui fait attendre, et elle ne demande que celles-ci — laquelle
 * dépend de la largeur de la case et de la densité de l'écran, donc les trois
 * doivent être prêtes. Le rendu pleine page ne vient jamais ici : il pèse une
 * dizaine de fois une vignette et le préchargement des voisines dans la
 * visionneuse couvre déjà le feuilletage.
 */
const VARIANTS: Variant[] = THUMB_SIZES.map((size) => ({ kind: 'thumb', size }));

/**
 * Une seule photo à la fois. Le limiteur de rendu a deux à quatre places : en
 * n'occupant jamais qu'une seule, le préchauffage laisse toujours passer
 * quelqu'un qui navigue.
 */
const PAUSE_MS = 1_000;

/**
 * Part du cache que le préchauffage s'autorise à occuper. L'éviction est LRU
 * **globale**, pas par album : sans cette part réservée, préparer un album
 * entier évincerait les vignettes des albums qu'on regarde vraiment.
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

            // Les vidéos n'ont pas de rendu image.
            if (item.kind !== 'photo') continue;

            const md5 = this.deps.media.getFileMeta(item.id)?.md5 ?? null;

            try {
              // Les trois tailles en un seul téléchargement : c'est lui qui
              // coûte, et le payer une fois par variante triplerait le trafic
              // Drive comme la durée du passage.
              const produits = await this.deps.renderer.prepare(item.id, VARIANTS, md5);
              // Rien à faire : la photo était déjà prête, et la pause n'a pas
              // lieu d'être — sans quoi un album déjà préchauffé occuperait un
              // passage entier à ne rien faire, une seconde par photo.
              if (produits === 0) {
                result.skipped++;
                continue;
              }
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
