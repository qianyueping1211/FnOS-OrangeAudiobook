const FLAT_FLAG = '__readerFlatHistory';

// 飞牛宿主把"返回"手势交给 WebView：只要 WebView 还有可退的历史，手势就退一页；
// 历史空了它才关掉整个窗口（橙子音乐没有前端路由，因此天然是关窗）。
// 听书是 SPA，这里把站内跳转都压成 replace，让历史始终只有一条，
// 手势于是落到"关窗"上；应用内的返回按钮改用下面这条自记录路径栈。
export function installFlatHistory() {
  if (typeof window === 'undefined') return;
  const history = window.history;
  if ((history.pushState as unknown as Record<string, unknown>)[FLAT_FLAG]) return;
  const replace = history.replaceState.bind(history);
  const flatPush = function (data: unknown, unused: string, url?: string | URL | null) {
    replace(data, unused, url ?? undefined);
  } as typeof history.pushState;
  (flatPush as unknown as Record<string, unknown>)[FLAT_FLAG] = true;
  history.pushState = flatPush;
}

const trail: string[] = [];
const TRAIL_LIMIT = 40;

export function rememberPath(path: string) {
  if (!path) return;
  if (trail[trail.length - 1] === path) return;
  const seen = trail.indexOf(path);
  if (seen !== -1) trail.splice(seen, 1);
  trail.push(path);
  if (trail.length > TRAIL_LIMIT) trail.shift();
}

export function backTarget(fallback: string): string {
  if (trail.length >= 2) {
    trail.pop();
    const previous = trail[trail.length - 1];
    if (previous) return previous;
  }
  return fallback;
}
