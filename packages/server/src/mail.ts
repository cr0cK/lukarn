import { createTransport } from 'nodemailer';
import { signUnsubscribeToken } from './crypto.js';
import type { Env } from './env.js';

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
      log.info("SMTP non configuré : les notifications de commentaires n'enverront rien.");
      return new Mailer(null, log);
    }

    const transport = createTransport(env.mail.smtpUrl, { from: env.mail.from });
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
        this.log.debug(`Notification envoyée à ${message.to}`);
      } catch (error) {
        // Journalisé et abandonné : pas de réessai. Une notification manquée
        // est un désagrément, une file de réessais est un mécanisme à
        // surveiller — et le commentaire, lui, est bien enregistré.
        this.log.warn(`Échec de l'envoi à ${message.to} : ${(error as Error).message}`);
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

export interface Recipient {
  username: string;
  email: string;
  displayName: string;
  reason: 'admin' | 'reply';
}

/**
 * Compose le message destiné à un destinataire.
 *
 * Le lien pointe la photo commentée, pas la page d'accueil : on ouvre un email
 * de notification pour voir de quoi il retourne, et forcer trois clics de plus
 * suffit à faire renoncer. La visionneuse s'ouvre sur `?photo=<id>` (voir
 * `AlbumPage`), qui est exactement l'URL qu'un visiteur partagerait.
 */
export function buildCommentMail(
  notification: CommentNotification,
  recipient: Recipient,
  env: Env,
): MailMessage {
  const link = `${env.publicUrl}/album/${encodeURIComponent(notification.albumId)}?photo=${encodeURIComponent(notification.mediaId)}`;
  const unsubscribe = `${env.publicUrl}/api/comments/unsubscribe?u=${encodeURIComponent(recipient.username)}&t=${signUnsubscribeToken(recipient.username, env.sessionSecret)}`;

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
    '',
    '—',
    `Se désabonner de ces emails : ${unsubscribe}`,
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
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        <a href="${escapeHtml(unsubscribe)}" style="color: #888;">Se désabonner de ces emails</a>
      </p>
    </div>
  `.trim();

  return { to: recipient.email, subject, text, html };
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
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
