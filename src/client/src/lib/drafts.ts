import type { Visibility } from '../../../shared/api.ts';
import { VISIBILITIES } from '../../../shared/constants.ts';
import { listKeys, readJson, removeItem, writeJson } from './storage.ts';

export interface Draft {
  title: string;
  html: string;
  css: string;
  js: string;
  /** absent in drafts written before private bins existed */
  visibility?: Visibility;
  /** epoch ms */
  savedAt: number;
  /** server updatedAt of the snippet this draft was based on, null for new snippets */
  baseUpdatedAt: string | null;
}

const PREFIX = 'bincode:draft:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 20;

export const draftKey = (shareId: string | null) => `${PREFIX}${shareId ?? 'new'}`;

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.title === 'string' &&
    typeof d.html === 'string' &&
    typeof d.css === 'string' &&
    typeof d.js === 'string' &&
    (d.visibility === undefined || (VISIBILITIES as readonly unknown[]).includes(d.visibility)) &&
    typeof d.savedAt === 'number' &&
    (d.baseUpdatedAt === null || typeof d.baseUpdatedAt === 'string')
  );
}

export function loadDraft(shareId: string | null): Draft | null {
  const value = readJson<unknown>(draftKey(shareId));
  return isDraft(value) ? value : null;
}

export function saveDraft(shareId: string | null, draft: Draft): void {
  if (!writeJson(draftKey(shareId), draft)) {
    // Probably over quota: drop old drafts and try once more.
    pruneDrafts();
    writeJson(draftKey(shareId), draft);
  }
}

export function clearDraft(shareId: string | null): void {
  removeItem(draftKey(shareId));
}

/** Removes drafts older than 30 days and all but the 20 most recent. */
export function pruneDrafts(now = Date.now()): void {
  const entries: { key: string; savedAt: number }[] = [];
  for (const key of listKeys(PREFIX)) {
    const value = readJson<unknown>(key);
    if (!isDraft(value) || now - value.savedAt > MAX_AGE_MS) {
      removeItem(key);
    } else {
      entries.push({ key, savedAt: value.savedAt });
    }
  }
  entries.sort((a, b) => b.savedAt - a.savedAt);
  for (const entry of entries.slice(MAX_DRAFTS)) removeItem(entry.key);
}
