import type {
  AdminComment,
  AdminCommentsPage,
  Comment,
  CommentThread,
  CommentsPage,
  ModerationFilter,
} from '@gdv/shared';
import type { Db } from './db.js';

/**
 * Dépôt des commentaires : lecture d'un fil, écriture, suppression et
 * modération.
 *
 * Le fil appartient au couple `(albumId, mediaId)` et non au seul média. Un
 * même fichier Drive indexé sous deux albums porte deux conversations
 * séparées : les réunir montrerait à un visiteur ce qui s'est dit dans un album
 * qu'il n'a pas le droit de voir, alors que tout le reste de l'application
 * cloisonne par album (D12).
 *
 * Toutes les lectures écartent les commentaires masqués, sauf celles de la
 * modération. C'est le seul endroit qui décide de cette visibilité — une route
 * qui la rejouerait finirait par diverger.
 */

/** Qui lit. Détermine `canDelete` et l'accès aux commentaires masqués. */
export interface Viewer {
  username: string;
  admin: boolean;
}

export interface CreateCommentInput {
  albumId: string;
  mediaId: string;
  username: string;
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

interface CommentRow {
  id: number;
  parent_id: number | null;
  username: string;
  display_name: string | null;
  body: string;
  created_at: string;
  hidden_at: string | null;
}

/** Le nom affiché n'est jamais vide : à défaut de nom saisi, l'identifiant. */
function toComment(row: CommentRow, viewer: Viewer): Comment {
  return {
    id: row.id,
    parentId: row.parent_id,
    author: {
      username: row.username,
      displayName: row.display_name?.trim() || row.username,
    },
    body: row.body,
    createdAt: row.created_at,
    canDelete: viewer.admin || row.username.toLowerCase() === viewer.username.toLowerCase(),
  };
}

const SELECT_COMMENT = `
  SELECT c.id, c.parent_id, c.username, u.display_name, c.body, c.created_at, c.hidden_at
    FROM comments c
    LEFT JOIN users u ON u.username = c.username
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
      // décidé : elle remonte donc en tête de fil. Son `parentId` repasse à
      // `null` pour que la forme rendue dise la vérité — une racine qui
      // désignerait encore un parent absent de la réponse n'aurait aucun sens.
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
        `INSERT INTO comments (album_id, media_id, parent_id, username, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.albumId, input.mediaId, parentId, input.username, input.body, createdAt);

    return this.byId(Number(result.lastInsertRowid), {
      username: input.username,
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

  /** Rend le commentaire tel que ce lecteur le verrait, masqués compris. */
  byId(id: number, viewer: Viewer): Comment | null {
    const row = this.db.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).get(id) as
      CommentRow | undefined;
    return row ? toComment(row, viewer) : null;
  }

  /** Album et média porteurs de ce commentaire, pour recomposer un lien. */
  locate(id: number): { albumId: string; mediaId: string } | null {
    const row = this.db.prepare('SELECT album_id, media_id FROM comments WHERE id = ?').get(id) as
      { album_id: string; media_id: string } | undefined;
    return row ? { albumId: row.album_id, mediaId: row.media_id } : null;
  }

  /**
   * Supprime définitivement — l'auteur son message, l'administrateur n'importe
   * lequel. Rend `false` si le commentaire n'existe pas ou n'appartient pas au
   * demandeur, sans distinguer les deux : le demandeur n'a pas à apprendre
   * qu'un identifiant qu'il a deviné correspond au message de quelqu'un.
   */
  remove(id: number, viewer: Viewer): boolean {
    const changes = viewer.admin
      ? this.db.prepare('DELETE FROM comments WHERE id = ?').run(id).changes
      : this.db
          .prepare('DELETE FROM comments WHERE id = ? AND username = ?')
          .run(id, viewer.username).changes;
    return changes > 0;
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
        `SELECT c.id, c.parent_id, c.username, u.display_name, c.body, c.created_at,
                c.hidden_at, c.hidden_by, c.album_id, c.media_id,
                a.title AS album_title, m.name AS media_name
           FROM comments c
           LEFT JOIN users u ON u.username = c.username
           LEFT JOIN albums a ON a.id = c.album_id
           -- LEFT JOIN : un commentaire survit à la disparition de sa photo de
           -- l'index (voir la migration 4). Il doit rester modérable.
           LEFT JOIN media m ON m.album_id = c.album_id AND m.id = c.media_id
           ${where}
           ORDER BY c.id DESC
           LIMIT ?`,
      )
      .all(...params, limit + 1) as (CommentRow & {
      hidden_by: string | null;
      album_id: string;
      media_id: string;
      album_title: string | null;
      media_name: string | null;
    })[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // L'administrateur peut tout supprimer : `canDelete` est vrai partout ici.
    const viewer: Viewer = { username: '', admin: true };
    const comments: AdminComment[] = page.map((row) => ({
      ...toComment(row, viewer),
      albumId: row.album_id,
      albumTitle: row.album_title ?? row.album_id,
      mediaId: row.media_id,
      mediaName: row.media_name,
      hiddenAt: row.hidden_at,
      hiddenBy: row.hidden_by,
    }));

    return {
      comments,
      nextCursor: hasMore ? String(page.at(-1)!.id) : null,
    };
  }

  /** Nombre de commentaires masqués, pour la pastille de la section modération. */
  hiddenCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM comments WHERE hidden_at IS NOT NULL')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Destinataires d'une notification : les administrateurs pour tout nouveau
   * commentaire, plus l'auteur de la racine quand il s'agit d'une réponse.
   *
   * L'auteur du message ne s'y trouve jamais — recevoir un email pour ce qu'on
   * vient d'écrire est le premier réflexe qui fait couper les notifications.
   * Les comptes sans adresse ou désabonnés sont écartés ici plutôt que par
   * l'appelant, pour que la règle ne vive qu'à un seul endroit.
   */
  recipientsFor(comment: { id: number; parentId: number | null; username: string }): {
    username: string;
    email: string;
    displayName: string;
    reason: 'admin' | 'reply';
  }[] {
    const rows = this.db
      .prepare(
        `SELECT u.username, u.email, u.display_name, u.admin,
                CASE WHEN p.username IS NULL THEN 0 ELSE 1 END AS is_parent_author
           FROM users u
           LEFT JOIN comments p ON p.id = ? AND p.username = u.username
          WHERE u.email IS NOT NULL AND TRIM(u.email) <> ''
            AND u.notify = 1
            AND u.username <> ?
            AND (u.admin = 1 OR p.username IS NOT NULL)`,
      )
      .all(comment.parentId, comment.username) as {
      username: string;
      email: string;
      display_name: string | null;
      admin: number;
      is_parent_author: number;
    }[];

    return rows.map((row) => ({
      username: row.username,
      email: row.email.trim(),
      displayName: row.display_name?.trim() || row.username,
      // Un administrateur qui a aussi écrit la racine est notifié une seule
      // fois, et c'est la réponse à son message qui motive l'envoi.
      reason: row.is_parent_author === 1 ? 'reply' : 'admin',
    }));
  }
}
