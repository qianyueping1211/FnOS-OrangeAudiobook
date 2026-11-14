import React, { useCallback, useState, useEffect, useRef } from 'react';
import apiClient from '../../core/api/client';
import { getBookshelfGridClass, useBookshelfDisplaySettings } from '../../core/hooks/useBookshelfCoverShape';
import type { Book, Library, Series } from '../../core/types';
import { apiErrorMessage } from '../../core/api/errors';
import BookCard from '../../shared/cards/BookCard';
import { Search as SearchIcon, Loader2, BookX, ChevronLeft, ChevronRight, SlidersHorizontal, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlayerStore } from '../../core/stores/playerStore';
import BackButton from '../../shared/widgets/BackButton';
import { useTranslation } from 'react-i18next';

type FilterOption = string | { id: string; name: string };

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

const SearchPage: React.FC = () => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  
  // Filter states
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('');
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedAuthor, setSelectedAuthor] = useState<string>('');
  const [selectedNarrator, setSelectedNarrator] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  
  // Data options
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [allSeries, setAllSeries] = useState<Series[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [allYears, setAllYears] = useState<string[]>([]);
  const [allAuthors, setAllAuthors] = useState<string[]>([]);
  const [allNarrators, setAllNarrators] = useState<string[]>([]);
  
  const [results, setResults] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const currentChapter = usePlayerStore((state) => state.currentChapter);
  
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

        let filtered = data as Book[];
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
    <div className="reader-page reader-search-page flex-1 space-y-6">
      {/* Sticky top: while the results scroll, the back button, the title and
          the search field stay pinned instead of sliding under the header. */}
      <div className="reader-search-sticky">
        <BackButton fallback="/bookshelf" />

        <div className="reader-search-header space-y-4">
          <h1 className="reader-search-title">{t('searchPage.title')}</h1>
          <p className="text-sm md:text-base text-slate-500">{t('searchPage.subtitle')}</p>

          {/* Main Search Input */}
          <div className="reader-search-field relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="search"
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

      {hasSearch && (
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

      {!hasSearch && (
        <div className="py-20 text-center text-slate-400">
          <p>{t('searchPage.emptyHint')}</p>
        </div>
      )}

      {/* Dynamic Safe Bottom Spacer */}
      <div 
        className="shrink-0 transition-all duration-300" 
        style={{ height: currentChapter ? 'var(--safe-bottom-with-player)' : 'var(--safe-bottom-base)' }} 
      />
    </div>
  );
};

export default SearchPage;
