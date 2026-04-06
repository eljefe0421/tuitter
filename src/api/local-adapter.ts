/**
 * Local data adapter: maps Xtract SQLite bookmark rows to tuitter's
 * ExpandedPost / XUser / XMedia types so the views work unchanged.
 */

import type { ExpandedPost, TimelinePage, XMedia, XPost, XUser } from "../types.js";
import {
  type BookmarkRow,
  type BookmarkDetail,
  type AuthorRow,
  listBookmarks,
  getBookmarkDetail,
  searchBookmarks,
  totalBookmarkCount,
  getAuthor,
} from "../db.js";

function rowToPost(row: BookmarkRow): XPost {
  return {
    id: row.id,
    author_id: row.authorHandle,
    text: row.text,
    created_at: row.tweetCreatedAt ?? row.importedAt,
    public_metrics: {
      like_count: 0,
      reply_count: 0,
      retweet_count: 0,
    },
  };
}

function rowToUser(row: BookmarkRow): XUser {
  return {
    id: row.authorHandle,
    name: row.authorName,
    username: row.authorHandle,
  };
}

function rowToMedia(row: BookmarkRow): XMedia[] {
  if (!row.firstMediaUrl) return [];
  return [
    {
      media_key: `${row.id}-media-0`,
      type: (row.firstMediaType as XMedia["type"]) ?? "photo",
      url: row.firstMediaUrl,
    },
  ];
}

function detailToMedia(detail: BookmarkDetail): XMedia[] {
  if (!detail.mediaUrls) return [];
  const urls = detail.mediaUrls.split("|||");
  const types = detail.mediaTypes?.split("|||") ?? [];
  return urls.map((url, i) => ({
    media_key: `${detail.id}-media-${i}`,
    type: (types[i] as XMedia["type"]) ?? "photo",
    url,
  }));
}

export function bookmarkToExpandedPost(row: BookmarkRow): ExpandedPost {
  return {
    post: rowToPost(row),
    author: rowToUser(row),
    media: rowToMedia(row),
  };
}

export function bookmarkDetailToExpandedPost(detail: BookmarkDetail): ExpandedPost {
  return {
    post: rowToPost(detail),
    author: rowToUser(detail),
    media: detailToMedia(detail),
  };
}

export function authorRowToUser(row: AuthorRow): XUser {
  return {
    id: row.authorHandle,
    name: row.authorName,
    username: row.authorHandle,
    public_metrics: {
      tweet_count: row.count,
    },
  };
}

// --- Drop-in replacements for API functions ---

export function getLocalTimeline(opts: {
  offset?: number;
  maxResults?: number;
  categorySlug?: string;
}): TimelinePage {
  const limit = opts.maxResults ?? 20;
  const offset = opts.offset ?? 0;
  const rows = listBookmarks({ limit: limit + 1, offset, categorySlug: opts.categorySlug });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(bookmarkToExpandedPost),
    nextToken: hasMore ? String(offset + limit) : undefined,
  };
}

export function getLocalUserTimeline(authorHandle: string, opts: {
  offset?: number;
  maxResults?: number;
}): TimelinePage {
  const limit = opts.maxResults ?? 20;
  const offset = opts.offset ?? 0;
  const rows = listBookmarks({ limit: limit + 1, offset, authorHandle });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(bookmarkToExpandedPost),
    nextToken: hasMore ? String(offset + limit) : undefined,
  };
}

export function getLocalPostDetail(postId: string): ExpandedPost | null {
  const detail = getBookmarkDetail(postId);
  if (!detail) return null;
  return bookmarkDetailToExpandedPost(detail);
}

export function getLocalUser(handle: string): XUser | null {
  const row = getAuthor(handle);
  if (!row) return null;
  return authorRowToUser(row);
}

export function searchLocal(query: string, limit = 50): TimelinePage {
  const rows = searchBookmarks(query, limit);
  return {
    items: rows.map(bookmarkToExpandedPost),
  };
}

export function getLocalStats() {
  return {
    totalBookmarks: totalBookmarkCount(),
  };
}
