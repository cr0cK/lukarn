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
}

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

  constructor(
    private readonly root: string,
    private maxBytes: number,
  ) {}

  /**
   * Nouvelle limite de taille, appliquée à chaud depuis les réglages. Une
   * limite abaissée déclenche l'éviction tout de suite plutôt qu'à la
   * prochaine écriture : c'est justement quand on veut récupérer de la place
   * qu'on abaisse la limite.
   */
  setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
    void this.evictIfNeeded();
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
        this.entries.set(path, { size: info.size, lastAccess: info.mtimeMs });
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
    this.entries.set(path, { size: data.byteLength, lastAccess: Date.now() });
    this.bytes += data.byteLength;

    void this.evictIfNeeded();
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
   * Supprime les entrées les moins récemment utilisées jusqu'à redescendre à
   * 90 % de la limite : évincer pile à la limite déclencherait une éviction à
   * chaque écriture suivante.
   */
  private evictIfNeeded(): Promise<void> {
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
    const ordered = [...this.entries.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    for (const [path, entry] of ordered) {
      if (this.bytes <= target) break;
      await rm(path, { force: true });
      this.entries.delete(path);
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
