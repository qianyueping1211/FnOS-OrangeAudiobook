// Opens the fnOS file manager on the NAS folder that holds a book, the same way
// OrangeMusic's download list does it (`openSavedFileFolder` → SDK
// `openFileManager(path)`), with one extra step for the phone.
//
// Why the extra step: the SDK gates `openFileManager` behind
// `assertMobileAppApi("openFileManager")`, and the version it compares comes from
// the host's `getAppMessage` reply. In the fnOS phone app that reply carries no
// `appApi`, so the gate always throws "openFileManager requires appApi >= v1.0"
// even though the host does expose a file-manager handler. Calling the handler
// directly skips only the version gate, not the host: if the app has the handler
// the folder really opens, and if it does not we say so instead of leaking a
// server path into the interface.
import type { Book } from '../types';

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  ready: () => Promise<void>;
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

const host = (): Promise<TrimAppInstance> => {
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

const hostBridge = () =>
  (window as unknown as {
    flutter_inappwebview?: { callHandler?: (name: string, ...args: unknown[]) => Promise<unknown> };
  }).flutter_inappwebview;

// The fnOS app webview injects flutter_inappwebview and a phone user agent.
const isPhoneHost = (): boolean => {
  if (typeof hostBridge() !== 'undefined') return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPhone|iPad|iPod|Android/i.test(ua);
};

const callHost = async (handler: string, arg: string): Promise<boolean> => {
  const bridge = hostBridge();
  if (!bridge?.callHandler) return false;
  try {
    const result = await withTimeout(bridge.callHandler(handler, arg), 8000, 'timeout');
    // A handler that reports back an error string has not opened anything.
    if (result === false || result === 'false') return false;
    if (typeof result === 'string' && /error|fail|not support|unavailable/i.test(result)) return false;
    return true;
  } catch {
    return false;
  }
};

export async function revealNasFolder(path: string): Promise<RevealResult> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');

  if (isPhoneHost()) {
    // Ask the host itself: `openFileManager` is the handler the SDK would have
    // called, `openFileManagerApp` is the variant some builds register instead.
    if (await callHost('openFileManager', folder)) return { mode: 'opened' };
    if (await callHost('openFileManagerApp', folder)) return { mode: 'opened' };
    return { mode: 'unsupported' };
  }

  const app = await host();
  if (app.isStandaloneWeb) return { mode: 'desktopOnly' };
  await withTimeout(app.ready(), 20000, '尚未连接到飞牛文件管理，请关闭应用后重新打开再试');
  if (typeof app.openFileManager !== 'function') return { mode: 'unsupported' };
  try {
    await withTimeout(app.openFileManager(folder), 10000, '飞牛文件管理没有响应，请稍后再试');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
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
