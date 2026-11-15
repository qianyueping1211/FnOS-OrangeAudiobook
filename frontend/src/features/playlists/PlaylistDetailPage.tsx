import { apiErrorMessage } from '../../core/api/errors';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Book, Playlist, PlaylistItem, Series } from '../../core/types';
import BookCard from '../../shared/cards/BookCard';
import BackButton from '../../shared/widgets/BackButton';
import { usePlayerStore } from '../../core/stores/playerStore';
import { Check, Edit3, ListMusic, Loader2, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { getBookshelfGridClass, useBookshelfDisplaySettings } from '../../core/hooks/useBookshelfCoverShape';
import { getPlaylistBookCount } from '../../core/utils/playlist';
import { readPlaylistSnapshot, cachePlaylistSnapshot } from '../../core/utils/playlistSnapshot';
import {
  BookCover,
  PlaylistCoverStack,
  EmptyPlaylistState,
  PlaylistSeriesCard,
  SelectedOrderPanel,
  samePlaylistItem,
  type EditablePlaylistItem,
} from './PlaylistPieces';

const getPlaylistItems = (playlist?: Playlist | null): PlaylistItem[] => {
  if (!playlist) return [];
  if (playlist.items && playlist.items.length > 0) return playlist.items;
  return (playlist.books || []).map((book, index) => ({
    item_type: 'book',
    item_id: book.id,
    order: index + 1,
    book,
  }));
};

const PlaylistDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const currentChapter = usePlayerStore((state) => state.currentChapter);
  const { coverShape, iconSize } = useBookshelfDisplaySettings();
  const [playlist, setPlaylist] = useState<Playlist | null>(() => readPlaylistSnapshot(id));
  const [books, setBooks] = useState<Book[]>([]);
  const [knownBooks, setKnownBooks] = useState<Map<string, Book>>(() => new Map());
  const [loading, setLoading] = useState(() => !readPlaylistSnapshot(id));
  const [isManaging, setIsManaging] = useState(false);
  const [selectedItems, setSelectedItems] = useState<EditablePlaylistItem[]>([]);
  const [query, setQuery] = useState('');
  const [manageTab, setManageTab] = useState<'search' | 'selected'>('search');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const searchSeq = useRef(0);

  const fetchData = async () => {
    if (!id) return;
    // A snapshot from the list page paints the first frame; the request below
    // then refreshes it without flashing the spinner again.
    const snapshot = readPlaylistSnapshot(id);
    if (snapshot) {
      setPlaylist(snapshot);
      setSelectedItems(getPlaylistItems(snapshot).map(item => ({
        item_type: item.item_type,
        item_id: item.item_id,
      })));
      setEditTitle(snapshot.title || '');
      setEditDescription(snapshot.description || '');
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      // The detail view only needs the playlist itself. The full book and
      // series catalogs are heavy on large libraries, so they load on demand
      // when the reader actually opens "manage content".
      const playlistRes = await apiClient.get(`/api/playlists/${id}`);
      setPlaylist(playlistRes.data);
      cachePlaylistSnapshot(playlistRes.data);
      setSelectedItems(getPlaylistItems(playlistRes.data).map(item => ({
        item_type: item.item_type,
        item_id: item.item_id,
      })));
      setEditTitle(playlistRes.data.title || '');
      setEditDescription(playlistRes.data.description || '');
    } catch (err) {
      console.error('Failed to load playlist', err);
    } finally {
      setLoading(false);
    }
  };

  const mergeKnownBooks = (incoming: Book[]) => {
    if (incoming.length === 0) return;
    setKnownBooks(previous => {
      const next = new Map(previous);
      incoming.forEach(book => next.set(book.id, book));
      return next;
    });
  };

  // Manage content searches on demand instead of pulling the whole library:
  // nothing is requested until the reader types, then only the matching rows
  // come back.
  const searchCatalog = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setBooks([]);
      setSearching(false);
      return;
    }
    const seq = searchSeq.current + 1;
    searchSeq.current = seq;
    setSearching(true);
    try {
      const res = await apiClient.get('/api/books/page', { params: { search: trimmed, page_size: 30 } });
      if (searchSeq.current !== seq) return;
      const list: Book[] = res.data?.items || [];
      setBooks(list);
      mergeKnownBooks(list);
    } catch (err) {
      console.error('Failed to search playlist catalog', err);
    } finally {
      if (searchSeq.current === seq) setSearching(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setBooks([]);
      setSearching(false);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void searchCatalog(value);
    }, 320);
  };

  const switchManageTab = (next: 'search' | 'selected') => {
    setManageTab(next);
    // Returning to the search tab keeps whatever was typed, so the results are
    // fetched again instead of leaving an empty grid behind.
    if (next === 'search' && query.trim()) void searchCatalog(query);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => () => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
  }, []);


  // The edit sheet is an overlay only: the playlist page keeps its position.
  useEffect(() => {
    if (!showEditModal) return;
    const scroller = document.getElementById('main-content');
    const previousBody = document.body.style.overflow;
    const previousScroller = scroller ? scroller.style.overflow : '';
    document.body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBody;
      if (scroller) scroller.style.overflow = previousScroller;
    };
  }, [showEditModal]);

  const bookMap = useMemo(() => {
    const map = new Map<string, Book>(knownBooks);
    playlist?.books.forEach(book => map.set(book.id, book));
    return map;
  }, [knownBooks, playlist?.books]);

  const seriesMap = useMemo(() => {
    // Series rows only ever come from the playlist itself now that the manage
    // sheet searches books, so the map is built from the loaded items.
    const map = new Map<string, Series>();
    getPlaylistItems(playlist).forEach(item => {
      if (item.series) map.set(item.series.id, item.series);
    });
    return map;
  }, [playlist]);

  const selectedDisplayItems = useMemo(() => (
    selectedItems
      .map((item, index) => {
        if (item.item_type === 'series') {
          const selectedSeries = seriesMap.get(item.item_id);
          return selectedSeries
            ? { item_type: 'series' as const, item_id: item.item_id, order: index + 1, series: selectedSeries }
            : null;
        }

        const book = bookMap.get(item.item_id);
        return book
          ? { item_type: 'book' as const, item_id: item.item_id, order: index + 1, book }
          : null;
      })
      .filter(Boolean) as PlaylistItem[]
  ), [bookMap, selectedItems, seriesMap]);

  const toggleBook = (bookId: string) => {
    setSelectedItems(prev => (
      prev.some(item => samePlaylistItem(item, 'book', bookId))
        ? prev.filter(item => !samePlaylistItem(item, 'book', bookId))
        : [...prev, { item_type: 'book', item_id: bookId }]
    ));
  };

  const removeSelectedItem = (itemType: 'book' | 'series', itemId: string) => {
    setSelectedItems(prev => prev.filter(item => !samePlaylistItem(item, itemType, itemId)));
  };

  const moveSelectedItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedItems.length) return;

    setSelectedItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const handleSaveBooks = async () => {
    if (!playlist) return;
    setSaving(true);
    try {
      const res = await apiClient.put(`/api/playlists/${playlist.id}`, {
        items: selectedItems,
      });
      setPlaylist(res.data);
      cachePlaylistSnapshot(res.data);
      setSelectedItems(getPlaylistItems(res.data).map(item => ({
        item_type: item.item_type,
        item_id: item.item_id,
      })));
      setIsManaging(false);
      setQuery('');
      setManageTab('search');
    } catch (err) {
      console.error('Failed to save playlist items', err);
      alert(apiErrorMessage(err, t('common.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInfo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!playlist || !editTitle.trim()) return;

    setSaving(true);
    try {
      const res = await apiClient.put(`/api/playlists/${playlist.id}`, {
        title: editTitle,
        description: editDescription,
      });
      setPlaylist(res.data);
      cachePlaylistSnapshot(res.data);
      setShowEditModal(false);
    } catch (err) {
      console.error('Failed to save playlist info', err);
      alert(apiErrorMessage(err, t('common.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!playlist) return;
    if (!window.confirm(t('playlists.deleteConfirm', { title: playlist.title }))) return;

    try {
      await apiClient.delete(`/api/playlists/${playlist.id}`);
      navigate('/playlists');
    } catch (err) {
      console.error('Failed to delete playlist', err);
      alert(apiErrorMessage(err, t('playlists.deleteFailed')));
    }
  };

  if (loading) {
    // A skeleton keeps the page, the back button and the grid in place while the
    // playlist loads, so opening one no longer looks like a stalled blank screen.
    return (
      <div className="reader-page flex-1 min-h-full flex flex-col">
        <BackButton fallback="/playlists" />
        <div className="mt-6 h-36 animate-pulse rounded-3xl border border-slate-200/60 bg-slate-100 dark:border-slate-800 dark:bg-slate-900/70" />
        <div className="mt-6 h-9 w-44 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/70" />
        <div className={`mt-5 grid gap-4 ${getBookshelfGridClass(iconSize)}`}>
          {[0, 1, 2, 3, 4, 5].map(value => (
            <div key={value} className="aspect-[3/4] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/70" />
          ))}
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="reader-page flex-1 min-h-full flex flex-col">
        <BackButton fallback="/playlists" />
        <div className="py-20 text-center text-slate-500">{t('playlists.notFound')}</div>
      </div>
    );
  }

  const playlistItems = getPlaylistItems(playlist);
  const filteredPlaylistItems = playlistItems.filter(item => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;

    const title = item.item_type === 'series' ? item.series?.title : item.book?.title;
    const author = item.item_type === 'series' ? item.series?.author : item.book?.author;
    const narrator = item.item_type === 'series' ? item.series?.narrator : item.book?.narrator;
    return (
      title?.toLowerCase().includes(normalizedQuery) ||
      author?.toLowerCase().includes(normalizedQuery) ||
      narrator?.toLowerCase().includes(normalizedQuery)
    );
  });

  return (
    <div className="reader-page flex-1 min-h-full flex flex-col">
      <div className="flex-1 space-y-6">
        <BackButton fallback="/playlists" />

        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-gradient-to-br from-primary-50/70 via-white to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/60 p-4 sm:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-28 sm:w-40 shrink-0">
              <PlaylistCoverStack playlist={playlist} coverShape={coverShape} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-white whitespace-pre-wrap [overflow-wrap:anywhere]">
                {playlist.title}
              </h1>
              <p className="mt-2 flex items-center gap-1.5 text-xs sm:text-sm text-primary-600 dark:text-primary-400">
                <ListMusic size={16} />{t('playlists.bookCount', { count: getPlaylistBookCount(playlist) })}
              </p>
              {playlist.description && <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap [overflow-wrap:anywhere]">{playlist.description}</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 xl:max-w-sm xl:justify-end">
            {isManaging ? (
              <>
                <button
                  onClick={() => {
                    setIsManaging(false);
                    setSelectedItems(getPlaylistItems(playlist).map(item => ({
                      item_type: item.item_type,
                      item_id: item.item_id,
                    })));
                    setQuery('');
                    setBooks([]);
                    setSearching(false);
                    setManageTab('search');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold"
                >
                  <X size={18} />
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveBooks}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  <Save size={18} />
                  {saving ? t('playlists.saving') : t('playlists.savePlaylist')}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Edit3 size={18} />
                  {t('playlists.editInfo')}
                </button>
                <button
                  onClick={() => {
                    setIsManaging(true);
                    setQuery('');
                    setBooks([]);
                    setSearching(false);
                    setManageTab('search');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold shadow-lg shadow-primary-500/25"
                >
                  <Plus size={18} />
                  {t('playlists.manageContent')}
                </button>
                <button
                  onClick={handleDelete}
                  aria-label={t('playlists.delete')}
                  title={t('playlists.delete')}
                  className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {isManaging && (
          <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              aria-pressed={manageTab === 'search'}
              onClick={() => switchManageTab('search')}
              className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                manageTab === 'search'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('playlists.searchTab')}
            </button>
            <button
              type="button"
              aria-pressed={manageTab === 'selected'}
              onClick={() => switchManageTab('selected')}
              className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                manageTab === 'selected'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('playlists.selectedTab')}
            </button>
          </div>
        )}

        {isManaging ? (
          manageTab === 'selected' ? (
            <SelectedOrderPanel
              items={selectedDisplayItems}
              coverShape={coverShape}
              onMove={moveSelectedItem}
              onRemove={removeSelectedItem}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={event => handleQueryChange(event.target.value)}
                    placeholder={t('playlists.searchBooksPlaceholder')}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                  />
                </div>
                <span className="text-sm font-bold text-slate-500 px-2 whitespace-nowrap">
                  {t('playlists.selectedItems', { count: selectedItems.length })}
                </span>
              </div>
              {searching ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                  {t('common.loading')}
                </div>
              ) : !query.trim() ? (
                <EmptyPlaylistState
                  icon={<Search size={40} />}
                  title={t('playlists.typeToSearch')}
                  description={t('playlists.typeToSearchHint')}
                />
              ) : books.length > 0 ? (
                <div className={`grid ${getBookshelfGridClass(iconSize)}`}>
                  {books.map(book => (
                    <div key={book.id} className="relative">
                      <button
                        onClick={() => toggleBook(book.id)}
                        className="block w-full text-left"
                      >
                        <div className={`absolute top-2 right-2 z-30 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all pointer-events-none ${
                          selectedItems.some(item => samePlaylistItem(item, 'book', book.id))
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-600'
                        }`}>
                          {selectedItems.some(item => samePlaylistItem(item, 'book', book.id)) && <Check size={15} />}
                        </div>
                        <div className={`transition-opacity ${selectedItems.some(item => samePlaylistItem(item, 'book', book.id)) ? 'opacity-100' : 'opacity-60 grayscale-[0.4]'}`}>
                          <BookCover book={book} coverShape={coverShape} />
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyPlaylistState
                  icon={<ListMusic size={40} />}
                  title={t('playlists.noMatchedBooks')}
                  description={t('playlists.tryAnotherKeyword')}
                />
              )}
            </>
          )
        ) : (
          <>
            {playlistItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t('playlists.searchInPlaylistPlaceholder')}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                  />
                </div>
                <span className="text-sm font-bold text-slate-500 px-2 whitespace-nowrap">
                  {t('playlists.itemProgress', { shown: filteredPlaylistItems.length, total: playlistItems.length })}
                </span>
              </div>
            )}
            {playlistItems.length === 0 ? (
              <EmptyPlaylistState
                icon={<ListMusic size={40} />}
                title={t('playlists.emptyPlaylistBooks')}
                description={t('playlists.addContentHint')}
              />
            ) : filteredPlaylistItems.length > 0 ? (
              <div className={`grid ${getBookshelfGridClass(iconSize)}`}>
                {filteredPlaylistItems.map(item => (
                  item.item_type === 'series' && item.series ? (
                    <PlaylistSeriesCard key={`series-${item.item_id}`} series={item.series} coverShape={coverShape} />
                  ) : item.book ? (
                    <BookCard key={`book-${item.item_id}`} book={item.book} coverShape={coverShape} />
                  ) : null
                ))}
              </div>
            ) : (
              <EmptyPlaylistState
                icon={<ListMusic size={40} />}
                title={t('playlists.noMatchedWorks')}
                description={t('playlists.tryAnotherKeyword')}
              />
            )}
          </>
        )}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold dark:text-white">{t('playlists.editPlaylist')}</h2>
              <button
                onClick={() => setShowEditModal(false)}
                aria-label={t('common.close')}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveInfo} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 dark:text-slate-400">{t('playlists.name')}</label>
                <input
                  value={editTitle}
                  onChange={event => setEditTitle(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 dark:text-slate-400">{t('playlists.description')}</label>
                <textarea
                  value={editDescription}
                  onChange={event => setEditDescription(event.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !editTitle.trim()}
                  className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  {saving ? t('playlists.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div
        className="shrink-0 transition-all duration-300"
        style={{ height: currentChapter ? 'var(--safe-bottom-with-player)' : 'var(--safe-bottom-base)' }}
      />
    </div>
  );
};


export default PlaylistDetailPage;
