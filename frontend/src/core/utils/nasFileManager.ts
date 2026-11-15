// Opens the fnOS file manager on the NAS folder that holds a book, following
// OrangeMusic's 「查看与下载」 step for step:
//
//   app.js:      navigation().then(n => n.warmFileManager())   // on startup
//   reveal(job): bridge.openSavedFileFolder(job.nas_path)
//   openMusicFolder(path): ready() (20s) → native.openFileManager(path) (10s)
//
// What the SDK actually does inside `openFileManager`, and why the earlier
// builds missed:
//
//   await initPromise;
//   if (isWeb) return (webMethods.openFileManager || webMethods.openFileManagerApp)(path);
//   assertMobileAppApi("openFileManager");      // throws "requires appApi >= v1.0"
//   return callAppMethod("openFileManager", path);
//
// The host only reports `appApi` through `getAppMessage`, and on this phone app
// that reply comes back empty, so the version gate throws even though the
// `openFileManager` handler really exists — OrangeMusic opens the manager on the
// same device. So: try the SDK path first, and when only the version gate
// objects, send the same message down the SDK's own channel (`callAppMethod`,
// i.e. `flutter_inappwebview.callHandler(name, …)` with the SDK's argument
// shape). The previous build called `callHandler` raw and treated any non-error
// string as success, which is why the button looked dead instead of failing.
import type { Book } from '../types';

interface FlutterBridge {
  callHandler?: (name: string, ...args: unknown[]) => Promise<unknown>;
}

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  flutterInAppWebView?: FlutterBridge | null;
  ready: () => Promise<unknown>;
  openFileManager?: (path: string) => Promise<unknown>;
  callAppMethod?: (name: string, ...args: unknown[]) => Promise<unknown>;
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

// The SDK's `callAppMethod` returns null when the host answered nothing — which
// is also what happens when the handler does not exist. Null means "not opened".
const sendThroughHostBridge = async (path: string, bridge?: FlutterBridge | null): Promise<boolean> => {
  if (!bridge?.callHandler) return false;
  try {
    const raw = await withTimeout(
      bridge.callHandler('openFileManager', path),
      10000,
      '飞牛文件管理没有响应，请稍后再试',
    );
    if (raw === null || raw === undefined || raw === '' || raw === false) return false;
    if (typeof raw === 'string') {
      if (/error|fail|not.?support|unavailable/i.test(raw)) return false;
      // The SDK unwraps { result: "<json>" } from the host reply.
      try {
        const envelope = JSON.parse(raw) as { result?: unknown };
        if (envelope && typeof envelope.result === 'string' && /error|fail|not.?support|unavailable/i.test(envelope.result)) {
          return false;
        }
      } catch {
        // A plain string answer is still an answer from the host.
      }
    }
    return true;
  } catch {
    return false;
  }
};

export async function revealNasFolder(path: string): Promise<RevealResult> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');

  const native = await warmFileManager();
  // OrangeMusic refuses here too: an ordinary browser tab has no host to talk to.
  if (native.isStandaloneWeb) return { mode: 'desktopOnly' };

  await withTimeout(native.ready(), 20000, '尚未连接到飞牛文件管理，请关闭应用后从应用中心重新打开再试');

  // 1) The SDK's public call: works on the desktop extension window, and on the
  //    phone whenever the host reports an appApi version.
  try {
    if (typeof native.openFileManager === 'function') {
      const opened = await withTimeout(native.openFileManager(folder), 10000, '飞牛文件管理没有响应，请稍后再试');
      if (opened !== null && opened !== undefined) return { mode: 'opened' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    // Only the version gate is forgiven here: a timeout, or a host that says it
    // has no file manager at all, is a real limitation.
    if (!/requires appApi/i.test(message)) {
      if (/NotSupportedInExtensionHost/i.test(message)) return { mode: 'unsupported' };
      throw error instanceof Error ? error : new Error(message);
    }
  }

  // 2) Same message down the SDK's own channel: skips the version gate, keeps
  //    the argument shape and envelope parsing the host expects.
  if (typeof native.callAppMethod === 'function') {
    const sent = await native.callAppMethod('openFileManager', folder).then(
      value => value !== null && value !== undefined,
      () => false,
    );
    if (sent) return { mode: 'opened' };
  }

  // 3) Last resort: the bridge the SDK itself holds, then the global one.
  if (await sendThroughHostBridge(folder, native.flutterInAppWebView)) return { mode: 'opened' };
  const globalBridge = (window as unknown as { flutter_inappwebview?: FlutterBridge }).flutter_inappwebview;
  if (await sendThroughHostBridge(folder, globalBridge)) return { mode: 'opened' };

  return { mode: 'unsupported' };
}

export async function revealBookOnNas(book: Pick<Book, 'path' | 'library_type'>): Promise<RevealResult> {
  if (book.library_type === 'webdav') throw new Error('远程书库的作品不在本机磁盘上');
  return revealNasFolder(book.path);
}
