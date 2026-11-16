// 手机端从左边缘向右滑，飞牛宿主会把它当成 WebView 的「返回」：系统先画一段
// 整页滑动动画，松手后再退一格历史，路由跟着换页、底部导航换选中项。
// 听书不要这种整页后退，所有页面都不响应右滑（需要返回时用页面上的返回按钮）。
//
// 做法：历史始终保持「只有当前这一条」——站内所有 pushState 都改成 replaceState。
// 系统没有上一页可退，右滑就没有动画，也不会换页、刷新。
// 万一仍收到 popstate（比如前进手势），在 capture 阶段抢在路由之前拦下，把地址拉回当前画面。
//
// 只在触摸设备或飞牛宿主里装（触屏、手机 UA、iframe、宿主桥、网关路径任一成立）：
// 普通桌面浏览器、自动化测试没有这个手势，保持原样的历史。
import { getGatewayBasePath } from './runtimeUrl';

const isFramed = (): boolean => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

/** 这个环境要不要接管历史。 */
const isGuardedSurface = (): boolean => {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true;
  if (/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)) return true;
  if (isFramed()) return true;
  if ((window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview) return true;
  return Boolean(getGatewayBasePath());
};

type HistoryWrite = (data: unknown, unused: string, url?: string | URL | null) => void;

let installed = false;
let originalReplace: HistoryWrite = () => undefined;

/** 当前画面对应的地址，拦下后退后用它把地址拉回来。 */
let heldUrl = '';

const onPopState = (event: PopStateEvent): void => {
  // 抢在路由之前按住：路由收不到这次事件，页面不动。
  event.stopImmediatePropagation();
  try {
    originalReplace(window.history.state, '', heldUrl || window.location.href);
  } catch {
    // 写不回去也只是地址栏落后一格，页面本身没动。
  }
};

export const installSwipeBackGuard = (): void => {
  if (installed) return;
  if (!isGuardedSurface()) return;
  installed = true;
  heldUrl = window.location.href;
  originalReplace = window.history.replaceState.bind(window.history);
  // 站内所有「前进一页」都改成覆盖当前这一条，历史不再增长。
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    originalReplace(data, unused, url);
  };
  window.addEventListener('popstate', onPopState, true);
};

/** 每次站内跳转后调用：记下当前画面地址。 */
export const syncSwipeBackGuard = (): void => {
  if (!installed) return;
  heldUrl = window.location.href;
};
