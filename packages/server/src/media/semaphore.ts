/**
 * Limiteur de tâches simultanées.
 *
 * Produire un dérivé demande de charger l'original entier en mémoire — neuf
 * mégaoctets pour une photo d'appareil courante — puis de le décoder et de le
 * ré-encoder. Ces deux étapes se font hors du fil principal, donc elles ne
 * bloquent pas les autres requêtes ; ce qui les gêne, c'est la mémoire.
 *
 * Sans limite, ouvrir une grille dont les vignettes ne sont pas encore en cache
 * lance autant de rendus que de photos visibles : une mesure sur vingt-quatre
 * rendus simultanés fait grimper la mémoire du processus de plus de 300 Mo, de
 * quoi faire tomber un VPS modeste pour tout le monde — y compris ceux qui ne
 * regardaient qu'une photo déjà en cache.
 *
 * La file est en mémoire et strictement locale au processus : l'application est
 * mono-instance, et une file partagée demanderait un service de plus pour un
 * problème qui n'existe pas encore.
 */
export class Semaphore {
  private disponibles: number;
  private readonly attente: (() => void)[] = [];

  constructor(readonly limite: number) {
    if (limite < 1) throw new Error('The limit must be at least 1');
    this.disponibles = limite;
  }

  /**
   * Exécute la tâche dès qu'une place se libère.
   *
   * La place est rendue même si la tâche échoue — sans quoi une suite d'erreurs
   * réduirait la limite jusqu'à bloquer définitivement tous les rendus.
   */
  async run<T>(tache: () => Promise<T>): Promise<T> {
    await this.acquerir();
    try {
      return await tache();
    } finally {
      this.liberer();
    }
  }

  /** Tâches en attente d'une place. Sert au diagnostic et aux tests. */
  get enAttente(): number {
    return this.attente.length;
  }

  /** Places occupées à cet instant. */
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
    // Le premier arrivé passe : une pile ferait attendre indéfiniment les
    // premières vignettes d'une grille pendant que les dernières défilent.
    const suivant = this.attente.shift();
    if (suivant) suivant();
    else this.disponibles++;
  }
}

/**
 * Nombre de rendus simultanés autorisés.
 *
 * Deux au minimum : à un seul, une photo lente retarderait toutes les vignettes
 * derrière elle. Plafonné à quatre parce que le gain s'arrête là — le décodage
 * occupe déjà plusieurs cœurs par image — alors que la mémoire, elle, continue
 * de croître. Deux cœurs sont laissés à tout le reste : servir les fichiers en
 * cache, les requêtes d'API, la synchronisation.
 */
export function renderConcurrencyFor(cpuCount: number): number {
  return Math.max(2, Math.min(4, cpuCount - 2));
}
