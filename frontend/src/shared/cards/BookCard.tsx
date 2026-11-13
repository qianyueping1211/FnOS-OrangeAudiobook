import React from 'react';
import type { Book } from '../../core/types';
import { Check, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import CoverArt from './CoverArt';
import ExpandableTitle from '../widgets/ExpandableTitle';
import { useTranslation } from 'react-i18next';
import { useUiPreferencesStore } from '../../core/stores/uiPreferencesStore';
import { coverProgressPercent } from '../../core/utils/playbackPreferences';
import { bookPrimaryCredit } from '../../core/utils/book';

interface BookCardProps {
  book: Book;
  onClick?: (e: React.MouseEvent) => void;
  disableLink?: boolean;
  coverShape?: 'rect' | 'square';
}

const BookCard: React.FC<BookCardProps> = ({ book, onClick, disableLink, coverShape = 'square' }) => {
  const { t } = useTranslation();
  const showProgress = useUiPreferencesStore((state) => state.bookshelfProgressEnabled);
  const progress = coverProgressPercent(book.progress_percent);
  const credits = bookPrimaryCredit(book.author, book.narrator);

  const content = (
    <>
      <div className={`relative ${coverShape === 'square' ? 'aspect-square' : 'aspect-[3/4]'} overflow-hidden rounded-md shadow-md bg-white dark:bg-slate-800`}>
        <CoverArt title={book.title} url={book.cover_url} libraryId={book.library_id} bookId={book.id} className="absolute inset-0" />
        {showProgress && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pt-8" style={{ background: 'linear-gradient(to top, rgba(15,23,42,0.64), rgba(15,23,42,0.18) 55%, transparent)' }}>
            <span className="flex items-center gap-1 px-2.5 pb-2 text-[10px] font-medium leading-none tabular-nums tracking-wide text-white/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]">
              {progress === 100 && <Check size={11} strokeWidth={2} />}
              {progress === 100 ? t('bookshelf.read') : progress === 0 ? t('bookshelf.unread') : `${progress}%`}
            </span>
            {progress > 0 && <div className="h-0.5 bg-white/15"><div className={`h-full ${progress === 100 ? 'bg-emerald-400/85' : 'bg-primary-400/90'}`} style={{ width: `${progress}%` }} /></div>}
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-full bg-black/30 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true"><ChevronRight size={16} /></div>
      </div>
      <div className="mt-2 min-w-0">
        <ExpandableTitle 
          title={book.title} 
          className="reader-book-title text-slate-900 dark:text-white group-hover:text-primary-600 transition-colors leading-tight" 
          maxLines={1}
        />
        {credits && <p className="reader-book-credit truncate text-slate-500 dark:text-slate-400" title={credits}>{credits}</p>}
      </div>
    </>
  );

  if (disableLink) {
    return (
      <div 
        className="reader-book-card group flex flex-col relative cursor-pointer"
        onClick={onClick}
      >
        {content}
      </div>
    );
  }

  return (
    <Link 
      to={`/book/${book.id}`}
      className="reader-book-card group flex flex-col relative"
      onClick={onClick}
    >
      {content}
    </Link>
  );
};

export default BookCard;
