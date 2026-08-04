// Paquets d'API ciblés plutôt que `googleapis` entier : ce dernier embarque
// toutes les API Google (~110 Mo) alors que seules Drive et OAuth2 servent ici.
import { auth, drive, type drive_v3 } from '@googleapis/drive';
import { oauth2 } from '@googleapis/oauth2';
import type { Db } from '../db.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Env } from '../env.js';

/**
 * `drive.readonly` donne la lecture de tout le Drive : c'est nécessaire pour
 * pointer n'importe quel dossier depuis la config sans avoir à le partager.
 * `userinfo.email` sert uniquement à afficher quel compte est connecté dans /admin.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/** google-auth-library n'est pas une dépendance directe : le type vient d'ici. */
type OAuth2Client = InstanceType<typeof auth.OAuth2>;

export class DriveNotConnectedError extends Error {
  constructor() {
    super("Google Drive n'est pas connecté. Va sur /admin pour autoriser l'accès.");
    this.name = 'DriveNotConnectedError';
  }
}

/**
 * `TOKEN_KEY` ne déchiffre pas le jeton stocké. Sous-classe de
 * `DriveNotConnectedError` pour hériter de son traitement — l'instance ne peut
 * effectivement rien lire de Drive — tout en disant la seule chose qui compte :
 * le jeton est là, c'est la clé qui ne va pas. Le supprimer ferait perdre une
 * autorisation valide pour une variable d'environnement mal recopiée.
 */
export class DriveKeyMismatchError extends DriveNotConnectedError {
  constructor() {
    super();
    this.message =
      'Le refresh token stocké ne se déchiffre pas avec TOKEN_KEY. Rétablis la clé ' +
      "d'origine, ou reconnecte Google Drive depuis /admin pour en obtenir un nouveau.";
    this.name = 'DriveKeyMismatchError';
  }
}

export class DriveNotConfiguredError extends Error {
  constructor() {
    super('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ne sont pas définis dans .env.');
    this.name = 'DriveNotConfiguredError';
  }
}

export class DriveRevokedError extends Error {
  constructor() {
    super(
      "L'autorisation Google a été révoquée ou a expiré. Reconnecte Google Drive depuis /admin.",
    );
    this.name = 'DriveRevokedError';
  }
}

/**
 * Google répond `invalid_grant` quand le refresh token n'est plus échangeable :
 * accès retiré depuis myaccount.google.com, six mois sans utilisation, ou
 * application repassée en statut « Test » (les jetons y expirent à 7 jours).
 *
 * L'erreur remonte tantôt de `getAccessToken()`, tantôt d'un appel à l'API
 * Drive, avec une forme qui varie selon le chemin parcouru — d'où la
 * reconnaissance sur plusieurs emplacements plutôt que sur un seul champ.
 */
function isRevocation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    message?: unknown;
    response?: { data?: { error?: unknown; error_description?: unknown } };
  };

  if (candidate.response?.data?.error === 'invalid_grant') return true;
  return typeof candidate.message === 'string' && candidate.message.includes('invalid_grant');
}

/** Réessais avant d'abandonner sur une limite de débit. */
const RATE_LIMIT_ATTEMPTS = 4;

/** Premier délai d'attente. Doublé à chaque tentative, plafonné à 30 s. */
const RATE_LIMIT_BASE_MS = 1000;
const RATE_LIMIT_MAX_MS = 30_000;

/**
 * Google exprime ses limites de débit de deux façons : un `429`, ou un `403`
 * dont le corps porte le motif. Le statut seul ne suffit donc pas — un `403`
 * est aussi ce que répond un fichier auquel le compte n'a pas accès, et
 * réessayer celui-là quatre fois ne ferait que retarder l'échec.
 *
 * `downloadQuotaExceeded` est délibérément exclu : c'est le quota de
 * téléchargement d'un fichier trop sollicité, qui se compte en heures. Attendre
 * trente secondes n'y change rien.
 */
function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (/downloadQuotaExceeded/i.test(body)) return false;
  return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(body);
}

/**
 * Délai avant la prochaine tentative. `Retry-After` de Google fait autorité
 * quand il est là ; sinon, doublement à chaque essai.
 */
function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const annonce = Number(retryAfter);
  if (Number.isFinite(annonce) && annonce > 0) {
    return Math.min(annonce * 1000, RATE_LIMIT_MAX_MS);
  }
  return Math.min(RATE_LIMIT_BASE_MS * 2 ** attempt, RATE_LIMIT_MAX_MS);
}

interface TokenRow {
  ciphertext: string;
  account: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface DriveConnection {
  account: string | null;
  grantedAt: string;
  /** Non `null` si Google a cessé d'accepter le refresh token. */
  revokedAt: string | null;
}

/**
 * Détient l'unique connexion OAuth de l'application et sert de porte d'entrée
 * vers Drive : l'API métadonnées (`api()`) pour l'indexation, et un accès HTTP
 * direct (`fetchFile()`) pour le contenu, qui permet de relayer les requêtes
 * `Range` telles quelles vers le navigateur.
 */
export class DriveService {
  private cachedClient: OAuth2Client | null = null;

  /**
   * Vrai depuis qu'une tentative de déchiffrement a échoué. Retenu ici plutôt
   * que recalculé : `connected` est lu à chaque page de /admin, et déchiffrer
   * coûte un `scrypt` — un prix qu'on ne paie pas pour afficher un état.
   */
  private unreadableToken = false;

  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly log: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  get configured(): boolean {
    return this.env.google !== null;
  }

  get connection(): DriveConnection | null {
    const row = this.readToken();
    return row
      ? { account: row.account, grantedAt: row.granted_at, revokedAt: row.revoked_at }
      : null;
  }

  /**
   * Un jeton révoqué — ou qui ne se déchiffre pas — est encore stocké, mais ne
   * permet plus rien. /admin doit donc proposer de reconnecter, sans que le
   * jeton en place soit effacé pour autant.
   */
  get connected(): boolean {
    if (this.unreadableToken) return false;
    const row = this.readToken();
    return row !== null && row.revoked_at === null;
  }

  /** URL de consentement Google. `state` protège le callback contre le CSRF. */
  authUrl(state: string): string {
    return this.newClient().generateAuthUrl({
      access_type: 'offline',
      // `consent` force Google à réémettre un refresh_token même si l'app a
      // déjà été autorisée : sans ça, une seconde autorisation ne renvoie rien
      // et la connexion échouerait silencieusement.
      prompt: 'consent',
      scope: SCOPES,
      include_granted_scopes: true,
      state,
    });
  }

  /** Échange le code du callback et persiste le refresh token chiffré. */
  async completeAuth(code: string): Promise<void> {
    const client = this.newClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google n'a pas renvoyé de refresh token. Révoque l'accès de l'application " +
          'dans https://myaccount.google.com/permissions puis recommence.',
      );
    }

    client.setCredentials(tokens);
    const account = await this.fetchAccountEmail(client);

    this.db
      .prepare(
        `INSERT INTO oauth_token (id, ciphertext, account, scope, granted_at, revoked_at)
         VALUES (1, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           account = excluded.account,
           scope = excluded.scope,
           granted_at = excluded.granted_at,
           -- Un nouveau consentement lève la révocation précédente.
           revoked_at = NULL`,
      )
      .run(
        encryptSecret(tokens.refresh_token, this.env.tokenKey),
        account,
        SCOPES.join(' '),
        new Date().toISOString(),
      );

    this.cachedClient = null;
    this.unreadableToken = false;
    this.log.info(`Google Drive connecté${account ? ` (${account})` : ''}`);
  }

  disconnect(): void {
    this.db.prepare('DELETE FROM oauth_token').run();
    this.cachedClient = null;
    this.unreadableToken = false;
    this.log.info('Google Drive déconnecté');
  }

  /** Client Drive authentifié pour les appels de métadonnées (files.list, ...). */
  api(): drive_v3.Drive {
    return drive({ version: 'v3', auth: this.authorizedClient() });
  }

  /**
   * Exécute un appel à Drive en surveillant la révocation du refresh token.
   * À utiliser autour de tout ce qui passe par `api()` — le client renvoyé
   * échange le refresh token de lui-même, donc l'erreur naît dans l'appel de
   * l'appelant, pas ici.
   */
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    // Le jeton en place au lancement de l'appel. Une requête peut être encore
    // en vol quand un nouveau consentement enregistre un autre jeton : sans
    // cette photographie, son échec marquerait révoqué un jeton tout neuf, et
    // /admin réclamerait une reconnexion qui vient d'être faite.
    const used = this.readToken()?.ciphertext ?? null;

    try {
      return await operation();
    } catch (error) {
      if (isRevocation(error)) {
        this.markRevoked(used);
        throw new DriveRevokedError();
      }
      throw error;
    }
  }

  /**
   * Enregistre que Google refuse désormais le refresh token. Le jeton est
   * conservé plutôt que supprimé : /admin peut ainsi dire « l'autorisation a
   * été révoquée » et pour quel compte, là où une base vide se lirait comme
   * une installation neuve.
   *
   * `used` est le chiffré du jeton dont le refus est constaté. L'écriture n'a
   * lieu que s'il est toujours celui qui est stocké — chaque `completeAuth`
   * produit un chiffré différent (sel et IV tirés à chaque fois), ce qui suffit
   * à reconnaître qu'une reconnexion est passée entre-temps.
   */
  private markRevoked(used: string | null): void {
    const row = this.readToken();
    if (!row || row.revoked_at !== null) return;

    if (used === null || row.ciphertext !== used) {
      this.log.warn(
        "Google a refusé un jeton qui n'est plus celui enregistré : une reconnexion a eu " +
          'lieu pendant la requête, la connexion actuelle est laissée intacte.',
      );
      return;
    }

    this.db
      .prepare('UPDATE oauth_token SET revoked_at = ? WHERE id = 1')
      .run(new Date().toISOString());
    this.cachedClient = null;
    this.log.warn(
      'Google a refusé le refresh token (invalid_grant). Reconnecte Google Drive depuis /admin.',
    );
  }

  /**
   * Télécharge le contenu d'un fichier. Passe par `fetch` plutôt que par
   * googleapis pour garder la main sur les en-têtes : un `Range` fourni est
   * transmis à Google, et la réponse 206 est renvoyée au navigateur sans
   * retraitement, ce qui donne le seek vidéo natif sans transcodage.
   */
  async fetchFile(fileId: string, range?: string): Promise<Response> {
    const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    return this.fetchAuthorized(url, fileId, range);
  }

  /**
   * `fetch` porteur du jeton OAuth courant, pour les URL Google servies hors de
   * `api()` — le `thumbnailLink` d'un fichier non public répond 401/403 sans
   * en-tête `Authorization`, ce qui ferait échouer le repli au moment précis où
   * il sert. `label` n'apparaît que dans les messages d'erreur.
   */
  async fetchAuthorized(url: string, label: string, range?: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.sendWithRefresh(url, range);

      if (response.ok || response.status === 206 || response.status === 416) return response;

      const body = await response.text().catch(() => '');

      // Une limite de débit n'est pas une erreur : Google demande d'attendre.
      // Sans ce réessai, un préchauffage ou une grande grille à froid laisse
      // des trous — chaque refus devient une vignette cassée qu'aucun mécanisme
      // ne rattrape, alors que la seconde d'après serait passée.
      if (attempt < RATE_LIMIT_ATTEMPTS && isRateLimited(response.status, body)) {
        const wait = retryDelayMs(response.headers.get('retry-after'), attempt);
        this.log.warn(
          `Drive limite le débit (${response.status}) pour ${label} : nouvelle tentative dans ${Math.round(wait / 1000)} s`,
        );
        await this.delay(wait);
        continue;
      }

      throw new Error(`Drive a répondu ${response.status} pour ${label}: ${body.slice(0, 200)}`);
    }
  }

  /** Un envoi, avec renouvellement du jeton si Google le refuse en cours de vie. */
  private async sendWithRefresh(url: string, range?: string): Promise<Response> {
    let response = await this.send(url, await this.accessToken(false), range);

    if (response.status === 401) {
      // Google a cessé d'accepter cet access token avant son expiration :
      // accès retiré, mot de passe changé, application révoquée. Sans ce
      // renouvellement forcé, le jeton en cache resterait utilisé jusqu'à une
      // heure et le propriétaire ne verrait que des erreurs opaques pendant ce
      // temps-là. Le nouvel échange passe par `guard` : si Google refuse aussi
      // le refresh token, la révocation est enregistrée et /admin le dit.
      if (response.body) await response.body.cancel();
      response = await this.send(url, await this.accessToken(true), range);
    }

    return response;
  }

  /**
   * Attente entre deux tentatives. `protected` pour la même raison
   * qu'`accessToken` : c'est la couture qui permet aux tests de vérifier le
   * réessai sans attendre réellement des secondes.
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private send(url: string, token: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = range;
    return fetch(url, { headers });
  }

  /**
   * Jeton d'accès courant. `force` jette le client en cache pour repartir du
   * refresh token, seul moyen d'obtenir un access token neuf avant l'expiration
   * de celui qui vient d'être refusé.
   *
   * `protected` et non `private` : c'est le seul point de contact réseau du
   * service, et les tests s'en servent comme couture pour ne pas appeler Google.
   */
  protected async accessToken(force: boolean): Promise<string> {
    if (force) this.cachedClient = null;

    const client = this.authorizedClient();
    // C'est ici que le refresh token est échangé quand l'access token approche
    // de son expiration — donc ici que la révocation se manifeste en premier.
    const { token } = await this.guard(() => client.getAccessToken());
    if (!token) throw new DriveNotConnectedError();
    return token;
  }

  private authorizedClient(): OAuth2Client {
    if (this.cachedClient) return this.cachedClient;

    const row = this.readToken();
    if (!row) throw new DriveNotConnectedError();
    // Inutile de retenter un jeton que Google a déjà refusé : autant échouer
    // tout de suite avec le message qui dit quoi faire.
    if (row.revoked_at !== null) throw new DriveRevokedError();

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(row.ciphertext, this.env.tokenKey);
    } catch {
      /**
       * La ligne est **conservée**. Un jeton illisible n'est pas un jeton
       * invalide : une `TOKEN_KEY` mal recopiée dans un déploiement, ou une
       * variable oubliée, suffit à produire cette erreur — et la supprimer
       * détruirait une autorisation encore valable, que seul un nouveau
       * consentement Google permettrait de retrouver. Rétablir la bonne clé
       * doit suffire.
       */
      this.unreadableToken = true;
      this.log.warn(
        'Le refresh token stocké est illisible (TOKEN_KEY a changé ?). Il est conservé : ' +
          "rétablis la clé d'origine, ou reconnecte Drive depuis /admin.",
      );
      throw new DriveKeyMismatchError();
    }

    this.unreadableToken = false;

    const client = this.newClient();
    client.setCredentials({ refresh_token: refreshToken });
    this.cachedClient = client;
    return client;
  }

  private newClient(): OAuth2Client {
    if (!this.env.google) throw new DriveNotConfiguredError();
    return new auth.OAuth2(
      this.env.google.clientId,
      this.env.google.clientSecret,
      this.env.oauthRedirectUri,
    );
  }

  private readToken(): TokenRow | null {
    const row = this.db
      .prepare('SELECT ciphertext, account, granted_at, revoked_at FROM oauth_token WHERE id = 1')
      .get() as TokenRow | undefined;
    return row ?? null;
  }

  private async fetchAccountEmail(client: OAuth2Client): Promise<string | null> {
    // Purement informatif : un échec ici ne doit pas faire capoter une
    // connexion Drive par ailleurs valide.
    try {
      const { data } = await oauth2({ version: 'v2', auth: client }).userinfo.get();
      return data.email ?? null;
    } catch {
      return null;
    }
  }
}
