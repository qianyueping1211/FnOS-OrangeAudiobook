import React, { useCallback, useState, useEffect, useRef } from 'react';
import apiClient from '../../core/api/client';
import { getBookshelfGridClass, useBookshelfDisplaySettings } from '../../core/hooks/useBookshelfCoverShape';
import type { Book, Library, Series } from '../../core/types';
import { apiErrorMessage } from '../../core/api/errors';
import BookCard from '../../shared/cards/BookCard';
import OnlineBookCard, { type OnlineBookItem } from '../../shared/cards/OnlineBookCard';
import { Search as SearchIcon, Loader2, BookX, ChevronLeft, ChevronRight, SlidersHorizontal, ChevronUp, ChevronDown, Cloud } from 'lucide-react';
import BackButton from '../../shared/widgets/BackButton';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { getRuntimePathname } from '../../core/utils/runtimeUrl';
import { useUiPreferencesStore } from '../../core/stores/uiPreferencesStore';

type FilterOption = string | { id: string; name: string };

interface BookSourceOption {
  id: string;
  name: string;
}

interface FilterRowProps {
  label: string;
  allLabel: string;
  items: FilterOption[];
  selected: string;
  onSelect: (value: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const scrollFilterRow = (
  ref: React.RefObject<HTMLDivElement | null>,
  direction: 'left' | 'right',
) => {
  ref.current?.scrollBy({
    left: direction === 'left' ? -300 : 300,
    behavior: 'smooth',
  });
};

const FilterRow: React.FC<FilterRowProps> = ({
  label,
  allLabel,
  items,
  selected,
  onSelect,
  scrollRef,
}) => {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const { scrollLeft, scrollWidth, clientWidth } = element;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, [scrollRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(checkScroll);
    window.addEventListener('resize', checkScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, items]);

  if (items.length === 0) return null;

  return (
    <div className="reader-filter-row">
      <div className="reader-filter-label">
        {label}
      </div>
      <div className="relative flex-1 group/row min-w-0">
        {canScrollLeft && (
          <button
            onClick={() => scrollFilterRow(scrollRef, 'left')}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/90 dark:bg-slate-800/90 rounded-full shadow-md border border-slate-100 dark:border-slate-700 text-slate-400 hover:text-primary-500 hidden sm:flex items-center justify-center backdrop-blur-sm transition-all animate-in fade-in zoom-in duration-200"
          >
            <ChevronLeft size={16} />
          </button>
        )}

        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="reader-filter-options"
        >
          <button
            aria-pressed={selected === ''}
            onClick={() => onSelect('')}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap ${
              selected === ''
                ? 'bg-primary-500 text-white font-medium shadow-md shadow-primary-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {allLabel}
          </button>
          {items.map((item) => {
            const value = typeof item === 'string' ? item : item.id;
            const itemLabel = typeof item === 'string' ? item : item.name;
            return (
              <button
                key={value}
                aria-pressed={selected === value}
                onClick={() => onSelect(selected === value ? '' : value)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap ${
                  selected === value
                    ? 'bg-primary-500 text-white font-medium shadow-md shadow-primary-500/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {itemLabel}
              </button>
            );
          })}
        </div>

        {canScrollRight && (
          <button
            onClick={() => scrollFilterRow(scrollRef, 'right')}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/90 dark:bg-slate-800/90 rounded-full shadow-md border border-slate-100 dark:border-slate-700 text-slate-400 hover:text-primary-500 hidden sm:flex items-center justify-center backdrop-blur-sm transition-all animate-in fade-in zoom-in duration-200"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

interface SavedSearchState {
  query: string;
  debouncedQuery: string;
  sourceMode: 'all' | 'local' | 'online';
  selectedLibraryId: string;
  selectedSeries: string;
  selectedTag: string;
  selectedGenre: string;
  selectedYear: string;
  selectedAuthor: string;
  selectedNarrator: string;
  showFilters: boolean;
  results: Book[];
  onlineResult: { key: string; items: OnlineBookItem[]; error: string };
}

// Going into a book and coming back must not wipe the page: the typed keyword
// and what it found are kept for that one round trip. Leaving for anywhere else
// clears them, so the next visit from the shelf starts fresh.
const searchMemory: { state: SavedSearchState | null } = { state: null };

const SearchPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [restored] = useState(() => searchMemory.state);
  const [query, setQuery] = useState(restored?.query ?? '');
  
  // Filter states
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(restored?.selectedLibraryId ?? '');
  const [selectedSeries, setSelectedSeries] = useState<string>(restored?.selectedSeries ?? '');
  const [selectedTag, setSelectedTag] = useState<string>(restored?.selectedTag ?? '');
  const [selectedGenre, setSelectedGenre] = useState<string>(restored?.selectedGenre ?? '');
  const [selectedYear, setSelectedYear] = useState<string>(restored?.selectedYear ?? '');
  const [selectedAuthor, setSelectedAuthor] = useState<string>(restored?.selectedAuthor ?? '');
  const [selectedNarrator, setSelectedNarrator] = useState<string>(restored?.selectedNarrator ?? '');
  const [showFilters, setShowFilters] = useState(restored?.showFilters ?? false);
  
  // Data options
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [allSeries, setAllSeries] = useState<Series[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [allYears, setAllYears] = useState<string[]>([]);
  const [allAuthors, setAllAuthors] = useState<string[]>([]);
  const [allNarrators, setAllNarrators] = useState<string[]>([]);
  
  const [results, setResults] = useState<Book[]>(restored?.results ?? []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState(restored?.debouncedQuery ?? '');

  // Online book sources: the shelf never queries them on its own except in the
  // default "全部" mode, where a search asks both. The source row only offers
  // 全部 / 书架 / 在线 — the plugin behind it stays unnamed. Local results stay on top.
  const [bookSources, setBookSources] = useState<BookSourceOption[]>([]);
  // The source list is still on its way: the online block must say "加载中"
  // rather than "暂无在线书源" while the answer is simply not back yet.
  const [sourcesReady, setSourcesReady] = useState(false);
  const [chosenSourceMode, setSourceMode] = useState<'all' | 'local' | 'online'>(restored?.sourceMode ?? 'all');
  // 个性化设置里关掉「在线书籍播放」后，搜索只查书架，来源行也不显示。
  const onlineEnabled = useUiPreferencesStore((state) => state.onlineBooksEnabled);
  const sourceMode: 'all' | 'local' | 'online' = onlineEnabled ? chosenSourceMode : 'local';
  // One fetch result tagged with the query it belongs to. Anything stale is
  // dropped while rendering instead of being cleared inside an effect.
  const [onlineResult, setOnlineResult] = useState<{
    key: string;
    items: OnlineBookItem[];
    error: string;
  }>(restored?.onlineResult ?? { key: '', items: [], error: '' });
  const [openingSourceId, setOpeningSourceId] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const latestRef = useRef<SavedSearchState | null>(null);
  useEffect(() => {
    latestRef.current = {
      query, debouncedQuery, sourceMode, selectedLibraryId, selectedSeries, selectedTag,
      selectedGenre, selectedYear, selectedAuthor, selectedNarrator, showFilters, results, onlineResult,
    };
  });
  // By the time this cleanup runs the address already points at where the user
  // went: a book means they will be back, anything else means a fresh start.
  useEffect(() => () => {
    searchMemory.state = /^\/book\//.test(getRuntimePathname()) ? latestRef.current : null;
  }, []);
  
  // Cover shape and icon size settings from bookshelf
  const { coverShape, iconSize } = useBookshelfDisplaySettings();

  // Scroll refs for filter rows
  const librariesScrollRef = useRef<HTMLDivElement>(null);
  const seriesScrollRef = useRef<HTMLDivElement>(null);
  const tagsScrollRef = useRef<HTMLDivElement>(null);
  const genresScrollRef = useRef<HTMLDivElement>(null);
  const yearsScrollRef = useRef<HTMLDivElement>(null);
  const authorsScrollRef = useRef<HTMLDivElement>(null);
  const narratorsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 500);
    return () => clearTimeout(timer);
  }, [query]);

  // The search field is the only thing this page is for: put the caret in it on
  // entry so the mobile keyboard comes up without an extra tap.
  useEffect(() => {
    // Coming back with a keyword in place: leave the keyboard down.
    if (restored?.query) return undefined;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [restored]);

  // Fetch all metadata options on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [tagsRes, booksRes, libsRes, seriesRes] = await Promise.all([
          apiClient.get('/api/tags'),
          apiClient.get('/api/books'),
          apiClient.get('/api/libraries'),
          apiClient.get('/api/v1/series')
        ]);
        
        setAllTags(tagsRes.data);
        setLibraries(libsRes.data);
        setAllSeries(seriesRes.data);
        
        // Extract unique authors, narrators, genres, and years
        const books = booksRes.data as Book[];
        const authors = new Set<string>();
        const narrators = new Set<string>();
        const genres = new Set<string>();
        const years = new Set<string>();
        
        books.forEach(book => {
          if (book.author) authors.add(book.author);
          if (book.narrator) narrators.add(book.narrator);
          if (book.genre) {
            book.genre.split(',').forEach(g => {
              const trimmed = g.trim();
              if (trimmed) genres.add(trimmed);
            });
          }
          if (book.year) years.add(book.year.toString());
        });
        
        setAllAuthors(Array.from(authors).sort());
        setAllNarrators(Array.from(narrators).sort());
        setAllGenres(Array.from(genres).sort());
        setAllYears(Array.from(years).sort((a, b) => parseInt(b) - parseInt(a))); // 降序排列
        
      } catch (err) {
        console.error('获取元数据失败', err);
      }
    };
    fetchMetadata();
  }, []);

  // Book source plugins declare themselves with book_source: true; everything
  // else in the scraper list is a metadata fetcher for local libraries.
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/api/scraper/sources')
      .then((response) => {
        if (cancelled) return;
        const raw = (response.data?.sources ?? []) as { id: string; name: string; book_source?: boolean }[];
        setBookSources(raw.filter((source) => source.book_source).map((source) => ({ id: source.id, name: source.name })));
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to load book sources', error);
      })
      .finally(() => {
        if (!cancelled) setSourcesReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const sourceIdsKey = bookSources.map((source) => source.id).join(',');
  const missingOnlineSources = sourceMode !== 'local' && sourcesReady && bookSources.length === 0;
  // No source means no query to run: folding the id list into the key keeps the
  // page from sitting in "loading" forever while the sources are still unknown.
  const onlineKey = sourceMode !== 'local' && sourceIdsKey && debouncedQuery.trim()
    ? `online|${debouncedQuery.trim()}`
    : '';
  const onlineItems = onlineResult.key === onlineKey ? onlineResult.items : [];
  const onlineError = onlineResult.key === onlineKey ? onlineResult.error : '';
  // A search with no answer yet — sources still loading, or the query has not
  // come back — always reads as "loading" instead of showing an empty block.
  const onlineLoading = sourceMode !== 'local' && Boolean(debouncedQuery.trim())
    && (!sourcesReady || (Boolean(onlineKey) && onlineResult.key !== onlineKey));

  useEffect(() => {
    if (!onlineKey || !sourceIdsKey) return;
    const keyword = onlineKey.slice(onlineKey.indexOf('|') + 1);
    const sources = sourceIdsKey.split(',');
    const controller = new AbortController();
    Promise.allSettled(
      sources.map((source) => apiClient
        .post(
          '/api/v1/scraper/search',
          { source, query: keyword, page: 1, page_size: 20 },
          // A source that never answers must stop being "loading" on this page.
          { signal: controller.signal, timeout: 15000 },
        )
        .then((response) => ({
          source,
          items: (response.data?.items ?? []) as OnlineBookItem[],
        }))),
    )
      .then((settled) => {
        if (controller.signal.aborted) return;
        const seen = new Set<string>();
        const items: OnlineBookItem[] = [];
        let failure = '';
        for (const entry of settled) {
          if (entry.status === 'rejected') {
            failure = failure || apiErrorMessage(entry.reason, t('searchPage.onlineFailed', '检索在线书源失败'));
            continue;
          }
          for (const item of entry.value.items) {
            // Same title-only rule as the local shelf: an album whose title does
            // not contain the keyword is not a match for this query.
            if (!(item.title ?? '').toLowerCase().includes(keyword.toLowerCase())) continue;
            const dedupe = `${entry.value.source}:${item.id}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            items.push({ ...item, sourceId: entry.value.source });
          }
        }
        // One failing source must not hide the answers another source returned.
        setOnlineResult({ key: onlineKey, items, error: items.length > 0 ? '' : failure });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setOnlineResult({
          key: onlineKey,
          items: [],
          error: apiErrorMessage(error, t('searchPage.onlineFailed', '检索在线书源失败')),
        });
      });
    return () => controller.abort();
  }, [onlineKey, sourceIdsKey, t]);

  // Opening an online result is the only moment it enters the database, and the
  // host files it under the source's managed library rather than the shelf.
  const openOnlineBook = useCallback(async (item: OnlineBookItem) => {
    if (!item.sourceId || openingSourceId) return;
    setOpeningSourceId(item.id);
    try {
      const { data } = await apiClient.post('/api/v1/scraper/books', {
        source: item.sourceId,
        book: { id: item.id, url: null },
      });
      if (data?.book_id) navigate(`/book/${data.book_id}`);
    } catch (error) {
      setOnlineResult((prev) => ({
        ...prev,
        error: apiErrorMessage(error, t('searchPage.onlineOpenFailed', '打开这本书失败')),
      }));
    } finally {
      setOpeningSourceId('');
    }
  }, [openingSourceId, navigate, t]);

  const hasActiveFilters = selectedLibraryId || selectedTag || selectedGenre
    || selectedYear || selectedAuthor || selectedNarrator || selectedSeries;

  // Search is scoped to the local bookshelf only: the shelf/online switch was
  // removed on purpose, so the query and the filters are the only inputs.
  useEffect(() => {
    const controller = new AbortController();
    const searchBooks = async () => {
      const hasLocalQuery = Boolean(debouncedQuery.trim()) || Boolean(hasActiveFilters);
      if (!hasLocalQuery) {
        setResults([]);
        setSearchError('');
        setLoading(false);
        return;
      }

      setLoading(true);
      setSearchError('');
      try {
        const { data } = await apiClient.get('/api/books', {
          params: {
            ...(debouncedQuery.trim() ? { search: debouncedQuery } : {}),
            ...(selectedTag ? { tag: selectedTag } : {}),
            ...(selectedLibraryId ? { library_id: selectedLibraryId } : {}),
          },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        // Online books live in a managed source library once opened; they are not
        // local audio and belong only to the online block below.
        let filtered = (data as Book[]).filter((book) => book.library_type !== 'source');
        // The query is a title query: the host also matches author and narrator,
        // which made "论语" return unrelated books whose reader happens to share
        // a character. Keep only titles that contain the typed keyword.
        const keyword = debouncedQuery.trim().toLowerCase();
        if (keyword) {
          filtered = filtered.filter((book) => (book.title ?? '').toLowerCase().includes(keyword));
        }
        if (selectedAuthor) filtered = filtered.filter(book => book.author === selectedAuthor);
        if (selectedNarrator) filtered = filtered.filter(book => book.narrator === selectedNarrator);
        if (selectedGenre) {
          filtered = filtered.filter(book => book.genre && book.genre.split(',').map(genre => genre.trim()).includes(selectedGenre));
        }
        if (selectedYear) filtered = filtered.filter(book => book.year && book.year.toString() === selectedYear);
        if (selectedSeries) {
          const series = allSeries.find(item => item.id === selectedSeries);
          const seriesBookIds = new Set(series?.books?.map(book => book.id) ?? []);
          filtered = filtered.filter(book => seriesBookIds.has(book.id));
        }
        setResults(filtered);
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(apiErrorMessage(error, t('searchPage.loadFailed')));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    searchBooks();
    return () => controller.abort();
  }, [debouncedQuery, selectedTag, selectedGenre, selectedYear, selectedAuthor, selectedNarrator, selectedLibraryId, selectedSeries, allSeries, hasActiveFilters, t]);

  const hasSearch = Boolean(debouncedQuery.trim()) || Boolean(hasActiveFilters);

  return (
    <div className="reader-page reader-search-page reader-locked-page flex flex-1 flex-col">
      {/* Same page chrome as home and the bookshelf: the back button, the title
          and the search field are fixed page chrome, only the results scroll. */}
      <div className="reader-search-toolbar reader-page-toolbar">
        <BackButton fallback="/bookshelf" />

        <div className="reader-search-header space-y-4">
          <h1 className="reader-search-title">{t('searchPage.title')}</h1>

          {/* Main Search Input */}
          <div className="reader-search-field relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              ref={searchInputRef}
              autoFocus={!restored?.query}
              type="search"
              enterKeyHint="search"
              aria-label={t('searchPage.placeholder')}
              placeholder={t('searchPage.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-12 pr-12 py-3 md:py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg focus:ring-2 focus:ring-primary-500 outline-none text-base md:text-lg transition-all dark:text-white"
            />
            {loading ? (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Loader2 className="animate-spin text-primary-600" size={24} />
              </div>
            ) : (
              query && (
                <button 
                  onClick={() => setQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <BookX size={20} />
                </button>
              )
            )}
          </div>

          {/* Three fixed choices only; the plugin name never surfaces here.
              "全部" is the default, so a search asks the shelf and the online
              sources together. The row stays visible even before a source
              answers, so the mode never silently disappears. */}
          {onlineEnabled && <div className="reader-search-source-row">
              <span className="reader-search-source-label">{t('searchPage.sourceRow', '来源')}</span>
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'local', 'online'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={sourceMode === mode}
                    onClick={() => setSourceMode(mode)}
                    className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap ${
                      sourceMode === mode
                        ? 'bg-primary-500 text-white font-medium shadow-md shadow-primary-500/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {mode === 'online' && <Cloud size={14} strokeWidth={2} aria-hidden="true" />}
                    {t(
                      mode === 'all'
                        ? 'searchPage.sourceAll'
                        : mode === 'local' ? 'searchPage.sourceLocal' : 'searchPage.sourceOnline',
                      mode === 'all' ? '全部' : mode === 'local' ? '书架' : '在线',
                    )}
                  </button>
                ))}
              </div>
            </div>}

          {/* Filters Toggle Button */}
          <div className="reader-search-filter-toggle">
            <button
              type="button"
              aria-expanded={showFilters}
              aria-controls="search-filters"
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal size={16} />
              {t(showFilters ? 'searchPage.hideFilters' : 'searchPage.showFilters')}
              {hasActiveFilters && !showFilters && <div className="w-2 h-2 rounded-full bg-primary-500 ml-1" />}
              {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      <div className="reader-page-scroll space-y-6">
      {/* Advanced Filters Panel */}
      {showFilters && (
        <div id="search-filters" className="reader-filter-panel">
          <div className="reader-filter-panel-heading">
            <strong>{t('searchPage.filtersTitle')}</strong>
            <button type="button" className="reader-button" onClick={() => {
              setSelectedLibraryId(''); setSelectedSeries(''); setSelectedTag(''); setSelectedGenre('');
              setSelectedYear(''); setSelectedAuthor(''); setSelectedNarrator('');
            }}>{t('searchPage.clear')}</button>
          </div>
          <div className="reader-filter-groups">
            <FilterRow
              label={t('searchPage.library')}
              allLabel={t('searchPage.all')}
              items={libraries}
              selected={selectedLibraryId}
              onSelect={setSelectedLibraryId}
              scrollRef={librariesScrollRef}
            />
            <FilterRow
              label={t('searchPage.series')}
              allLabel={t('searchPage.all')}
              items={allSeries.map(s => ({ id: s.id, name: s.title }))}
              selected={selectedSeries}
              onSelect={setSelectedSeries}
              scrollRef={seriesScrollRef}
            />
            <FilterRow
              label={t('searchPage.tags')}
              allLabel={t('searchPage.all')}
              items={allTags}
              selected={selectedTag}
              onSelect={setSelectedTag}
              scrollRef={tagsScrollRef}
            />
            <FilterRow
              label={t('searchPage.genre')}
              allLabel={t('searchPage.all')}
              items={allGenres}
              selected={selectedGenre}
              onSelect={setSelectedGenre}
              scrollRef={genresScrollRef}
            />
            <FilterRow
              label={t('searchPage.year')}
              allLabel={t('searchPage.all')}
              items={allYears}
              selected={selectedYear}
              onSelect={setSelectedYear}
              scrollRef={yearsScrollRef}
            />
            <FilterRow
              label={t('searchPage.author')}
              allLabel={t('searchPage.all')}
              items={allAuthors}
              selected={selectedAuthor}
              onSelect={setSelectedAuthor}
              scrollRef={authorsScrollRef}
            />
            <FilterRow
              label={t('searchPage.narrator')}
              allLabel={t('searchPage.all')}
              items={allNarrators}
              selected={selectedNarrator}
              onSelect={setSelectedNarrator} 
              scrollRef={narratorsScrollRef}
            />
          </div>
        </div>
      )}

      {hasSearch && sourceMode !== 'online' && (
        <section aria-live="polite" aria-busy={loading}>
          {searchError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{searchError}</p>}
          {results.length > 0 ? (
            <div className={`grid ${getBookshelfGridClass(iconSize)} pt-4`}>
              {results.map((book) => (
                <BookCard key={book.id} book={book} coverShape={coverShape} />
              ))}
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : (
            <div className="py-20 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-400 mb-4">
                <BookX size={40} />
              </div>
              <h3 className="text-xl font-medium dark:text-white">{t('searchPage.noResults')}</h3>
              <p className="text-slate-500 mt-2">{t('searchPage.noResultsHint')}</p>
            </div>
          )}
        </section>
      )}

      {sourceMode !== 'local' && debouncedQuery.trim() && (
        <section className="space-y-3" aria-live="polite" aria-busy={onlineLoading}>
          <header className="flex items-center gap-2 pt-2">
            <Cloud size={16} className="text-slate-400" aria-hidden="true" />
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {t('searchPage.onlineTitle', '在线结果')}
            </h2>
          </header>
          {onlineError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{onlineError}</p>}
          {missingOnlineSources ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('searchPage.onlineNoSource', '暂无在线书源')}</p>
          ) : onlineItems.length > 0 ? (
            <div className={`grid ${getBookshelfGridClass(iconSize)} pt-1`}>
              {onlineItems.map((item) => (
                <OnlineBookCard
                  key={item.id}
                  item={item}
                  coverShape={coverShape}
                  busy={openingSourceId === item.id}
                  onOpen={openOnlineBook}
                />
              ))}
            </div>
          ) : onlineLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : (
            !onlineError && <p className="py-8 text-center text-sm text-slate-400">{t('searchPage.onlineEmpty', '没有搜到匹配的有声书')}</p>
          )}
        </section>
      )}

      {!hasSearch && (
        <div className="py-20 text-center text-slate-400">
          <p>{t('searchPage.emptyHint')}</p>
        </div>
      )}
      </div>
    </div>
  );
};

export default SearchPage;
