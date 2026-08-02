import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface CacheStats {
  entryCount: number;
  bytes: number;
  maxBytes: number;
}

interface Entry {
  size: number;
  /** Horodatage du dernier accès, tenu en mémoire — `atime` n'est pas fiable
   *  sur un montage `relatime`, qui est le défaut sur la plupart des VPS. */
  lastAccess: number;
  /**
   * Estampille strictement croissante, réattribuée à chaque accès. L'éviction
   * relève celle des entrées qu'elle s'apprête à supprimer, puis la recompare
   * juste avant le `rm` : c'est le seul moyen de savoir qu'une entrée a été
   * touchée entre-temps. `lastAccess` ne suffirait pas — deux accès dans la
   * même milliseconde laissent la même valeur.
   */
  stamp: number;
}

/** Ce que le cache a besoin de dire, et rien de plus. */
interface CacheLogger {
  warn: (msg: string) => void;
}

const SILENT: CacheLogger = { warn: () => {} };

/**
 * Cache disque des dérivés d'images (vignettes et rendus pleine largeur).
 * Chaque entrée est un fichier ; l'inventaire des tailles est tenu en mémoire
 * pour décider des évictions sans re-parcourir l'arborescence.
 *
 * Il n'est jamais nécessaire d'invalider une entrée : la clé contient l'id du
 * fichier Drive, qui change lorsque le fichier est remplacé.
 */
export class MediaCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private evicting: Promise<void> | null = null;
  /** Source des estampilles d'accès. Jamais remise à zéro de tout le process. */
  private clock = 0;

  constructor(
    private readonly root: string,
    private maxBytes: number,
    private readonly log: CacheLogger = SILENT,
  ) {}

  /**
   * Nouvelle limite de taille, appliquée à chaud depuis les réglages. Une
   * limite abaissée déclenche l'éviction tout de suite plutôt qu'à la
   * prochaine écriture : c'est justement quand on veut récupérer de la place
   * qu'on abaisse la limite.
   */
  setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
    this.evictInBackground();
  }

  /** Reconstruit l'inventaire à partir du disque. À appeler au démarrage. */
  async load(): Promise<void> {
    this.entries.clear();
    this.bytes = 0;
    await mkdir(this.root, { recursive: true });
    await this.scan(this.root);
  }

  private async scan(dir: string): Promise<void> {
    let listing;
    try {
      listing = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of listing) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scan(path);
        continue;
      }
      // Fichiers temporaires laissés par une écriture interrompue.
      if (entry.name.endsWith('.tmp')) {
        await rm(path, { force: true });
        continue;
      }
      try {
        const info = await stat(path);
        this.entries.set(path, { size: info.size, lastAccess: info.mtimeMs, stamp: ++this.clock });
        this.bytes += info.size;
      } catch {
        // Fichier disparu entre readdir et stat : rien à inventorier.
      }
    }
  }

  /**
   * Chemin de l'entrée si elle est en cache, sinon `null`.
   * Marque l'entrée comme utilisée pour la retarder dans l'ordre d'éviction.
   */
  hit(key: string): string | null {
    const path = this.pathFor(key);
    const entry = this.entries.get(path);
    if (!entry) return null;
    entry.lastAccess = Date.now();
    entry.stamp = ++this.clock;
    return path;
  }

  /** Écrit une entrée et renvoie son chemin. Déclenche l'éviction si besoin. */
  async put(key: string, data: Buffer): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Écriture puis renommage : un lecteur concurrent ne voit jamais un fichier
    // partiel, le rename étant atomique sur le même système de fichiers.
    const temp = `${path}.${process.pid}.${this.entries.size}.tmp`;
    await writeFile(temp, data);
    await rename(temp, path);

    const previous = this.entries.get(path);
    if (previous) this.bytes -= previous.size;
    this.entries.set(path, {
      size: data.byteLength,
      lastAccess: Date.now(),
      stamp: ++this.clock,
    });
    this.bytes += data.byteLength;

    this.evictInBackground();
    return path;
  }

  stats(): CacheStats {
    return { entryCount: this.entries.size, bytes: this.bytes, maxBytes: this.maxBytes };
  }

  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
    this.entries.clear();
    this.bytes = 0;
  }

  /**
   * Éviction lancée sans être attendue — l'appelant vient d'écrire, il n'a pas
   * à patienter pendant le ménage. Le `catch` n'est pas décoratif : sans lui,
   * un `rm` qui échoue (disque remonté en lecture seule, erreur d'E/S) produit
   * un rejet non géré, et Node termine le process là-dessus. Toute la galerie
   * tomberait parce qu'un fichier de cache n'a pas pu être supprimé.
   */
  private evictInBackground(): void {
    void this.evictIfNeeded().catch((error: unknown) => {
      this.log.warn(`Éviction du cache interrompue : ${(error as Error).message}`);
    });
  }

  /**
   * Supprime les entrées les moins récemment utilisées jusqu'à redescendre à
   * 90 % de la limite : évincer pile à la limite déclencherait une éviction à
   * chaque écriture suivante.
   */
  evictIfNeeded(): Promise<void> {
    if (this.bytes <= this.maxBytes) return Promise.resolve();
    // Une seule passe d'éviction à la fois, sinon deux passes concurrentes
    // supprimeraient chacune de quoi revenir sous la limite.
    this.evicting ??= this.evict().finally(() => {
      this.evicting = null;
    });
    return this.evicting;
  }

  private async evict(): Promise<void> {
    const target = this.maxBytes * 0.9;
    // L'ordre est figé ici, mais chaque candidat est revérifié avant sa
    // suppression : `rm` rend la main à la boucle d'événements, donc une requête
    // peut très bien servir cette entrée entre le tri et le `rm`.
    const ordered = [...this.entries.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
      .map(([path, entry]) => ({ path, stamp: entry.stamp }));

    for (const candidate of ordered) {
      if (this.bytes <= target) break;

      const entry = this.entries.get(candidate.path);
      // Déjà partie, ou réécrite : plus rien à évincer sous ce chemin.
      if (!entry) continue;
      // Touchée depuis le tri. La supprimer quand même ferait échouer en
      // `ENOENT` le `createReadStream` de la requête qui vient de la demander.
      if (entry.stamp !== candidate.stamp) continue;

      try {
        await rm(candidate.path, { force: true });
      } catch (error) {
        // L'entrée reste inventoriée : le fichier est toujours là, l'oublier
        // ferait mentir `stats()` et perdrait sa taille pour toutes les
        // évictions suivantes.
        this.log.warn(
          `Entrée de cache non supprimable (${candidate.path}) : ${(error as Error).message}`,
        );
        continue;
      }

      this.entries.delete(candidate.path);
      this.bytes -= entry.size;
    }
  }

  /**
   * `cache/ab/<hash>.bin` — le hash évite d'avoir à assainir des ids Drive dans
   * des noms de fichiers, et le préfixe à deux caractères répartit les entrées
   * sur 256 sous-dossiers pour ne pas créer un répertoire à 100 000 fichiers.
   */
  private pathFor(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.root, hash.slice(0, 2), `${hash.slice(2)}.bin`);
  }
}
