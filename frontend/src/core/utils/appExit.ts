interface HostWebView {
  callHandler?: (name: string) => unknown;
}

// 左边缘向右滑在飞牛宿主里等同于 WebView 的"返回"。听书保留真实历史后，
// 宿主自己就会退一页，页面不再介入——自己再喊一次退页会和宿主手势叠加，
// 一次滑动退两页。exitApp 只留作关窗兜底（例如根页面没有上一页时）。
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
