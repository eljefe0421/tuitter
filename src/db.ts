import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const XTRACT_DB_PATH = resolve(
  process.env.TUITTER_DB_PATH || resolve(process.cwd(), "..", "xtract", "prisma", "dev.db"),
);

let _db: Database | null = null;

function db(): Database {
  if (!_db) {
    _db = new Database(XTRACT_DB_PATH, { readonly: true });
    _db.exec("PRAGMA journal_mode = WAL");
  }
  return _db;
}

export interface BookmarkRow {
  id: string;
  tweetId: string;
  text: string;
  authorHandle: string;
  authorName: string;
  tweetCreatedAt: string | null;
  importedAt: string;
  semanticTags: string | null;
  entities: string | null;
  source: string;
  categories: string | null;
  categoryColors: string | null;
  mediaCount: number;
  firstMediaUrl: string | null;
  firstMediaType: string | null;
}

export interface BookmarkDetail extends BookmarkRow {
  rawJson: string;
  enrichmentMeta: string | null;
  mediaUrls: string | null;
  mediaTypes: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  count: number;
}

export interface AuthorRow {
  authorHandle: string;
  authorName: string;
  count: number;
}

const BOOKMARK_SELECT = `
  SELECT b.id, b.tweetId, b.text, b.authorHandle, b.authorName,
         b.tweetCreatedAt, b.importedAt, b.semanticTags, b.entities, b.source,
         GROUP_CONCAT(DISTINCT c.name) as categories,
         GROUP_CONCAT(DISTINCT c.color) as categoryColors,
         (SELECT COUNT(*) FROM MediaItem WHERE bookmarkId = b.id) as mediaCount,
         (SELECT url FROM MediaItem WHERE bookmarkId = b.id AND type = 'photo' LIMIT 1) as firstMediaUrl,
         (SELECT type FROM MediaItem WHERE bookmarkId = b.id LIMIT 1) as firstMediaType
  FROM Bookmark b
  LEFT JOIN BookmarkCategory bc ON bc.bookmarkId = b.id
  LEFT JOIN Category c ON c.id = bc.categoryId`;

export function listBookmarks(opts: {
  limit?: number;
  offset?: number;
  categorySlug?: string;
  authorHandle?: string;
  sort?: "newest" | "oldest";
}): BookmarkRow[] {
  const d = db();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const order = opts.sort === "oldest" ? "ASC" : "DESC";

  if (opts.authorHandle) {
    return d
      .prepare(
        `${BOOKMARK_SELECT}
      WHERE b.authorHandle = ?
      GROUP BY b.id
      ORDER BY COALESCE(b.tweetCreatedAt, b.importedAt) ${order}
      LIMIT ? OFFSET ?`,
      )
      .all(opts.authorHandle, limit, offset) as BookmarkRow[];
  }

  if (opts.categorySlug) {
    return d
      .prepare(
        `${BOOKMARK_SELECT}
      WHERE b.id IN (
        SELECT bc2.bookmarkId FROM BookmarkCategory bc2
        JOIN Category c2 ON c2.id = bc2.categoryId
        WHERE c2.slug = ?
      )
      GROUP BY b.id
      ORDER BY COALESCE(b.tweetCreatedAt, b.importedAt) ${order}
      LIMIT ? OFFSET ?`,
      )
      .all(opts.categorySlug, limit, offset) as BookmarkRow[];
  }

  return d
    .prepare(
      `${BOOKMARK_SELECT}
    GROUP BY b.id
    ORDER BY COALESCE(b.tweetCreatedAt, b.importedAt) ${order}
    LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as BookmarkRow[];
}

export function getBookmarkDetail(id: string): BookmarkDetail | null {
  return db()
    .prepare(
      `SELECT b.*,
       GROUP_CONCAT(DISTINCT c.name) as categories,
       GROUP_CONCAT(DISTINCT c.color) as categoryColors,
       (SELECT COUNT(*) FROM MediaItem WHERE bookmarkId = b.id) as mediaCount,
       (SELECT GROUP_CONCAT(url, '|||') FROM MediaItem WHERE bookmarkId = b.id) as mediaUrls,
       (SELECT GROUP_CONCAT(type, '|||') FROM MediaItem WHERE bookmarkId = b.id) as mediaTypes
    FROM Bookmark b
    LEFT JOIN BookmarkCategory bc ON bc.bookmarkId = b.id
    LEFT JOIN Category c ON c.id = bc.categoryId
    WHERE b.id = ?
    GROUP BY b.id`,
    )
    .get(id) as BookmarkDetail | null;
}

export function listCategories(): CategoryRow[] {
  return db()
    .prepare(
      `SELECT c.id, c.name, c.slug, c.color, c.description,
       COUNT(bc.bookmarkId) as count
    FROM Category c
    LEFT JOIN BookmarkCategory bc ON bc.categoryId = c.id
    GROUP BY c.id
    ORDER BY count DESC`,
    )
    .all() as CategoryRow[];
}

export function listAuthors(limit = 50): AuthorRow[] {
  return db()
    .prepare(
      `SELECT authorHandle, authorName, COUNT(*) as count
    FROM Bookmark
    GROUP BY authorHandle
    ORDER BY count DESC
    LIMIT ?`,
    )
    .all(limit) as AuthorRow[];
}

export function getAuthor(handle: string): AuthorRow | null {
  return db()
    .prepare(
      `SELECT authorHandle, authorName, COUNT(*) as count
    FROM Bookmark
    WHERE authorHandle = ?
    GROUP BY authorHandle`,
    )
    .get(handle) as AuthorRow | null;
}

export function searchBookmarks(query: string, limit = 50): BookmarkRow[] {
  const d = db();

  try {
    const terms = query
      .replace(/["*()]/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    if (terms.length > 0) {
      const match = terms.join(" OR ");
      const ftsIds = d
        .prepare(
          `SELECT bookmark_id FROM bookmark_fts
        WHERE bookmark_fts MATCH ?
        ORDER BY rank LIMIT ?`,
        )
        .all(match, limit) as { bookmark_id: string }[];

      if (ftsIds.length > 0) {
        const placeholders = ftsIds.map(() => "?").join(",");
        return d
          .prepare(
            `${BOOKMARK_SELECT}
          WHERE b.id IN (${placeholders})
          GROUP BY b.id`,
          )
          .all(...ftsIds.map((r) => r.bookmark_id)) as BookmarkRow[];
      }
    }
  } catch {
    // FTS table might not exist — fall through to LIKE
  }

  const pattern = `%${query}%`;
  return d
    .prepare(
      `${BOOKMARK_SELECT}
    WHERE b.text LIKE ? OR b.authorHandle LIKE ? OR b.authorName LIKE ? OR b.semanticTags LIKE ?
    GROUP BY b.id
    LIMIT ?`,
    )
    .all(pattern, pattern, pattern, pattern, limit) as BookmarkRow[];
}

export function totalBookmarkCount(categorySlug?: string, authorHandle?: string): number {
  const d = db();
  if (authorHandle) {
    return (
      d.prepare(`SELECT COUNT(*) as c FROM Bookmark WHERE authorHandle = ?`).get(authorHandle) as {
        c: number;
      }
    ).c;
  }
  if (categorySlug) {
    return (
      d
        .prepare(
          `SELECT COUNT(DISTINCT bc.bookmarkId) as c
      FROM BookmarkCategory bc
      JOIN Category c ON c.id = bc.categoryId
      WHERE c.slug = ?`,
        )
        .get(categorySlug) as { c: number }
    ).c;
  }
  return (d.prepare("SELECT COUNT(*) as c FROM Bookmark").get() as { c: number }).c;
}

export function getStats() {
  const d = db();
  const bookmarks = (d.prepare("SELECT COUNT(*) as c FROM Bookmark").get() as { c: number }).c;
  const categories = (d.prepare("SELECT COUNT(*) as c FROM Category").get() as { c: number }).c;
  const media = (d.prepare("SELECT COUNT(*) as c FROM MediaItem").get() as { c: number }).c;
  const authors = (
    d.prepare("SELECT COUNT(DISTINCT authorHandle) as c FROM Bookmark").get() as { c: number }
  ).c;
  return { bookmarks, categories, media, authors };
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
