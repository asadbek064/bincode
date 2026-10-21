import type { Expiration, SnippetSettingsInput, Visibility } from '../../../shared/api.ts';
import { DEFAULT_VISIBILITY } from '../../../shared/constants.ts';

export const VISIBILITY_LABELS: Record<Visibility, { label: string; hint: string }> = {
  unlisted: { label: 'Link', hint: 'Anyone with the link can open it.' },
  password: { label: 'Password', hint: 'Anyone with the link and password can open it.' },
  private: { label: 'Only me', hint: 'Only you can open it.' },
};

/**
 * One "Delete" control instead of separate expiry and burn settings: devs pick one lifetime.
 * 'burn' = after the first view by someone else.
 */
export type Lifetime = Expiration | 'burn';

export const LIFETIME_LABELS: Record<Lifetime, string> = {
  never: 'Never',
  burn: 'After first view',
  '10m': 'After 10 minutes',
  '1h': 'After 1 hour',
  '1d': 'After 1 day',
  '1w': 'After 1 week',
  '1m': 'After 1 month',
};

export const LIFETIMES = Object.keys(LIFETIME_LABELS) as Lifetime[];

export function lifetimeToInput(lifetime: Lifetime): Pick<SnippetSettingsInput, 'expiresIn' | 'burnAfterRead'> {
  return lifetime === 'burn'
    ? { burnAfterRead: true, expiresIn: 'never' }
    : { burnAfterRead: false, expiresIn: lifetime };
}

/** Settings chosen for a bin that hasn't been saved yet; sent with its first save. */
export interface PendingSettings {
  visibility: Visibility;
  password: string;
  lifetime: Lifetime;
  /** shareIds of collections to add the bin to once it exists */
  collections: string[];
}

export const DEFAULT_PENDING: PendingSettings = {
  visibility: DEFAULT_VISIBILITY,
  password: '',
  lifetime: 'never',
  collections: [],
};

export function pendingToInput(p: PendingSettings): SnippetSettingsInput {
  return {
    visibility: p.visibility,
    ...(p.visibility === 'password' && p.password ? { password: p.password } : {}),
    ...lifetimeToInput(p.lifetime),
  };
}
