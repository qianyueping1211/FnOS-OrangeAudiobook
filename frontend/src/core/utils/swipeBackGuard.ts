// 手机端从左边缘向右滑，飞牛宿主会把它当成 WebView 的「返回」，一退就是整页
// 切换、底部导航跟着换选中项。听书不要这种整页后退，所以滑动只在一小撮页面里
// 顶替「返回」按钮：书架的搜索结果页、书籍详情页、书单详情页。其余页面
// （首页、播放、书架本身、书单列表、设置）一律不响应，页面上有什么按钮都不动。
//
// 实现方式不是预先在历史里垫条目（真机上没生效，且页面加载时改历史在 WebKit
// 上崩过），而是抢在路由之前按住那次后退：popstate 用 capture 注册，比路由的
// 监听先跑；退掉的那一格 URL 立刻用 pushState 拉回来，路由收不到这次事件，
// DOM 和底部导航一动不动，这时候才去点按钮。
//
// 只在触摸设备或飞牛宿主里装（触屏、手机 UA、iframe、宿主桥、网关路径任一成立）：
// 普通桌面浏览器、自动化测试没有这个手势。
import { consumeInternalBack } from './appExit';
import { getGatewayBasePath, getRuntimePathname } from './runtimeUrl';
import { swipeLog } from './swipeDebug';

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
 * 只找不点：手势真的发生时它才决定要不要点。
 */
const findDismissCandidate = (): HTMLElement | null => {
  // 弹窗通常挂在树的最末尾，反过来找能让「关闭」优先于页面顶部的「返回」。
  const visible = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR))
    .reverse()
    .filter(isVisible);
  for (const pattern of DISMISS_PATTERNS) {
    const hit = visible.find(el => {
      const label = labelOf(el);
      return pattern.test(label);
    });
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

let installed = false;

/** 当前画面对应的地址。后退被按住之后要用它把 URL 拉回来。 */
let heldUrl = '';

/** 刚替用户点过按钮：它自己发起的后退要放行，别把按钮的导航又按住。 */
let dismissWindowUntil = 0;

/**
 * 这个环境要不要按住后退。触屏、手机 UA、被嵌在 iframe 里（飞牛窗口）、
 * 有飞牛宿主桥、地址在网关路径下，任一成立就装。reasons 写进诊断日志。
 */
const detectGuardedSurface = (): { guarded: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    reasons.push('coarse');
  }
  if (/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)) reasons.push('ua');
  let framed = false;
  try {
    framed = window.top !== window.self;
  } catch {
    framed = true;
  }
  if (framed) reasons.push('iframe');
  if ((window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview) reasons.push('host');
  if (getGatewayBasePath()) reasons.push('gateway');
  return { guarded: reasons.length > 0, reasons };
};

/** 把地址栏拉回当前画面，DOM 不动。 */
const holdCurrentPage = (): void => {
  const state = window.history.state;
  const base = state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : null;
  try {
    window.history.pushState(base, '', heldUrl || window.location.href);
  } catch {
    // 禁用 pushState 的环境只能让宿主退到底，至少不去点错按钮。
  }
};

const onPopState = (event: PopStateEvent): void => {
  // 站内「返回」按钮自己发起的历史回退，放行。
  if (consumeInternalBack()) {
    swipeLog('pop CAPTURE internal-back, passed');
    return;
  }
  // 刚刚替用户点过按钮，这一退是它自己的导航，放行。
  if (Date.now() < dismissWindowUntil) {
    swipeLog('pop CAPTURE in dismiss window, passed');
    return;
  }
  const target = getRuntimePathname();
  // 抢在路由之前按住：这一格退掉之后，路由不该看到这次 popstate。
  event.stopImmediatePropagation();
  holdCurrentPage();
  const dismissed = invokePageDismissAction();
  swipeLog(`pop CAPTURE to=${target} held=${getRuntimePathname()} click=${dismissed}`);
  if (dismissed) {
    // 点了按钮，页面自己会导航。它若走 history.back()，这一次要放行，
    // 否则又会被按住，来回点同一个按钮。
    dismissWindowUntil = Date.now() + 600;
  }
};

export const installSwipeBackGuard = (): void => {
  if (installed) return;
  const { guarded, reasons } = detectGuardedSurface();
  swipeLog(`guard ${guarded ? 'ON' : 'OFF'} [${reasons.join(',') || '-'}]`);
  if (!guarded) return;
  installed = true;
  heldUrl = window.location.href;
  window.addEventListener('popstate', onPopState, true);
};

/** 每次站内跳转后更新「当前画面的地址」，按住后退时才拉得回来。 */
export const syncSwipeBackGuard = (): void => {
  if (!installed) return;
  heldUrl = window.location.href;
};
