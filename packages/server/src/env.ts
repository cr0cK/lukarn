import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Front buildé, à côté du serveur dans le monorepo. Le chemin est calculé
 * depuis ce module, donc il tombe juste aussi bien depuis `src/` (tsx) que
 * depuis `dist/` (production). Surchargeable par WEB_DIR pour le conteneur.
 */
const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Les secrets doivent faire au moins 32 caractères — c'est la longueur produite
 * par `openssl rand -hex 32` divisée par deux, donc largement atteignable, et
 * ça écarte les valeurs de test laissées par erreur en production.
 */
const secret = z.string().min(32, 'doit faire au moins 32 caractères (openssl rand -hex 32)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),

  SESSION_SECRET: secret,
  TOKEN_KEY: secret,

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Clé JSON d'un compte de service, en alternative au consentement OAuth.
   * Renseignée, elle prend le pas : plus d'écran « Google n'a pas validé cette
   * application », plus de refresh token à renouveler. Le compte de service ne
   * voit que les dossiers explicitement partagés avec son adresse.
   */
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().optional(),

  // Notifications de commentaires. Une URL plutôt qu'un quatuor hôte/port/
  // utilisateur/mot de passe : c'est la forme que tous les fournisseurs
  // documentent, et elle porte le chiffrement dans son schéma (`smtps://`).
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  CONFIG_PATH: z.string().default('./config/albums.yaml'),
  DATA_DIR: z.string().default('./data'),
  CACHE_DIR: z.string().default('./cache'),
  WEB_DIR: z.string().default(DEFAULT_WEB_DIR),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  publicUrl: string;
  sessionSecret: string;
  tokenKey: string;
  google: { clientId: string; clientSecret: string } | null;
  /**
   * Compte de service, `null` si l'instance passe par OAuth. Les deux peuvent
   * être configurés — c'est alors le compte de service qui sert, l'autre
   * restant utilisable après avoir retiré la clé.
   */
  serviceAccount: { email: string; privateKey: string; file: string } | null;
  /** `null` si l'instance n'envoie pas d'email : les notifications s'éteignent. */
  mail: { smtpUrl: string; from: string } | null;
  configPath: string;
  dataDir: string;
  cacheDir: string;
  webDir: string;
  logLevel: string;
  /** Callback OAuth, dérivé de PUBLIC_URL — doit être déclaré tel quel dans la console GCP. */
  oauthRedirectUri: string;
}

/**
 * Lit la clé JSON d'un compte de service.
 *
 * Échoue franchement plutôt que de retomber sur OAuth : une clé désignée mais
 * illisible est une erreur de déploiement — chemin non monté dans le
 * conteneur, droits trop stricts, fichier tronqué. Basculer silencieusement
 * sur l'autre chemin d'authentification ferait réapparaître l'écran de
 * consentement là où on venait précisément de le supprimer, sans dire pourquoi.
 */
function readServiceAccount(file: string): { email: string; privateKey: string; file: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_FILE : « ${file} » est illisible ou n'est pas du JSON ` +
        `(${(error as Error).message})`,
    );
  }

  const shape = z.object({ client_email: z.string().min(1), private_key: z.string().min(1) });
  const result = shape.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_FILE : « ${file} » ne porte pas « client_email » et ` +
        '« private_key ». Télécharge la clé au format JSON depuis la console Google Cloud.',
    );
  }

  return { email: result.data.client_email, privateKey: result.data.private_key, file };
}

/**
 * `baseDir` sert de racine aux chemins relatifs (CONFIG_PATH, DATA_DIR…).
 * C'est le répertoire du `.env` quand il y en a un, si bien qu'un script lancé
 * depuis `packages/server` vise les mêmes fichiers que le serveur lancé depuis
 * la racine.
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables d'environnement invalides :\n${details}`);
  }

  const env = parsed.data;
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');

  // Les deux identifiants OAuth vont par paire : n'en avoir qu'un est une erreur
  // de configuration silencieuse qui ne se manifesterait qu'au moment du consentement.
  const hasId = Boolean(env.GOOGLE_CLIENT_ID);
  const hasSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
  if (hasId !== hasSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être renseignés ensemble (ou aucun des deux).',
    );
  }

  // Même raison que ci-dessus : une instance configurée avec un serveur SMTP
  // mais sans expéditeur n'échouerait qu'au premier commentaire posté, des
  // semaines après la mise en service.
  const hasSmtp = Boolean(env.SMTP_URL);
  const hasFrom = Boolean(env.MAIL_FROM);
  if (hasSmtp !== hasFrom) {
    throw new Error('SMTP_URL et MAIL_FROM doivent être renseignés ensemble (ou aucun des deux).');
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    publicUrl,
    sessionSecret: env.SESSION_SECRET,
    tokenKey: env.TOKEN_KEY,
    google:
      hasId && hasSecret
        ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
        : null,
    serviceAccount: env.GOOGLE_SERVICE_ACCOUNT_FILE
      ? readServiceAccount(resolve(baseDir, env.GOOGLE_SERVICE_ACCOUNT_FILE))
      : null,
    mail: hasSmtp && hasFrom ? { smtpUrl: env.SMTP_URL!, from: env.MAIL_FROM! } : null,
    configPath: resolve(baseDir, env.CONFIG_PATH),
    dataDir: resolve(baseDir, env.DATA_DIR),
    cacheDir: resolve(baseDir, env.CACHE_DIR),
    webDir: resolve(baseDir, env.WEB_DIR),
    logLevel: env.LOG_LEVEL,
    oauthRedirectUri: `${publicUrl}/api/oauth/callback`,
  };
}
