import { apiErrorMessage } from '../../core/api/errors';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Playlist } from '../../core/types';
import { usePlayerStore } from '../../core/stores/playerStore';
import DisplaySettingsMenu from '../../shared/widgets/DisplaySettingsMenu';
import { ListMusic, Plus, Search, X } from 'lucide-react';
import { getBookshelfGridClass, useBookshelfCoverShape, type CoverShape } from '../../core/hooks/useBookshelfCoverShape';
import { getPlaylistBookCount } from '../../core/utils/playlist';
import { cachePlaylistSnapshot } from '../../core/utils/playlistSnapshot';
import { loadClientSettings } from '../../core/api/clientSettings';
import { useAuthStore } from '../../core/stores/authStore';
import { PlaylistCoverStack } from './PlaylistPieces';

type PlaylistSortBy = 'updatedAt' | 'title' | 'count';
type PlaylistIconSize = 'small' | 'medium' | 'large';

// The list is a handful of small rows, but the request behind it resolves every
// item of every playlist. Keeping the last answer in memory lets a tab switch
// paint the existing rows at once while the authoritative copy refreshes behind
// them; the key is the session, so a different account never sees this cache.
let listCache: { key: string; data: Playlist[] } = { key: '', data: [] };

const cacheKey = (): string => {
  const state = useAuthStore.getState();
  return `${state.activeUrl ?? ''}|${state.token ?? ''}`;
};

const seededPlaylists = (): Playlist[] => (listCache.key === cacheKey() ? listCache.data : []);

// The create sheet opens as an overlay; on a touch device an auto-focused
// input makes the OS raise the keyboard and push the page around, so only a
// fine pointer (mouse/trackpad) gets the automatic focus.
const AUTO_FOCUS_CREATE_TITLE =
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches);

const MyPlaylistsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentChapter = usePlayerStore((state) => state.currentChapter);
  const coverShape = useBookshelfCoverShape();
  const [playlists, setPlaylists] = useState<Playlist[]>(seededPlaylists);
  const [loading, setLoading] = useState(() => seededPlaylists().length === 0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [playlistCoverSeed, setPlaylistCoverSeed] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState<PlaylistSortBy>('updatedAt');
  const [iconSize, setIconSize] = useState<PlaylistIconSize>('medium');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const fetchPlaylists = async () => {
    // A cached list keeps the rows on screen; the refresh runs behind it and the
    // skeleton only appears when there is genuinely nothing to show yet.
    if (seededPlaylists().length === 0) setLoading(true);
    try {
      const res = await apiClient.get('/api/playlists');
      const list: Playlist[] = res.data || [];
      listCache = { key: cacheKey(), data: list };
      setPlaylists(list);
      setPlaylistCoverSeed(Date.now());
    } catch (err) {
      console.error('Failed to load playlists', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPlaylists(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // The detail route is its own chunk. Warm it up while the list is on screen
  // so tapping a playlist does not wait for a download on top of the request.
  useEffect(() => {
    void import('./PlaylistDetailPage');
  }, []);

  // Opening the create sheet must only paint an overlay: the page behind it
  // keeps its scroll position instead of shifting by one line.
  useEffect(() => {
    if (!showCreateModal) return;
    const scroller = document.getElementById('main-content');
    const previousBody = document.body.style.overflow;
    const previousScroller = scroller ? scroller.style.overflow : '';
    document.body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBody;
      if (scroller) scroller.style.overflow = previousScroller;
    };
  }, [showCreateModal]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        // The shell already asked for these settings; reuse that answer instead
        // of paying a second request every time the tab opens.
        const settings = (await loadClientSettings()).settings_json as
          | Record<string, unknown>
          | undefined;

        const sort = settings?.playlist_sort_by;
        if (sort === 'updatedAt' || sort === 'title' || sort === 'count') setSortBy(sort);

        const size = settings?.playlist_icon_size;
        if (size === 'small' || size === 'medium' || size === 'large') setIconSize(size);
      } catch (err) {
        console.error('Failed to load playlist display settings', err);
      }
    };

    loadSettings();
  }, []);

  const filteredPlaylists = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const nextPlaylists = normalizedQuery
      ? playlists.filter(playlist =>
        playlist.title.toLowerCase().includes(normalizedQuery) ||
        playlist.description?.toLowerCase().includes(normalizedQuery)
      )
      : [...playlists];

    return nextPlaylists.sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sortBy === 'count') return getPlaylistBookCount(b) - getPlaylistBookCount(a);
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });
  }, [playlists, query, sortBy]);

  const handleSortChange = (newSort: PlaylistSortBy) => {
    setSortBy(newSort);
    apiClient.post('/api/settings', { playlist_sort_by: newSort });
  };

  const handleIconSizeChange = (newSize: PlaylistIconSize) => {
    setIconSize(newSize);
    apiClient.post('/api/settings', { playlist_icon_size: newSize });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      const res = await apiClient.post('/api/playlists', {
        title,
        description,
        book_ids: [],
      });
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      navigate(`/playlists/${res.data.id}`);
    } catch (err) {
      console.error('Failed to create playlist', err);
      alert(apiErrorMessage(err, t('playlists.createFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reader-page reader-locked-page flex-1 min-h-full flex flex-col">
      <div className="reader-page-toolbar space-y-6">
        <div className="flex flex-col min-[760px]:flex-row min-[760px]:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <ListMusic className="text-primary-600" />
              {t('playlists.title')}
            </h1>
            <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              {t('playlists.subtitle')}
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <Plus size={18} />
            {t('playlists.newPlaylist')}
          </button>
        </div>

        {playlists.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('playlists.searchPlaylistPlaceholder')}
                className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white shadow-sm"
                />
            </div>
            <div className="flex shrink-0 items-center">
              <DisplaySettingsMenu
                open={showFilterMenu}
                onOpenChange={setShowFilterMenu}
                sheetLabel={t('playlists.closeDisplaySettings')}
                sections={[
                  {
                    title: t('playlists.sortBy'),
                    value: sortBy,
                    options: [
                      { value: 'updatedAt', label: t('playlists.recentlyUpdated') },
                      { value: 'title', label: t('playlists.playlistName') },
                      { value: 'count', label: t('playlists.workCount') },
                    ],
                    onChange: (value) => handleSortChange(value as PlaylistSortBy),
                  },
                  {
                    title: t('playlists.iconSize'),
                    value: iconSize,
                    options: [
                      { value: 'large', label: t('playlists.largeIcon') },
                      { value: 'medium', label: t('playlists.mediumIconDefault') },
                      { value: 'small', label: t('playlists.smallIcon') },
                    ],
                    onChange: (value) => handleIconSizeChange(value as PlaylistIconSize),
                  },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      <div className="reader-page-scroll mt-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-[3/4] rounded-xl bg-slate-200/60 dark:bg-slate-800/60 animate-pulse" />
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 mb-6">
              <ListMusic size={40} />
            </div>
            <h3 className="text-xl font-bold dark:text-white">{t('playlists.emptyTitle')}</h3>
            <p className="text-sm text-slate-500 mt-2 mb-8">{t('playlists.emptyDescription')}</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
            >
              <Plus size={18} />
              {t('playlists.newPlaylist')}
            </button>
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mb-6">
              <Search size={40} />
            </div>
            <h3 className="text-xl font-bold dark:text-white">{t('playlists.noMatchedPlaylist')}</h3>
            <p className="text-sm text-slate-500 mt-2">{t('playlists.tryAnotherKeyword')}</p>
          </div>
        ) : (
          <div className={`grid ${getBookshelfGridClass(iconSize)}`}>
            {filteredPlaylists.map(playlist => (
              <PlaylistCard key={playlist.id} playlist={playlist} coverShape={coverShape} coverSeed={playlistCoverSeed} />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold dark:text-white">{t('playlists.newPlaylist')}</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                aria-label={t('common.close')}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 dark:text-slate-400">{t('playlists.name')}</label>
                <input
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  placeholder={t('playlists.namePlaceholder')}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                  autoFocus={AUTO_FOCUS_CREATE_TITLE}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 dark:text-slate-400">{t('playlists.description')}</label>
                <textarea
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  placeholder={t('playlists.descriptionPlaceholder')}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !title.trim()}
                  className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  {saving ? t('playlists.creating') : t('playlists.create')}
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

const PlaylistCard = ({
  playlist,
  coverShape,
  coverSeed,
}: {
  playlist: Playlist;
  coverShape: CoverShape;
  coverSeed: number;
}) => {
  const { t } = useTranslation();
  const bookCount = getPlaylistBookCount(playlist);

  return (
    <Link
      to={`/playlists/${playlist.id}`}
      onClick={() => cachePlaylistSnapshot(playlist)}
      className="group min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-4 dark:ring-offset-slate-950"
    >
      <PlaylistCoverStack playlist={playlist} coverShape={coverShape} seed={coverSeed} />
      <div className="min-w-0 px-0.5">
        <h3 title={playlist.title} className="truncate text-sm font-semibold leading-snug text-slate-900 dark:text-white group-hover:text-primary-600 transition-colors">
          {playlist.title}
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('playlists.bookCount', { count: bookCount })}</p>
        {playlist.description && <p title={playlist.description} className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">{playlist.description}</p>}
      </div>
    </Link>
  );
};

export default MyPlaylistsPage;
