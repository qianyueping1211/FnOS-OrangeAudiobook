import { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Book, Chapter, Progress } from '../../core/types';
import { sortChaptersForPlayback } from '../../core/utils/chapter';
import { isTooLight } from '../../core/utils/color';
import { usePlayerStore } from '../../core/stores/playerStore';
import LoadingSpinner from '../../shared/ui/LoadingSpinner';

// Layout keeps one shared Player/audio element mounted during navigation.
export default function PlayerPage() {
  const { t } = useTranslation();
  const hasChapter = usePlayerStore(state => !!state.currentChapter);
  const [loading, setLoading] = useState(!hasChapter);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (hasChapter) return;
    const controller = new AbortController();
    const loadRecent = async () => {
      try {
        const options = { signal: controller.signal };
        const recent = (await apiClient.get<Progress[]>('/api/progress/recent', options)).data;
        const last = [...recent].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
        if (!last?.book_id) return;
        const id = encodeURIComponent(last.book_id);
        const [bookResponse, chapterResponse] = await Promise.all([
          apiClient.get<Book>('/api/books/' + id, options),
          apiClient.get<Chapter[]>('/api/books/' + id + '/chapters', options),
        ]);
        const chapters = sortChaptersForPlayback(chapterResponse.data);
        const chapter = chapters.find(item => item.id === last.chapter_id) || chapters[0];
        // A user may have started another book while this request was pending.
        if (!chapter || controller.signal.aborted || usePlayerStore.getState().currentChapter) return;
        const book = bookResponse.data;
        const position = chapter.id === last.chapter_id ? last.position : chapter.progress_position || 0;
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
  }, [hasChapter, attempt]);

  if (hasChapter) return null;
  if (loading) return <LoadingSpinner className="min-h-64" />;
  return (
    <div className="reader-page">
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
    </div>
  );
}
