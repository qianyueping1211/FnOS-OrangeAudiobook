// Opens the fnOS file manager on the NAS folder that holds a book, mirroring the
// "view on device" shortcut OrangeMusic exposes from its download list. The SDK
// is imported lazily so the host bridge never sits in the first paint.
//
// One thing OrangeMusic learned the hard way, and is copied here: the official
// SDK bridge does not exist inside the fnOS mobile app webview. Only the desktop
// extension window hands the page a host bridge; on a phone the SDK either has no
// session (isStandaloneWeb) or fails its own appApi version gate with
// "openFileManager requires appApi >= v1.0". Calling it there can only produce an
// error the reader cannot act on, so the mobile path copies the NAS path instead.
import type { Book } from '../types';

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  ready: () => Promise<void>;
  openFileManager?: (path: string) => Promise<unknown>;
}

export type RevealResult = { mode: 'opened' } | { mode: 'copied'; folder: string; copied: boolean };

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

// The fnOS app webview injects flutter_inappwebview and a phone user agent, but
// ships no usable file-manager bridge; a plain browser window is equally locked
// out. Both are "no host" as far as this feature is concerned.
const isPhoneHost = (): boolean => {
  const injected = typeof (window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview !== 'undefined';
  if (injected) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPhone|iPad|iPod|Android/i.test(ua);
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path: an insecure origin refuses the async API.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
};

export async function revealNasFolder(path: string): Promise<RevealResult> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');
  // No bridge on a phone or in a standalone browser tab: hand the reader the
  // path instead of an error they cannot act on.
  if (isPhoneHost()) {
    return { mode: 'copied', folder, copied: await copyText(folder) };
  }
  const app = await host();
  if (app.isStandaloneWeb) {
    return { mode: 'copied', folder, copied: await copyText(folder) };
  }
  await withTimeout(app.ready(), 20000, '尚未连接到飞牛文件管理，请关闭应用后重新打开再试');
  if (typeof app.openFileManager !== 'function') {
    return { mode: 'copied', folder, copied: await copyText(folder) };
  }
  try {
    await withTimeout(app.openFileManager(folder), 10000, '飞牛文件管理没有响应，请稍后再试');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    // The extension host answers with a code when it has no file manager attached.
    if (message.includes('NotSupportedInExtensionHost') || message.includes('requires appApi')) {
      return { mode: 'copied', folder, copied: await copyText(folder) };
    }
    throw error instanceof Error ? error : new Error(message);
  }
  return { mode: 'opened' };
}

export async function revealBookOnNas(book: Pick<Book, 'path' | 'library_type'>): Promise<RevealResult> {
  if (book.library_type === 'webdav') throw new Error('远程书库的作品不在本机磁盘上');
  return revealNasFolder(book.path);
}
