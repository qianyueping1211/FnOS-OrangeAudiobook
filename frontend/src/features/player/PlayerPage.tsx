import { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Book, Chapter, Progress } from '../../core/types';
import { sortChaptersForPlayback } from '../../core/utils/chapter';
import { isTooLight } from '../../core/utils/color';
import { usePlayerStore } from '../../core/stores/playerStore';
import LoadingSpinner from '../../shared/ui/LoadingSpinner';

// Navigation keeps the shared Player and its one audio element alive.
export default function PlayerPage() {
  const [params] = useSearchParams();
  const requestedBook = params.get('book');
  const requestedChapter = params.get('chapter');
  return <PlaybackSelection key={JSON.stringify([requestedBook, requestedChapter])}
    requestedBook={requestedBook} requestedChapter={requestedChapter} />;
}

function PlaybackSelection({ requestedBook, requestedChapter }: { requestedBook: string | null; requestedChapter: string | null }) {
  const { t } = useTranslation();
  const [resolvedChapter, setResolvedChapter] = useState<string | null>(null);
  const currentBook = usePlayerStore(state => state.currentBook);
  const currentChapter = usePlayerStore(state => state.currentChapter);
  const matches = !!currentChapter && (!requestedBook || currentBook?.id === requestedBook)
    && (!requestedChapter || currentChapter.id === (resolvedChapter || requestedChapter));
  const [loading, setLoading] = useState(!matches);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (matches) return;
    const controller = new AbortController();
    const startingBook = usePlayerStore.getState().currentBook?.id;
    const loadRecent = async () => {
      try {
        const options = { signal: controller.signal };
        let last: Progress | undefined;
        if (!requestedBook) {
          const recent = (await apiClient.get<Progress[]>('/api/progress/recent', options)).data;
          last = [...recent].sort((a,b) => Date.parse(b.updated_at)-Date.parse(a.updated_at))[0];
        }
        const bookId = requestedBook || last?.book_id;
        if (!bookId) return;
        const id = encodeURIComponent(bookId);
        const [bookResponse, chapterResponse, progress] = await Promise.all([
          apiClient.get<Book>('/api/books/' + id, options),
          apiClient.get<Chapter[]>('/api/books/' + id + '/chapters', options),
          last ? Promise.resolve(last) : apiClient.get<Progress>('/api/progress/' + id, options).then(response => response.data).catch(() => undefined),
        ]);
        const chapters = sortChaptersForPlayback(chapterResponse.data);
        const target = requestedChapter || progress?.chapter_id;
        const chapter = chapters.find(item => item.id === target) || chapters[0];
        const current = usePlayerStore.getState();
        if (!chapter || controller.signal.aborted) return;
        if (!requestedBook && current.currentChapter) return;
        if (requestedBook && current.currentBook?.id !== startingBook && current.currentBook?.id !== bookId) return;
        const book = bookResponse.data;
        const position = progress?.chapter_id === chapter.id ? progress.position : chapter.progress_position || 0;
        setResolvedChapter(chapter.id);
        usePlayerStore.setState(state => ({
          currentBook: book, currentChapter: chapter, chapters,
          currentTime: Math.max(0, position || 0), duration: chapter.duration || 0,
          isPlaying: false, isExpanded: false, isCollapsed: false,
          playbackRevision: state.playbackRevision + 1,
          themeColor: book.theme_color && !isTooLight(book.theme_color) ? book.theme_color : '#F2EDE4',
        }));
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadRecent();
    return () => controller.abort();
  }, [matches, requestedBook, requestedChapter, attempt]);

  if (matches) return null;
  if (loading) return <div className="reader-player-route-state"><LoadingSpinner className="min-h-64" /></div>;
  return <div className="reader-page reader-player-route-state">
    <header className="reader-heading"><h1>{t('nav.playerPage')}</h1></header>
    <section className="reader-player-empty">
      <Headphones size={48} aria-hidden="true" />
      <h2>{t(failed ? 'player.resumeFailed' : 'player.emptyTitle')}</h2>
      <p>{t('player.emptyDescription')}</p>
      {failed && <button className="reader-button" onClick={() => {
        setFailed(false); setLoading(true); setAttempt(value => value + 1);
      }}>{t('common.retry')}</button>}
      <Link to="/bookshelf">{t('nav.bookshelf')}</Link>
    </section>
  </div>;
}
