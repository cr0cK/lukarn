import {
  remainingEditMs,
  type AdminComment,
  type AdminCommentsPage,
  type Comment,
  type CommentThread,
  type CommentsPage,
  type ModerationFilter,
} from '@gdv/shared';
import type { Db } from './db.js';

/**
 * Dépôt des commentaires : lecture d'un fil, écriture, suppression et
 * modération.
 *
 * Un commentaire est signé par une **identité** (`commenters`), pas par la clé
 * d'accès qui a servi à ouvrir l'album : le même identifiant peut être partagé
 * par plusieurs personnes, et chacune doit signer de son nom. La clé d'accès est
 * tout de même conservée dans `account`, parce que c'est elle qu'on change quand
 * un mot de passe a trop circulé.
 *
 * Le fil appartient au couple `(albumId, mediaId)` et non au seul média. Un même
 * fichier Drive indexé sous deux albums porte deux conversations séparées : les
 * réunir montrerait à un visiteur ce qui s'est dit dans un album qu'il n'a pas
 * le droit de voir, alors que tout le reste de l'application cloisonne par
 * album (D12).
 *
 * Toutes les lectures écartent les commentaires masqués, sauf celles de la
 * modération. C'est le seul endroit qui décide de cette visibilité — une route
 * qui la rejouerait finirait par diverger.
 */

/** Qui lit. Détermine `canDelete` et l'accès aux commentaires masqués. */
export interface Viewer {
  /** Identité en cours, `null` si personne ne s'est identifié sur la session. */
  commenterId: number | null;
  admin: boolean;
}

export interface CreateCommentInput {
  albumId: string;
  mediaId: string;
  commenterId: number;
  /** Clé d'accès utilisée, conservée pour la modération. */
  account: string;
  body: string;
  /** Commentaire auquel on répond, ou `null` pour ouvrir un fil. */
  parentId: number | null;
}

/**
 * Échec de création qui doit devenir une réponse HTTP précise plutôt qu'une
 * 500. Le seul cas : répondre à un commentaire qui n'existe pas, ou qui vit sur
 * un autre média — ce dernier étant une tentative de rattacher un message à une
 * conversation qu'on ne peut pas lire.
 */
export class UnknownParentError extends Error {
  constructor() {
    super('Le commentaire auquel tu réponds n’existe plus.');
    this.name = 'UnknownParentError';
  }
}

/**
 * La fenêtre de correction s'est refermée. Distinct d'un refus d'accès : le
 * commentaire est bien celui du demandeur, c'est son **état** qui ne s'y prête
 * plus. D'où un 409 côté route, et non le 404 des refus d'accès.
 */
export class EditWindowClosedError extends Error {
  constructor() {
    super('Le délai pour corriger ce commentaire est passé.');
    this.name = 'EditWindowClosedError';
  }
}

interface CommentRow {
  id: number;
  parent_id: number | null;
  commenter_id: number;
  display_name: string;
  body: string;
  created_at: string;
  hidden_at: string | null;
}

function toComment(row: CommentRow, viewer: Viewer, now = Date.now()): Comment {
  const mine = row.commenter_id === viewer.commenterId;
  return {
    id: row.id,
    parentId: row.parent_id,
    author: { displayName: row.display_name },
    body: row.body,
    createdAt: row.created_at,
    // L'administrateur peut tout retirer ; chacun peut retirer ce qu'il a écrit.
    canDelete: viewer.admin || mine,
    // Corriger n'est pas modérer : l'administrateur peut masquer ou supprimer,
    // jamais réécrire. Mettre d'autres mots dans la bouche de quelqu'un sous son
    // nom serait un pouvoir d'une autre nature que celui de retirer un propos.
    canEdit: mine && remainingEditMs(row.created_at, now) > 0,
  };
}

const SELECT_COMMENT = `
  SELECT c.id, c.parent_id, c.commenter_id, a.display_name, c.body, c.created_at, c.hidden_at
    FROM comments c
    JOIN commenters a ON a.id = c.commenter_id
`;

export class CommentRepo {
  constructor(private readonly db: Db) {}

  /* ----------------------------------------------------------------- lecture */

  /**
   * Fil d'un média, racines dans l'ordre chronologique et réponses sous leur
   * racine. Les commentaires masqués n'y figurent pas, y compris pour leur
   * auteur : lui laisser croire que son message est lu alors qu'il ne l'est
   * plus serait un mensonge par omission.
   */
  thread(albumId: string, mediaId: string, viewer: Viewer): CommentsPage {
    const rows = this.db
      .prepare(
        `${SELECT_COMMENT}
          WHERE c.album_id = ? AND c.media_id = ? AND c.hidden_at IS NULL
          ORDER BY c.id`,
      )
      .all(albumId, mediaId) as CommentRow[];

    const threads: CommentThread[] = [];
    const byId = new Map<number, CommentThread>();

    // Une passe suffit : l'ordre par id est l'ordre d'écriture, donc une racine
    // précède toujours ses réponses.
    for (const row of rows) {
      const comment = toComment(row, viewer);
      if (row.parent_id === null) {
        const thread: CommentThread = { root: comment, replies: [] };
        byId.set(comment.id, thread);
        threads.push(thread);
        continue;
      }
      // Une réponse dont la racine est masquée n'a plus de fil où s'accrocher.
      // La laisser de côté la ferait disparaître sans que personne ne l'ait
      // décidé : elle remonte donc en tête de fil, `parentId` remis à `null`
      // pour que la forme rendue dise la vérité.
      const parent = byId.get(row.parent_id);
      if (parent) parent.replies.push(comment);
      else {
        const thread: CommentThread = { root: { ...comment, parentId: null }, replies: [] };
        byId.set(comment.id, thread);
        threads.push(thread);
      }
    }

    return { threads, total: rows.length };
  }

  /**
   * Compteurs de tout un album, masqués exclus, photos sans commentaire omises.
   *
   * Le regroupement se fait en base et non en mémoire : `idx_comments_thread`
   * porte `(album_id, media_id, id)`, donc SQLite lit la tranche de l'album déjà
   * ordonnée par média. Rendre les lignes une à une pour les compter côté
   * serveur ferait traverser tout le fil de chaque photo pour n'en garder qu'un
   * entier.
   */
  countsByAlbum(albumId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT media_id, COUNT(*) AS count FROM comments
          WHERE album_id = ? AND hidden_at IS NULL
          GROUP BY media_id`,
      )
      .all(albumId) as { media_id: string; count: number }[];

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.media_id] = row.count;
    return counts;
  }

  /** Compteur affiché avec le détail d'un média, masqués exclus. */
  countFor(albumId: string, mediaId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM comments
          WHERE album_id = ? AND media_id = ? AND hidden_at IS NULL`,
      )
      .get(albumId, mediaId) as { count: number };
    return row.count;
  }

  /* ---------------------------------------------------------------- écriture */

  /**
   * Publie un commentaire. Répondre à une réponse rattache le message à la
   * racine du fil plutôt que de refuser : l'utilisateur a cliqué « Répondre »
   * sous un message, l'intention est claire, et un second niveau d'imbrication
   * transformerait le panneau en forum.
   */
  create(input: CreateCommentInput): Comment {
    const parentId = input.parentId === null ? null : this.rootOf(input);
    const createdAt = new Date().toISOString();

    const result = this.db
      .prepare(
        `INSERT INTO comments (album_id, media_id, parent_id, commenter_id, account, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.albumId,
        input.mediaId,
        parentId,
        input.commenterId,
        input.account,
        input.body,
        createdAt,
      );

    return this.byId(Number(result.lastInsertRowid), {
      commenterId: input.commenterId,
      admin: false,
    })!;
  }

  /**
   * Racine du fil désigné par `parentId`, après avoir vérifié qu'il vit bien
   * sur ce média. Sans ce contrôle, un client pourrait greffer sa réponse sur
   * un fil d'un autre album en devinant un identifiant.
   */
  private rootOf(input: CreateCommentInput): number {
    const parent = this.db
      .prepare('SELECT id, parent_id FROM comments WHERE id = ? AND album_id = ? AND media_id = ?')
      .get(input.parentId, input.albumId, input.mediaId) as
      { id: number; parent_id: number | null } | undefined;

    if (!parent) throw new UnknownParentError();
    return parent.parent_id ?? parent.id;
  }

  /**
   * Corrige un commentaire dans la fenêtre qui suit sa publication.
   *
   * Réservé à son auteur, administrateur compris — et l'administrateur n'y a
   * aucun privilège : il modère en masquant, pas en réécrivant.
   *
   * Rend `false` si le commentaire n'existe pas, n'est pas celui du demandeur,
   * ou a été masqué depuis. Ces trois cas sont indistinguables pour la même
   * raison que dans `remove`. La fenêtre écoulée, elle, **lève** : c'est le seul
   * refus que l'auteur doit pouvoir comprendre, puisqu'il porte sur son propre
   * message et qu'il ne révèle rien.
   */
  edit(id: number, viewer: Viewer, body: string, now = Date.now()): Comment | null {
    if (viewer.commenterId === null) return null;

    const row = this.db
      .prepare(
        'SELECT created_at FROM comments WHERE id = ? AND commenter_id = ? AND hidden_at IS NULL',
      )
      .get(id, viewer.commenterId) as { created_at: string } | undefined;

    if (!row) return null;
    if (remainingEditMs(row.created_at, now) <= 0) throw new EditWindowClosedError();

    // `created_at` reste celui de la publication : la place du message dans le
    // fil ne doit pas bouger sous les yeux de ceux qui le lisaient déjà.
    this.db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(body, id);
    return this.byId(id, viewer, now);
  }

  /** Rend le commentaire tel que ce lecteur le verrait, masqués compris. */
  byId(id: number, viewer: Viewer, now = Date.now()): Comment | null {
    const row = this.db.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).get(id) as
      CommentRow | undefined;
    return row ? toComment(row, viewer, now) : null;
  }

  /** Album et média porteurs de ce commentaire, pour recomposer un lien. */
  locate(id: number): { albumId: string; mediaId: string } | null {
    const row = this.db.prepare('SELECT album_id, media_id FROM comments WHERE id = ?').get(id) as
      { album_id: string; media_id: string } | undefined;
    return row ? { albumId: row.album_id, mediaId: row.media_id } : null;
  }

  /**
   * Supprime définitivement — chacun son message, l'administrateur n'importe
   * lequel. Rend `false` si le commentaire n'existe pas ou n'appartient pas au
   * demandeur, sans distinguer les deux : celui-ci n'a pas à apprendre qu'un
   * identifiant qu'il a deviné correspond au message de quelqu'un.
   */
  remove(id: number, viewer: Viewer): boolean {
    if (viewer.admin) {
      return this.db.prepare('DELETE FROM comments WHERE id = ?').run(id).changes > 0;
    }
    if (viewer.commenterId === null) return false;
    return (
      this.db
        .prepare('DELETE FROM comments WHERE id = ? AND commenter_id = ?')
        .run(id, viewer.commenterId).changes > 0
    );
  }

  /* -------------------------------------------------------------- modération */

  /** Masquer plutôt que supprimer : la décision reste réversible. */
  hide(id: number, by: string): boolean {
    return (
      this.db
        .prepare(
          'UPDATE comments SET hidden_at = ?, hidden_by = ? WHERE id = ? AND hidden_at IS NULL',
        )
        .run(new Date().toISOString(), by, id).changes > 0
    );
  }

  show(id: number): boolean {
    return (
      this.db.prepare('UPDATE comments SET hidden_at = NULL, hidden_by = NULL WHERE id = ?').run(id)
        .changes > 0
    );
  }

  /**
   * File de modération, du plus récent au plus ancien, tous albums confondus.
   *
   * Le curseur est un simple identifiant : `AUTOINCREMENT` garantit que l'ordre
   * des id est l'ordre d'écriture, ce qui évite le curseur composite dont la
   * pagination des médias a besoin (voir `repo.ts`).
   */
  listForModeration(
    filter: ModerationFilter,
    limit: number,
    cursor: number | null,
  ): AdminCommentsPage {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (filter === 'hidden') conditions.push('c.hidden_at IS NOT NULL');
    if (cursor !== null) {
      conditions.push('c.id < ?');
      params.push(cursor);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT c.id, c.parent_id, c.commenter_id, a.display_name, a.email, c.body, c.created_at,
                c.hidden_at, c.hidden_by, c.album_id, c.media_id, c.account,
                al.title AS album_title, m.name AS media_name
           FROM comments c
           JOIN commenters a ON a.id = c.commenter_id
           LEFT JOIN albums al ON al.id = c.album_id
           -- LEFT JOIN : un commentaire survit à la disparition de sa photo de
           -- l'index (voir la migration 4). Il doit rester modérable.
           LEFT JOIN media m ON m.album_id = c.album_id AND m.id = c.media_id
           ${where}
           ORDER BY c.id DESC
           LIMIT ?`,
      )
      .all(...params, limit + 1) as (CommentRow & {
      email: string;
      hidden_by: string | null;
      album_id: string;
      media_id: string;
      account: string | null;
      album_title: string | null;
      media_name: string | null;
    })[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // L'administrateur peut tout supprimer : `canDelete` est vrai partout ici.
    const viewer: Viewer = { commenterId: null, admin: true };
    const comments: AdminComment[] = page.map((row) => ({
      ...toComment(row, viewer),
      albumId: row.album_id,
      albumTitle: row.album_title ?? row.album_id,
      mediaId: row.media_id,
      mediaName: row.media_name,
      authorEmail: row.email,
      account: row.account,
      hiddenAt: row.hidden_at,
      hiddenBy: row.hidden_by,
    }));

    return { comments, nextCursor: hasMore ? String(page.at(-1)!.id) : null };
  }

  /** Nombre de commentaires masqués, pour la pastille de la section modération. */
  hiddenCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM comments WHERE hidden_at IS NOT NULL')
      .get() as { count: number };
    return row.count;
  }
}
