import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './design/reader.css'
import './design/player-layout-fixes.css'
import i18n from './core/i18n'
import App from './App.tsx'
import { installIOSViewportGuards } from './core/utils/iosViewport'
import { installFlatHistory } from './core/utils/appHistory'
import { installSwipeExit } from './core/utils/appExit'

// 必须在路由首次跳转前装上：站内跳转不压历史，宿主手势才会关窗而不是退一页。
installFlatHistory();
installIOSViewportGuards();
installSwipeExit();

const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.classList.add(savedTheme === 'system'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : savedTheme);

// Let the application and authentication requests finish before offline precaching.
const registerUpdates = () => {
  const updateSW = registerSW({
    onNeedRefresh() { if (confirm(i18n.t('pwa.refreshPrompt'))) updateSW(true); },
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
