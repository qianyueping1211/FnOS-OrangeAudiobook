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
