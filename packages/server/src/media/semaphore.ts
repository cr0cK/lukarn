/**
 * Concurrent task limiter.
 *
 * Producing a derivative requires loading the entire original into memory — nine
 * megabytes for a typical camera photo — then decoding and re-encoding it. Both
 * steps run off the main thread, so they do not block other requests; memory is
 * the limiting factor.
 *
 * Without a limit, opening a grid whose thumbnails are not yet cached starts as
 * many renders as there are visible photos: twenty-four simultaneous renders
 * increase process memory by more than 300 MB, enough to bring down a modest VPS
 * for everyone — including those only viewing a cached photo.
 *
 * The queue is held in memory and strictly local to the process: the application
 * runs as a single instance, and a shared queue would require another service
 * for a problem that does not yet exist.
 */
export class Semaphore {
  private disponibles: number;
  private readonly attente: (() => void)[] = [];

  constructor(readonly limite: number) {
    if (limite < 1) throw new Error('The limit must be at least 1');
    this.disponibles = limite;
  }

  /**
   * Runs the task as soon as a slot becomes available.
   *
   * The slot is released even if the task fails — otherwise, a series of errors
   * would reduce the limit until all renders were permanently blocked.
   */
  async run<T>(tache: () => Promise<T>): Promise<T> {
    await this.acquerir();
    try {
      return await tache();
    } finally {
      this.liberer();
    }
  }

  /** Tasks waiting for a slot. Used for diagnostics and tests. */
  get enAttente(): number {
    return this.attente.length;
  }

  /** Slots currently in use. */
  get enCours(): number {
    return this.limite - this.disponibles;
  }

  private acquerir(): Promise<void> {
    if (this.disponibles > 0) {
      this.disponibles--;
      return Promise.resolve();
    }
    return new Promise((resoudre) => this.attente.push(resoudre));
  }

  private liberer(): void {
    // First come, first served: a stack would leave the first thumbnails in a
    // grid waiting indefinitely while later ones keep coming.
    const suivant = this.attente.shift();
    if (suivant) suivant();
    else this.disponibles++;
  }
}

/**
 * Number of simultaneous renders allowed.
 *
 * At least two: with only one, a slow photo would delay every thumbnail behind
 * it. Capped at four because the benefit ends there — decoding already uses
 * several cores per image — while memory usage keeps growing. Two cores are left
 * for everything else: serving cached files, API requests and synchronisation.
 */
export function renderConcurrencyFor(cpuCount: number): number {
  return Math.max(2, Math.min(4, cpuCount - 2));
}
