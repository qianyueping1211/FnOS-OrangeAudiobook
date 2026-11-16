// 临时诊断：把右滑相关事件写到屏幕顶部，方便在真机上截图。
// 只用于排查右滑问题的 beta 构建，排查完请删除，不要合并到 main。
// 日志存在 sessionStorage 里：如果滑动导致整页重新加载，重载后还能看到之前的记录。
const STORAGE_KEY = 'ting.swipeDebug.log';
const MAX_LINES = 14;

let lines: string[] = [];
let overlay: HTMLDivElement | null = null;

const load = (): string[] => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const save = (): void => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // 存储不可用时只保留内存里的记录。
  }
};

const stamp = (): string => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

const render = (): void => {
  if (overlay) overlay.textContent = lines.join('\n');
};

export const swipeLog = (message: string): void => {
  lines.push(`${stamp()} ${message}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  save();
  render();
};

export const installSwipeDebug = (): void => {
  if (overlay || typeof document === 'undefined') return;
  lines = load();
  overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'pointer-events:none',
    'margin:0',
    'padding:calc(env(safe-area-inset-top, 0px) + 2px) 6px 2px',
    'font:9px/1.25 ui-monospace,Menlo,monospace',
    'color:#7cfc00',
    'background:rgba(0,0,0,0.72)',
    'white-space:pre-wrap',
    'word-break:break-all',
  ].join(';');
  document.body.appendChild(overlay);
  render();

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  let framed = false;
  try {
    framed = window.top !== window.self;
  } catch {
    framed = true;
  }
  swipeLog(`boot nav=${navigation?.type ?? '?'} path=${window.location.pathname} len=${window.history.length} iframe=${framed}`);

  window.addEventListener('pagehide', (event) => swipeLog(`pagehide persisted=${event.persisted}`));
  window.addEventListener('pageshow', (event) => swipeLog(`pageshow persisted=${event.persisted}`));
  document.addEventListener('visibilitychange', () => swipeLog(`visibility=${document.visibilityState}`));
  window.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (touch && touch.clientX <= 30) swipeLog(`edge-touch x=${Math.round(touch.clientX)}`);
  }, { passive: true, capture: true });
  // 这个监听比路由先注册，且在冒泡阶段：守卫若真的按住了后退，它不会被调用；
  // 一旦出现这行日志，就说明事件越过了守卫。
  window.addEventListener('popstate', () => swipeLog(`popstate BUBBLE reached, path=${window.location.pathname}`));
};
