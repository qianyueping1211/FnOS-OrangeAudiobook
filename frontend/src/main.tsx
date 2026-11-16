import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './design/reader.css'
import './design/player-layout-fixes.css'
import i18n from './core/i18n'
import App from './App.tsx'
import { installIOSViewportGuards } from './core/utils/iosViewport'
import { installSwipeBackGuard } from './core/utils/swipeBackGuard'

// 宿主把右滑当成 WebView 的"返回"：只要历史里真有上一页就退一页。
// 所以这里只装 iOS 视口保护，站内跳转保持正常的 push 历史。
installIOSViewportGuards();
// 入口就装：登录态还没加载、Layout 还没挂载时，宿主的手势也能被按住。
// 它是幂等的，Layout 里那次调用只是重复确认。
installSwipeBackGuard();

const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.classList.add(savedTheme === 'system'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : savedTheme);

// Let the application and authentication requests finish before offline precaching.
const registerUpdates = () => {
  const updateSW = registerSW({
    // The fnOS shell swallows window.confirm, so asking the reader left the old
    // service worker in charge forever. Take the update silently; skipWaiting is
    // applied now and the next cold start serves the fresh bundle, without
    // interrupting a running listen.
    onNeedRefresh() { void updateSW(false); },
    onOfflineReady() { console.log(i18n.t('pwa.offlineReady')); },
  });
};
const scheduleUpdates = () => window.setTimeout(() => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(registerUpdates, { timeout: 3000 });
  else registerUpdates();
}, 2500);
if (document.readyState === 'complete') scheduleUpdates();
else window.addEventListener('load', scheduleUpdates, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
