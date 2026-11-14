import React from 'react';
import { Clock, ListMusic, Loader2, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Chapter } from '../../../core/types';
import { isLight, setAlpha, toSolidColor } from '../../../core/utils/color';

interface Props {
  open: boolean;
  loading: boolean;
  bookTitle: string;
  chapters: Chapter[];
  currentChapterId?: string | null;
  isPlaying: boolean;
  themeColor?: string;
  onSelect: (chapter: Chapter) => void;
  onClose: () => void;
  formatDuration: (seconds: number) => string;
  getChapterProgressText: (chapter: Chapter) => string | null;
}

/**
 * Bottom sheet that lists every chapter of one book. The detail page opens it
 * from the cover art or the title, so the page itself can stay short.
 */
const ChapterPickerDrawer: React.FC<Props> = ({
  open,
  loading,
  bookTitle,
  chapters,
  currentChapterId,
  isPlaying,
  themeColor,
  onSelect,
  onClose,
  formatDuration,
  getChapterProgressText,
}) => {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[190] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:max-w-xl sm:rounded-3xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6">
          <ListMusic size={20} className="shrink-0 text-primary-600" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold dark:text-white sm:text-lg">{t('bookshelf.chapterList')}</h2>
            <p className="truncate text-xs text-slate-500">{bookTitle}</p>
          </div>
          <span className="shrink-0 text-xs text-slate-400">
            {t('bookshelf.chapterCount', { count: chapters.length })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
              {t('bookshelf.loadingChapters')}
            </div>
          ) : chapters.length === 0 ? (
            <p className="py-10 text-center text-slate-400">{t('bookshelf.noChapters')}</p>
          ) : (
            <div className="space-y-2">
              {chapters.map((chapter, index) => {
                const isCurrent = currentChapterId === chapter.id;
                const progressText = getChapterProgressText(chapter);
                return (
                  <button
                    type="button"
                    key={chapter.id}
                    onClick={() => onSelect(chapter)}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors sm:p-3 ${
                      isCurrent
                        ? 'border-transparent'
                        : 'border-slate-100 dark:border-slate-800 hover:border-primary-200 dark:hover:border-primary-800'
                    }`}
                    style={isCurrent && themeColor ? {
                      backgroundColor: setAlpha(themeColor, 0.1),
                      borderColor: setAlpha(themeColor, 0.3),
                    } : isCurrent ? { backgroundColor: 'rgba(99,102,241,0.08)' } : {}}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold sm:h-10 sm:w-10 ${
                        isCurrent ? 'text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                      style={isCurrent && themeColor ? {
                        backgroundColor: toSolidColor(themeColor),
                        color: isLight(themeColor) ? '#475569' : '#ffffff',
                      } : isCurrent ? { backgroundColor: '#6366f1' } : {}}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-white">
                        {chapter.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} className="shrink-0" />
                          {formatDuration(chapter.duration)}
                        </span>
                        {progressText && (
                          <span className={`rounded px-1 py-0.5 font-medium ${
                            progressText === t('bookshelf.progressComplete')
                              ? 'bg-green-50 text-green-500 dark:bg-green-900/20'
                              : 'bg-primary-50 text-primary-600 dark:bg-primary-900/20'
                          }`}>
                            {progressText}
                          </span>
                        )}
                      </span>
                    </span>
                    {isCurrent && isPlaying ? (
                      <span className="flex h-5 shrink-0 items-end gap-0.5">
                        <span className="w-0.5 animate-music-bar-1 rounded-full bg-primary-600" />
                        <span className="w-0.5 animate-music-bar-2 rounded-full bg-primary-600" />
                        <span className="w-0.5 animate-music-bar-3 rounded-full bg-primary-600" />
                      </span>
                    ) : (
                      <Play size={16} className="shrink-0 text-primary-600" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 pb-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
};

export default ChapterPickerDrawer;
