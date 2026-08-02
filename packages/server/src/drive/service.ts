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

interface TokenRow {
  ciphertext: string;
  account: string | null;
  granted_at: string;
}

export interface DriveConnection {
  account: string | null;
  grantedAt: string;
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
    return row ? { account: row.account, grantedAt: row.granted_at } : null;
  }

  get connected(): boolean {
    return this.readToken() !== null;
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
        `INSERT INTO oauth_token (id, ciphertext, account, scope, granted_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           account = excluded.account,
           scope = excluded.scope,
           granted_at = excluded.granted_at`,
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
   * Télécharge le contenu d'un fichier. Passe par `fetch` plutôt que par
   * googleapis pour garder la main sur les en-têtes : un `Range` fourni est
   * transmis à Google, et la réponse 206 est renvoyée au navigateur sans
   * retraitement, ce qui donne le seek vidéo natif sans transcodage.
   */
  async fetchFile(fileId: string, range?: string): Promise<Response> {
    const client = this.authorizedClient();
    const { token } = await client.getAccessToken();
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
      .prepare('SELECT ciphertext, account, granted_at FROM oauth_token WHERE id = 1')
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
