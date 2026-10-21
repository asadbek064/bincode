import { nanoid } from 'nanoid';
import type { Snippet, SnippetInput, SnippetSummary, Visibility } from '../../shared/api.ts';
import { DEFAULT_VISIBILITY, SHARE_ID_LENGTH } from '../../shared/constants.ts';
import type { Db } from '../db.ts';

/** Server-side view of a snippet; ids, the password hash and the fork source's owner never leave the server. */
export interface SnippetRecord extends Omit<Snippet, 'isOwner' | 'collections'> {
  id: string;
  userId: string;
  passwordHash: string | null;
  /** bumped on every password change so outstanding unlock tokens stop working */
  passwordVersion: number;
  /** owner and visibility of the fork source, used to hide private sources from other viewers */
  forkedFromUserId: string | null;
  forkedFromVisibility: Visibility | null;
}

/** Everything about a bin except its content. */
export interface SnippetSettings {
  visibility: Visibility;
  passwordHash: string | null;
  expiresAt: string | null;
  burnAfterRead: boolean;
}

export const DEFAULT_SETTINGS: SnippetSettings = {
  visibility: DEFAULT_VISIBILITY,
  passwordHash: null,
  expiresAt: null,
  burnAfterRead: false,
};

interface SnippetRow {
  id: string;
  share_id: string;
  user_id: string;
  title: string;
  html: string;
  css: string;
  js: string;
  visibility: Visibility;
  password_hash: string | null;
  password_version: number;
  expires_at: string | null;
  burn_after_read: number;
  forked_from_share_id: string | null;
  forked_from_user_id: string | null;
  forked_from_visibility: Visibility | null;
  created_at: string;
  updated_at: string;
}

export type SummaryRow = Pick<
  SnippetRow,
  | 'share_id'
  | 'user_id'
  | 'title'
  | 'visibility'
  | 'expires_at'
  | 'burn_after_read'
  | 'forked_from_share_id'
  | 'forked_from_user_id'
  | 'forked_from_visibility'
  | 'created_at'
  | 'updated_at'
>;

const FORK_COLUMNS = `src.share_id AS forked_from_share_id, src.user_id AS forked_from_user_id,
         src.visibility AS forked_from_visibility`;

const SELECT_FULL = `
  SELECT s.id, s.share_id, s.user_id, s.title, s.html, s.css, s.js, s.visibility, s.password_hash,
         s.password_version, s.expires_at, s.burn_after_read, ${FORK_COLUMNS}, s.created_at, s.updated_at
  FROM snippets s
  LEFT JOIN snippets src ON src.id = s.forked_from`;

export const SELECT_SUMMARY = `
  SELECT s.share_id, s.user_id, s.title, s.visibility, s.expires_at, s.burn_after_read, ${FORK_COLUMNS},
         s.created_at, s.updated_at
  FROM snippets s
  LEFT JOIN snippets src ON src.id = s.forked_from`;

/**
 * Expired bins count as deleted from the moment they expire; the sweep only reclaims the space.
 * Bind the current ISO time for the placeholder.
 */
export const NOT_EXPIRED = '(s.expires_at IS NULL OR s.expires_at > ?)';

const nowIso = () => new Date().toISOString();

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
    passwordHash: row.password_hash,
    passwordVersion: row.password_version,
    expiresAt: row.expires_at,
    burnAfterRead: row.burn_after_read === 1,
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
    expiresAt: row.expires_at,
    burnAfterRead: row.burn_after_read === 1,
    forkedFrom: visibleForkedFrom(row.forked_from_share_id, row.forked_from_user_id, row.forked_from_visibility, viewerId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSnippet(record: SnippetRecord, viewerId: string | undefined, collections?: string[]): Snippet {
  const { id: _id, userId, passwordHash: _hash, passwordVersion: _pv, forkedFromUserId, forkedFromVisibility, ...rest } =
    record;
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
    INSERT INTO snippets (id, share_id, user_id, title, html, css, js, visibility, password_hash, expires_at,
                          burn_after_read, forked_from, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byShareId = db.prepare(`${SELECT_FULL} WHERE s.share_id = ? AND ${NOT_EXPIRED}`);
  const listByUser = db.prepare(`${SELECT_SUMMARY}
    WHERE s.user_id = ? AND ${NOT_EXPIRED}
    ORDER BY s.updated_at DESC, s.rowid DESC`);
  const update = db.prepare('UPDATE snippets SET title = ?, html = ?, css = ?, js = ?, updated_at = ? WHERE id = ?');
  const updateSettings = db.prepare(`
    UPDATE snippets SET visibility = ?, password_hash = ?, password_version = ?, expires_at = ?, burn_after_read = ?,
                        updated_at = ?
    WHERE id = ?`);
  const remove = db.prepare('DELETE FROM snippets WHERE id = ?');
  // Counts every stored row, expired ones included: they take space until the sweep removes them.
  const usage = db.prepare(`
    SELECT COUNT(*) AS bins, COALESCE(SUM(length(html) + length(css) + length(js)), 0) AS chars
    FROM snippets WHERE user_id = ?`);
  const sweep = db.prepare('DELETE FROM snippets WHERE expires_at IS NOT NULL AND expires_at <= ?');
  const collectionsOf = db.prepare(`
    SELECT c.share_id FROM collection_snippets cs
    JOIN collections c ON c.id = cs.collection_id
    WHERE cs.snippet_id = ?
    ORDER BY c.title, c.rowid`);

  function findByShareId(shareId: string): SnippetRecord | undefined {
    const row = byShareId.get(shareId, nowIso()) as SnippetRow | undefined;
    return row && toRecord(row);
  }

  return {
    findByShareId,

    create(
      userId: string,
      input: SnippetInput,
      settings: SnippetSettings = DEFAULT_SETTINGS,
      forkedFromId: string | null = null,
    ): SnippetRecord {
      const now = nowIso();
      const shareId = nanoid(SHARE_ID_LENGTH);
      insert.run(
        nanoid(),
        shareId,
        userId,
        input.title,
        input.html,
        input.css,
        input.js,
        settings.visibility,
        settings.passwordHash,
        settings.expiresAt,
        settings.burnAfterRead ? 1 : 0,
        forkedFromId,
        now,
        now,
      );
      return findByShareId(shareId)!;
    },

    listByUser(userId: string): SnippetSummary[] {
      const rows = listByUser.all(userId, nowIso()) as unknown as SummaryRow[];
      return rows.map((r) => toSummary(r, userId));
    },

    update(existing: SnippetRecord, input: SnippetInput): SnippetRecord {
      update.run(input.title, input.html, input.css, input.js, nextUpdatedAt(existing.updatedAt), existing.id);
      return findByShareId(existing.shareId)!;
    },

    updateSettings(existing: SnippetRecord, settings: SnippetSettings): SnippetRecord {
      const passwordChanged = settings.passwordHash !== existing.passwordHash;
      updateSettings.run(
        settings.visibility,
        settings.passwordHash,
        passwordChanged ? existing.passwordVersion + 1 : existing.passwordVersion,
        settings.expiresAt,
        settings.burnAfterRead ? 1 : 0,
        nextUpdatedAt(existing.updatedAt),
        existing.id,
      );
      return findByShareId(existing.shareId)!;
    },

    delete(id: string): boolean {
      return remove.run(id).changes > 0;
    },

    /** Deletes a burn-after-read bin; false means another request already burned it. */
    burn(id: string): boolean {
      return remove.run(id).changes > 0;
    },

    sweepExpired(now = nowIso()): number {
      return Number(sweep.run(now).changes);
    },

    usageOf(userId: string): { bins: number; chars: number } {
      const row = usage.get(userId) as { bins: number; chars: number };
      return { bins: Number(row.bins), chars: Number(row.chars) };
    },

    collectionsOf(snippetId: string): string[] {
      return (collectionsOf.all(snippetId) as { share_id: string }[]).map((r) => r.share_id);
    },
  };
}

export type SnippetsRepo = ReturnType<typeof createSnippetsRepo>;
