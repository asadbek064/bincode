import type { DraftOffer } from '../hooks/useLocalDraft.ts';
import { relativeTime } from '../lib/time.ts';

interface DraftBannerProps {
  offer: DraftOffer;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftBanner({ offer, onRestore, onDiscard }: DraftBannerProps) {
  const when = relativeTime(new Date(offer.draft.savedAt).toISOString());
  return (
    <div className={offer.stale ? 'banner banner-warning' : 'banner'} role="status">
      <span>
        You have unsaved changes to this snippet from {when}.
        {offer.stale && ' The bin has been updated since; restoring will overwrite the newer version.'}
      </span>
      <span className="banner-actions">
        <button type="button" className="primary" onClick={onRestore}>
          Restore
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
      </span>
    </div>
  );
}
