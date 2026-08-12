// Targeted API packages rather than all of `googleapis`: the latter bundles every
// Google API (~110 MB), while only Drive and OAuth2 are used here.
import { auth, drive, type drive_v3 } from '@googleapis/drive';
import { oauth2 } from '@googleapis/oauth2';
import type { Db } from '../db.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Env } from '../env.js';

/**
 * `drive.readonly` grants read access to all of Drive: this is required to select any
 * folder from configuration without sharing it. `userinfo.email` is used only to show
 * which account is connected in /admin.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/** google-auth-library is not a direct dependency, so its type comes from here. */
type OAuth2Client = InstanceType<typeof auth.OAuth2>;
type JwtClient = InstanceType<typeof auth.JWT>;

/**
 * What signs calls to Drive. Both expose `getAccessToken()` and are passed as-is to
 * `drive({ auth })`; the rest of the service treats them identically.
 */
type AuthorizedClient = OAuth2Client | JwtClient;

export class DriveNotConnectedError extends Error {
  constructor() {
    super('Google Drive is not connected. Go to /admin to authorise access.');
    this.name = 'DriveNotConnectedError';
  }
}

/**
 * `TOKEN_KEY` cannot decrypt the stored token. A subclass of
 * `DriveNotConnectedError` to inherit its handling — the instance truly cannot read
 * Drive — while stating the one fact that matters: the token exists, but the key is
 * wrong. Deleting it would lose valid authorisation because of a mistyped environment
 * variable.
 */
export class DriveKeyMismatchError extends DriveNotConnectedError {
  constructor() {
    super();
    this.message =
      'The stored refresh token does not decrypt with TOKEN_KEY. Restore the original ' +
      'key, or reconnect Google Drive from /admin to obtain a new one.';
    this.name = 'DriveKeyMismatchError';
  }
}

export class DriveNotConfiguredError extends Error {
  constructor() {
    super('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env.');
    this.name = 'DriveNotConfiguredError';
  }
}

export class DriveRevokedError extends Error {
  constructor() {
    super(
      'The Google authorisation was revoked or has expired. Reconnect Google Drive from /admin.',
    );
    this.name = 'DriveRevokedError';
  }
}

/**
 * Drive did not respond in time or continued rate-limiting beyond our retries.
 *
 * **Transient, which is why the distinction matters**: a file in an unreadable format
 * will fail the same way in an hour; this will not. The client must be able to retry,
 * hence the 503 and `Retry-After` header produced by the route — a 500 would falsely
 * say "broken" and make it give up.
 */
export class DriveUnavailableError extends Error {
  constructor(
    label: string,
    readonly retryAfterSeconds: number,
    cause: string,
  ) {
    super(`Drive could not serve ${label} (${cause}). Try again in a moment.`);
    this.name = 'DriveUnavailableError';
  }
}

/**
 * Google returns `invalid_grant` when the refresh token can no longer be exchanged:
 * access removed through myaccount.google.com, six months without use, or an
 * application returned to "Testing" status, where tokens expire after seven days.
 *
 * The error may come from `getAccessToken()` or from a Drive API call, with a shape
 * that varies by path — hence detection in several locations rather than one field.
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

/**
 * Content-download timeout in milliseconds.
 *
 * Its existence matters more than its value: without it, `fetch` inherits undici's
 * **five-minute** default, and a render-limiter slot is taken *before* downloading.
 * Two stalled downloads on a dual-core VPS therefore freeze all renders for that
 * duration, indistinguishable from a permanent stall in the browser.
 *
 * 120 s accommodates `MAX_DECODE_BYTES` (80 MB) over a slow connection and leaves
 * ample margin for the common case — a camera original weighs around ten megabytes.
 * The worst case becomes 240 s when the Drive-preview fallback also stalls, rather
 * than 600 s previously.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** How long the client is asked to wait before returning after a transient failure. */
const RETRY_AFTER_SECONDS = 5;

/** Retries before giving up on a rate limit. */
const RATE_LIMIT_ATTEMPTS = 4;

/** Initial delay. Doubled on every attempt and capped at 30 s. */
const RATE_LIMIT_BASE_MS = 1000;
const RATE_LIMIT_MAX_MS = 30_000;

/**
 * Google expresses rate limits in two ways: a `429`, or a `403` whose body carries
 * the reason. Status alone is insufficient — `403` also applies to a file the account
 * cannot access, and retrying that four times would only delay failure.
 *
 * `downloadQuotaExceeded` is deliberately excluded: it is the per-file download
 * quota for an overused file and lasts hours. Waiting thirty seconds changes nothing.
 */
function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (/downloadQuotaExceeded/i.test(body)) return false;
  return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(body);
}

/**
 * Delay before the next attempt. Google's `Retry-After` is authoritative when
 * present; otherwise the delay doubles on each attempt.
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
  /** `null` for a service account: there was no consent to date. */
  grantedAt: string | null;
  /** Non-`null` if Google has stopped accepting the refresh token. */
  revokedAt: string | null;
}

/**
 * Holds the application's sole OAuth connection and serves as its gateway to Drive:
 * the metadata API (`api()`) for indexing, and direct HTTP access (`fetchFile()`)
 * for content, allowing `Range` requests to be relayed unchanged to the browser.
 */
export class DriveService {
  private cachedClient: AuthorizedClient | null = null;

  /**
   * True after a decryption attempt fails. Retained here rather than recalculated:
   * `connected` is read on every /admin page, and decryption costs one `scrypt` —
   * not a price worth paying to display state.
   */
  private unreadableToken = false;

  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly log: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  get configured(): boolean {
    return this.env.serviceAccount !== null || this.env.google !== null;
  }

  /**
   * How the instance authenticates with Drive. The service account takes precedence
   * when its key is supplied: this is the only way to avoid the "Google hasn't verified
   * this app" screen, which verifying a restricted scope would remove only after a
   * third-party audit (D46).
   */
  get mode(): 'service_account' | 'oauth' {
    return this.env.serviceAccount ? 'service_account' : 'oauth';
  }

  get connection(): DriveConnection | null {
    // A service account has neither consent nor revocation: folder sharing in Drive
    // authorises it, and the API cannot query that. /admin therefore shows its address,
    // the only useful detail — this is what gets copied into sharing settings.
    if (this.env.serviceAccount) {
      return { account: this.env.serviceAccount.email, grantedAt: null, revokedAt: null };
    }

    const row = this.readToken();
    return row
      ? { account: row.account, grantedAt: row.granted_at, revokedAt: row.revoked_at }
      : null;
  }

  /**
   * A revoked or undecryptable token remains stored but enables nothing. /admin must
   * therefore offer reconnection without deleting the existing token.
   */
  get connected(): boolean {
    if (this.env.serviceAccount) return true;
    if (this.unreadableToken) return false;
    const row = this.readToken();
    return row !== null && row.revoked_at === null;
  }

  /** Google consent URL. `state` protects the callback against CSRF. */
  authUrl(state: string): string {
    return this.newClient().generateAuthUrl({
      access_type: 'offline',
      // `consent` forces Google to reissue a refresh_token even if the application was
      // already authorised: without it, a second authorisation returns nothing and
      // connection would fail silently.
      prompt: 'consent',
      scope: SCOPES,
      include_granted_scopes: true,
      state,
    });
  }

  /** Exchanges the callback code and persists the encrypted refresh token. */
  async completeAuth(code: string): Promise<void> {
    const client = this.newClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google returned no refresh token. Revoke the application's access at " +
          'https://myaccount.google.com/permissions, then start again.',
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
           -- New consent clears the previous revocation.
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
    this.log.info(`Google Drive connected${account ? ` (${account})` : ''}`);
  }

  disconnect(): void {
    this.db.prepare('DELETE FROM oauth_token').run();
    this.cachedClient = null;
    this.unreadableToken = false;
    this.log.info('Google Drive disconnected');
  }

  /** Authenticated Drive client for metadata calls (files.list, ...). */
  api(): drive_v3.Drive {
    return drive({ version: 'v3', auth: this.authorizedClient() });
  }

  /**
   * Runs a Drive call while monitoring refresh-token revocation. Use around everything
   * that passes through `api()` — the returned client exchanges the refresh token
   * itself, so the error arises in the caller's call, not here.
   */
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    // The token in place when the call starts. A request may still be in flight when
    // new consent records another token: without this snapshot, its failure would mark
    // a brand-new token as revoked and /admin would request a reconnection just made.
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
   * Records that Google now refuses the refresh token. The token is retained rather
   * than deleted so /admin can say "authorisation was revoked" and identify the
   * account, whereas an empty database would look like a new installation.
   *
   * `used` is the encrypted token whose refusal was observed. The write occurs only
   * if it is still the stored value — every `completeAuth` produces different encrypted
   * text with a new salt and IV, enough to detect an intervening reconnection.
   */
  private markRevoked(used: string | null): void {
    const row = this.readToken();
    if (!row || row.revoked_at !== null) return;

    if (used === null || row.ciphertext !== used) {
      this.log.warn(
        'Google rejected a token that is no longer the stored one: a reconnection ' +
          'happened during the request, so the current connection is left intact.',
      );
      return;
    }

    this.db
      .prepare('UPDATE oauth_token SET revoked_at = ? WHERE id = 1')
      .run(new Date().toISOString());
    this.cachedClient = null;
    this.log.warn(
      'Google rejected the refresh token (invalid_grant). Reconnect Google Drive from /admin.',
    );
  }

  /**
   * Downloads file content. Uses `fetch` rather than googleapis to retain control of
   * headers: a supplied `Range` is forwarded to Google and the 206 response returned
   * to the browser without processing, enabling native video seeking without transcoding.
   */
  async fetchFile(fileId: string, range?: string, signal?: AbortSignal): Promise<Response> {
    const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    return this.fetchAuthorized(url, fileId, range, signal);
  }

  /**
   * `fetch` carrying the current OAuth token for Google URLs served outside `api()` —
   * the `thumbnailLink` of a non-public file returns 401/403 without an `Authorization`
   * header, making the fallback fail precisely when needed. `label` appears only in
   * error messages.
   */
  async fetchAuthorized(
    url: string,
    label: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.sendWithRefresh(url, range, signal);

      if (response.ok || response.status === 206 || response.status === 416) return response;

      const body = await response.text().catch(() => '');

      // A rate limit is not an error: Google asks the client to wait. Without this retry,
      // prewarming or a large cold grid leaves gaps — every refusal becomes a broken
      // thumbnail no mechanism repairs, although it would succeed a second later.
      if (attempt < RATE_LIMIT_ATTEMPTS && isRateLimited(response.status, body)) {
        const wait = retryDelayMs(response.headers.get('retry-after'), attempt);
        this.log.warn(
          `Drive is rate limiting (${response.status}) for ${label}: retrying in ${Math.round(wait / 1000)} s`,
        );
        await this.delay(wait);
        continue;
      }

      // Retries exhausted on a rate limit: failure remains **transient**, and saying so
      // is better than a 500 that makes the client give up. A large cold grid saturating
      // Drive quota is the typical case.
      if (isRateLimited(response.status, body)) {
        throw new DriveUnavailableError(label, RETRY_AFTER_SECONDS, `Drive ${response.status}`);
      }

      throw new Error(`Drive answered ${response.status} for ${label}: ${body.slice(0, 200)}`);
    }
  }

  /** One request, renewing the token if Google refuses it before expiry. */
  private async sendWithRefresh(
    url: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    let response = await this.send(url, await this.accessToken(false), range, signal);

    if (response.status === 401) {
      // Google stopped accepting this access token before expiry: access removed,
      // password changed or application revoked. Without forced renewal, the cached
      // token would remain in use for up to an hour and the owner would see only opaque
      // errors. The new exchange passes through `guard`: if Google also refuses the
      // refresh token, revocation is recorded and /admin reports it.
      if (response.body) await response.body.cancel();
      response = await this.send(url, await this.accessToken(true), range, signal);
    }

    return response;
  }

  /**
   * Wait between attempts. `protected` for the same reason as `accessToken`: this seam
   * lets tests verify retries without actually waiting seconds.
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async send(
    url: string,
    token: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = range;

    // **No default timeout on a `Range` request.** This relays video to the browser,
    // which consumes it at its own pace: a *total* timeout would interrupt playback,
    // not a failure. A caller other than this relay — reading a 64 KB video header
    // during synchronisation — supplies its own timeout.
    if (range) return fetch(url, { headers, signal });

    try {
      return await fetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      // `AbortSignal.timeout` rejects with `TimeoutError`; everything else is an
      // ordinary network failure with its own paths.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new DriveUnavailableError(url, RETRY_AFTER_SECONDS, 'timed out');
      }
      throw error;
    }
  }

  /**
   * Current access token. `force` discards the cached client to start again from the
   * refresh token, the only way to obtain a new access token before the refused one
   * expires.
   *
   * `protected` rather than `private`: this is the service's only network contact
   * point, and tests use it as a seam to avoid calling Google.
   */
  protected async accessToken(force: boolean): Promise<string> {
    if (force) this.cachedClient = null;

    const client = this.authorizedClient();
    // The refresh token is exchanged here as the access token nears expiry, so this
    // is where revocation first appears.
    const { token } = await this.guard(() => client.getAccessToken());
    if (!token) throw new DriveNotConnectedError();
    return token;
  }

  private authorizedClient(): AuthorizedClient {
    if (this.cachedClient) return this.cachedClient;

    // The service account bypasses everything else: no database token, nothing to
    // decrypt and nothing that expires. The library exchanges the key for an access
    // token and renews it itself.
    if (this.env.serviceAccount) {
      const client = new auth.JWT({
        email: this.env.serviceAccount.email,
        key: this.env.serviceAccount.privateKey,
        scopes: SCOPES,
      });
      this.cachedClient = client;
      return client;
    }

    const row = this.readToken();
    if (!row) throw new DriveNotConnectedError();
    // There is no point retrying a token Google already refused; fail immediately
    // with the message explaining what to do.
    if (row.revoked_at !== null) throw new DriveRevokedError();

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(row.ciphertext, this.env.tokenKey);
    } catch {
      /**
       * The row is **retained**. An unreadable token is not an invalid token: a
       * mistyped `TOKEN_KEY` in a deployment or a missing variable is enough to cause
       * this error, and deleting it would destroy still-valid authorisation recoverable
       * only through new Google consent. Restoring the correct key must be sufficient.
       */
      this.unreadableToken = true;
      this.log.warn(
        'The stored refresh token is unreadable (did TOKEN_KEY change?). It is kept: ' +
          'restore the original key, or reconnect Drive from /admin.',
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
    // Informational only: failure here must not break an otherwise valid Drive connection.
    try {
      const { data } = await oauth2({ version: 'v2', auth: client }).userinfo.get();
      return data.email ?? null;
    } catch {
      return null;
    }
  }
}
