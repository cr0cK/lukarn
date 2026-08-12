import {
  remainingEditMs,
  type AdminComment,
  type AdminCommentsPage,
  type Comment,
  type CommentThread,
  type CommentsFeedPage,
  type CommentsPage,
  type FeedComment,
  type ModerationQuery,
} from '@nonni/shared';
import type { Db } from './db.js';

/**
 * Comment repository: reading a thread, writing, deleting and moderating.
 *
 * A comment is signed by an **identity** (`commenters`), not by the access key used
 * to open the album: the same username may be shared by several people, and each
 * must sign with their own name. The access key is still retained in `account`
 * because it is what gets changed when a password has circulated too widely.
 *
 * A thread belongs to the `(albumId, mediaId)` pair, not to the media alone. The
 * same Drive file indexed under two albums carries two separate conversations:
 * merging them would show a visitor what was said in an album they may not view,
 * while the rest of the application isolates data by album (D12).
 *
 * All reads exclude hidden comments except moderation reads. This is the only place
 * that decides visibility — duplicating the rule in a route would eventually diverge.
 */

/** Who is reading. Determines `canDelete` and access to hidden comments. */
export interface Viewer {
  /** Current identity, `null` if nobody has identified themselves in the session. */
  commenterId: number | null;
  admin: boolean;
}

export interface CreateCommentInput {
  albumId: string;
  mediaId: string;
  commenterId: number;
  /** Access key used, retained for moderation. */
  account: string;
  body: string;
  /** Comment being replied to, or `null` to open a thread. */
  parentId: number | null;
}

/** What the activity feed requests from the repository. */
export interface FeedQuery {
  /**
   * Albums the requester may view. An empty list returns an empty page — not the
   * entire corpus, as an omitted `IN ()` would.
   */
  albumIds: string[];
  /** Identifier of the previous page's last row, `null` for the first page. */
  cursor: number | null;
  limit: number;
  viewer: Viewer;
}

/**
 * Creation failure that must become a precise HTTP response rather than a 500. The
 * only case is replying to a comment that does not exist or belongs to another media
 * item — the latter attempts to attach a message to a conversation that cannot be read.
 */
export class UnknownParentError extends Error {
  constructor() {
    super('The comment you are replying to no longer exists.');
    this.name = 'UnknownParentError';
  }
}

/**
 * The editing window has closed. Distinct from denied access: the comment does belong
 * to the requester, but its **state** no longer permits editing. The route therefore
 * returns 409 rather than the 404 used for access denials.
 */
export class EditWindowClosedError extends Error {
  constructor() {
    super('The window for correcting this comment has closed.');
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
    // The administrator may remove anything; everyone may remove what they wrote.
    canDelete: viewer.admin || mine,
    // Editing is not moderating: the administrator may hide or delete, but never
    // rewrite. Putting different words in someone's mouth under their name would
    // be a fundamentally different power from removing a statement.
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

  /* -------------------------------------------------------------------- reading */

  /**
   * Thread for a media item, with roots in chronological order and replies below
   * their root. Hidden comments are absent even for their author: letting someone
   * believe their message is being read when it no longer is would be a lie by omission.
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

    // One pass is enough: ID order is insertion order, so a root always precedes
    // its replies.
    for (const row of rows) {
      const comment = toComment(row, viewer);
      if (row.parent_id === null) {
        const thread: CommentThread = { root: comment, replies: [] };
        byId.set(comment.id, thread);
        threads.push(thread);
        continue;
      }
      // A reply whose root is hidden no longer has a thread to attach to. Leaving
      // it out would make it disappear without anyone deciding to remove it, so it
      // is promoted to a thread root with `parentId` reset to `null`, making the
      // returned shape truthful.
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
   * Counts for a whole album, excluding hidden comments and omitting uncommented photos.
   *
   * Grouping happens in the database rather than memory: `idx_comments_thread`
   * carries `(album_id, media_id, id)`, so SQLite reads the album slice already
   * ordered by media. Returning rows individually to count them on the server would
   * traverse every photo's full thread only to retain one integer.
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

  /**
   * Activity feed: the latest comments from albums the requester may view, newest
   * first, across all albums and photos.
   *
   * **`albumIds` is the only isolation boundary.** Nothing else in this query limits
   * its scope, and a caller passing every album in the instance would serve a visitor
   * conversations from albums they do not have. The list comes from `albumsFor()`,
   * never from the client.
   *
   * Ordering follows the primary key in descending order: SQLite scans the table
   * backwards and stops at `LIMIT`, with no sorting or extra index. The cost of this
   * choice appears in one case — an account that sees only one album out of fifty
   * scans comments from the other forty-nine before assembling its page. For a family
   * gallery's corpus, this remains a scan of a few thousand rows; an
   * `(album_id, id DESC)` index would not avoid it because SQLite cannot merge the
   * order of several slices from an `IN`.
   */
  listFeed(query: FeedQuery): CommentsFeedPage {
    if (query.albumIds.length === 0) return { comments: [], nextCursor: null };

    const conditions = ['c.hidden_at IS NULL'];
    const params: (string | number)[] = [];

    conditions.push(`c.album_id IN (${query.albumIds.map(() => '?').join(', ')})`);
    params.push(...query.albumIds);

    if (query.cursor !== null) {
      conditions.push('c.id < ?');
      params.push(query.cursor);
    }

    const rows = this.db
      .prepare(
        `SELECT c.id, c.parent_id, c.commenter_id, a.display_name, c.body, c.created_at,
                c.hidden_at, c.album_id, c.media_id,
                al.title AS album_title, m.name AS media_name, m.md5 AS media_md5
           FROM comments c
           JOIN commenters a ON a.id = c.commenter_id
           LEFT JOIN albums al ON al.id = c.album_id
           -- LEFT JOIN, for the same reason as in moderation: a comment survives its
           -- photo disappearing from the index (migration 4).
           LEFT JOIN media m ON m.album_id = c.album_id AND m.id = c.media_id
           ${where(conditions)}
           ORDER BY c.id DESC
           LIMIT ?`,
      )
      .all(...params, query.limit + 1) as (CommentRow & {
      album_id: string;
      media_id: string;
      album_title: string | null;
      media_name: string | null;
      media_md5: string | null;
    })[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const comments: FeedComment[] = page.map((row) => ({
      ...toComment(row, query.viewer),
      albumId: row.album_id,
      albumTitle: row.album_title ?? row.album_id,
      mediaId: row.media_id,
      mediaName: row.media_name,
      // Same truncation as in `repo.ts`: the thumbnail is served as `immutable`, so
      // its URL must change when the Drive file's content changes.
      mediaVersion: row.media_md5 ? row.media_md5.slice(0, 8) : null,
    }));

    return { comments, nextCursor: hasMore ? String(page.at(-1)!.id) : null };
  }

  /** Count displayed with media details, excluding hidden comments. */
  countFor(albumId: string, mediaId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM comments
          WHERE album_id = ? AND media_id = ? AND hidden_at IS NULL`,
      )
      .get(albumId, mediaId) as { count: number };
    return row.count;
  }

  /* -------------------------------------------------------------------- writing */

  /**
   * Publishes a comment. Replying to a reply attaches the message to the thread root
   * rather than refusing it: the user clicked "Reply" below a message, so the intent
   * is clear, while a second nesting level would turn the panel into a forum.
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
   * Root of the thread identified by `parentId`, after verifying that it belongs to
   * this media item. Without this check, a client could graft a reply onto a thread
   * from another album by guessing an identifier.
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
   * Edits a comment within the window following publication.
   *
   * Reserved for its author, including when the author is an administrator — the
   * administrator has no special privilege here and moderates by hiding, not rewriting.
   *
   * Returns `false` if the comment does not exist, does not belong to the requester,
   * or has since been hidden. These three cases are indistinguishable for the same
   * reason as in `remove`. An elapsed window **throws**: it is the only refusal the
   * author should be able to understand, since it concerns their own message and
   * reveals nothing.
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

    // `created_at` remains the publication time: the message must not move within
    // the thread while people are already reading it.
    this.db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(body, id);
    return this.byId(id, viewer, now);
  }

  /** Returns the comment as this reader would see it, including hidden comments. */
  byId(id: number, viewer: Viewer, now = Date.now()): Comment | null {
    const row = this.db.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).get(id) as
      CommentRow | undefined;
    return row ? toComment(row, viewer, now) : null;
  }

  /** Album and media carrying this comment, used to reconstruct a link. */
  locate(id: number): { albumId: string; mediaId: string } | null {
    const row = this.db.prepare('SELECT album_id, media_id FROM comments WHERE id = ?').get(id) as
      { album_id: string; media_id: string } | undefined;
    return row ? { albumId: row.album_id, mediaId: row.media_id } : null;
  }

  /**
   * Deletes permanently — each person their own message, the administrator any
   * message. Returns `false` if the comment does not exist or does not belong to the
   * requester, without distinguishing the two: the requester must not learn that a
   * guessed identifier belongs to someone else's message.
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

  /* ---------------------------------------------------------------- moderation */

  /** Hide rather than delete so the decision remains reversible. */
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
   * Moderation queue, newest to oldest, across all albums.
   *
   * The cursor is a simple identifier: `AUTOINCREMENT` guarantees that ID order is
   * insertion order, avoiding the composite cursor required by media pagination
   * (see `repo.ts`).
   *
   * Moderating is not browsing: the user arrives with an intent — a reported message,
   * a day, an address. Hence the filter, album and search, and `total`, which reports
   * everything retained by the filter (D67).
   */
  listForModeration(query: ModerationQuery): AdminCommentsPage {
    const { conditions, params } = moderationConditions(query);

    // The total ignores the cursor: it is the size of the filtered corpus, not the
    // remainder to browse. The album and media `LEFT JOIN`s are unnecessary here —
    // they do not change the number of rows.
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM comments c
           JOIN commenters a ON a.id = c.commenter_id
           ${where(conditions)}`,
      )
      .get(...params) as { count: number };

    if (query.cursor !== null) {
      conditions.push('c.id < ?');
      params.push(query.cursor);
    }

    const rows = this.db
      .prepare(
        `SELECT c.id, c.parent_id, c.commenter_id, a.display_name, a.email, c.body, c.created_at,
                c.hidden_at, c.hidden_by, c.album_id, c.media_id, c.account,
                al.title AS album_title, m.name AS media_name
           FROM comments c
           JOIN commenters a ON a.id = c.commenter_id
           LEFT JOIN albums al ON al.id = c.album_id
           -- LEFT JOIN: a comment survives its photo disappearing from the index
           -- (see migration 4). It must remain available for moderation.
           LEFT JOIN media m ON m.album_id = c.album_id AND m.id = c.media_id
           ${where(conditions)}
           ORDER BY c.id DESC
           LIMIT ?`,
      )
      .all(...params, query.limit + 1) as (CommentRow & {
      email: string;
      hidden_by: string | null;
      album_id: string;
      media_id: string;
      account: string | null;
      album_title: string | null;
      media_name: string | null;
    })[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    // The administrator may delete anything, so `canDelete` is true throughout here.
    const viewer: Viewer = { commenterId: null, admin: true };
    const comments: AdminComment[] = page.map((row) => ({
      ...toComment(row, viewer),
      albumId: row.album_id,
      albumTitle: row.album_title ?? row.album_id,
      mediaId: row.media_id,
      mediaName: row.media_name,
      authorEmail: row.email,
      commenterId: row.commenter_id,
      account: row.account,
      hiddenAt: row.hidden_at,
      hiddenBy: row.hidden_by,
    }));

    return {
      comments,
      nextCursor: hasMore ? String(page.at(-1)!.id) : null,
      total: totalRow.count,
    };
  }

  /**
   * Hides every still-visible message from an identity and returns their count.
   *
   * This follows an access key that has circulated too widely or a commenter who
   * has become persistent: nobody will remove the messages one by one.
   * `AND hidden_at IS NULL` preserves the date of an already hidden message — the
   * original decision date is what matters, following the same rule as a single item.
   */
  hideAllFrom(commenterId: number, by: string): number {
    return this.db
      .prepare(
        `UPDATE comments SET hidden_at = ?, hidden_by = ?
          WHERE commenter_id = ? AND hidden_at IS NULL`,
      )
      .run(new Date().toISOString(), by, commenterId).changes;
  }

  /** Makes every hidden message from an identity visible and returns their count. */
  showAllFrom(commenterId: number): number {
    return this.db
      .prepare(
        `UPDATE comments SET hidden_at = NULL, hidden_by = NULL
          WHERE commenter_id = ? AND hidden_at IS NOT NULL`,
      )
      .run(commenterId).changes;
  }

  /** Number of hidden comments, for the moderation section badge. */
  hiddenCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM comments WHERE hidden_at IS NOT NULL')
      .get() as { count: number };
    return row.count;
  }
}

/**
 * Escapes `LIKE` wildcards.
 *
 * Without this, a `%` entered in search would return the whole corpus and `_` would
 * replace any character: the query would search for something other than what was
 * entered, with no indication of the difference.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function where(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * Conditions shared by the count and the page — except the cursor, which only applies
 * to the latter. Writing them twice would let them diverge, and the total would
 * describe a different corpus from the one being listed.
 */
function moderationConditions(query: ModerationQuery): {
  conditions: string[];
  params: (string | number)[];
} {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.filter === 'hidden') conditions.push('c.hidden_at IS NOT NULL');
  if (query.filter === 'visible') conditions.push('c.hidden_at IS NULL');

  if (query.albumId !== null) {
    conditions.push('c.album_id = ?');
    params.push(query.albumId);
  }

  if (query.q !== null) {
    // Search the name and address as well as the body: users may look for a reported
    // word or for the person who wrote it.
    conditions.push(
      `(c.body LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\' OR a.email LIKE ? ESCAPE '\\')`,
    );
    const pattern = `%${escapeLike(query.q)}%`;
    params.push(pattern, pattern, pattern);
  }

  return { conditions, params };
}
