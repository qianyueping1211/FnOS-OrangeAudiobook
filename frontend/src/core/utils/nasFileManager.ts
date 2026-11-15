// Opens the fnOS file manager on the NAS folder that holds a book, mirroring the
// "view on device" shortcut OrangeMusic exposes from its download list. The SDK
// is imported lazily so the host bridge never sits in the first paint.
import type { Book } from '../types';

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  ready: () => Promise<void>;
  openFileManager?: (path: string) => Promise<unknown>;
}

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

export async function revealNasFolder(path: string): Promise<void> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');
  const app = await host();
  if (app.isStandaloneWeb) {
    throw new Error('请从飞牛应用中心的应用窗口打开橙子听书，再查看文件位置');
  }
  await withTimeout(app.ready(), 20000, '尚未连接到飞牛文件管理，请关闭应用后重新打开再试');
  if (typeof app.openFileManager !== 'function') {
    throw new Error('当前飞牛宿主没有提供文件管理接口');
  }
  await withTimeout(app.openFileManager(folder), 10000, '飞牛文件管理没有响应，请稍后再试');
}

export async function revealBookOnNas(book: Pick<Book, 'path' | 'library_type'>): Promise<void> {
  if (book.library_type === 'webdav') throw new Error('远程书库的作品不在本机磁盘上');
  await revealNasFolder(book.path);
}
