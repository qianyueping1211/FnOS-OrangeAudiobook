import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Headphones, Heart, History, Library, ListMusic, Search } from 'lucide-react';
import apiClient from '../../core/api/client';
import type { Book, Playlist, Progress, Series } from '../../core/types';
import { DEFAULT_HOME_LAYOUT, normalizeHomeLayout } from '../../core/utils/homeLayout';
import { useBookshelfCoverShape } from '../../core/hooks/useBookshelfCoverShape';
import { usePlayerStore } from '../../core/stores/playerStore';
import BookCard from '../../shared/cards/BookCard';
import CoverArt from '../../shared/cards/CoverArt';
import LoadingSpinner from '../../shared/ui/LoadingSpinner';

export default function HomePage() {
  const { t } = useTranslation();
  const coverShape = useBookshelfCoverShape();
  const currentChapter = usePlayerStore(state => state.currentChapter);
  const [books, setBooks] = useState<Book[]>([]);
  const [recent, setRecent] = useState<Progress[]>([]);
  const [favorites, setFavorites] = useState<Book[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [layout, setLayout] = useState(DEFAULT_HOME_LAYOUT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      const options = { signal: controller.signal };
      const result = await Promise.allSettled([
        apiClient.get<Book[]>('/api/books', options),
        apiClient.get<Progress[]>('/api/progress/recent', options),
        apiClient.get<Book[]>('/api/favorites', options),
        apiClient.get<Playlist[]>('/api/playlists', options),
        apiClient.get<Series[]>('/api/v1/series', options),
        apiClient.get('/api/settings', options),
      ]);
      if (controller.signal.aborted) return;
      if (result[0].status === 'fulfilled') setBooks(result[0].value.data || []);
      if (result[1].status === 'fulfilled') setRecent(result[1].value.data || []);
      if (result[2].status === 'fulfilled') setFavorites(result[2].value.data || []);
      if (result[3].status === 'fulfilled') setPlaylists(result[3].value.data || []);
      if (result[4].status === 'fulfilled') setSeries(result[4].value.data || []);
      if (result[5].status === 'fulfilled') setLayout(normalizeHomeLayout(result[5].value.data.settings_json?.home_layout ?? result[5].value.data.home_layout));
      setLoading(false);
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); };
  }, []);

  const recentBooks = useMemo(() => {
    const seen = new Set<string>();
    return [...recent].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .filter(item => { if (seen.has(item.book_id)) return false; seen.add(item.book_id); return true; });
  }, [recent]);
  const latest = useMemo(() => [...books].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 12), [books]);
  const recommended = useMemo(() => {
    const seen = new Set<string>();
    return [...favorites, ...latest].filter(book => { if (seen.has(book.id)) return false; seen.add(book.id); return true; }).slice(0, 6);
  }, [favorites, latest]);
  const last = recentBooks[0];
  const hero = books.find(book => book.id === last?.book_id) || recommended[0];
  if (loading) return <LoadingSpinner className="min-h-64" />;

  return <div className="reader-page reader-home flex-1">
    <header className="reader-heading">
      <div><div className="reader-eyebrow">{t('reader.privateLibrary')}</div><h1>{t('reader.homeTitle')}</h1><p>{t('reader.homeSubtitle')}</p></div>
      <Link to="/search" className="reader-search-link"><Search size={19} /><span>{t('reader.searchPlaceholder')}</span></Link>
    </header>
    {layout.showHero && <section className="reader-hero">
      <div className="reader-hero-copy">
        <div className="reader-eyebrow"><Headphones size={15} />{last ? t('home.continueListening') : t('home.todayRecommendation')}</div>
        <h2>{hero?.title || t('reader.emptyTitle')}</h2>
        <p>{hero?.narrator || hero?.author || t('reader.emptySubtitle')}</p>
        {hero?.description && <p className="reader-hero-description">{hero.description}</p>}
        <Link className="reader-button primary" to={hero ? '/book/' + hero.id : '/bookshelf'}>
          {hero ? (last ? t('home.continuePlay') : t('home.viewDetails')) : t('home.goBookshelf')}<ChevronRight size={16} />
        </Link>
      </div>
      <CoverArt title={hero?.title || 'Ting Reader'} url={hero?.cover_url} libraryId={hero?.library_id} bookId={hero?.id} className="reader-hero-cover" />
    </section>}
    {layout.showStats && <nav className="reader-shortcuts" aria-label={t('reader.quickAccess')}>
      <Shortcut to="/bookshelf" icon={<Library />} title={t('nav.bookshelf')} count={books.length} />
      <Shortcut to="/favorites" icon={<Heart />} title={t('mine.favoritesTitle')} count={favorites.length} />
      <Shortcut to="/history" icon={<History />} title={t('home.recentListening')} count={recentBooks.length} />
      <Shortcut to="/playlists" icon={<ListMusic />} title={t('nav.playlists')} count={playlists.length} />
    </nav>}
    {layout.showRecent && recentBooks.length > 0 && <section className="reader-section">
      <SectionTitle title={t('home.recentListening')} to="/history" />
      <div className="reader-recent-grid">{recentBooks.slice(0, 4).map(item => <Link key={item.book_id} to={'/book/' + item.book_id} className="reader-recent">
        <CoverArt title={item.book_title || t('home.unknownBook')} url={item.cover_url} libraryId={item.library_id} bookId={item.book_id} />
        <div className="reader-recent-text"><strong>{item.book_title || t('home.unknownBook')}</strong><small>{item.chapter_title}</small>
          <div className="reader-meter"><span style={{ width: Math.min(100, Math.max(0, item.position / (item.chapter_duration || item.duration || 1) * 100)) + '%' }} /></div>
        </div><ChevronRight size={16} className="text-slate-500 shrink-0" />
      </Link>)}</div>
    </section>}
    {layout.showRecentlyAdded && <section className="reader-section">
      <SectionTitle title={t('home.recentlyAdded')} to="/bookshelf" />
      {latest.length ? <div className="reader-grid">{latest.map(book => <BookCard key={book.id} book={book} coverShape={coverShape} />)}</div> : <Empty />}
    </section>}
    {layout.showRecommended && recommended.length > 0 && <section className="reader-section">
      <SectionTitle title={t('home.recommended')} to="/bookshelf" />
      <div className="reader-grid">{recommended.map(book => <BookCard key={book.id} book={book} coverShape={coverShape} />)}</div>
    </section>}
    {layout.showCollections && <section className="reader-section">
      <SectionTitle title={t('home.collections')} to="/playlists" />
      {playlists.length || series.length ? <div className="reader-recent-grid">
        {playlists.slice(0, 4).map(item => <Link className="reader-recent" key={item.id} to={'/playlists/' + item.id}><ListMusic size={25} className="text-primary-500" /><div className="reader-recent-text"><strong>{item.title}</strong><small>{t('home.bookCount', { count: item.books?.length || item.book_ids?.length || 0 })}</small></div><ChevronRight size={16} /></Link>)}
        {series.slice(0, 2).map(item => <Link className="reader-recent" key={item.id} to={'/series/' + item.id}><Library size={25} className="text-primary-500" /><div className="reader-recent-text"><strong>{item.title}</strong><small>{item.author}</small></div><ChevronRight size={16} /></Link>)}
      </div> : <Empty />}
    </section>}
    <div style={{ height: currentChapter ? 'var(--safe-bottom-with-player)' : 'var(--safe-bottom-base)' }} />
  </div>;
}

function SectionTitle({ title, to }: { title: string; to: string }) {
  const { t } = useTranslation();
  return <div className="reader-section-heading"><h2>{title}</h2><Link to={to}>{t('home.more')}<ChevronRight size={14} /></Link></div>;
}
function Shortcut({ to, icon, title, count }: { to: string; icon: ReactNode; title: string; count: number }) {
  const { t } = useTranslation();
  return <Link to={to} className="reader-shortcut">{icon}<div><strong>{title}</strong><small>{t('reader.itemCount', { count })}</small></div></Link>;
}
function Empty() {
  const { t } = useTranslation();
  return <div className="reader-empty"><Library size={32} /><p>{t('reader.emptySubtitle')}</p><Link to="/bookshelf" className="reader-button">{t('home.goBookshelf')}</Link></div>;
}
