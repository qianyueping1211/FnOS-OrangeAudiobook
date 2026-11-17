import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Headphones, Heart, History, Library, ListMusic, Search } from 'lucide-react';
import apiClient from '../../core/api/client';
import type { Book, Playlist, Progress, Series } from '../../core/types';
import { DEFAULT_HOME_LAYOUT, normalizeHomeLayout, type HomeLayoutSettings } from '../../core/utils/homeLayout';
import { cacheHomeLayout, readCachedHomeLayout } from '../../core/utils/homeLayout';
import { readHeroCredit, rememberHeroCredit } from '../../core/utils/resumeCredit';
import { useBookshelfCoverShape } from '../../core/hooks/useBookshelfCoverShape';
import { usePlayerStore } from '../../core/stores/playerStore';
import BookCard from '../../shared/cards/BookCard';
import CoverArt from '../../shared/cards/CoverArt';
import LoadingSpinner from '../../shared/ui/LoadingSpinner';
import { useAuthStore } from '../../core/stores/authStore';
import { libraryCacheIdentity, libraryViewCache } from '../../core/api/libraryCache';
import { loadClientSettings } from '../../core/api/clientSettings';
import { useOnlineBookFilter } from '../../core/utils/onlineBooks';

type HomeSnapshot = {
  books: Book[]; bookCount: number; recent: Progress[]; favorites: Book[];
  playlists: Playlist[]; series: Series[]; layout: HomeLayoutSettings;
  // Whether the resume history has answered for this snapshot. Until it has, the
  // hero must not fall back to the newest book, otherwise the "recently added"
  // frame shows for a moment and is replaced by "continue listening".
  recentLoaded?: boolean;
};
const emptyHome = (): HomeSnapshot => ({
  // Start from the layout this device used last, not the defaults: otherwise the
  // sections the reader switched off paint for one frame and then disappear.
  books: [], bookCount: 0, recent: [], favorites: [], playlists: [], series: [],
  layout: readCachedHomeLayout() ?? DEFAULT_HOME_LAYOUT, recentLoaded: false,
});
const homeIdentity = () => {
  const state = useAuthStore.getState();
  return libraryCacheIdentity(state.serverUrl || state.activeUrl, state.user?.id);
};

export default function HomePage() {
  const { t } = useTranslation();
  const coverShape = useBookshelfCoverShape();
  const currentChapter = usePlayerStore(state => state.currentChapter);
  const currentBook = usePlayerStore(state => state.currentBook);
  const identity = useAuthStore(state => libraryCacheIdentity(state.serverUrl || state.activeUrl, state.user?.id));
  const initial = useMemo(() => libraryViewCache.get<HomeSnapshot>(identity, 'home'), [identity]);
  const [data, setData] = useState(() => ({ ...(initial || emptyHome()), identity, loading: !initial }));
  // Which resume book could not be loaded: only then may the hero fall back to
  // the newest book, so a slow/failed fetch never gets replaced by a different
  // book that the reader then sees disappear again.
  const [heroFailedId, setHeroFailedId] = useState<string | null>(null);
  const visible = data.identity === identity ? data : { ...(initial || emptyHome()), identity, loading: !initial };
  const { books: allBooks, bookCount, recent: allRecent, favorites: allFavorites, playlists: allPlaylists, series, layout, loading, recentLoaded } = visible;
  // 个性化设置里关掉「在线书籍播放」后，继续收听、最近、收藏、书单封面里的在线书都不显示。
  const hideOnline = useOnlineBookFilter();
  const books = useMemo(() => allBooks.filter(book => !hideOnline(book)), [allBooks, hideOnline]);
  const recent = useMemo(() => allRecent.filter(item => !hideOnline(item)), [allRecent, hideOnline]);
  const favorites = useMemo(() => allFavorites.filter(book => !hideOnline(book)), [allFavorites, hideOnline]);
  const playlists = useMemo(
    () => allPlaylists.map(item => ({ ...item, books: item.books ? item.books.filter(book => !hideOnline(book)) : item.books })),
    [allPlaylists, hideOnline],
  );

  useEffect(() => {
    let current = initial || emptyHome();
    let booksReady = !!initial;
    let heroBook: Book | undefined;    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const active = () => !controller.signal.aborted && homeIdentity() === identity;
      const update = (patch: Partial<HomeSnapshot>, ready = booksReady) => {
        if (!active()) return;
        current = { ...current, ...patch };
        booksReady = ready;
        setData({ ...current, identity, loading: !booksReady });
        if (booksReady) {
          const latest = [...current.books].sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,6);
          const lastId = [...current.recent].sort((a,b) => Date.parse(b.updated_at)-Date.parse(a.updated_at))[0]?.book_id;
          const lastBook = current.books.find(book => book.id === lastId);
          if (lastBook && !latest.some(book => book.id === lastId)) latest.push(lastBook);
          // The cached snapshot is only trustworthy for the hero when the book it
          // resumes is inside it: otherwise the next page load would paint the
          // newest book for a frame before /api/books catches up with that one.
          const resumeCached = lastId ? current.books.some(book => book.id === lastId) : true;
          libraryViewCache.set(identity, 'home', {
            ...current, books: latest, recent: current.recent.slice(0,20), favorites: current.favorites.slice(0,12),
            recentLoaded: (!!current.recentLoaded || current.recent.length > 0) && resumeCached,
            playlists: current.playlists.slice(0,4).map(item => ({ ...item, book_ids: item.book_ids || item.books?.map(book => book.id), books: [] })),
            series: current.series.slice(0,2).map(item => ({ ...item, books: undefined })),
          } satisfies HomeSnapshot);
        }
      };
      const options = { signal: controller.signal };
      // Each section commits independently: a slow collection never blocks the hero or latest books.
      // Only the first screen of books is requested - a large library no longer
      // ships every row before the page can paint.
      void apiClient.get<{ items: Book[]; total: number }>('/api/books/page', {
        ...options,
        // 首页摆最新六本，系列书照旧交给书架的系列区块，
        // 所以这里仍按接口默认过滤，只把 page_size 收小省一次往返体积。
        params: { page_size: 6, sort: 'created' },
      }).then(({ data }) => update({
        books: [...(data.items || []), ...(heroBook && !(data.items || []).some(book => book.id === heroBook!.id) ? [heroBook] : [])],
        bookCount: typeof data.total === 'number' ? data.total : (data.items?.length || 0),
      }, true))
        .catch(() => { if (active()) { booksReady = true; setData({ ...current, identity, loading: false }); } });
      void apiClient.get<Progress[]>('/api/progress/recent', options).then(({ data }) => {
        const recentRows = data || [];
        update({ recent: recentRows, recentLoaded: true });
        // Resuming has to survive paging: when the last book played is older
        // than the newest page, fetch it on its own. The book the player still
        // holds is refreshed the same way, so a metadata fix saved in the
        // library replaces the stale snapshot the player cached locally.
        const lastId = [...recentRows]
          .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]?.book_id;
        const playingId = usePlayerStore.getState().currentBook?.id;
        for (const id of [lastId, playingId]) {
          if (!id || current.books.some(book => book.id === id)) continue;
          void apiClient.get<Book>(`/api/books/${encodeURIComponent(id)}`, options)
            .then(({ data: freshBook }) => {
              if (!freshBook?.id) return;
              heroBook = freshBook;
              if (!current.books.some(book => book.id === freshBook.id)) {
                update({ books: [...current.books, freshBook] });
              }
            })
            .catch(() => { if (id === lastId) setHeroFailedId(id); });
        }
      }).catch(() => update({ recentLoaded: true }));
      void apiClient.get<Book[]>('/api/favorites', options).then(({data}) => update({ favorites: data || [] })).catch(() => {});
      void apiClient.get<Playlist[]>('/api/playlists', options).then(({data}) => update({ playlists: data || [] })).catch(() => {});
      void apiClient.get<Series[]>('/api/v1/series', options).then(({data}) => update({ series: data || [] })).catch(() => {});
      void loadClientSettings().then(settings => {
        const layout = normalizeHomeLayout(settings.settings_json?.home_layout ?? settings.home_layout);
        cacheHomeLayout(layout);
        update({ layout });
      }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { request?.abort(); window.removeEventListener('focus', refresh); };
  }, [identity, initial]);

  const recentBookIds = new Set<string>();
  const recentBooks = [...recent]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .filter(item => {
      if (recentBookIds.has(item.book_id)) return false;
      recentBookIds.add(item.book_id);
      return true;
    });
  const latest = [...books]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 6);
  // "为你推荐" is the shelf's own signal: favourites first, then the newest
  // arrivals, so a small library still fills the row. It is only painted when
  // the reader keeps the switch on in 个性化设置.
  const recommended = useMemo(() => {
    const seen = new Set<string>();
    return [...favorites, ...latest]
      .filter(book => { if (seen.has(book.id)) return false; seen.add(book.id); return true; })
      .slice(0, 6);
  }, [favorites, latest]);
  const last = recentBooks[0];
  // 手机端页面高度按内容算，不按屏幕撑：内容没占满一屏时底部不留空格，
  // 只有真的需要滚动（最后一行会被浮层压住）时才补上底部让位。
  const homeRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const [tailClearance, setTailClearance] = useState(false);
  useEffect(() => {
    const page = homeRef.current;
    const tail = tailRef.current;
    const viewport = page?.parentElement;
    if (!page || !tail || !viewport) return;
    const update = () => {
      // 减去尾巴自身高度，量出"纯内容"的高度，避免补完空白后又判定成溢出。
      const natural = page.scrollHeight - tail.offsetHeight;
      setTailClearance(natural > viewport.clientHeight + 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(page);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  // The hero waits for the resume history before it considers the newest book:
  // /api/books/page usually answers before /api/progress/recent, so falling back
  // early paints "recently added" for a frame and then swaps to "continue
  // listening". Only the player's current book may show immediately.
  // The player keeps its own copy of the book (survives reloads), so the hero
  // prefers the library's freshly loaded row whenever it has one: otherwise a
  // metadata fix (author/narrator/title) stays hidden behind that cached copy.
  const playingBook = currentBook && !hideOnline(currentBook) ? books.find(book => book.id === currentBook.id) ?? currentBook : undefined;
  // Once the resume history has an entry, the hero waits for that exact book
  // instead of falling back to the newest one: the newest book is what used to
  // flash for a second and then turn into "继续收听". Only when the history is
  // genuinely empty (or its book could not be fetched) may the newest/first
  // favourite take the slot.
  const resumeBook = last ? books.find(book => book.id === last.book_id) : undefined;
  // The history row already carries the title and cover, so the card can paint
  // "继续播放" straight away instead of flashing a loading placeholder; the full
  // record (narrator, description) fills in as soon as the book arrives.
  const resumeStub = last && last.book_title ? {
    id: last.book_id, library_id: last.library_id || '', title: last.book_title,
    cover_url: last.cover_url, created_at: last.updated_at, path: '', hash: '',
    // The history row has no narrator, so remember the one this device saw last:
    // without it the headline paints the bare title and grows a "樊登：" prefix
    // once the book row arrives.
    narrator: readHeroCredit(last.book_id) ?? undefined,
  } as Book : undefined;
  const resumeMissing = !!last && !resumeBook;
  const resumeFailed = !!last && !resumeBook && heroFailedId === last.book_id;
  const fallbackBook = !last && recentLoaded ? (latest[0] || favorites[0]) : undefined;
  const heroReview = playingBook || resumeBook || resumeStub || fallbackBook || (resumeFailed ? (latest[0] || favorites[0]) : undefined);
  const heroPending = !heroReview && (loading || !recentLoaded || (resumeMissing && !resumeFailed));
  const hero = heroReview;
  const hasResume = !!hero && ((currentBook?.id === hero.id && !!currentChapter) || last?.book_id === hero.id);
  const resumeChapterId = currentBook?.id === hero?.id ? currentChapter?.id : last?.book_id === hero?.id ? last.chapter_id : undefined;
  const playerQuery = new URLSearchParams();
  if (hero) playerQuery.set('book', hero.id);
  if (resumeChapterId) playerQuery.set('chapter', resumeChapterId);
  const bookUrl = hero ? '/book/' + encodeURIComponent(hero.id) + (resumeChapterId ? '?chapter_id=' + encodeURIComponent(resumeChapterId) : '') : '/bookshelf';
  // One narrator for the whole card: the loaded row wins, the remembered name
  // fills in while the row is still on its way, so the headline never paints
  // the title first and then grows a prefix.
  const heroCredit = hero?.narrator || readHeroCredit(hero?.id);
  useEffect(() => { rememberHeroCredit(hero?.id, hero?.narrator); }, [hero?.id, hero?.narrator]);

  // A title wider than the column slides left and right instead of wrapping: the
  // hero keeps one line, so "继续收听" no longer grows with a long book name.
  const heroTitleRef = useRef<HTMLHeadingElement | null>(null);
  const heroLineRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const wrap = heroTitleRef.current;
    const line = heroLineRef.current;
    if (!wrap || !line) return;
    line.classList.remove('is-scrolling');
    line.style.removeProperty('--marquee-shift');
    line.style.removeProperty('--marquee-duration');
    const overflow = line.scrollWidth - wrap.clientWidth;
    if (overflow > 8) {
      line.style.setProperty('--marquee-shift', `-${overflow + 10}px`);
      const length = line.scrollWidth + overflow;
      line.style.setProperty('--marquee-duration', `${Math.min(26, Math.max(7, Math.round(length / 55)))}s`);
      line.classList.add('is-scrolling');
    }
  }, [hero?.id, hero?.title, heroCredit]);

  return <div ref={homeRef} className="reader-page reader-home flex flex-1 flex-col">
    <header className="reader-heading reader-page-toolbar">
      <div><div className="reader-eyebrow">{t('reader.privateLibrary')}</div><h1>{t('reader.homeTitle')}</h1><p>{t('reader.homeSubtitle')}</p></div>
      <Link to="/search" className="reader-search-link"><Search size={19} /><span>{t('reader.searchPlaceholder')}</span></Link>
    </header>
    <div className="reader-page-scroll">
    {layout.showHero && <section className="reader-hero" aria-busy={heroPending}>
      <div className="reader-hero-copy">
        {hasResume && <div className="reader-eyebrow"><Headphones size={15} />{t('home.continueListening')}</div>}
        <h2 className="reader-hero-title" ref={heroTitleRef}>
          <span className="reader-hero-line" ref={heroLineRef}>
            {heroCredit && <span className="reader-hero-credit">{heroCredit}：</span>}
            {hero?.title || t(heroPending ? 'common.loading' : 'reader.emptyTitle')}
          </span>
        </h2>
        {hero?.description && <p className="reader-hero-description">{hero.description}</p>}
        <Link className="reader-button primary" to={hasResume ? '/player?' + playerQuery.toString() : bookUrl}>
          {hero ? (hasResume ? t('home.continuePlay') : t('home.viewDetails')) : t('home.goBookshelf')}<ChevronRight size={16} />
        </Link>
      </div>
      {hero ? <Link to={bookUrl} className="reader-hero-cover-link" aria-label={t('home.viewDetails') + ' ' + hero.title}>
        <CoverArt title={hero.title} url={hero.cover_url} libraryId={hero.library_id} bookId={hero.id} width={480} className="reader-hero-cover" />
      </Link> : <CoverArt title={t('common.appName')} className="reader-hero-cover" />}
    </section>}
    {layout.showStats && <nav className="reader-shortcuts" aria-label={t('reader.quickAccess')}>
      <Shortcut to="/bookshelf" icon={<Library />} title={t('nav.bookshelf')} count={bookCount} />
      <Shortcut to="/favorites" icon={<Heart />} title={t('mine.favoritesTitle')} count={favorites.length} />
      <Shortcut to="/history" icon={<History />} title={t('home.recentListening')} count={recentBooks.length} />
      <Shortcut to="/playlists" icon={<ListMusic />} title={t('nav.playlists')} count={playlists.length} />
    </nav>}
    {layout.showRecommended && recommended.length > 0 && <section className="reader-section">
      <SectionTitle title={t('home.recommended')} to="/bookshelf" />
      <div className="reader-grid">{recommended.map(book => <BookCard key={book.id} book={book} coverShape={coverShape} />)}</div>
    </section>}
    {layout.showRecentlyAdded && <section className="reader-section">
      <SectionTitle title={t('home.recentlyAdded')} to="/bookshelf" />
      {loading && !latest.length ? <LoadingSpinner className="min-h-40" /> : latest.length ? <div className="reader-grid">{latest.map(book => <BookCard key={book.id} book={book} coverShape={coverShape} />)}</div> : <Empty />}
    </section>}
    {layout.showRecent && recentBooks.length > 0 && <section className="reader-section">
      <SectionTitle title={t('home.recentListening')} to="/history" />
      <div className="reader-recent-grid">{recentBooks.slice(0, 4).map(item => <Link key={item.book_id} to={'/book/' + item.book_id} className="reader-recent">
        <CoverArt title={item.book_title || t('home.unknownBook')} url={item.cover_url} libraryId={item.library_id} bookId={item.book_id} />
        <div className="reader-recent-text"><strong>{item.book_title || t('home.unknownBook')}</strong><small>{item.chapter_title}</small>
          <div className="reader-meter"><span style={{ width: Math.min(100, Math.max(0, item.position / (item.chapter_duration || item.duration || 1) * 100)) + '%' }} /></div>
        </div><ChevronRight size={16} className="text-slate-500 shrink-0" />
      </Link>)}</div>
    </section>}
    {layout.showCollections && (playlists.length > 0 || series.length > 0) && <section className="reader-section">
      <SectionTitle title={t('home.collections')} to="/playlists" />
      {playlists.length || series.length ? <div className="reader-recent-grid">
        {playlists.slice(0, 4).map(item => <Link className="reader-recent" key={item.id} to={'/playlists/' + item.id}><ListMusic size={25} className="text-primary-500" /><div className="reader-recent-text"><strong>{item.title}</strong><small>{t('home.bookCount', { count: item.books?.length || item.book_ids?.length || 0 })}</small></div><ChevronRight size={16} /></Link>)}
        {series.slice(0, 2).map(item => <Link className="reader-recent" key={item.id} to={'/series/' + item.id}><Library size={25} className="text-primary-500" /><div className="reader-recent-text"><strong>{item.title}</strong><small>{item.author}</small></div><ChevronRight size={16} /></Link>)}
      </div> : <Empty />}
    </section>}
    <div
      ref={tailRef}
      className="reader-home-tail"
      style={{ height: tailClearance ? (currentChapter ? 'var(--safe-bottom-with-player)' : 'var(--safe-bottom-base)') : 0 }}
    />
    </div>
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
