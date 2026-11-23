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
import { safeStorage } from './core/utils/storage'
import { getRuntimePathname } from './core/utils/runtimeUrl'

installIOSViewportGuards();
// 入口就装：宿主把右滑当成 WebView 的"返回"，要在路由挂载之前接管历史，
// 让只有三类页面（搜索结果、书籍详情、书单详情）能右滑，其余页面没有可退的历史。
installSwipeBackGuard();

// 已登录时在入口就并行取回外壳和首页的代码，不等 React 挂载后才开始下载。
try {
  if (safeStorage.getItem('auth_token')) {
    void import('./shared/layout/Layout');
    if (getRuntimePathname() === '/') void import('./features/home/HomePage');
  }
} catch {
  // 取不到登录状态就走原来的按需加载。
}

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
