// Warms the "pick up where you left off" data before the player page is asked
// for it. The app boots, we quietly read the most recent progress entry and its
// book + chapter list, and keep the result in memory. Nothing is mounted and
// nothing plays: the player page stays off screen until it is opened, and the
// store is only written when PlayerPage actually renders.
//
// This is why tapping 播放 can feel instant: no chunk to fetch (Layout already
// warmed it), and no three-request round trip waiting behind a spinner.
import apiClient from '../../core/api/client';
import type { Book, Chapter, Progress } from '../../core/types';
import { sortChaptersForPlayback } from '../../core/utils/chapter';
import { isTooLight } from '../../core/utils/color';
import { usePlayerStore } from '../../core/stores/playerStore';
import { useUiPreferencesStore } from '../../core/stores/uiPreferencesStore';
import { isOnlineBookHidden, loadSourceLibraryIds } from '../../core/utils/onlineBooks';

export interface PlaybackWarmup {
  book: Book;
  chapters: Chapter[];
  progress?: Progress;
}

let pending: Promise<PlaybackWarmup | null> | null = null;
let ready: PlaybackWarmup | null = null;

const load = async (): Promise<PlaybackWarmup | null> => {
  const recent = (await apiClient.get<Progress[]>('/api/progress/recent')).data;
  // 关掉「在线书籍播放」后，继续收听不能接到在线书上：先读出在线书源的库 id 再过滤。
  if (!useUiPreferencesStore.getState().onlineBooksEnabled) await loadSourceLibraryIds();
  const last = [...recent]
    .filter((item) => !isOnlineBookHidden(item))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  if (!last?.book_id) return null;
  const id = encodeURIComponent(last.book_id);
  const [bookResponse, chapterResponse] = await Promise.all([
    apiClient.get<Book>('/api/books/' + id),
    apiClient.get<Chapter[]>('/api/books/' + id + '/chapters'),
  ]);
  if (isOnlineBookHidden(bookResponse.data)) return null;
  return {
    book: bookResponse.data,
    chapters: sortChaptersForPlayback(chapterResponse.data),
    progress: last,
  };
};

export const warmRecentPlayback = (): Promise<PlaybackWarmup | null> => {
  if (!pending) {
    pending = load()
      .then(value => {
        ready = value;
        return value;
      })
      .catch((error: unknown) => {
        // A failed warm-up must not be sticky: the player page will fetch for
        // itself and can try again on the next open. 失败要能区分出来——null 表示
        // "确实没有最近收听"，抛错表示"这次没取到"，播放页据此决定是显示空态
        // 还是自动重试。
        pending = null;
        ready = null;
        throw error;
      });
  }
  return pending;
};

// Only hand back data for the book the caller is about to open.
export const takeRecentPlayback = (bookId?: string | null): PlaybackWarmup | null => {
  if (!ready) return null;
  if (bookId && ready.book.id !== bookId) return null;
  return ready;
};

// 点「播放」的那一刻同步把预热好的内容交给共享播放器：路由切到 /player 时
// Player 已经在树上，直接以整页形态出现，没有请求、没有骨架、也不开始播放。
// 预热只是把数据揣在口袋里，不写 store，所以启动后首页不会挂载播放器。
export const primePlaybackFromWarm = (): boolean => {
  const warmed = ready;
  if (!warmed) return false;
  const state = usePlayerStore.getState();
  if (state.currentChapter) return true;
  const target = warmed.progress?.chapter_id;
  const chapter = warmed.chapters.find(item => item.id === target) || warmed.chapters[0];
  if (!chapter) return false;
  const position = warmed.progress?.chapter_id === chapter.id ? warmed.progress.position : chapter.progress_position || 0;
  usePlayerStore.setState(s => ({
    currentBook: warmed.book,
    currentChapter: chapter,
    chapters: warmed.chapters,
    currentTime: Math.max(0, position || 0),
    duration: chapter.duration || 0,
    isPlaying: false,
    isExpanded: false,
    isCollapsed: false,
    playbackRevision: s.playbackRevision + 1,
    themeColor: warmed.book.theme_color && !isTooLight(warmed.book.theme_color) ? warmed.book.theme_color : '#F2EDE4',
  }));
  return true;
};
