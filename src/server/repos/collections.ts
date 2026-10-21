import { nanoid } from 'nanoid';
import type { CollectionSummary, SnippetSummary } from '../../shared/api.ts';
import { SHARE_ID_LENGTH } from '../../shared/constants.ts';
import type { Db } from '../db.ts';
import { SELECT_SUMMARY, nextUpdatedAt, toSummary } from './snippets.ts';

/** Server-side view of a collection; `id`, `userId` and the password hash never leave the server. */
export interface CollectionRecord extends Omit<CollectionSummary, 'hasPassword' | 'snippetCount'> {
  id: string;
  userId: string;
  passwordHash: string | null;
  /** bumped on every password change so outstanding unlock tokens stop working */
  passwordVersion: number;
  snippetCount: number;
}

interface CollectionRow {
  id: string;
  share_id: string;
  user_id: string;
  title: string;
  description: string;
  password_hash: string | null;
  password_version: number;
  snippet_count: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT c.id, c.share_id, c.user_id, c.title, c.description, c.password_hash, c.password_version,
         (SELECT COUNT(*) FROM collection_snippets cs WHERE cs.collection_id = c.id) AS snippet_count,
         c.created_at, c.updated_at
  FROM collections c`;

function toRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    shareId: row.share_id,
    title: row.title,
    description: row.description,
    passwordHash: row.password_hash,
    passwordVersion: row.password_version,
    snippetCount: row.snippet_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCollectionSummary(record: CollectionRecord): CollectionSummary {
  return {
    shareId: record.shareId,
    title: record.title,
    description: record.description,
    hasPassword: record.passwordHash !== null,
    snippetCount: record.snippetCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface CollectionData {
  title: string;
  description?: string;
  /** undefined keeps the current hash, null removes it */
  passwordHash?: string | null;
}

export function createCollectionsRepo(db: Db) {
  const insert = db.prepare(`
    INSERT INTO collections (id, share_id, user_id, title, description, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const byShareId = db.prepare(`${SELECT} WHERE c.share_id = ?`);
  const byId = db.prepare(`${SELECT} WHERE c.id = ?`);
  const listByUser = db.prepare(`${SELECT} WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.rowid DESC`);
  const update = db.prepare(`
    UPDATE collections SET title = ?, description = ?, password_hash = ?, password_version = ?, updated_at = ?
    WHERE id = ?`);
  const touch = db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM collections WHERE id = ?');
  const addSnippet = db.prepare(
    'INSERT OR IGNORE INTO collection_snippets (collection_id, snippet_id, added_at) VALUES (?, ?, ?)',
  );
  const removeSnippet = db.prepare('DELETE FROM collection_snippets WHERE collection_id = ? AND snippet_id = ?');
  const listSnippets = db.prepare(`${SELECT_SUMMARY}
    JOIN collection_snippets cs ON cs.snippet_id = s.id
    WHERE cs.collection_id = ?
    ORDER BY s.updated_at DESC, s.rowid DESC`);

  function findByShareId(shareId: string): CollectionRecord | undefined {
    const row = byShareId.get(shareId) as CollectionRow | undefined;
    return row && toRecord(row);
  }

  function bump(record: CollectionRecord): void {
    touch.run(nextUpdatedAt(record.updatedAt), record.id);
  }

  return {
    findByShareId,

    findById(id: string): CollectionRecord | undefined {
      const row = byId.get(id) as CollectionRow | undefined;
      return row && toRecord(row);
    },

    create(userId: string, data: CollectionData): CollectionRecord {
      const now = new Date().toISOString();
      const shareId = nanoid(SHARE_ID_LENGTH);
      insert.run(nanoid(), shareId, userId, data.title, data.description ?? '', data.passwordHash ?? null, now, now);
      return findByShareId(shareId)!;
    },

    listByUser(userId: string): CollectionRecord[] {
      return (listByUser.all(userId) as unknown as CollectionRow[]).map(toRecord);
    },

    update(existing: CollectionRecord, data: CollectionData): CollectionRecord {
      const passwordChanged = data.passwordHash !== undefined;
      update.run(
        data.title,
        data.description ?? existing.description,
        passwordChanged ? data.passwordHash! : existing.passwordHash,
        passwordChanged ? existing.passwordVersion + 1 : existing.passwordVersion,
        nextUpdatedAt(existing.updatedAt),
        existing.id,
      );
      return findByShareId(existing.shareId)!;
    },

    delete(id: string): boolean {
      return remove.run(id).changes > 0;
    },

    addSnippet(collection: CollectionRecord, snippetId: string): void {
      if (addSnippet.run(collection.id, snippetId, new Date().toISOString()).changes > 0) bump(collection);
    },

    removeSnippet(collection: CollectionRecord, snippetId: string): void {
      if (removeSnippet.run(collection.id, snippetId).changes > 0) bump(collection);
    },

    listSnippets(collectionId: string, viewerId: string | undefined): SnippetSummary[] {
      const rows = listSnippets.all(collectionId) as unknown as Parameters<typeof toSummary>[0][];
      return rows.map((r) => toSummary(r, viewerId));
    },
  };
}

export type CollectionsRepo = ReturnType<typeof createCollectionsRepo>;
