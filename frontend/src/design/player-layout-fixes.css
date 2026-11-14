import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './design/reader.css'
import i18n from './core/i18n'
import App from './App.tsx'
import { installIOSViewportGuards } from './core/utils/iosViewport'

installIOSViewportGuards();

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
