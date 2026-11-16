// Opens the fnOS file manager on the NAS folder that holds a book, following
// OrangeMusic's 「查看与下载」 step for step:
//
//   app.js:      navigation().then(n => n.warmFileManager())   // after /api/state
//   reveal(job): bridge.openSavedFileFolder(job.nas_path)
//   openMusicFolder(path): ready() (20s) → native.openFileManager(path) (10s)
//
// Two things the SDK does behind that call, both learned the hard way:
//
//   await initPromise;                          // may never settle, see below
//   if (isWeb) return (webMethods.openFileManager || webMethods.openFileManagerApp)(path);
//   assertMobileAppApi("openFileManager");      // throws "requires appApi >= v1.0"
//   return callAppMethod("openFileManager", path);   // → flutter_inappwebview.callHandler(name, path)
//
// The mobile branch only takes the bridge immediately when the UA is iOS/Mac,
// when `flutterInAppWebViewPlatformReady` fired inside this module's lifetime,
// or when the host pre-set `window.flutter_inappwebview._platformReady`. A
// Windows client does none of those, so the SDK parks on an event listener that
// never fires: `initPromise` stays pending forever and `ready()` times out —
// which is exactly the「尚未连接到飞牛文件管理」message. The two fallbacks below
// were never reached either, because the old code awaited `ready()` outside the
// try block.
//
// So the host bridge is probed directly first (the same `callHandler` message
// the SDK would send), and the SDK path stays as the second attempt for hosts
// that do initialise. Every branch keeps a short note so a failing device
// reports which one it took.
import type { Book } from '../types';

interface FlutterBridge {
  callHandler?: (name: string, ...args: unknown[]) => Promise<unknown>;
}

interface TrimAppInstance {
  isStandaloneWeb?: boolean;
  appApiVersion?: string;
  flutterInAppWebView?: FlutterBridge | null;
  ready: () => Promise<unknown>;
  openFileManager?: (path: string) => Promise<unknown>;
  callAppMethod?: (name: string, ...args: unknown[]) => Promise<unknown>;
}

export type RevealResult =
  | { mode: 'opened' }
  | { mode: 'unsupported'; detail?: string }
  | { mode: 'desktopOnly' };

let hostPromise: Promise<TrimAppInstance> | null = null;

const FILE_MANAGER_METHODS = ['openFileManager', 'openFileManagerApp'] as const;

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

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

const resetFileManagerHost = () => {
  hostPromise = null;
};

// `books.path` — the「书籍位置」field shown in the metadata editor — already
// points at the folder that holds the audiobook:
//
//   /vol2/1000/Learn/0 有声读物/樊登作品/万历传
//
// so it is handed to the host unchanged. Only the rare library that stores a
// single audio file as the book (no per-book folder) needs one level up.
const AUDIO_FILE = /\.(mp3|m4a|m4b|aac|flac|wav|ogg|opus|ape|wma|mp4|m4v|mkv|webm|ts)$/i;

export const nasFolderOf = (path?: string): string | null => {
  if (!path || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) return null;
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed) return '/';
  if (!AUDIO_FILE.test(trimmed)) return trimmed;
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
};

export const canRevealNasFolder = (book?: Pick<Book, 'path' | 'library_type'> | null): boolean =>
  // Online book-source books have no NAS folder at all: their path holds the
  // source's own book id, so the folder affordance must stay hidden.
  !!book && book.library_type !== 'webdav' && book.library_type !== 'source' && !!nasFolderOf(book.path);

const globalBridge = (): FlutterBridge | null => {
  const candidate = (window as unknown as { flutter_inappwebview?: FlutterBridge }).flutter_inappwebview;
  return typeof candidate?.callHandler === 'function' ? candidate : null;
};

// The host may inject the bridge a moment after the page paints, so keep
// looking for a few seconds instead of deciding on the first frame.
const waitForBridge = async (ms: number): Promise<FlutterBridge | null> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const bridge = globalBridge();
    if (bridge) return bridge;
    await sleep(150);
  }
  return globalBridge();
};

interface HostReply {
  opened: boolean;
  detail: string;
}

// The host opens the file manager and answers nothing — OrangeMusic never
// inspects this return value for that reason. A real refusal arrives as a
// rejected promise (Flutter throws for an unknown handler), so "no reply"
// means "sent", not "unsupported"; only an explicit error payload fails.
const readHostReply = (raw: unknown): HostReply => {
  if (raw === null || raw === undefined || raw === '') {
    return { opened: true, detail: '' };
  }
  if (raw === false) {
    return { opened: false, detail: 'rejected' };
  }
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      const envelope = JSON.parse(raw) as { result?: unknown };
      if (envelope && typeof envelope === 'object' && 'result' in envelope) {
        const inner = envelope.result;
        if (typeof inner === 'string' && inner.trim()) {
          try {
            payload = JSON.parse(inner);
          } catch {
            payload = inner;
          }
        } else {
          payload = inner;
        }
      } else {
        payload = envelope;
      }
    } catch {
      payload = raw;
    }
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  if (text && /error|fail|not.?support|unavailable|denied|not allowed/i.test(text)) {
    return { opened: false, detail: text.slice(0, 120) };
  }
  return { opened: true, detail: '' };
};

const callHost = async (bridge: FlutterBridge, name: string, path: string): Promise<HostReply> => {
  try {
    const raw = await withTimeout(
      (bridge.callHandler as (n: string, ...a: unknown[]) => Promise<unknown>)(name, path),
      10000,
      'timeout',
    );
    return readHostReply(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return { opened: false, detail: message.includes('timeout') ? 'timeout' : message.slice(0, 60) };
  }
};

export async function revealNasFolder(path: string): Promise<RevealResult> {
  const folder = nasFolderOf(path);
  if (!folder) throw new Error('这个作品还没有可用的 NAS 位置');

  const notes: string[] = [];

  // 1) OrangeMusic's order, step for step: the warmed SDK instance → ready() →
  //    native.openFileManager(folder). That is the message this host answers by
  //    opening its file manager at the folder. The instance is warmed when the
  //    app shell mounts, so a tap normally finds it already settled — no polling,
  //    no visible delay. `ready()` stays capped instead of fatal, because the
  //    Windows client parks it on an event it never fires.
  let native = await warmFileManager().catch(() => null);
  if (native?.isStandaloneWeb) return { mode: 'desktopOnly' };

  const settleSdk = async (instance: TrimAppInstance | null, ms: number): Promise<boolean> => {
    if (!instance) return false;
    try {
      await withTimeout(instance.ready(), ms, 'sdk-init-timeout');
      return true;
    } catch {
      return false;
    }
  };

  let ready = await settleSdk(native, 8000);
  if (!ready) {
    notes.push('sdk=init-timeout');
    // A fresh instance re-runs the platform probe; if the bridge appeared in
    // the meantime it settles immediately.
    resetFileManagerHost();
    native = await warmFileManager().catch(() => null);
    ready = await settleSdk(native, 5000);
  }

  if (native && ready) {
    for (const method of FILE_MANAGER_METHODS) {
      const direct = (native as unknown as Record<string, unknown>)[method];
      if (typeof direct !== 'function') {
        notes.push(method + '=missing');
        continue;
      }
      try {
        const reply = await withTimeout(
          (direct as (p: string) => Promise<unknown>).call(native, folder),
          10000,
          'timeout',
        );
        const verdict = readHostReply(reply);
        if (verdict.opened) return { mode: 'opened' };
        notes.push(method + '=' + verdict.detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        notes.push(method + '=' + message.slice(0, 80));
        if (/NotSupportedInExtensionHost/i.test(message)) {
          return { mode: 'unsupported', detail: 'host-bridge-missing' };
        }
      }
    }
    // Last SDK channel: skips the appApi version gate, same message, same host.
    const appCall = typeof native.callAppMethod === 'function'
      ? (native.callAppMethod as (n: string, ...a: unknown[]) => Promise<unknown>)
      : null;
    if (appCall) {
      for (const method of FILE_MANAGER_METHODS) {
        try {
          const raw = await withTimeout(appCall.call(native, method, folder), 10000, 'timeout');
          const verdict = readHostReply(raw);
          if (verdict.opened) return { mode: 'opened' };
          notes.push('sdk:' + method + '=' + verdict.detail);
        } catch (error) {
          notes.push('sdk:' + method + '=' + (error instanceof Error ? error.message : String(error)).slice(0, 80));
        }
      }
    }
    if (!native.appApiVersion) notes.push('appApi=absent');
  }

  // 2) Fallback: send the same message straight to the host bridge, for a host
  //    that injects `flutter_inappwebview` without ever firing the SDK's
  //    platform-ready event.
  const bridge = await waitForBridge(6000);
  if (bridge) {
    for (const method of FILE_MANAGER_METHODS) {
      const reply = await callHost(bridge, method, folder);
      if (reply.opened) return { mode: 'opened' };
      notes.push(method + '=' + reply.detail);
    }
  } else {
    notes.push('bridge=absent');
  }

  const detail = notes.filter(Boolean).slice(0, 4).join(' | ');
  if (typeof console !== 'undefined') console.warn('[nas-reveal]', folder, detail);
  return { mode: 'unsupported', detail };
}

export async function revealBookOnNas(book: Pick<Book, 'path' | 'library_type'>): Promise<RevealResult> {
  if (book.library_type === 'webdav') throw new Error('远程书库的作品不在本机磁盘上');
  return revealNasFolder(book.path);
}
