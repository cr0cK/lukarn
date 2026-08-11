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

  /**
   * Nom de l'instance : onglet, écran de connexion, et surtout l'icône posée
   * sur un écran d'accueil. Une variable d'environnement plutôt qu'un réglage
   * en base, parce qu'elle doit valoir avant qu'un compte existe — la première
   * page servie est l'écran de connexion, et elle porte déjà ce nom.
   */
  APP_NAME: z.string().trim().min(1).default('Photos'),

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

  /**
   * Adresse à qui répondre, quand celle de `MAIL_FROM` ne reçoit rien. Un relais
   * transactionnel n'a pas de boîte de réception, et le domaine d'envoi n'en a
   * pas forcément une : sans cette variable, répondre à une notification part
   * dans le vide, ou rebondit. Absente, aucun `Reply-To` n'est posé — le
   * comportement d'avant, correct pour un domaine qui reçoit son courrier.
   */
  MAIL_REPLY_TO: z.string().optional(),

  /**
   * Racine du service de géocodage inverse, qui donne un nom aux coordonnées
   * EXIF. Une chaîne vide le désactive : les journées gardent leurs grappes,
   * simplement sans libellé. Une instance Nominatim privée se met ici.
   */
  GEOCODING_URL: z.string().default('https://nominatim.openstreetmap.org'),

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
  /** Nom affiché de l'instance, et nom de l'application une fois installée. */
  appName: string;
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
  /**
   * Hors de `mail` à dessein : la variable est indépendante de la paire
   * `SMTP_URL`/`MAIL_FROM`, et le rester ici permet de signaler celle qui est
   * renseignée sans relais pour l'utiliser.
   */
  mailReplyTo: string | null;
  /**
   * `null` si `GEOCODING_URL` est vide : les lieux déduits de l'EXIF ne sont
   * plus nommés, le reste de l'application est inchangé.
   */
  geocoding: { baseUrl: string; userAgent: string } | null;
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
 * Contrôle la forme de `SMTP_URL`.
 *
 * Le cas visé est silencieux, et c'est ce qui le rend coûteux : un mot de passe
 * contenant `/`, `?` ou `#` non encodé **termine l'adresse** au milieu des
 * identifiants. Nodemailer ne s'en plaint pas — il construit un transport vers
 * un hôte qui est en fait le nom d'utilisateur, sans authentification — et
 * l'instance démarre normalement. La panne ne se voit qu'au premier envoi, des
 * semaines plus tard, sous la forme d'un échec réseau incompréhensible.
 *
 * `new URL` refuse exactement ces cas. `+`, `:` et l'espace passent très bien,
 * et ne sont donc pas signalés : un contrôle qui crie à tort finit contourné.
 */
function validateSmtpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "SMTP_URL n'est pas une URL valide. Un mot de passe contenant « / », « ? » ou " +
        "« # » coupe l'adresse : encode ces caractères (%2F, %3F, %23), comme le « @ » " +
        "d'une adresse email en %40.",
    );
  }

  if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
    throw new Error(
      `SMTP_URL doit commencer par « smtp:// » ou « smtps:// », pas « ${parsed.protocol}// ».`,
    );
  }

  if (!parsed.hostname) {
    throw new Error("SMTP_URL ne désigne aucun serveur : il manque le nom d'hôte.");
  }
}

/** Une adresse : rien d'espace ni de chevron autour d'un seul `@`. */
const ADRESSE = /^[^\s<>@]+@[^\s<>@]+$/;

/**
 * Extrait l'adresse d'un en-tête « Nom <adresse> » ou « adresse », en minuscules
 * pour être comparable. Rend `null` si rien ne ressemble à une adresse.
 *
 * Volontairement permissif sur le domaine — pas de point exigé, `@localhost`
 * sert aux essais avec un relais local — et strict sur ce qui trahit une faute
 * de frappe : chevron non refermé, `@` absent ou en double, espace au milieu.
 */
export function parseMailAddress(valeur: string): string | null {
  const brut = valeur.trim();

  const chevrons = brut.match(/<([^<>]*)>$/);
  if (chevrons) {
    const adresse = chevrons[1]!.trim();
    return ADRESSE.test(adresse) ? adresse.toLowerCase() : null;
  }

  // Un chevron sans sa paire : « Galerie <galerie@exemple.fr » part tel quel
  // dans l'en-tête, et le relais le rejette ou le réécrit.
  if (brut.includes('<') || brut.includes('>')) return null;

  return ADRESSE.test(brut) ? brut.toLowerCase() : null;
}

/**
 * Contrôle qu'une variable d'adresse est exploitable, et arrête le démarrage
 * sinon. Même raison que pour `SMTP_URL` : un en-tête `From` mal formé ne se
 * voit qu'au premier envoi, sous la forme d'un rejet du relais que rien ne
 * rattache à une faute de frappe dans le `.env`.
 */
function validateMailAddress(variable: string, valeur: string): void {
  if (parseMailAddress(valeur)) return;
  throw new Error(
    `${variable} ne porte pas d'adresse email exploitable : « ${valeur} ». Formes ` +
      'acceptées : « galerie@exemple.fr » ou « Galerie <galerie@exemple.fr> ».',
  );
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
  if (hasSmtp) validateSmtpUrl(env.SMTP_URL!);
  if (hasFrom) validateMailAddress('MAIL_FROM', env.MAIL_FROM!);

  const replyTo = env.MAIL_REPLY_TO?.trim() || null;
  if (replyTo) validateMailAddress('MAIL_REPLY_TO', replyTo);

  const geocodingUrl = env.GEOCODING_URL.trim().replace(/\/+$/, '');
  if (geocodingUrl && !URL.canParse(geocodingUrl)) {
    throw new Error(
      `GEOCODING_URL n'est pas une URL valide : « ${geocodingUrl} ». Laisse la variable ` +
        'vide pour désactiver le géocodage des lieux.',
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    publicUrl,
    appName: env.APP_NAME,
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
    mailReplyTo: replyTo,
    // La politique d'usage de Nominatim exige un `User-Agent` qui identifie
    // l'appelant : l'instance publique bloque les agents anonymes, et un
    // `node-fetch` générique se ferait couper sans qu'on sache pourquoi.
    geocoding: geocodingUrl ? { baseUrl: geocodingUrl, userAgent: `nonni (+${publicUrl})` } : null,
    configPath: resolve(baseDir, env.CONFIG_PATH),
    dataDir: resolve(baseDir, env.DATA_DIR),
    cacheDir: resolve(baseDir, env.CACHE_DIR),
    webDir: resolve(baseDir, env.WEB_DIR),
    logLevel: env.LOG_LEVEL,
    oauthRedirectUri: `${publicUrl}/api/oauth/callback`,
  };
}
