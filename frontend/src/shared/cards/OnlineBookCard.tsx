import React from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ExpandableTitle from '../widgets/ExpandableTitle';

/** One album returned by an online book source; it is not a shelf book yet. */
export interface OnlineBookItem {
  id: string;
  title: string;
  author?: string | null;
  narrator?: string | null;
  cover_url?: string | null;
  intro?: string | null;
  tags?: string[];
  /** Which book source returned this album; the host needs it to import the book. */
  sourceId?: string;
}

interface OnlineBookCardProps {
  item: OnlineBookItem;
  coverShape?: 'rect' | 'square';
  busy?: boolean;
  onOpen: (item: OnlineBookItem) => void;
}

const OnlineBookCard: React.FC<OnlineBookCardProps> = ({
  item,
  coverShape = 'square',
  busy,
  onOpen,
}) => {
  const { t } = useTranslation();
  const credits = [item.author, item.narrator].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ');

  return (
    <button
      type="button"
      onClick={() => { if (!busy) onOpen(item); }}
      disabled={busy}
      className="reader-book-card group flex flex-col relative text-left disabled:opacity-70"
    >
      <div className={`relative ${coverShape === 'square' ? 'aspect-square' : 'aspect-[3/4]'} overflow-hidden rounded-md shadow-md bg-white dark:bg-slate-800`}>
        {item.cover_url ? (
          <img
            src={item.cover_url}
            alt={item.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400">
            <Cloud size={26} aria-hidden="true" />
          </div>
        )}
        <span className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium leading-none text-white shadow-sm backdrop-blur-sm">
          <Cloud size={11} strokeWidth={2} aria-hidden="true" />
          {t('bookshelf.onlineBadge', '在线')}
        </span>
        {busy && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <Loader2 className="animate-spin text-white" size={22} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <ExpandableTitle
          title={item.title}
          className="reader-book-title text-slate-900 dark:text-white group-hover:text-primary-600 transition-colors leading-tight"
          maxLines={1}
        />
        {credits && <p className="reader-book-credit truncate text-slate-500 dark:text-slate-400" title={credits}>{credits}</p>}
      </div>
    </button>
  );
};

export default OnlineBookCard;
