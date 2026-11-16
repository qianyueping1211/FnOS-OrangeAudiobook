import { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import apiClient from '../../core/api/client';
import type { Book, Chapter, Progress } from '../../core/types';
import { sortChaptersForPlayback } from '../../core/utils/chapter';
import { isTooLight } from '../../core/utils/color';
import { usePlayerStore } from '../../core/stores/playerStore';
import { takeRecentPlayback, warmRecentPlayback } from './playbackWarmup';

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
    const commit = (book: Book, chapters: Chapter[], progress: Progress | undefined, bookId: string) => {
      const target = requestedChapter || progress?.chapter_id;
      const chapter = chapters.find(item => item.id === target) || chapters[0];
      const current = usePlayerStore.getState();
      if (!chapter || controller.signal.aborted) return;
      if (!requestedBook && current.currentChapter) return;
      if (requestedBook && current.currentBook?.id !== startingBook && current.currentBook?.id !== bookId) return;
      const position = progress?.chapter_id === chapter.id ? progress.position : chapter.progress_position || 0;
      setResolvedChapter(chapter.id);
      usePlayerStore.setState(state => ({
        currentBook: book, currentChapter: chapter, chapters,
        currentTime: Math.max(0, position || 0), duration: chapter.duration || 0,
        isPlaying: false, isExpanded: false, isCollapsed: false,
        playbackRevision: state.playbackRevision + 1,
        themeColor: book.theme_color && !isTooLight(book.theme_color) ? book.theme_color : '#F2EDE4',
      }));
    };
    const loadOnce = async () => {
      const options = { signal: controller.signal };
      // 启动时已经取回过的最近收听先用上，点「播放」就不用再等三个请求。
      // 没取回就等那次预热（同一个 promise，不会重复发请求）——它失败才往下试。
      if (!requestedBook) {
        const warmed = takeRecentPlayback() || await warmRecentPlayback();
        if (warmed) {
          commit(warmed.book, warmed.chapters, warmed.progress, warmed.book.id);
        }
        // null = 这台机器上确实还没有收听记录，是空态而不是失败。
        return;
      }
      const bookId = requestedBook;
      const id = encodeURIComponent(bookId);
      const [bookResponse, chapterResponse, progress] = await Promise.all([
        apiClient.get<Book>('/api/books/' + id, options),
        apiClient.get<Chapter[]>('/api/books/' + id + '/chapters', options),
        apiClient.get<Progress>('/api/progress/' + id, options).then(response => response.data).catch(() => undefined),
      ]);
      commit(bookResponse.data, sortChaptersForPlayback(chapterResponse.data), progress, bookId);
    };
    // 刚启动那一两分钟里，宿主网关还没完全就绪，第一个请求偶尔会直接断掉。
    // 以前这里一次失败就摆"重试连接"，看着像是坏了；现在先自己退避重试两轮
    // （0.6s / 1.2s），仍然失败才让用户看到重试按钮。
    const loadRecent = async () => {
      try {
        for (let round = 0; ; round += 1) {
          try {
            await loadOnce();
            return;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (round >= 2) throw error;
            await new Promise(resolve => window.setTimeout(resolve, 600 * (round + 1)));
            if (controller.signal.aborted) throw error;
          }
        }
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
  // 首帧就把这页画出来：标题栏立刻在，下面先摆播放页的形状（封面位、两条
  // 文本、一颗按钮位），数据一到就换成真正的播放器。以前这里是一颗转圈，
  // 用户看到的就是"点了没反应"。
  if (loading) return <div className="reader-page reader-player-route-state">
    <header className="reader-heading"><h1>{t('nav.playerPage')}</h1></header>
    <section className="reader-player-empty" aria-busy="true">
      <div className="reader-player-skeleton-cover animate-pulse" aria-hidden="true" />
      <h2 className="reader-player-skeleton-line animate-pulse" aria-hidden="true" />
      <p className="reader-player-skeleton-line is-short animate-pulse" aria-hidden="true" />
      <span className="reader-sr-only">{t('player.restoringRecent')}</span>
    </section>
  </div>;
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
