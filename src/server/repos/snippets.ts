import { nanoid } from 'nanoid';
import type { Snippet, SnippetInput, SnippetSummary } from '../../shared/api.ts';
import { SHARE_ID_LENGTH } from '../../shared/constants.ts';
import type { Db } from '../db.ts';

/** Server-side view of a snippet; `id` and `userId` never leave the server. */
export interface SnippetRecord extends Omit<Snippet, 'isOwner'> {
  id: string;
  userId: string;
}

interface SnippetRow {
  id: string;
  share_id: string;
  user_id: string;
  title: string;
  html: string;
  css: string;
  js: string;
  forked_from_share_id: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_FULL = `
  SELECT s.id, s.share_id, s.user_id, s.title, s.html, s.css, s.js,
         src.share_id AS forked_from_share_id, s.created_at, s.updated_at
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
    forkedFrom: row.forked_from_share_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSnippet(record: SnippetRecord, viewerId: string | undefined): Snippet {
  const { id: _id, userId, ...rest } = record;
  return { ...rest, isOwner: viewerId !== undefined && viewerId === userId };
}

export function createSnippetsRepo(db: Db) {
  const insert = db.prepare(`
    INSERT INTO snippets (id, share_id, user_id, title, html, css, js, forked_from, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byShareId = db.prepare(`${SELECT_FULL} WHERE s.share_id = ?`);
  const listByUser = db.prepare(`
    SELECT s.share_id, s.title, src.share_id AS forked_from_share_id, s.created_at, s.updated_at
    FROM snippets s
    LEFT JOIN snippets src ON src.id = s.forked_from
    WHERE s.user_id = ?
    ORDER BY s.updated_at DESC, s.rowid DESC`);
  const update = db.prepare('UPDATE snippets SET title = ?, html = ?, css = ?, js = ?, updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM snippets WHERE id = ?');

  function findByShareId(shareId: string): SnippetRecord | undefined {
    const row = byShareId.get(shareId) as SnippetRow | undefined;
    return row && toRecord(row);
  }

  return {
    findByShareId,

    create(userId: string, input: SnippetInput, forkedFromId: string | null = null): SnippetRecord {
      const now = new Date().toISOString();
      const shareId = nanoid(SHARE_ID_LENGTH);
      insert.run(nanoid(), shareId, userId, input.title, input.html, input.css, input.js, forkedFromId, now, now);
      return findByShareId(shareId)!;
    },

    listByUser(userId: string): SnippetSummary[] {
      const rows = listByUser.all(userId) as unknown as Omit<SnippetRow, 'id' | 'user_id' | 'html' | 'css' | 'js'>[];
      return rows.map((r) => ({
        shareId: r.share_id,
        title: r.title,
        forkedFrom: r.forked_from_share_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    update(existing: SnippetRecord, input: SnippetInput): SnippetRecord {
      // Clients use updatedAt to detect changes, so it must move even within the same millisecond.
      const prev = Date.parse(existing.updatedAt);
      const nowMs = Date.now();
      const updatedAt = new Date(nowMs > prev ? nowMs : prev + 1).toISOString();
      update.run(input.title, input.html, input.css, input.js, updatedAt, existing.id);
      return findByShareId(existing.shareId)!;
    },

    delete(id: string): boolean {
      return remove.run(id).changes > 0;
    },
  };
}

export type SnippetsRepo = ReturnType<typeof createSnippetsRepo>;
