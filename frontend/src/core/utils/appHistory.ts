// 飞牛宿主把"返回"手势交给 WebView：只要有可退的历史，手势就退一页；
// 历史空了它才关掉整个窗口。听书是 SPA，站内跳转保持真实的 push 历史，
// 所以左边缘右滑就是"返回上一步"，而不是退出微应用。
// 应用内的返回按钮仍走下面这条自记录路径栈，位置见 backTarget。
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
