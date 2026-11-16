// 手机端从左边缘向右滑，飞牛宿主会把它当成 WebView 的「返回」，真实历史一退
// 就是整页切换。听书希望这一次手势交给当前页面自己的「关闭 / 取消 / 返回」
// 按钮，页面本身的位置不动；三个按钮都不在时，这次滑动不做任何事。
//
// 做法是给当前页面在历史里垫一条同 URL 的「护垫」条目：右滑只退到护垫，URL
// 没变，画面就不会切换。这时再看页面上有没有可点的按钮，有就点它，没有就把
// 护垫补回去，让这次手势完全无效果。
import { consumeInternalBack } from './appExit';

type GuardState = Record<string, unknown> & { __tingSwipeGuard?: boolean };

const GUARD_KEY = '__tingSwipeGuard';

// 优先级：关闭 > 取消 > 返回。中文是各页面上的实际文案，英文是 t() 的回退。
// 英文必须按整词匹配，否则 playback / background 这类词也会命中 back。
const DISMISS_PATTERNS: readonly RegExp[] = [
  /关闭|\bclose\b/,
  /取消|\bcancel\b/,
  /返回|\bback\b|\bgo back\b/,
];

const CLICKABLE_SELECTOR = 'button, [role="button"], a[href]';

const hasGuard = (state: unknown): boolean =>
  !!state && typeof state === 'object' && (state as GuardState)[GUARD_KEY] === true;

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
 * 只找不点，护垫也要靠它判断这一页值不值得拦手势。
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

/**
 * 按「关闭 > 取消 > 返回」的优先级点掉当前页面的一个按钮。
 * 找到并点掉返回 true；页面上一个都没有时返回 false，什么也不做。
 */
export const invokePageDismissAction = (): boolean => {
  const hit = findDismissCandidate();
  if (!hit) return false;
  hit.click();
  return true;
};

let waitingForLoad = false;

function ensureGuard(): void {
  if (hasGuard(window.history.state)) return;
  // 没有可点的按钮就不垫护垫：这一页右滑不做任何事，交给宿主默认行为。
  if (!findDismissCandidate()) return;
  // 文档还在加载时改历史，WebKit 上有整页崩溃的先例，等 load 完再垫。
  if (document.readyState !== 'complete') {
    if (!waitingForLoad) {
      waitingForLoad = true;
      window.addEventListener(
        'load',
        () => {
          waitingForLoad = false;
          ensureGuard();
        },
        { once: true },
      );
    }
    return;
  }
  const state = window.history.state;
  const base: GuardState = state && typeof state === 'object' ? { ...(state as GuardState) } : {};
  try {
    // 保留路由自己的 state（其中的索引让 react-router 认得出这是同一页）。
    window.history.pushState({ ...base, [GUARD_KEY]: true }, '', window.location.href);
  } catch {
    // 极少数环境禁用 pushState，此时手势退回宿主默认行为，不做拦截。
  }
}

let installed = false;

export const installSwipeBackGuard = (): void => {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', () => {
    // 站内「返回」按钮自己发起的历史回退，放行。
    if (consumeInternalBack()) return;
    // 已经站在护垫上（例如宿主前进），没有手势要处理。
    if (hasGuard(window.history.state)) return;
    // 护垫被右滑吃掉了，URL 没变，所以画面还停在原处。
    const acted = invokePageDismissAction();
    if (acted) {
      // 按钮自己会导航，页面可能已经换掉；等它落定再按新页面决定要不要垫护垫。
      window.setTimeout(syncSwipeBackGuard, 0);
    }
  });
  ensureGuard();
};

/** 每次站内跳转后重新垫护垫，右滑才有东西可吃。 */
export const syncSwipeBackGuard = (): void => {
  if (!installed) return;
  ensureGuard();
};
