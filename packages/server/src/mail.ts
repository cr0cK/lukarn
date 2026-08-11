import { createTransport } from 'nodemailer';
import { signAlbumUnsubscribeToken, signUnsubscribeToken } from './crypto.js';
import { parseMailAddress, type Env } from './env.js';

/**
 * Notifications par email : transport SMTP, mise en file et composition des
 * messages.
 *
 * Deux principes gouvernent ce module.
 *
 * **L'envoi ne bloque jamais une requête.** Poster un commentaire répond dès
 * que la ligne est écrite ; les emails partent après, sur une file sérialisée.
 * Un serveur SMTP lent ou injoignable ne doit pas se voir depuis l'interface.
 *
 * **Un échec d'envoi n'échoue pas.** Il est journalisé et abandonné. Un rejet
 * non géré en tâche de fond termine le process Node : toute la galerie
 * tomberait parce qu'un relais SMTP a refusé une connexion — c'est la même
 * précaution que l'éviction du cache disque.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Remplaçable dans les tests, qui n'ouvrent évidemment pas de connexion SMTP. */
export type Deliver = (message: MailMessage) => Promise<void>;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

export class Mailer {
  /**
   * File d'attente réduite à une promesse chaînée. Les envois se suivent au
   * lieu de partir ensemble : un relais SMTP courant limite les connexions
   * simultanées, et un commentaire ne produit jamais plus de quelques messages.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly deliver: Deliver | null,
    private readonly log: Logger,
  ) {}

  /**
   * Construit le transport depuis l'environnement. Rend un `Mailer` inerte —
   * et non `null` — quand SMTP n'est pas configuré : les appelants n'ont pas à
   * savoir si l'instance envoie des emails.
   */
  static fromEnv(env: Env, log: Logger): Mailer {
    if (!env.mail) {
      log.info(
        "SMTP non configuré : ni les notifications de commentaires ni l'annonce des " +
          "nouvelles photos n'enverront rien.",
      );
      // Avertir plutôt que refuser de démarrer : couper SMTP le temps d'une
      // intervention est légitime, et on ne laisse pas au passage une variable
      // qui n'a rien d'invalide bloquer l'instance.
      if (env.mailReplyTo) {
        log.warn(
          "MAIL_REPLY_TO est renseignée mais aucun relais n'est configuré : sans " +
            "SMTP_URL ni MAIL_FROM, aucun message ne part, et l'adresse de réponse " +
            'ne sert à rien.',
        );
      }
      return new Mailer(null, log);
    }

    // Le garde-fou vise le geste réflexe : recopier MAIL_FROM dans
    // MAIL_REPLY_TO. La configuration paraît faite, et les réponses continuent
    // d'aller exactement là où elles n'arrivaient pas.
    if (env.mailReplyTo && parseMailAddress(env.mailReplyTo) === parseMailAddress(env.mail.from)) {
      log.warn(
        `MAIL_REPLY_TO désigne la même adresse que MAIL_FROM (${env.mailReplyTo}) : ` +
          "l'en-tête Reply-To ne détourne alors rien. Mets-y une adresse qui reçoit " +
          'vraiment du courrier, ou laisse la variable vide.',
      );
    }

    // `replyTo` n'est posé que s'il est configuré : un en-tête vide vaut moins
    // que pas d'en-tête, le client de messagerie retombant alors sur l'adresse
    // d'expédition — qui est justement celle qui ne reçoit rien.
    const transport = createTransport(env.mail.smtpUrl, {
      from: env.mail.from,
      ...(env.mailReplyTo ? { replyTo: env.mailReplyTo } : {}),
    });
    return new Mailer(async (message) => {
      await transport.sendMail(message);
    }, log);
  }

  get enabled(): boolean {
    return this.deliver !== null;
  }

  /** Met en file sans attendre. L'appelant n'a rien à gérer, pas même l'échec. */
  queue(message: MailMessage): void {
    if (!this.deliver) return;
    const deliver = this.deliver;

    this.tail = this.tail.then(async () => {
      try {
        await deliver(message);
        this.log.debug(`Notification sent to ${message.to}`);
      } catch (error) {
        // Journalisé et abandonné : pas de réessai. Une notification manquée
        // est un désagrément, une file de réessais est un mécanisme à
        // surveiller — et le commentaire, lui, est bien enregistré.
        this.log.warn(`Delivery to ${message.to} : ${(error as Error).message}`);
      }
    });
  }

  /** Attend que la file soit vide. Sert à l'arrêt gracieux et aux tests. */
  async drain(): Promise<void> {
    await this.tail;
  }
}

/** Ce qu'il faut savoir du commentaire pour rédiger la notification. */
export interface CommentNotification {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  mediaName: string | null;
  authorDisplayName: string;
  body: string;
}

/**
 * À qui, et pourquoi. `moderation` désigne l'adresse de l'instance, réglée dans
 * /admin : elle n'a pas d'identité de commentateur, donc pas de lien de
 * désabonnement — on la retire en la vidant du formulaire.
 */
export interface Recipient {
  email: string;
  reason: 'moderation' | 'reply';
}

/**
 * Compose le message destiné à un destinataire.
 *
 * Le lien pointe la photo commentée, pas la page d'accueil : on ouvre un email
 * de notification pour voir de quoi il retourne, et forcer trois clics de plus
 * suffit à faire renoncer. La visionneuse s'ouvre sur `?photo=<id>` (voir
 * `AlbumPage`), qui est exactement l'URL qu'un visiteur partagerait.
 *
 * Et sur `&panel=comments` : cet email annonce un **message**, pas une photo.
 * Arriver sur l'image le panneau fermé laisserait chercher ce dont il était
 * question.
 */
export function buildCommentMail(
  notification: CommentNotification,
  recipient: Recipient,
  env: Env,
): MailMessage {
  const link = `${env.publicUrl}/album/${encodeURIComponent(notification.albumId)}?photo=${encodeURIComponent(notification.mediaId)}&panel=comments`;
  /**
   * Ce lien coupe `commenters.notify`, donc **tout** ce que la galerie envoie :
   * les réponses aux commentaires comme les annonces de nouvelles photos. Le
   * libellé le dit en toutes lettres — « se désabonner de ces emails » laisserait
   * croire qu'on ne coupe que les notifications de commentaires, et la surprise
   * se paierait au signalement en indésirable.
   *
   * Pour ne faire taire qu'un album, c'est le lien de l'email de nouveautés
   * (`buildAlbumUpdateMail`) qu'il faut suivre.
   */
  const unsubscribe =
    recipient.reason === 'reply'
      ? `${env.publicUrl}/api/comments/unsubscribe?u=${encodeURIComponent(recipient.email)}&t=${signUnsubscribeToken(recipient.email, env.sessionSecret)}`
      : null;

  // Le sujet sert aussi d'accroche dans le corps : le lecteur qui ouvre depuis
  // une notification a déjà lu cette phrase, la répéter à l'identique lui dit
  // qu'il est au bon endroit.
  const subject =
    recipient.reason === 'reply'
      ? `${notification.authorDisplayName} a répondu à ton commentaire`
      : `${notification.authorDisplayName} a commenté une photo`;

  const where = notification.mediaName
    ? `${notification.mediaName} — ${notification.albumTitle}`
    : notification.albumTitle;

  const text = [
    `${subject} :`,
    '',
    quote(notification.body),
    '',
    where,
    link,
    ...(unsubscribe
      ? ['', '—', `Ne plus recevoir aucun email de cette galerie : ${unsubscribe}`]
      : []),
  ].join('\n');

  // HTML volontairement pauvre : styles en ligne, pas d'image, pas de police
  // distante. Les clients de messagerie retirent tout le reste, et un email
  // qui ne charge rien depuis le serveur ne signale pas non plus sa lecture.
  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">${escapeHtml(subject)} :</p>
      <blockquote style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #d4d4d4; background: #fafafa; white-space: pre-wrap;">${escapeHtml(notification.body)}</blockquote>
      <p style="margin: 0 0 8px; color: #666;">${escapeHtml(where)}</p>
      <p style="margin: 0 0 24px;"><a href="${escapeHtml(link)}" style="color: #2563eb;">Voir la photo</a></p>
      ${
        unsubscribe
          ? `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        <a href="${escapeHtml(unsubscribe)}" style="color: #888;">Ne plus recevoir aucun email de cette galerie</a>
      </p>`
          : ''
      }
    </div>
  `.trim();

  return { to: recipient.email, subject, text, html };
}

/** Ce qu'il faut savoir de l'album pour annoncer ses nouveautés. */
export interface AlbumUpdateNotification {
  albumId: string;
  albumTitle: string;
  /** Médias entrés dans l'index depuis la dernière annonce. */
  count: number;
}

/**
 * Annonce des nouvelles photos d'un album à quelqu'un qui l'a ouvert.
 *
 * Le compte figure dans le sujet : c'est ce qui distingue « il y a du nouveau »
 * de « il y a beaucoup de nouveau », et ce qu'on lit sans ouvrir le message.
 * Le lien de désabonnement porte l'album, pas seulement l'adresse — se
 * désabonner d'une galerie bavarde ne doit pas couper les autres.
 */
export function buildAlbumUpdateMail(
  notification: AlbumUpdateNotification,
  email: string,
  env: Env,
): MailMessage {
  // `?order=desc` : le message annonce ce qui vient d'arriver, le lien doit y
  // mener. Le paramètre ne vaut que pour cette visite — il prime sur le sens
  // par défaut de l'album, sans écraser la mémoire du navigateur (D99).
  const link = `${env.publicUrl}/album/${encodeURIComponent(notification.albumId)}?order=desc`;
  const unsubscribe =
    `${env.publicUrl}/api/subscriptions/unsubscribe` +
    `?u=${encodeURIComponent(email)}&a=${encodeURIComponent(notification.albumId)}` +
    `&t=${signAlbumUnsubscribeToken(email, notification.albumId, env.sessionSecret)}`;

  const plural = notification.count > 1;
  const subject = `${notification.count} nouvelle${plural ? 's' : ''} photo${plural ? 's' : ''} dans ${notification.albumTitle}`;

  const text = [
    `${subject}.`,
    '',
    link,
    '',
    '—',
    `Tu reçois ce message parce que tu as ouvert cet album.`,
    `Ne plus être prévenu des nouveautés de « ${notification.albumTitle} » : ${unsubscribe}`,
  ].join('\n');

  // Même sobriété que les notifications de commentaires : styles en ligne, rien
  // à charger depuis le serveur — donc rien qui signale la lecture non plus.
  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">${escapeHtml(subject)}.</p>
      <p style="margin: 0 0 24px;"><a href="${escapeHtml(link)}" style="color: #2563eb;">Voir l’album</a></p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        Tu reçois ce message parce que tu as ouvert cet album.
        <br>
        <a href="${escapeHtml(unsubscribe)}" style="color: #888;">Ne plus être prévenu des nouveautés de «&nbsp;${escapeHtml(notification.albumTitle)}&nbsp;»</a>
      </p>
    </div>
  `.trim();

  return { to: email, subject, text, html };
}

/** Citation en texte brut, préfixée « > » comme le veut l'usage du courrier. */
function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Le corps d'un commentaire est saisi par un visiteur : il traverse cette
 * fonction avant d'entrer dans le HTML de l'email, sinon un message contenant
 * une balise s'exécuterait dans le client de messagerie du destinataire.
 */
/**
 * Échappement HTML des textes composés par l'application — noms d'albums, noms
 * d'auteurs, corps de commentaires.
 *
 * Exporté parce que les pages de confirmation de désabonnement en ont besoin
 * elles aussi : deux copies d'une fonction de sécurité finissent par diverger,
 * et c'est celle qu'on oublie de corriger qui laisse passer une injection.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Code de vérification d'une adresse.
 *
 * Le sujet nomme l'instance, pas le code (D65) : c'est l'hôte qui dit pourquoi
 * ce message est arrivé, alors qu'un code dans le sujet se lit par-dessus une
 * épaule et reste en clair dans l'historique des notifications.
 *
 * Aucun lien cliquable, pas même vers la galerie : un code se recopie dans
 * l'onglet resté ouvert, là où un lien ouvrirait une seconde session dans un
 * autre navigateur. L'hôte n'est donc mentionné qu'en texte.
 *
 * Le code est affiché d'un seul tenant, jamais groupé en « 123 456 » : `verify`
 * exige six caractères après `trim()`, et un collage avec l'espace du milieu
 * serait rejeté. L'aération passe par `letter-spacing`, qui ne touche pas à la
 * chaîne copiée.
 */
export function buildVerificationMail(
  email: string,
  displayName: string,
  code: string,
  env: Env,
): MailMessage {
  const host = new URL(env.publicUrl).host;
  const subject = `Code de vérification — ${host}`;

  const text = [
    `Bonjour ${displayName},`,
    '',
    `Tu viens de renseigner cette adresse sur ${host} pour signer tes commentaires.`,
    'Voici ton code :',
    '',
    code,
    '',
    'Recopie-le dans la page restée ouverte. Il est valable quinze minutes et ne',
    'sert qu’une fois.',
    '',
    '—',
    "Si tu n'as rien demandé, ignore ce message : tant que le code n'est pas saisi,",
    "rien n'est associé à cette adresse. Ne le communique à personne.",
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">Bonjour ${escapeHtml(displayName)},</p>
      <p style="margin: 0 0 8px;">
        Tu viens de renseigner cette adresse sur ${escapeHtml(host)} pour signer tes
        commentaires. Voici ton code :
      </p>
      <p style="margin: 0 0 16px; font-size: 28px; font-weight: 600; letter-spacing: 0.15em;">${escapeHtml(code)}</p>
      <p style="margin: 0 0 24px; color: #666;">
        Recopie-le dans la page restée ouverte. Il est valable quinze minutes et ne sert
        qu’une fois.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        Si tu n'as rien demandé, ignore ce message : tant que le code n'est pas saisi,
        rien n'est associé à cette adresse. Ne le communique à personne.
      </p>
    </div>
  `.trim();

  return { to: email, subject, text, html };
}
