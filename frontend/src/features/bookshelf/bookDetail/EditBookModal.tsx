import React from 'react';
import { ArrowLeft, Loader2, Save, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Book } from '../../../core/types';
import type { RegexGenerationResult } from '../../../core/api/books';

export type EditBookTab = 'metadata' | 'chapters';

interface Props {
  editData: Partial<Book>;
  coverFile: File | null;
  saving: boolean;
  saveError: string | null;
  activeTab: EditBookTab;
  onChangeTab: (tab: EditBookTab) => void;
  chaptersPanel?: React.ReactNode;
  onChangeCoverFile: (file: File | null) => void;
  showRegexGenerator: boolean;
  genFilename: string;
  genNum: string;
  genTitle: string;
  genResult: RegexGenerationResult | null;
  chapterGroupOrder: 'asc' | 'desc';
  onChangeEditData: (next: Partial<Book>) => void;
  onChangeMetadataLock: (locked: boolean) => void;
  onChangeChapterGroupOrder: (order: 'asc' | 'desc') => void;
  onShowRegexGenerator: () => void;
  onHideRegexGenerator: () => void;
  onChangeGenFilename: (v: string) => void;
  onChangeGenNum: (v: string) => void;
  onChangeGenTitle: (v: string) => void;
  onGenerateRegex: () => void;
  onApplyRegex: () => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
}

const EditBookModal: React.FC<Props> = ({
  editData,
  coverFile,
  saving,
  saveError,
  activeTab,
  onChangeTab,
  chaptersPanel,
  onChangeCoverFile,
  showRegexGenerator,
  genFilename,
  genNum,
  genTitle,
  genResult,
  chapterGroupOrder,
  onChangeEditData,
  onChangeMetadataLock,
  onChangeChapterGroupOrder,
  onShowRegexGenerator,
  onHideRegexGenerator,
  onChangeGenFilename,
  onChangeGenNum,
  onChangeGenTitle,
  onGenerateRegex,
  onApplyRegex,
  onClose,
  onDelete,
  onSave,
}) => {
  const { t } = useTranslation();
  const [locationExpanded, setLocationExpanded] = React.useState(false);
  const [coverError, setCoverError] = React.useState<string | null>(null);
  const coverInput = React.useRef<HTMLInputElement>(null);
  const coverPreviewRef = React.useCallback((node: HTMLImageElement | null) => {
    if (!node || !coverFile) return;
    const url = URL.createObjectURL(coverFile);
    node.src = url;
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  const update = (patch: Partial<Book>) => onChangeEditData({ ...editData, ...patch });
  const bookLocation = editData.path || '';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={saving ? undefined : onClose}></div>
      {/* Same shell as the manual scrape dialog: fixed 92vh panel on a dimmed,
          blurred page, a titled header with the close control top right. */}
      <div className={`relative flex h-[92vh] w-full ${activeTab === 'chapters' ? 'max-w-5xl' : 'max-w-2xl'} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:bg-slate-950`}>
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-4 dark:border-slate-800 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={t('common.back')}
              title={t('common.back')}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ArrowLeft size={18} />
              {t('common.back')}
            </button>
            <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-950 dark:text-white sm:text-xl">
              {t('bookshelf.editBookMetadata')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={t('common.close')}
              title={t('common.close')}
              className="rounded-full p-2 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            >
              <X size={22} className="text-slate-500" />
            </button>
          </div>
          {!showRegexGenerator && (
            <div className="mx-auto mt-3 grid max-w-md grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                aria-pressed={activeTab === 'metadata'}
                onClick={() => onChangeTab('metadata')}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                  activeTab === 'metadata'
                    ? 'bg-white text-primary-600 shadow-sm dark:bg-slate-700'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t('bookshelf.metadataTab')}
              </button>
              <button
                type="button"
                aria-pressed={activeTab === 'chapters'}
                onClick={() => onChangeTab('chapters')}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                  activeTab === 'chapters'
                    ? 'bg-white text-primary-600 shadow-sm dark:bg-slate-700'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {t('bookshelf.chaptersTab')}
              </button>
            </div>
          )}
        </div>

        {activeTab === 'chapters' ? (
          <div className="chapter-tab-panel flex min-h-0 flex-1 flex-col overflow-hidden">
            {chaptersPanel}
          </div>
        ) : (
        <>
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {showRegexGenerator ? (
            <div className="p-4 sm:p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
                        <Wand2 className="text-primary-600" /> {t('bookshelf.regexGenerator')}
                    </h2>
                    <button onClick={onHideRegexGenerator}><X size={24} className="text-slate-400" /></button>
                </div>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500">{t('bookshelf.sampleFilename')}</label>
                        <input
                            type="text"
                            value={genFilename}
                            onChange={e => onChangeGenFilename(e.target.value)}
                            placeholder={t('bookshelf.sampleFilenamePlaceholder')}
                            className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500">{t('bookshelf.extractChapterNumber')}</label>
                            <input
                                type="text"
                                value={genNum}
                                onChange={e => onChangeGenNum(e.target.value)}
                                placeholder={t('bookshelf.exampleOne')}
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500">{t('bookshelf.extractChapterTitle')}</label>
                            <input
                                type="text"
                                value={genTitle}
                                onChange={e => onChangeGenTitle(e.target.value)}
                                placeholder={t('bookshelf.exampleChapterTitle')}
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                            />
                        </div>
                    </div>

                    <button
                        onClick={onGenerateRegex}
                        disabled={!genFilename || !genNum || !genTitle}
                        className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-500/30 transition-all disabled:opacity-50"
                    >
                        {t('bookshelf.generateRule')}
                    </button>

                    {genResult && (
                        <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                            <div>
                                <div className="text-xs font-bold text-slate-500 mb-1">{t('bookshelf.generatedRegex')}</div>
                                <code className="block p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-sm text-primary-600 break-all">
                                    {genResult.regex}
                                </code>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs">{t('bookshelf.extractedIndex')}</span>
                                    <div className={genResult.captured_index === genNum ? "text-green-600 font-bold" : "text-red-500"}>
                                        {genResult.captured_index || t('bookshelf.noMatch')}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-slate-500 text-xs">{t('bookshelf.extractedTitle')}</span>
                                    <div className={genResult.captured_title === genTitle ? "text-green-600 font-bold" : "text-red-500"}>
                                        {genResult.captured_title || t('bookshelf.noMatch')}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={onApplyRegex}
                                className="w-full py-2 border-2 border-primary-600 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 font-bold rounded-xl transition-all"
                            >
                                {t('bookshelf.useThisRule')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        ) : (
        <div className="p-4 sm:p-6 md:p-8">
          <label className="mb-4 sm:mb-6 flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/70 px-3 py-3 dark:border-primary-900/40 dark:bg-primary-900/20">
            <input
              type="checkbox"
              checked={editData.manual_corrected === true}
              onChange={e => onChangeMetadataLock(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{t('bookshelf.metadataLock')}</span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t('bookshelf.metadataLockHelp')}</span>
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="space-y-3 sm:space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.titleField')}</label>
                <input
                  type="text"
                  value={editData.title || ''}
                  onChange={e => update({ title: e.target.value })}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.authorField')}</label>
                <input
                  type="text"
                  value={editData.author || ''}
                  onChange={e => update({ author: e.target.value })}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.narratorField')}</label>
                <input
                  type="text"
                  value={editData.narrator || ''}
                  onChange={e => update({ narrator: e.target.value })}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.tagsCommaSeparated')}</label>
                <input
                  type="text"
                  value={editData.tags || ''}
                  onChange={e => update({ tags: e.target.value })}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.genreField')}</label>
                <input
                  type="text"
                  value={editData.genre || ''}
                  onChange={e => update({ genre: e.target.value })}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.yearField')}</label>
                <input
                  type="number"
                  value={editData.year || ''}
                  onChange={e => update({ year: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder={t('bookshelf.exampleYear')}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                    <span>{t('bookshelf.chapterRegexRule')}</span>
                    <button
                        onClick={onShowRegexGenerator}
                        className="text-primary-600 hover:text-primary-700 flex items-center gap-1 whitespace-nowrap text-xs sm:text-sm"
                    >
                        <Wand2 size={12} /> {t('bookshelf.autoGenerate')}
                    </button>
                </label>
                <input
                  type="text"
                  value={editData.chapter_regex || ''}
                  onChange={e => update({ chapter_regex: e.target.value })}
                  placeholder="^...(\d+)...(.+)$"
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
                <p className="text-[10px] text-slate-400">{t('bookshelf.chapterRegexHelp')}</p>
              </div>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="book-cover" className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.coverUrl')}</label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => coverInput.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs sm:text-sm font-semibold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50"
                  >
                    <Upload size={14} /> {t('bookshelf.uploadCover')}
                  </button>
                  <input
                    ref={coverInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
                        setCoverError(t('bookshelf.coverFileInvalid'));
                        return;
                      }
                      setCoverError(null);
                      onChangeCoverFile(file);
                    }}
                  />
                </div>
                <input
                  id="book-cover"
                  type="text"
                  value={editData.cover_url || ''}
                  disabled={saving}
                  onChange={e => {
                    onChangeCoverFile(null);
                    update({ cover_url: e.target.value });
                  }}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
                {coverFile && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2.5">
                    <img ref={coverPreviewRef} alt={t('bookshelf.coverUrl')} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{coverFile.name}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{t('bookshelf.coverUploadOnSave')}</p>
                    </div>
                    <button type="button" disabled={saving} aria-label={t('bookshelf.removeSelectedCover')} onClick={() => onChangeCoverFile(null)} className="p-1 text-slate-400 hover:text-red-500"><X size={16} /></button>
                  </div>
                )}
                {coverError && <p className="text-xs text-red-500">{coverError}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.bookLocation')}</label>
                <button
                  type="button"
                  title={bookLocation}
                  onClick={() => setLocationExpanded(value => !value)}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs sm:text-sm font-mono bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-slate-600 dark:text-slate-300 cursor-pointer ${
                    locationExpanded ? 'whitespace-pre-wrap break-all' : 'truncate'
                  }`}
                >
                  {bookLocation}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.skipIntroSeconds')}</label>
                  <input
                    type="number"
                    value={editData.skip_intro || 0}
                    onChange={e => update({ skip_intro: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.skipOutroSeconds')}</label>
                  <input
                    type="number"
                    value={editData.skip_outro || 0}
                    onChange={e => update({ skip_outro: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.groupDisplayOrder')}</label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => onChangeChapterGroupOrder('asc')}
                    className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                      chapterGroupOrder === 'asc'
                        ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {t('bookshelf.frontToBack')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeChapterGroupOrder('desc')}
                    className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                      chapterGroupOrder === 'desc'
                        ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {t('bookshelf.backToFront')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 sm:mt-6 space-y-1">
            <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bookshelf.descriptionField')}</label>
            <textarea
              rows={4}
              value={editData.description || ''}
              onChange={e => update({ description: e.target.value })}
              className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white resize-none"
            />
          </div>

        </div>
        )}
        </div>
        {!showRegexGenerator && (
          <div className="shrink-0 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6 sm:py-4">
            {saveError && <p role="alert" className="mb-3 text-sm text-red-500">{saveError}</p>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-4 py-2.5 font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all flex items-center justify-center gap-2 sm:justify-start whitespace-nowrap text-xs sm:text-base"
              >
                <Trash2 size={18} className="sm:w-5 sm:h-5" />
                {t('bookshelf.deleteBook')}
              </button>
              <div className="flex-1" />
              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-3 sm:px-6 py-2.5 sm:py-3 font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all text-xs sm:text-base whitespace-nowrap"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-3 sm:px-8 py-2.5 sm:py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-500/30 flex items-center justify-center gap-1.5 sm:gap-2 transition-all text-xs sm:text-base whitespace-nowrap"
                >
                  {saving ? <Loader2 size={16} className="animate-spin sm:w-5 sm:h-5" /> : <Save size={16} className="sm:w-5 sm:h-5" />}
                  <span>{t(saving ? 'common.saving' : 'common.save')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default EditBookModal;
