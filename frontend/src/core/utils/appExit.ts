interface HostWebView {
  callHandler?: (name: string) => unknown;
}

// 左边缘向右滑在飞牛宿主里等同于 WebView 的"返回"，默认会回到上一个页面。
// 听书里没有"上一页"的语义：滑动应该直接关掉当前窗口，所以这里统一走宿主
// 的退出指令（移动端 exitPage），浏览器窗口再用 window.close() 兜底。
export const exitApp = () => {
  const host = (window as unknown as { flutter_inappwebview?: HostWebView }).flutter_inappwebview;
  if (host?.callHandler) {
    try {
      host.callHandler('exitPage');
      return;
    } catch {
      // 宿主没响应就继续往下试
    }
  }
  try {
    window.close();
  } catch {
    // 普通标签页不允许脚本关闭，滑动就到此为止
  }
};

// 应用内的"返回"按钮同样是历史回退，会触发 popstate。用一次性的标记把这类
// 主动返回放过去，别被当成滑动手势处理。
let internalBackPending = false;

export const beginInternalBack = () => {
  internalBackPending = true;
};

export const consumeInternalBack = () => {
  if (!internalBackPending) return false;
  internalBackPending = false;
  return true;
};

// 与橙子音乐同一套兜底：宿主没把这次右滑当成"关窗"时，由页面自己喊 exitPage。
export function installSwipeExit() {
  if (typeof window === 'undefined') return;
  const touchDevice = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/.test(navigator.userAgent);
  if (!touchDevice) return;
  const EDGE = 32;
  const DISTANCE = 80;
  let tracking = false;
  let startX = 0;
  let startY = 0;
  const onStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const first = event.touches[0];
    tracking = first.clientX <= EDGE;
    startX = first.clientX;
    startY = first.clientY;
  };
  const onEnd = (event: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const point = event.changedTouches[0];
    if (!point) return;
    if (point.clientX - startX >= DISTANCE && Math.abs(point.clientY - startY) <= 60) exitApp();
  };
  const onCancel = () => { tracking = false; };
  document.addEventListener('touchstart', onStart, { passive: true, capture: true });
  document.addEventListener('touchend', onEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', onCancel, { passive: true, capture: true });
}
