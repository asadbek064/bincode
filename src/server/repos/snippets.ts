import { nanoid } from 'nanoid';
import type { Snippet, SnippetInput, SnippetSummary, Visibility } from '../../shared/api.ts';
import { DEFAULT_VISIBILITY, SHARE_ID_LENGTH } from '../../shared/constants.ts';
import type { Db } from '../db.ts';

/** Server-side view of a snippet; `id`, `userId` and the fork source's owner never leave the server. */
export interface SnippetRecord extends Omit<Snippet, 'isOwner' | 'collections'> {
  id: string;
  userId: string;
  /** owner and visibility of the fork source, used to hide private sources from other viewers */
  forkedFromUserId: string | null;
  forkedFromVisibility: Visibility | null;
}

interface SnippetRow {
  id: string;
  share_id: string;
  user_id: string;
  title: string;
  html: string;
  css: string;
  js: string;
  visibility: Visibility;
  forked_from_share_id: string | null;
  forked_from_user_id: string | null;
  forked_from_visibility: Visibility | null;
  created_at: string;
  updated_at: string;
}

type SummaryRow = Pick<
  SnippetRow,
  | 'share_id'
  | 'user_id'
  | 'title'
  | 'visibility'
  | 'forked_from_share_id'
  | 'forked_from_user_id'
  | 'forked_from_visibility'
  | 'created_at'
  | 'updated_at'
>;

const FORK_COLUMNS = `src.share_id AS forked_from_share_id, src.user_id AS forked_from_user_id,
         src.visibility AS forked_from_visibility`;

const SELECT_FULL = `
  SELECT s.id, s.share_id, s.user_id, s.title, s.html, s.css, s.js, s.visibility,
         ${FORK_COLUMNS}, s.created_at, s.updated_at
  FROM snippets s
  LEFT JOIN snippets src ON src.id = s.forked_from`;

export const SELECT_SUMMARY = `
  SELECT s.share_id, s.user_id, s.title, s.visibility, ${FORK_COLUMNS}, s.created_at, s.updated_at
  FROM snippets s
  LEFT JOIN snippets src ON src.id = s.forked_from`;

function toRecord(row: SnippetRow): SnippetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    shareId: row.share_id,
    title: row.title,
    html: row.html,
    css: row.css,
    js: row.js,
    visibility: row.visibility,
    forkedFrom: row.forked_from_share_id,
    forkedFromUserId: row.forked_from_user_id,
    forkedFromVisibility: row.forked_from_visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A private fork source's shareId is only shown to the source's owner. */
function visibleForkedFrom(
  shareId: string | null,
  sourceUserId: string | null,
  sourceVisibility: Visibility | null,
  viewerId: string | undefined,
): string | null {
  if (shareId === null) return null;
  if (sourceVisibility === 'private' && sourceUserId !== viewerId) return null;
  return shareId;
}

export function toSummary(row: SummaryRow, viewerId: string | undefined): SnippetSummary {
  return {
    shareId: row.share_id,
    title: row.title,
    visibility: row.visibility,
    forkedFrom: visibleForkedFrom(row.forked_from_share_id, row.forked_from_user_id, row.forked_from_visibility, viewerId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSnippet(record: SnippetRecord, viewerId: string | undefined, collections?: string[]): Snippet {
  const { id: _id, userId, forkedFromUserId, forkedFromVisibility, ...rest } = record;
  const isOwner = viewerId !== undefined && viewerId === userId;
  return {
    ...rest,
    forkedFrom: visibleForkedFrom(record.forkedFrom, forkedFromUserId, forkedFromVisibility, viewerId),
    isOwner,
    ...(isOwner && collections ? { collections } : {}),
  };
}

/** Clients use updatedAt to detect changes, so it must move even within the same millisecond. */
export function nextUpdatedAt(previous: string): string {
  const prev = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(nowMs > prev ? nowMs : prev + 1).toISOString();
}

export function createSnippetsRepo(db: Db) {
  const insert = db.prepare(`
    INSERT INTO snippets (id, share_id, user_id, title, html, css, js, visibility, forked_from, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byShareId = db.prepare(`${SELECT_FULL} WHERE s.share_id = ?`);
  const listByUser = db.prepare(`${SELECT_SUMMARY}
    WHERE s.user_id = ?
    ORDER BY s.updated_at DESC, s.rowid DESC`);
  const update = db.prepare(
    'UPDATE snippets SET title = ?, html = ?, css = ?, js = ?, visibility = ?, updated_at = ? WHERE id = ?',
  );
  const remove = db.prepare('DELETE FROM snippets WHERE id = ?');
  const inCollection = db.prepare('SELECT 1 AS hit FROM collection_snippets WHERE collection_id = ? AND snippet_id = ?');
  const collectionsOf = db.prepare(`
    SELECT c.share_id FROM collection_snippets cs
    JOIN collections c ON c.id = cs.collection_id
    WHERE cs.snippet_id = ?
    ORDER BY c.title, c.rowid`);

  function findByShareId(shareId: string): SnippetRecord | undefined {
    const row = byShareId.get(shareId) as SnippetRow | undefined;
    return row && toRecord(row);
  }

  return {
    findByShareId,

    create(userId: string, input: SnippetInput, forkedFromId: string | null = null): SnippetRecord {
      const now = new Date().toISOString();
      const shareId = nanoid(SHARE_ID_LENGTH);
      const visibility = input.visibility ?? DEFAULT_VISIBILITY;
      insert.run(nanoid(), shareId, userId, input.title, input.html, input.css, input.js, visibility, forkedFromId, now, now);
      return findByShareId(shareId)!;
    },

    listByUser(userId: string): SnippetSummary[] {
      const rows = listByUser.all(userId) as unknown as SummaryRow[];
      return rows.map((r) => toSummary(r, userId));
    },

    update(existing: SnippetRecord, input: SnippetInput): SnippetRecord {
      const visibility = input.visibility ?? existing.visibility;
      update.run(input.title, input.html, input.css, input.js, visibility, nextUpdatedAt(existing.updatedAt), existing.id);
      return findByShareId(existing.shareId)!;
    },

    delete(id: string): boolean {
      return remove.run(id).changes > 0;
    },

    isInCollection(snippetId: string, collectionId: string): boolean {
      return inCollection.get(collectionId, snippetId) !== undefined;
    },

    collectionsOf(snippetId: string): string[] {
      return (collectionsOf.all(snippetId) as { share_id: string }[]).map((r) => r.share_id);
    },
  };
}

export type SnippetsRepo = ReturnType<typeof createSnippetsRepo>;
