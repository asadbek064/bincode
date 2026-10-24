import { nanoid } from 'nanoid';
import type { BackupBin, BackupCollection, BackupFile, ImportSummary } from '../../shared/api.ts';
import { SHARE_ID_LENGTH } from '../../shared/constants.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../middleware/error.ts';
import type { Quotas } from '../middleware/security.ts';
import { NOT_EXPIRED } from './snippets.ts';

interface BinRow {
  share_id: string;
  title: string;
  html: string;
  css: string;
  js: string;
  visibility: BackupBin['visibility'];
  password_hash: string | null;
  expires_at: string | null;
  burn_after_read: number;
  forked_from_share_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  share_id: string;
  title: string;
  description: string;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

type Kind = 'snippet' | 'collection';

export function createBackupRepo(db: Db) {
  const exportBins = db.prepare(`
    SELECT s.share_id, s.title, s.html, s.css, s.js, s.visibility, s.password_hash, s.expires_at,
           s.burn_after_read, src.share_id AS forked_from_share_id, s.created_at, s.updated_at
    FROM snippets s
    LEFT JOIN snippets src ON src.id = s.forked_from
    WHERE s.user_id = ? AND ${NOT_EXPIRED}
    ORDER BY s.created_at, s.rowid`);
  const exportCollections = db.prepare(`
    SELECT id, share_id, title, description, password_hash, created_at, updated_at
    FROM collections WHERE user_id = ? ORDER BY created_at, rowid`);
  const exportMembers = db.prepare(`
    SELECT s.share_id FROM collection_snippets cs JOIN snippets s ON s.id = cs.snippet_id
    WHERE cs.collection_id = ? AND ${NOT_EXPIRED}
    ORDER BY cs.added_at, s.rowid`);

  const snippetOwner = db.prepare('SELECT id, user_id FROM snippets WHERE share_id = ?');
  const collectionOwner = db.prepare('SELECT id, user_id FROM collections WHERE share_id = ?');
  const retired = db.prepare('SELECT user_id FROM retired_share_ids WHERE share_id = ? AND kind = ?');
  const unretire = db.prepare('DELETE FROM retired_share_ids WHERE share_id = ? AND kind = ?');
  const insertBin = db.prepare(`
    INSERT INTO snippets (id, share_id, user_id, title, html, css, js, visibility, password_hash, expires_at,
                          burn_after_read, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const setForkedFrom = db.prepare('UPDATE snippets SET forked_from = ? WHERE id = ?');
  const insertCollection = db.prepare(`
    INSERT INTO collections (id, share_id, user_id, title, description, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO collection_snippets (collection_id, snippet_id, added_at) VALUES (?, ?, ?)',
  );
  const usage = db.prepare(`
    SELECT (SELECT COUNT(*) FROM snippets WHERE user_id = ?1) AS bins,
           (SELECT COALESCE(SUM(length(html) + length(css) + length(js)), 0) FROM snippets WHERE user_id = ?1) AS chars,
           (SELECT COUNT(*) FROM collections WHERE user_id = ?1) AS collections`);

  /**
   * Where an imported item goes: 'skip' (already the importer's), the original shareId (free, or only
   * ever the importer's), or a fresh one — never a link that is or was someone else's.
   */
  function placement(kind: Kind, shareId: string, userId: string): { skip: string } | { shareId: string } {
    const live = (kind === 'snippet' ? snippetOwner : collectionOwner).get(shareId) as
      | { id: string; user_id: string }
      | undefined;
    if (live) return live.user_id === userId ? { skip: live.id } : { shareId: nanoid(SHARE_ID_LENGTH) };
    const gone = retired.get(shareId, kind) as { user_id: string } | undefined;
    if (gone && gone.user_id !== userId) return { shareId: nanoid(SHARE_ID_LENGTH) };
    if (gone) unretire.run(shareId, kind);
    return { shareId };
  }

  return {
    exportFor(userId: string): BackupFile {
      const bins = (exportBins.all(userId, new Date().toISOString()) as unknown as BinRow[]).map(
        (r): BackupBin => ({
          shareId: r.share_id,
          title: r.title,
          html: r.html,
          css: r.css,
          js: r.js,
          visibility: r.visibility,
          passwordHash: r.password_hash,
          expiresAt: r.expires_at,
          burnAfterRead: r.burn_after_read === 1,
          forkedFrom: r.forked_from_share_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }),
      );
      const now = new Date().toISOString();
      const collections = (exportCollections.all(userId) as unknown as CollectionRow[]).map(
        (c): BackupCollection => ({
          shareId: c.share_id,
          title: c.title,
          description: c.description,
          passwordHash: c.password_hash,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          bins: (exportMembers.all(c.id, now) as { share_id: string }[]).map((m) => m.share_id),
        }),
      );
      return { format: 'bincode-backup', version: 1, exportedAt: now, bins, collections };
    },

    /** All-or-nothing: any error (including a quota breach) rolls the whole import back. */
    importFor(userId: string, file: BackupFile, quotas: Quotas): ImportSummary {
      const summary: ImportSummary = {
        bins: { imported: 0, skipped: 0, newLinks: 0 },
        collections: { imported: 0, skipped: 0, newLinks: 0 },
        memberships: 0,
      };
      const now = new Date().toISOString();
      // backup shareId -> internal id of the bin the importer now owns
      const binIds = new Map<string, string>();
      const inserted: { id: string; forkedFrom: string | null }[] = [];

      db.exec('BEGIN');
      try {
        for (const bin of file.bins) {
          if (bin.expiresAt && bin.expiresAt <= now) continue;
          const place = placement('snippet', bin.shareId, userId);
          if ('skip' in place) {
            summary.bins.skipped++;
            binIds.set(bin.shareId, place.skip);
            continue;
          }
          const id = nanoid();
          insertBin.run(
            id,
            place.shareId,
            userId,
            bin.title,
            bin.html,
            bin.css,
            bin.js,
            bin.visibility,
            bin.passwordHash,
            bin.expiresAt,
            bin.burnAfterRead ? 1 : 0,
            bin.createdAt,
            bin.updatedAt,
          );
          summary.bins.imported++;
          if (place.shareId !== bin.shareId) summary.bins.newLinks++;
          binIds.set(bin.shareId, id);
          inserted.push({ id, forkedFrom: bin.forkedFrom });
        }

        // Fork links point into the same file first, then at any bin that still exists here.
        for (const { id, forkedFrom } of inserted) {
          if (!forkedFrom) continue;
          const source = binIds.get(forkedFrom) ?? (snippetOwner.get(forkedFrom) as { id: string } | undefined)?.id;
          if (source && source !== id) setForkedFrom.run(source, id);
        }

        for (const col of file.collections) {
          const place = placement('collection', col.shareId, userId);
          let collectionId: string;
          if ('skip' in place) {
            summary.collections.skipped++;
            collectionId = place.skip;
          } else {
            collectionId = nanoid();
            insertCollection.run(
              collectionId,
              place.shareId,
              userId,
              col.title,
              col.description,
              col.passwordHash,
              col.createdAt,
              col.updatedAt,
            );
            summary.collections.imported++;
            if (place.shareId !== col.shareId) summary.collections.newLinks++;
          }
          for (const member of col.bins) {
            const binId = binIds.get(member);
            if (binId && addMember.run(collectionId, binId, now).changes > 0) summary.memberships++;
          }
        }

        const used = usage.get(userId) as { bins: number; chars: number; collections: number };
        if (
          Number(used.bins) > quotas.binsPerUser ||
          Number(used.chars) > quotas.storagePerUser ||
          Number(used.collections) > quotas.collectionsPerUser
        ) {
          throw new HttpError(403, 'Import would exceed your limits. Nothing was imported.');
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return summary;
    },
  };
}

export type BackupRepo = ReturnType<typeof createBackupRepo>;
