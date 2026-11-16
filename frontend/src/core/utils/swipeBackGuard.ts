// 手机端从左边缘向右滑，飞牛宿主会把它当成 WebView 的「返回」：系统先画一段
// 整页滑动动画，松手后再退一格历史，路由跟着换页、底部导航换选中项。
// 听书不要这种整页后退，所以：
//
// 1. 历史始终保持「只有当前这一条」：站内所有 pushState 都改成 replaceState。
//    系统没有上一页可退，右滑就没有动画，也不会换页、刷新（首页、播放、书架本身、
//    书单列表、设置都是这样）。
// 2. 只有书架的搜索结果页、书籍详情页、书单详情页才多垫一条同 URL 的历史，
//    让右滑能「退」到它。松手后 capture 阶段的 popstate 抢在路由之前接住，
//    把垫的那条补回去，再去点页面上的「关闭 / 取消 / 返回」按钮。
//    离开这三类页面时，用 history.go(-1) 把垫的那条退掉，回到只有一条的状态。
//
// 只在触摸设备或飞牛宿主里装（触屏、手机 UA、iframe、宿主桥、网关路径任一成立）：
// 普通桌面浏览器、自动化测试没有这个手势，保持原样的历史。
import { getGatewayBasePath, getRuntimePathname } from './runtimeUrl';

// 允许滑动代替返回的页面：书架的搜索结果、书籍详情、书单详情。
const SWIPE_BACK_ROUTES: readonly RegExp[] = [
  /^\/search$/,
  /^\/book\/[^/]+$/,
  /^\/playlists\/[^/]+$/,
];

// 优先级：关闭 > 取消 > 返回。中文是各页面上的实际文案，英文是 t() 的回退。
// 英文必须按整词匹配，否则 playback / background 这类词也会命中 back。
const DISMISS_PATTERNS: readonly RegExp[] = [
  /关闭|\bclose\b/,
  /取消|\bcancel\b/,
  /返回|\bback\b|\bgo back\b/,
];

const CLICKABLE_SELECTOR = 'button, [role="button"], a[href]';

const isVisible = (el: HTMLElement): boolean => {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
  // 弹窗收起后元素还在树上，只是被 aria-hidden 盖住。
  if (el.closest('[aria-hidden="true"]')) return false;
  // 底部导航常驻，不属于「当前页面上的按钮」，不能被当成返回。
  if (el.closest('.reader-tabs')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if (style.pointerEvents === 'none') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const labelOf = (el: HTMLElement): string =>
  `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.textContent ?? ''}`
    .trim()
    .toLowerCase();

/**
 * 找当前页面上可点的「关闭 / 取消 / 返回」，优先级 关闭 > 取消 > 返回。
 */
const findDismissCandidate = (): HTMLElement | null => {
  // 弹窗通常挂在树的最末尾，反过来找能让「关闭」优先于页面顶部的「返回」。
  const visible = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR))
    .reverse()
    .filter(isVisible);
  for (const pattern of DISMISS_PATTERNS) {
    const hit = visible.find(el => pattern.test(labelOf(el)));
    if (hit) return hit;
  }
  return null;
};

const allowsSwipeBack = (): boolean => {
  const path = getRuntimePathname();
  return SWIPE_BACK_ROUTES.some(pattern => pattern.test(path));
};

/**
 * 按「关闭 > 取消 > 返回」的优先级点掉当前页面的一个按钮。
 * 不在允许滑动的页面上、或者一个按钮都没有时返回 false，什么也不做。
 */
export const invokePageDismissAction = (): boolean => {
  if (!allowsSwipeBack()) return false;
  const hit = findDismissCandidate();
  if (!hit) return false;
  hit.click();
  return true;
};

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
let originalPush: HistoryWrite = () => undefined;
let originalReplace: HistoryWrite = () => undefined;

/** 历史里现在是否多垫了一条（只会出现在三类允许滑动的页面上）。 */
let armed = false;

/** 当前画面对应的地址，右滑被接住后用它把垫的那条补回去。 */
let heldUrl = '';

/** 正在用 history.go(-1) 退掉多余的垫条：等它的 popstate 回来。 */
let pendingDisarm: { state: unknown; url: string; timer: number } | null = null;

const arm = (): void => {
  try {
    originalPush(window.history.state, '', window.location.href);
    armed = true;
  } catch {
    // 禁用 pushState 的环境放弃垫条，右滑就只是没有动作。
  }
};

const disarm = (): void => {
  const timer = window.setTimeout(() => {
    // 宿主没有退（比如根本没有上一条），别一直等下去。
    pendingDisarm = null;
  }, 1000);
  pendingDisarm = { state: window.history.state, url: window.location.href, timer };
  window.history.go(-1);
};

let reconcileScheduled = false;

/** 让历史条数和当前页面对上：三类页面两条，其余一条。 */
const reconcile = (): void => {
  reconcileScheduled = false;
  heldUrl = window.location.href;
  if (pendingDisarm) return;
  const allowed = allowsSwipeBack();
  if (allowed && !armed) arm();
  else if (!allowed && armed) disarm();
};

const onPopState = (event: PopStateEvent): void => {
  // 退掉垫条的那次回退：把新页面的地址写回第一条，路由不用知道。
  if (pendingDisarm) {
    event.stopImmediatePropagation();
    window.clearTimeout(pendingDisarm.timer);
    const { state, url } = pendingDisarm;
    pendingDisarm = null;
    try {
      originalReplace(state, '', url);
    } catch {
      // 写不回去也只是地址栏落后一格，页面本身没动。
    }
    armed = false;
    reconcile();
    return;
  }
  // 其余的后退都是右滑：抢在路由之前按住，路由收不到这次事件。
  event.stopImmediatePropagation();
  if (armed) {
    // 退到了第一条，把垫的那条补回去，下一次右滑还有地方退。
    try {
      originalPush(window.history.state, '', heldUrl || window.location.href);
    } catch {
      armed = false;
    }
    invokePageDismissAction();
  } else {
    // 不该有后退的页面却收到了（比如前进手势）：把地址拉回当前画面。
    try {
      originalReplace(window.history.state, '', heldUrl || window.location.href);
    } catch {
      // 忽略
    }
  }
};

export const installSwipeBackGuard = (): void => {
  if (installed) return;
  if (!isGuardedSurface()) return;
  installed = true;
  heldUrl = window.location.href;
  originalPush = window.history.pushState.bind(window.history);
  originalReplace = window.history.replaceState.bind(window.history);
  // 站内所有「前进一页」都改成覆盖当前这一条，历史不再增长。
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    originalReplace(data, unused, url);
  };
  window.addEventListener('popstate', onPopState, true);
};

/** 每次站内跳转后调用：更新当前画面地址，并让历史条数跟上当前页面。 */
export const syncSwipeBackGuard = (): void => {
  if (!installed) return;
  heldUrl = window.location.href;
  if (reconcileScheduled) return;
  reconcileScheduled = true;
  // 稍后再动历史：页面加载那一刻就改历史在 WebKit 上崩过。
  window.setTimeout(reconcile, 0);
};
