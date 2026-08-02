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

  /** Un jeton révoqué est encore stocké, mais ne permet plus rien. */
  get connected(): boolean {
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
    this.log.info(`Google Drive connecté${account ? ` (${account})` : ''}`);
  }

  disconnect(): void {
    this.db.prepare('DELETE FROM oauth_token').run();
    this.cachedClient = null;
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
    try {
      return await operation();
    } catch (error) {
      if (isRevocation(error)) {
        this.markRevoked();
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
   */
  private markRevoked(): void {
    const row = this.readToken();
    if (!row || row.revoked_at !== null) return;

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
    const client = this.authorizedClient();
    // C'est ici que le refresh token est échangé quand l'access token approche
    // de son expiration — donc ici que la révocation se manifeste en premier.
    const { token } = await this.guard(() => client.getAccessToken());
    if (!token) throw new DriveNotConnectedError();

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = range;

    const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const response = await fetch(url, { headers });

    if (!response.ok && response.status !== 206) {
      const body = await response.text().catch(() => '');
      throw new Error(`Drive a répondu ${response.status} pour ${fileId}: ${body.slice(0, 200)}`);
    }
    return response;
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
      // TOKEN_KEY a changé : le token stocké est irrécupérable, autant le
      // supprimer pour que /admin affiche clairement « non connecté ».
      this.log.warn(
        'Le refresh token stocké est illisible (TOKEN_KEY a changé ?). Reconnecte Drive depuis /admin.',
      );
      this.disconnect();
      throw new DriveNotConnectedError();
    }

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
