// Opens the fnOS file manager on the NAS folder that holds a book, following
// OrangeMusic's 「查看与下载」 exactly:
//
//   app.js:      navigation().then(n => n.warmFileManager())   // on startup
//   reveal(job): bridge.openSavedFileFolder(job.nas_path)
//   openMusicFolder(path): ready() (20s) → native.openFileManager(path) (10s)
//
// The two details that matter and that we got wrong before:
//
// 1. warmFileManager() runs when the app boots, so the SDK module is imported
//    and TrimApp is constructed long before the button is tapped. The host's
//    `getAppMessage` round-trip fills `appApiVersion` during that warm-up;
//    doing it on the tap was too late and made the SDK's
//    `assertMobileAppApi("openFileManager")` fail with "requires appApi >= v1.0".
// 2. The call must go through the SDK, not through a guessed
//    `callHandler('openFileManager')`. The SDK awaits `initPromise` first and
//    serialises the argument the way the host expects. A raw callHandler on a
//    handler the host never registered resolves quietly, which is why the last
//    build looked like it did nothing at all.
import type { Book } from '../types';

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  ready: () => Promise<unknown>;
  openFileManager?: (path: string) => Promise<unknown>;
}

export type RevealResult =
  | { mode: 'opened' }
  | { mode: 'unsupported' }
  | { mode: 'desktopOnly' };

let hostPromise: Promise<TrimAppInstance> | null = null;

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

// Same shape as OrangeMusic's warmFileManager(): one shared promise, cleared on
// failure so the next tap can retry.
export const warmFileManager = (): Promise<TrimAppInstance> => {
  if (!hostPromise) {
    hostPromise = import('../../vendor/fnos-sdk.js')
      .then(module => {
        const ctor = (module.TrimApp || module.default) as unknown as new (options?: { debug?: boolean }) => TrimAppInstance;
        return new ctor({ debug: false });
      })
      .catch(error => {
        hostPromise = null;
        throw error;
      });
  }
  return hostPromise;
};

export const nasFolderOf = (path?: string): string | null => {
  if (!path || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) return null;
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
};

export const canRevealNasFolder = (book?: Pick<Book, 'path' | 'library_type'> | null): boolean =>
  !!book && book.library_type !== 'webdav' && !!nasFolderOf(book.path);

export async function revealNasFolder(path: string): Promise<RevealResult> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');

  const native = await warmFileManager();
  // OrangeMusic refuses here too: an ordinary browser tab has no host to talk to.
  if (native.isStandaloneWeb) return { mode: 'desktopOnly' };

  try {
    await withTimeout(native.ready(), 20000, '尚未连接到飞牛文件管理，请关闭应用后从应用中心重新打开再试');
    if (typeof native.openFileManager !== 'function') return { mode: 'unsupported' };
    await withTimeout(native.openFileManager(folder), 10000, '飞牛文件管理没有响应，请稍后再试');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    // The host says it has no file manager to hand us: that is a limitation of
    // the window, not a crash, so the interface just says so.
    if (message.includes('NotSupportedInExtensionHost') || message.includes('requires appApi')) {
      return { mode: 'unsupported' };
    }
    throw error instanceof Error ? error : new Error(message);
  }
  return { mode: 'opened' };
}

export async function revealBookOnNas(book: Pick<Book, 'path' | 'library_type'>): Promise<RevealResult> {
  if (book.library_type === 'webdav') throw new Error('远程书库的作品不在本机磁盘上');
  return revealNasFolder(book.path);
}
