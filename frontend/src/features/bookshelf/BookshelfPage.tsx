import { apiErrorMessage } from '../../core/api/errors';
import { useBookOperations } from '../../core/hooks/useBooks';
import { libraryCacheIdentity, libraryViewCache } from '../../core/api/libraryCache';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Book, Library, Series } from '../../core/types';
import BookCard from '../../shared/cards/BookCard';
import SeriesCard from '../../shared/cards/SeriesCard';
import SeriesModal from '../../shared/modals/SeriesModal';
import DeleteLibraryItemModal from './bookDetail/DeleteLibraryItemModal';
import DisplaySettingsMenu from '../../shared/widgets/DisplaySettingsMenu';
import { Search, Database, Plus, Library as LibraryIcon, Layers, Check, X, CheckSquare, ChevronDown, Trash2, BookCheck, BookX } from 'lucide-react';
import { useAuthStore } from '../../core/stores/authStore';
import { getPinyinInitial } from '../../core/utils/pinyin';
import { localeCompare } from '../../core/utils/locale';
import { publishBookshelfCoverShape } from '../../core/hooks/useBookshelfCoverShape';
import BookshelfListItem from './BookshelfListItem';

type ShelfLibrary = Pick<Library, 'id' | 'name' | 'library_type'>;
interface ShelfSnapshot {
  books: Book[];
  series: Series[];
  libraries: ShelfLibrary[];
  libraryId: string;
  sortBy: 'createdAt' | 'title' | 'author' | 'year';
  iconSize: 'small' | 'medium' | 'large';
  coverShape: 'rect' | 'square';
  viewMode: 'grid' | 'list';
}

const sortForApi = (value: ShelfSnapshot['sortBy']) => (value === 'createdAt' ? 'created' : value);

// 书架首屏以前要先等一次 /api/settings 再取书，冷启动就多了一次往返。设置本身
// 很少变，把上一份按 identity 记在本地：有缓存就先把书取下来，settings 回来
// 只做校正，参数真变了才会再取一遍。
const SHELF_PREFS_KEY = 'ting-shelf-prefs';
type ShelfPrefs = Pick<ShelfSnapshot, 'libraryId' | 'sortBy' | 'iconSize' | 'coverShape' | 'viewMode'>;
const readShelfPrefs = (identity: string): ShelfPrefs | null => {
  try {
    const raw = window.localStorage.getItem(`${SHELF_PREFS_KEY}:${identity}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShelfPrefs>;
    const sortValues: ShelfPrefs['sortBy'][] = ['createdAt', 'title', 'author', 'year'];
    const iconValues: ShelfPrefs['iconSize'][] = ['small', 'medium', 'large'];
    return {
      libraryId: typeof parsed.libraryId === 'string' ? parsed.libraryId : '',
      sortBy: sortValues.includes(parsed.sortBy as ShelfPrefs['sortBy']) ? parsed.sortBy as ShelfPrefs['sortBy'] : 'createdAt',
      iconSize: iconValues.includes(parsed.iconSize as ShelfPrefs['iconSize']) ? parsed.iconSize as ShelfPrefs['iconSize'] : 'medium',
      coverShape: parsed.coverShape === 'rect' ? 'rect' : 'square',
      viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
    };
  } catch {
    return null;
  }
};
const writeShelfPrefs = (identity: string, prefs: ShelfPrefs): void => {
  try {
    window.localStorage.setItem(`${SHELF_PREFS_KEY}:${identity}`, JSON.stringify(prefs));
  } catch {
    // Private mode or a full quota: the next visit simply waits for settings again.
  }
};

const BookshelfPage: React.FC = () => {
  const identity = useAuthStore(state => libraryCacheIdentity(state.serverUrl || state.activeUrl, state.token ? state.user?.id : undefined));
  return <BookshelfContents key={identity} cacheIdentity={identity} />;
};

const BookshelfContents: React.FC<{ cacheIdentity: string }> = ({ cacheIdentity }) => {
  const [snapshot] = useState(() => libraryViewCache.get<ShelfSnapshot>(cacheIdentity, 'shelf'));
  const [savedView] = useState(() => libraryViewCache.get<{ count: number; scroll: number }>(cacheIdentity, 'shelf-view'));
  const [cachedPrefs] = useState(() => readShelfPrefs(cacheIdentity));
  const dataRequest = React.useRef<AbortController | null>(null);
  const loadedLibrary = React.useRef(snapshot?.libraryId);
  const bookOperations = useBookOperations();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const [books, setBooks] = useState<Book[]>((snapshot?.books ?? []).filter((book) => book.library_type !== 'source'));
  const [series, setSeries] = useState<Series[]>(snapshot?.series ?? []);
  const [libraries, setLibraries] = useState<ShelfLibrary[]>(snapshot?.libraries ?? []);
  // Online book-source libraries hold gathered audiobooks, not NAS files, so the
  // shelf leaves them out. loadedRaw keeps paging on the server's row count so
  // the filter can never skip a row.
  const [loadedRaw, setLoadedRaw] = useState(snapshot?.books?.length ?? 0);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(snapshot?.libraryId ?? cachedPrefs?.libraryId ?? '');
  const [loading, setLoading] = useState(!snapshot);
  const [sortBy, setSortBy] = useState<ShelfSnapshot['sortBy']>(snapshot?.sortBy ?? cachedPrefs?.sortBy ?? 'createdAt');
  const [iconSize, setIconSize] = useState<ShelfSnapshot['iconSize']>(snapshot?.iconSize ?? cachedPrefs?.iconSize ?? 'medium');
  const [coverShape, setCoverShape] = useState<ShelfSnapshot['coverShape']>(snapshot?.coverShape ?? cachedPrefs?.coverShape ?? 'square');
  const [viewMode, setViewMode] = useState<ShelfSnapshot['viewMode']>(snapshot?.viewMode ?? cachedPrefs?.viewMode ?? 'grid');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(!!snapshot || !!cachedPrefs);
  
  // Alphabet Index State
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [isTouchingIndex, setIsTouchingIndex] = useState(false);
  
  // Selection mode for creating series and bulk actions
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>([]);
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState(false);
  const [isOperationsOpen, setIsOperationsOpen] = useState(false);
  const [isDeleteBookOpen, setIsDeleteBookOpen] = useState(false);
  const [isDeleteSeriesOpen, setIsDeleteSeriesOpen] = useState(false);
  const [deletingBooks, setDeletingBooks] = useState(false);
  const [deletingSeries, setDeletingSeries] = useState(false);
  const [deleteSourceFiles, setDeleteSourceFiles] = useState(false);
  const [savingReadStatus, setSavingReadStatus] = useState(false);
  const [confirmUnread, setConfirmUnread] = useState(false);

  useEffect(() => {
    if (!confirmUnread) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingReadStatus) setConfirmUnread(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmUnread, savingReadStatus]);

  // Paging: the shelf asks the server for one screen at a time. A media query
  // answered ">=960" even on phones, so every device used to pull 18 rows
  // regardless of how many cards actually fit. The size now follows the
  // rendered grid: columns x (visible rows + 1), measured after the first paint.
  const SHELF_PAGE_SIZE = 12;
  const pageSizeRef = React.useRef(SHELF_PAGE_SIZE);
  const measurePageSize = () => {
    const grid = document.querySelector<HTMLElement>('[data-shelf-grid]');
    const pane = document.querySelector<HTMLElement>('.reader-bookshelf-page .reader-page-scroll');
    if (!grid || !pane) return SHELF_PAGE_SIZE;
    const gridStyle = window.getComputedStyle(grid);
    const columns = gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length;
    const gap = parseFloat(gridStyle.rowGap || '0');
    const rowHeight = ((grid.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0)
      + (Number.isFinite(gap) ? gap : 0);
    if (columns <= 0 || rowHeight <= 0) return SHELF_PAGE_SIZE;
    const rows = Math.max(1, Math.ceil(pane.clientHeight / rowHeight));
    // One extra row keeps the next batch queued before the reader reaches the end.
    return Math.min(Math.max(columns * (rows + 1), columns), 80);
  };
  useEffect(() => {
    pageSizeRef.current = measurePageSize();
  }, [books.length, series.length, viewMode, iconSize, coverShape, loading, selectedLibraryId]);
  const [totalBooks, setTotalBooks] = useState(snapshot?.books?.length ?? 0);
  const loadingMoreRef = React.useRef(false);
  const booksRef = React.useRef(books);
  useEffect(() => { booksRef.current = books; }, [books]);
  React.useLayoutEffect(() => {
    const container = document.querySelector<HTMLElement>('.reader-bookshelf-page .reader-page-scroll');
    if (!container) return;
    const scroll = savedView?.scroll ?? 0;
    container.scrollTo({ top: scroll, behavior: 'instant' });
    let latestScroll = scroll;
    const record = () => { latestScroll = container.scrollTop; };
    container.addEventListener('scroll', record, { passive: true });
    return () => {
      container.removeEventListener('scroll', record);
      libraryViewCache.set(cacheIdentity, 'shelf-view', { count: booksRef.current.length, scroll: latestScroll });
    };
  }, [cacheIdentity, savedView]);

  // Append the next page when the shelf pane nears its end. The rows come from
  // the server (series members are filtered there), so a 700-book library no
  // longer arrives in a single response before the first card can paint.
  useEffect(() => {
    if (loading || loadedRaw >= totalBooks) return;
    const pane = document.querySelector<HTMLElement>('.reader-bookshelf-page .reader-page-scroll');
    const shell = document.getElementById('main-content');
    const scrollable = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    };
    const target = scrollable(pane) ? pane : scrollable(shell) ? shell : null;
    if (!target) return;
    let frame = 0;

    const loadNextPage = async () => {
      if (loadingMoreRef.current || loadedRaw >= totalBooks) return;
      loadingMoreRef.current = true;
      try {
        const res = await apiClient.get('/api/books/page', {
          params: {
            library_id: selectedLibraryId || undefined,
            offset: loadedRaw,
            page_size: pageSizeRef.current,
            sort: sortForApi(sortBy),
          },
        });
        const data = res.data as { items: Book[]; total: number };
        const items = data.items || [];
        setLoadedRaw(loadedRaw + items.length);
        setTotalBooks(typeof data.total === 'number' ? data.total : loadedRaw + items.length);
        setBooks((prev) => {
          const seen = new Set(prev.map((book) => book.id));
          return [...prev, ...items.filter((book) => book.library_type !== 'source' && !seen.has(book.id))];
        });
      } catch (err) {
        console.error('Failed to load the next bookshelf page', err);
      } finally {
        loadingMoreRef.current = false;
      }
    };

    const check = () => {
      frame = 0;
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining > 320) return;
      void loadNextPage();
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(check);
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    // A first page that does not overflow still has to grow, otherwise a tall
    // window would never fire a scroll event.
    const topUp = window.setTimeout(check, 0);

    return () => {
      target.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(topUp);
    };
  }, [loading, books, loadedRaw, totalBooks, sortBy, selectedLibraryId]);

  useEffect(() => {
    const request = new AbortController();
    const loadSettings = async () => {
      try {
        const res = await apiClient.get('/api/settings', { signal: request.signal });
        if (request.signal.aborted) return;
        const settings = res.data.settings_json || {};
        
        setSelectedLibraryId(settings.bookshelf_library_id || '');
        if (settings.bookshelf_sort_by) {
          setSortBy(settings.bookshelf_sort_by);
        }
        if (settings.bookshelf_icon_size) {
          setIconSize(settings.bookshelf_icon_size);
        }
        if (settings.bookshelf_cover_shape) {
          setCoverShape(settings.bookshelf_cover_shape);
        }
        setViewMode(settings.bookshelf_view_mode === 'list' ? 'list' : 'grid');
        writeShelfPrefs(cacheIdentity, {
          libraryId: settings.bookshelf_library_id || '',
          sortBy: (settings.bookshelf_sort_by as ShelfPrefs['sortBy']) || 'createdAt',
          iconSize: (settings.bookshelf_icon_size as ShelfPrefs['iconSize']) || 'medium',
          coverShape: (settings.bookshelf_cover_shape as ShelfPrefs['coverShape']) || 'square',
          viewMode: settings.bookshelf_view_mode === 'list' ? 'list' : 'grid',
        });
      } catch (err) {
        if (!request.signal.aborted) console.error('Failed to load bookshelf settings', err);
      } finally {
        if (!request.signal.aborted) setSettingsLoaded(true);
      }
    };
    loadSettings();
    return () => request.abort();
  }, [cacheIdentity]);

  // Close operations menu when clicking outside
  useEffect(() => {
    if (!isOperationsOpen) return;
    
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.operations-dropdown-container')) {
        setIsOperationsOpen(false);
      }
    };
    
    const timer = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 50);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [isOperationsOpen]);

  const handleLibraryChange = (newId: string) => {
    setSelectedLibraryId(newId);
    apiClient.post('/api/settings', { bookshelf_library_id: newId });
  };

  const handleSortChange = (newSort: 'createdAt' | 'title' | 'author' | 'year') => {
    setSortBy(newSort);
    setShowFilterMenu(false);
    apiClient.post('/api/settings', { bookshelf_sort_by: newSort });
  };

  const handleIconSizeChange = (newSize: 'small' | 'medium' | 'large') => {
    setIconSize(newSize);
    setShowFilterMenu(false);
    apiClient.post('/api/settings', { bookshelf_icon_size: newSize });
  };

  const handleCoverShapeChange = (newShape: 'rect' | 'square') => {
    setCoverShape(newShape);
    setShowFilterMenu(false);
    publishBookshelfCoverShape(newShape);
    apiClient.post('/api/settings', { bookshelf_cover_shape: newShape });
  };

  const handleViewModeChange = (newMode: 'grid' | 'list') => {
    setViewMode(newMode);
    setShowFilterMenu(false);
    apiClient.post('/api/settings', { bookshelf_view_mode: newMode });
  };

  const fetchData = async () => {
    dataRequest.current?.abort();
    const request = new AbortController();
    dataRequest.current = request;
    setLoading(loadedLibrary.current !== selectedLibraryId);
    try {
      // The library list only feeds the switcher, so it is fetched alongside
      // the first screen of books instead of in front of it.
      const pageSize = pageSizeRef.current;
      const [libsRes, booksRes, seriesRes] = await Promise.all([
        apiClient.get('/api/libraries', { signal: request.signal }),
        apiClient.get('/api/books/page', {
          signal: request.signal,
          params: {
            library_id: selectedLibraryId || undefined,
            page: 1,
            page_size: pageSize,
            sort: sortForApi(sortBy),
          },
        }),
        apiClient.get('/api/v1/series', {
          signal: request.signal,
          params: { library_id: selectedLibraryId || undefined },
        }),
      ]);
      if (request.signal.aborted) return;
      const libs = libsRes.data as Library[];
      setLibraries(libs.filter((library) => library.library_type !== 'source'));

      // A saved library id that no longer exists is dropped, which re-runs
      // this effect without a filter.
      if (selectedLibraryId && !libs.some((library) => library.id === selectedLibraryId)) {
        console.warn(`Selected library ${selectedLibraryId} was not found. Resetting to default.`);
        setSelectedLibraryId('');
        apiClient.post('/api/settings', { bookshelf_library_id: '' });
        return;
      }

      const pageData = booksRes.data as { items: Book[]; total: number };
      const pageItems = pageData.items || [];
      loadedLibrary.current = selectedLibraryId;
      setBooks(pageItems.filter((book) => book.library_type !== 'source'));
      setLoadedRaw(pageItems.length);
      setTotalBooks(typeof pageData.total === 'number' ? pageData.total : pageItems.length);
      setSeries(seriesRes.data);
    } catch (err) {
      if (!request.signal.aborted) console.error('Failed to fetch bookshelf data', err);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (settingsLoaded) {
      const timer = window.setTimeout(() => void fetchData(), 0);
      return () => { window.clearTimeout(timer); dataRequest.current?.abort(); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibraryId, settingsLoaded, sortBy]);

  useEffect(() => {
    if (loading || loadedLibrary.current !== selectedLibraryId) return;
    libraryViewCache.set(cacheIdentity, 'shelf', {
      books, series,
      libraries: libraries.map(({ id, name, library_type }) => ({ id, name, library_type })),
      libraryId: selectedLibraryId, sortBy, iconSize, coverShape, viewMode,
    } satisfies ShelfSnapshot);
  }, [cacheIdentity, books, series, libraries, selectedLibraryId, sortBy, iconSize, coverShape, viewMode, loading]);

  const sortedBooks = React.useMemo(() => [...books].sort((a, b) => {
    if (sortBy === 'title') return localeCompare(a.title, b.title);
    if (sortBy === 'author') return localeCompare(a.author || '', b.author || '');
    if (sortBy === 'year') {
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      return yearB - yearA; // Descending order (newest first)
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }), [books, sortBy]);

  // Collect all book IDs that are in a series
  const booksInSeries = React.useMemo(
    () => new Set(series.flatMap(s => s.books?.map(b => b.id) || [])),
    [series],
  );

  const filteredBooks = React.useMemo(
    () => sortedBooks.filter(book => !booksInSeries.has(book.id)),
    [sortedBooks, booksInSeries],
  );

  const filteredSeries = series;
  // Everything fetched so far is on screen: the server already cut the list
  // into pages, so there is nothing left to hide here.
  const visibleCount = filteredBooks.length + filteredSeries.length;

  const toggleBookSelection = (id: string) => {
    setSelectedBookIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSeriesSelection = (id: string) => {
    setSelectedSeriesIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedBookIds([]);
    setSelectedSeriesIds([]);
    setIsOperationsOpen(false);
    fetchData();
  };

  const handleSelectAll = () => {
    if (filteredBooks.length === 0 && filteredSeries.length === 0) return;
    
    const allBooksSelected = filteredBooks.every(b => selectedBookIds.includes(b.id));
    const allSeriesSelected = filteredSeries.every(s => selectedSeriesIds.includes(s.id));
    
    if (allBooksSelected && allSeriesSelected) {
      setSelectedBookIds([]);
      setSelectedSeriesIds([]);
    } else {
      setSelectedBookIds(filteredBooks.map(b => b.id));
      setSelectedSeriesIds(filteredSeries.map(s => s.id));
    }
  };

  const handleMarkRead = async (read: boolean) => {
    if (selectedBookIds.length === 0 || savingReadStatus) return;
    setSavingReadStatus(true);
    try {
      await bookOperations.current?.markRead(selectedBookIds, read);
      setConfirmUnread(false);
      await fetchData();
      setSelectedBookIds([]);
    } catch (err) {
      console.error('Failed to update book read status', err);
      alert(apiErrorMessage(err, t('common.saveFailed')));
    } finally {
      setSavingReadStatus(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteSourceFiles(false);
    if (selectedSeriesIds.length > 0) {
      setIsDeleteSeriesOpen(true);
    } else if (selectedBookIds.length > 0) {
      setIsDeleteBookOpen(true);
    }
  };

  const handleDeleteBooks = async () => {
    try {
      setDeletingBooks(true);
      await bookOperations.current?.deleteBooks(selectedBookIds, deleteSourceFiles);
      exitSelectionMode();
      fetchData();
    } catch (err) {
      console.error('Failed to delete books', err);
      alert(apiErrorMessage(err, t('bookshelf.deleteBookFailed')));
    } finally {
      setDeletingBooks(false);
      setIsDeleteBookOpen(false);
    }
  };

  const handleDeleteSeries = async () => {
    try {
      setDeletingSeries(true);
      await bookOperations.current?.deleteSeries(selectedSeriesIds);
      setIsDeleteSeriesOpen(false);
      if (selectedBookIds.length > 0) {
        setDeleteSourceFiles(false);
        setIsDeleteBookOpen(true);
      } else {
        exitSelectionMode();
        fetchData();
      }
    } catch (err) {
      console.error('Failed to delete series', err);
      alert(apiErrorMessage(err, t('bookshelf.deleteSeriesFailed')));
      setIsDeleteSeriesOpen(false);
    } finally {
      setDeletingSeries(false);
    }
  };

  const getGridCols = () => {
    // Gaps come from .reader-shelf-grid in reader.css, which mirrors the home
    // "recently added" grid (13px/20px on phones, 18px/22px from 960px up) so a
    // cover row reads exactly the same on both screens.
    switch (iconSize) {
      case 'small':
        return 'grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-8 2xl:grid-cols-10';
      case 'large':
        return 'grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-6';
      default: // medium
        return 'grid-cols-3 sm:grid-cols-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7';
    }
  };

  // Group items by first letter if sorting by title or author, or by year if sorting by year
  const groupedItems = React.useMemo(() => {
    if (sortBy === 'createdAt') return null;

    const groups: Record<string, (Book | Series)[]> = {};
    const otherKey = '#';

    // Process books
    filteredBooks.forEach(book => {
      let key = '';
      if (sortBy === 'title') {
        key = getPinyinInitial(book.title);
      } else if (sortBy === 'author') {
        key = getPinyinInitial(book.author || '');
      } else if (sortBy === 'year') {
        const year = book.year;
        key = year ? String(year).slice(-2) : otherKey; // Use last 2 digits (e.g., "24" for 2024)
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(book);
    });

    // Process series
    filteredSeries.forEach(series => {
      let key = '';
      if (sortBy === 'title') {
        key = getPinyinInitial(series.title);
      } else if (sortBy === 'author') {
        key = getPinyinInitial(series.author || '');
      } else if (sortBy === 'year') {
        // For series, we could use the year of the first book if available
        // For now, skip series in year sorting or use a default
        key = otherKey;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(series);
    });

    // Sort items within each group
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => {
        if (sortBy === 'title') return localeCompare(a.title, b.title);
        if (sortBy === 'author') return localeCompare(a.author || '', b.author || '');
        if (sortBy === 'year') {
          const yearA = 'year' in a ? (a.year || 0) : 0;
          const yearB = 'year' in b ? (b.year || 0) : 0;
          return yearB - yearA; // Descending order within group
        }
        return 0;
      });
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === otherKey) return 1;
        if (b === otherKey) return -1;
        if (sortBy === 'year') {
          // For year sorting, sort keys numerically in descending order
          return Number(b) - Number(a);
        }
        return localeCompare(a, b);
    });

    return { groups, sortedKeys };
  }, [filteredBooks, filteredSeries, sortBy]);

  const visibleGroupedItems = React.useMemo(() => {
    if (!groupedItems) return null;
    let count = 0;
    const newGroups: Record<string, (Book | Series)[]> = {};
    const newSortedKeys: string[] = [];

    for (const key of groupedItems.sortedKeys) {
      if (count >= visibleCount) break;
      const itemsInGroup = groupedItems.groups[key];
      const itemsToTake = Math.min(itemsInGroup.length, visibleCount - count);
      
      if (itemsToTake > 0) {
        newGroups[key] = itemsInGroup.slice(0, itemsToTake);
        newSortedKeys.push(key);
        count += itemsToTake;
      }
    }
    return { groups: newGroups, sortedKeys: newSortedKeys };
  }, [groupedItems, visibleCount]);

  const visibleSeries = filteredSeries.slice(0, visibleCount);
  const remainingCount = Math.max(0, visibleCount - visibleSeries.length);
  const visibleBooks = filteredBooks.slice(0, remainingCount);

  const scrollToGroup = (key: string) => {
    setActiveLetter(key);
    const element = document.getElementById(`group-${key}`);
    const container = document.getElementById('main-content');
    
    if (element && container) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const offset = elementRect.top - containerRect.top + container.scrollTop;
      
      // Mobile header height (64px) + padding or Desktop padding
      const headerOffset = window.innerWidth < 1280 ? 80 : 20;
      
      container.scrollTo({ top: offset - headerOffset, behavior: 'auto' });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const key = element?.getAttribute('data-key');
    if (key && key !== activeLetter) {
      scrollToGroup(key);
    }
  };

  const mockBookForDeletion = React.useMemo(() => {
    if (selectedBookIds.length === 0) return null;
    const selectedBooks = selectedBookIds
      .map(id => books.find(b => b.id === id))
      .filter((book): book is Book => Boolean(book));
    if (selectedBookIds.length === 1) {
      return selectedBooks[0] || null;
    }
    const firstBook = selectedBooks[0];
    const hasLocalBook = selectedBooks.some(book => book.library_type === 'local');
    return {
      id: 'bulk',
      title: selectedBookIds.length.toString(),
      library_type: hasLocalBook ? 'local' : firstBook?.library_type,
    } as Book;
  }, [selectedBookIds, books]);

  const mockSeriesForDeletion = React.useMemo(() => {
    if (selectedSeriesIds.length === 0) return null;
    if (selectedSeriesIds.length === 1) {
      return series.find(s => s.id === selectedSeriesIds[0]) || null;
    }
    return {
      id: 'bulk',
      title: selectedSeriesIds.length.toString(),
    } as Series;
  }, [selectedSeriesIds, series]);

  const shelfLayoutClass = viewMode === 'list'
    ? 'divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900'
    : `grid reader-shelf-grid ${getGridCols()}`;

  const renderShelfItem = (item: Book | Series, kind: 'book' | 'series') => {
    const selected = (kind === 'series' ? selectedSeriesIds : selectedBookIds).includes(item.id);
    const onSelect = () => kind === 'series' ? toggleSeriesSelection(item.id) : toggleBookSelection(item.id);
    if (viewMode === 'list') {
      return (
        <BookshelfListItem key={`${kind}-${item.id}`} item={item} kind={kind}
          coverShape={coverShape} iconSize={iconSize} selected={selected}
          onSelect={isSelectionMode ? onSelect : undefined} />
      );
    }
    const card = kind === 'series'
      ? <SeriesCard series={item as Series} coverShape={coverShape} onClick={isSelectionMode ? onSelect : undefined} />
      : <BookCard book={item as Book} coverShape={coverShape} disableLink={isSelectionMode} onClick={isSelectionMode ? onSelect : undefined} />;
    return (
      <div key={`${kind}-${item.id}`} className="relative">
        {isSelectionMode ? (
          <>
            <div className={`absolute top-2 right-2 z-30 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all pointer-events-none ${selected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white/80 dark:bg-slate-900/80 border-slate-300 dark:border-slate-600'}`}>
              {selected && <Check size={14} />}
            </div>
            <div className={`transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-60 grayscale-[0.5]'}`}>{card}</div>
          </>
        ) : card}
      </div>
    );
  };

  return (
    <div className="reader-page reader-bookshelf-page reader-locked-page flex-1 min-h-full flex flex-col">
        <div className="reader-library-header reader-page-toolbar">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <LibraryIcon className="text-primary-600" />
              {t('bookshelf.myBookshelf')}
            </h1>
            <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 mt-1">{t('bookshelf.subtitle')}</p>
          </div>
          
          <div className="reader-library-tools">
            {isSelectionMode ? (
              <div className="reader-selection-actions flex items-center gap-2 order-1 relative">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
                  title={t('bookshelf.selectAllCurrent')}
                >
                  <CheckSquare size={18} />
                  <span>{t('bookshelf.selectAll')}</span>
                </button>
                  <div className="relative operations-dropdown-container">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOperationsOpen(!isOperationsOpen);
                      }}
                      aria-haspopup="menu"
                      aria-expanded={isOperationsOpen}
                      disabled={savingReadStatus}
                      className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-primary-500/30 whitespace-nowrap shrink-0 transition-all active:scale-95"
                    >
                      <span className="tabular-nums" aria-live="polite" aria-atomic="true">
                        {t('bookshelf.batchOperationsWithCount', { count: selectedBookIds.length + selectedSeriesIds.length })}
                      </span>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${isOperationsOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOperationsOpen && (
                      <div role="menu" className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-1.5 space-y-1">
                          {selectedBookIds.length === 0 && selectedSeriesIds.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-center text-slate-400 dark:text-slate-500 font-medium">
                              {t('bookshelf.selectItemsFirst', '请先在下方勾选书籍或系列')}
                            </div>
                          ) : (
                            <>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setIsOperationsOpen(false);
                                  void handleMarkRead(true);
                                }}
                                disabled={selectedBookIds.length === 0 || savingReadStatus}
                                className="w-full text-left px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 flex items-center gap-2 disabled:opacity-50"
                              >
                                <BookCheck size={16} />
                                <span>{t('bookshelf.markRead')}</span>
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setIsOperationsOpen(false);
                                  setConfirmUnread(true);
                                }}
                                disabled={selectedBookIds.length === 0 || savingReadStatus}
                                className="w-full text-left px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 flex items-center gap-2 disabled:opacity-50"
                              >
                                <BookX size={16} />
                                <span>{t('bookshelf.markUnread')}</span>
                              </button>
                              {isAdmin && <>
                              <div className="mx-3 my-1 border-t border-slate-100 dark:border-slate-800" />
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setIsOperationsOpen(false);
                                  setIsSeriesModalOpen(true);
                                }}
                                disabled={selectedBookIds.length === 0 || selectedSeriesIds.length > 0}
                                className="w-full text-left px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-transparent"
                              >
                                <Layers size={16} />
                                <span>{t('bookshelf.createSeries')}</span>
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setIsOperationsOpen(false);
                                  handleDeleteClick();
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-2"
                              >
                                <Trash2 size={16} />
                                <span>{t('common.delete')}</span>
                              </button>
                              </>}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                <button
                  onClick={exitSelectionMode}
                  className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl shrink-0"
                >
                  <X size={20} />
                </button>
              </div>
            ) : (
              (
                <button
                  onClick={() => setIsSelectionMode(true)}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium shrink-0 order-1"
                >
                  <Layers size={18} />
                  <span className="sm:hidden">{t('bookshelf.select')}</span>
                  <span className="hidden sm:inline">{t('bookshelf.selectionMode')}</span>
                </button>
              )
            )}

            {/* Library Selector */}
            {libraries.length > 0 && (
              <div className={`reader-library-select relative order-2 ${isSelectionMode ? 'hidden sm:block' : ''}`}>
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                  <LibraryIcon size={16} />
                </div>
                <select
                  aria-label={t('bookshelf.allLibraries')}
                  value={selectedLibraryId}
                  onChange={(e) => handleLibraryChange(e.target.value)}
                  className="w-full pl-8 pr-7 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 text-sm font-medium text-slate-700 dark:text-slate-200 appearance-none cursor-pointer truncate"
                >
                  <option value="">{t('bookshelf.allLibraries')}</option>
                  {libraries.map(lib => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            )}

            <Link
              to="/search"
              className="reader-library-search reader-search-link"
            >
              <Search size={18} className="shrink-0" />
              <span className="text-sm font-medium truncate">{t('bookshelf.searchPlaceholder')}</span>
            </Link>
            <DisplaySettingsMenu
              className="reader-display-control order-3"
              open={showFilterMenu}
              onOpenChange={setShowFilterMenu}
              sections={[
                {
                  title: t('bookshelf.viewMode'),
                  value: viewMode,
                  options: [
                    { value: 'grid', label: t('bookshelf.gridView') },
                    { value: 'list', label: t('bookshelf.listView') },
                  ],
                  onChange: (value) => handleViewModeChange(value as 'grid' | 'list'),
                },
                {
                  title: t('bookshelf.sortBy'),
                  value: sortBy,
                  options: [
                    { value: 'createdAt', label: t('bookshelf.sortRecentlyAdded') },
                    { value: 'title', label: t('bookshelf.sortTitle') },
                    { value: 'author', label: t('bookshelf.sortAuthor') },
                    { value: 'year', label: t('bookshelf.sortYear') },
                  ],
                  onChange: (value) => handleSortChange(value as 'createdAt' | 'title' | 'author' | 'year'),
                },
                {
                  title: t('bookshelf.iconSize'),
                  value: iconSize,
                  options: [
                    { value: 'large', label: t('bookshelf.largeIcon') },
                    { value: 'medium', label: t('bookshelf.mediumIconDefault') },
                    { value: 'small', label: t('bookshelf.smallIcon') },
                  ],
                  onChange: (value) => handleIconSizeChange(value as 'small' | 'medium' | 'large'),
                },
                {
                  title: t('bookshelf.coverShape'),
                  value: coverShape,
                  options: [
                    { value: 'rect', label: t('bookshelf.rectCover') },
                    { value: 'square', label: t('bookshelf.squareCoverDefault') },
                  ],
                  onChange: (value) => handleCoverShapeChange(value as 'rect' | 'square'),
                },
              ]}
            />
          </div>
        </div>

      <div className="reader-page-scroll space-y-6">
      {loading ? (
        <div className="flex min-h-52 flex-col items-center justify-center" aria-label={t('common.loading')}>
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary-600" />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        </div>
      ) : books.length > 0 || series.length > 0 ? (
        <>
          {/* Alphabet Scroll Bar */}
          {groupedItems && (
            <>
              {/* Central Big Letter Overlay */}
              {isTouchingIndex && activeLetter && (
                <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
                  <div className="w-20 h-20 bg-slate-900/50 backdrop-blur-sm rounded-xl flex items-center justify-center text-4xl font-bold text-white shadow-xl">
                    {activeLetter}
                  </div>
                </div>
              )}
              
              <div 
                className="fixed right-2 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center bg-transparent py-2 select-none touch-none"
                onTouchStart={(e) => {
                  e.preventDefault();
                  setIsTouchingIndex(true);
                }}
                onTouchMove={handleTouchMove}
                onTouchEnd={() => {
                  setIsTouchingIndex(false);
                  setTimeout(() => setActiveLetter(null), 1000);
                }}
              >
                {groupedItems.sortedKeys.map(key => (
                  <button
                    key={key}
                    data-key={key}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToGroup(key);
                      setIsTouchingIndex(true);
                      setTimeout(() => {
                        setIsTouchingIndex(false);
                        setActiveLetter(null);
                      }, 500);
                    }}
                    className={`w-4 h-4 flex items-center justify-center text-[10px] font-medium transition-all cursor-pointer rounded-full my-[1px]
                      ${activeLetter === key && isTouchingIndex
                        ? 'bg-primary-600 text-white scale-125 font-bold shadow-sm' 
                        : 'text-slate-400 hover:text-primary-600 dark:text-slate-500 dark:hover:text-primary-400'
                      }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </>
          )}



          {visibleGroupedItems ? (
             // Grouped Layout
             <div className="space-y-6">
               {visibleGroupedItems.sortedKeys.map(key => (
                 <div key={key} id={`group-${key}`}>
                   <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 pl-1">
                      {key}
                   </div>
                   <div className={shelfLayoutClass} data-shelf-grid>
                     {visibleGroupedItems.groups[key].map(item => renderShelfItem(item, 'books' in item ? 'series' : 'book'))}
                   </div>
                 </div>
               ))}
             </div>
          ) : (
            // Default Layout (Recent)
            <div className={shelfLayoutClass} data-shelf-grid>
              {visibleSeries.map(item => renderShelfItem(item, 'series'))}
              {visibleBooks.map(item => renderShelfItem(item, 'book'))}
            </div>
          )}

          {/* Bottom spacer: the shelf pane loads the next batch as it gets near the end */}
          <div className="h-10 w-full" aria-hidden="true" />

          {filteredBooks.length === 0 && (filteredSeries.length === 0 || (isSelectionMode && sortBy === 'createdAt')) && (
            <div className="py-20 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-400 mb-4">
                <Search size={40} />
              </div>
              <h3 className="text-lg font-medium dark:text-white">{t('bookshelf.noDisplayContent')}</h3>
              <p className="text-slate-500 mt-2">{t('bookshelf.noDisplayHint')}</p>
            </div>
          )}
        </>
      ) : (
        <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 mb-6">
            <Database size={40} />
          </div>
          <h3 className="text-xl font-bold dark:text-white mb-2">{t('bookshelf.emptyTitle')}</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-8">{t('bookshelf.emptyDescription')}</p>
          <Link 
            to="/admin/libraries"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-xl shadow-primary-500/30 transition-all active:scale-95"
          >
            <Plus size={18} />
            {t('bookshelf.configureLibrary')}
          </Link>
        </div>
      )}
      </div>

      {/* Series Creation Modal */}
      {confirmUnread && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingReadStatus) setConfirmUnread(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="mark-unread-title" aria-describedby="mark-unread-description" className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-400"><BookX size={22} /></div>
            <h2 id="mark-unread-title" className="text-lg font-bold text-slate-900 dark:text-white">{t('bookshelf.confirmUnreadTitle')}</h2>
            <p id="mark-unread-description" className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('bookshelf.confirmUnreadMessage', { count: selectedBookIds.length })}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button autoFocus onClick={() => setConfirmUnread(false)} disabled={savingReadStatus} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">{t('common.cancel')}</button>
              <button onClick={() => void handleMarkRead(false)} disabled={savingReadStatus} className="rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50">{savingReadStatus ? t('common.loading') : t('bookshelf.markUnread')}</button>
            </div>
          </section>
        </div>
      )}

      <SeriesModal
        isOpen={isSeriesModalOpen}
        onClose={() => setIsSeriesModalOpen(false)}
        selectedBooks={books.filter(b => selectedBookIds.includes(b.id))}
        onSuccess={exitSelectionMode}
      />

      {isDeleteBookOpen && mockBookForDeletion && (
        <DeleteLibraryItemModal
          book={mockBookForDeletion}
          deleting={deletingBooks}
          deleteSourceFiles={deleteSourceFiles}
          onToggleDeleteSourceFiles={() => setDeleteSourceFiles(!deleteSourceFiles)}
          onClose={() => setIsDeleteBookOpen(false)}
          onConfirm={handleDeleteBooks}
        />
      )}

      {isDeleteSeriesOpen && mockSeriesForDeletion && (
        <DeleteLibraryItemModal
          series={mockSeriesForDeletion}
          deleting={deletingSeries}
          onClose={() => setIsDeleteSeriesOpen(false)}
          onConfirm={handleDeleteSeries}
        />
      )}

    </div>
  );
};

export default BookshelfPage;
