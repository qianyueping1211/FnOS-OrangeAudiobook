import React, { Suspense, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { 
  Home, 
  Headphones, 
  Library, 
  User,
  LogOut, 
  Database,
  Users,
  Terminal,
  ListMusic,
  Puzzle,
  ArrowUpCircle,
} from 'lucide-react';
import { useAuthStore } from '../../core/stores/authStore';
import { getRuntimeAssetUrl } from '../../core/utils/runtimeUrl';
import { useTheme } from '../../core/hooks/useTheme';
import { usePlayerStore } from '../../core/stores/playerStore';
import { normalizeLanguage } from '../../core/i18n/locales';
import { useAppLanguage } from '../../core/i18n/useAppLanguage';
import {
  getBrowserSessionId,
  hasSessionRestoreLogged,
  markSessionRestoreLogged,
} from '../../core/utils/sessionRestore';
import apiClient from '../../core/api/client';
import { loadClientSettings } from '../../core/api/clientSettings';
import { setApplicationTimeZone } from '../../core/utils/timeZone';
import { useClientExtensions } from '../../core/hooks/useClientExtensions';
import { useUiPreferencesStore } from '../../core/stores/uiPreferencesStore';
import { consumeInternalBack, exitApp } from '../../core/utils/appExit';
import { rememberPath } from '../../core/utils/appHistory';

import DefaultAdminCredentialsDialog from '../../features/auth/DefaultAdminCredentialsDialog';
import { isMiniPlayerHiddenPath } from '../../features/player/platform';
import PluginExtensionIcon from '../pluginExtensions/PluginExtensionIcon';
import ReaderPageSkeleton from './ReaderPageSkeleton';
import { useSystemUpdate } from '../../core/hooks/useSystemUpdate';

const Player = React.lazy(() => import('../../features/player/Player'));
const PluginExtensionHost = React.lazy(() => import('../pluginExtensions/PluginExtensionHost'));

type NavItem = {
  icon: React.ReactNode;
  label: string;
  path: string;
  matches?: string[];
};

// 移动端按下 tab 时的预高亮：记录目标路径和按下那一刻的 location 引用。
// location 引用一旦变化就说明导航已经发生，预高亮随之失效，
// 因此不需要在 effect 里 setState（react-hooks/set-state-in-effect），
// 也不会出现返回上一页时残留旧高亮的问题。
type PendingMobileNav = {
  path: string;
  origin: ReturnType<typeof useLocation>;
};

const Layout: React.FC = () => {
  const { t } = useTranslation();
  const { setLanguage } = useAppLanguage();
  const { applyTheme } = useTheme();
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pendingMobileNav, setPendingMobileNav] = useState<PendingMobileNav | null>(null);
  const [dismissedDefaultCredentials, setDismissedDefaultCredentials] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isMiniPlayerHidden = isMiniPlayerHiddenPath(location.pathname);

  React.useEffect(() => {
    if (location.pathname === '/bookshelf') return;
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // 底部 tab 的目标页面是懒加载的：外壳起来后把它们的 chunk 提前取回来，
  // 第一次点 tab 时锁定区就能立刻画出来，而不是先空一会儿再整页一起出现。
  React.useEffect(() => {
    const idleWindow = window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    // 页面 chunk 逐个取回，而不是一次并发四个：同时下载并解析四个 chunk 会把
    // 主线程占住一小段，恰好落在用户刚点开菜单、刚输入完的那一刻，就会觉得
    // "点了没反应"。串行 + 间隔后，预热对交互几乎无感。
    const warmers: Array<() => Promise<unknown>> = [
      () => import('../../features/bookshelf/BookshelfPage'),
      () => import('../../features/playlists/MyPlaylistsPage'),
      () => import('../../features/mine/MyPage'),
      // 播放页同样先取回来：只加载代码，不挂载、不取音频，所以不会出声；
      // 点「播放」时页面立刻能画出来，剩下的只是恢复已有进度。
      () => import('../../features/player/PlayerPage'),
    ];
    let cancelled = false;
    let timer: number | undefined;
    let index = 0;
    const next = () => {
      if (cancelled || index >= warmers.length) return;
      // 用户切走或页面不可见时先不做，别在后台抢主线程。
      if (document.visibilityState !== 'visible') {
        timer = window.setTimeout(next, 800);
        return;
      }
      void warmers[index++]().catch(() => undefined);
      timer = window.setTimeout(next, 320);
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(next, { timeout: 3000 });
      return () => {
        cancelled = true;
        if (timer !== undefined) window.clearTimeout(timer);
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    timer = window.setTimeout(next, 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // 历史栈被压平后由我们自己记路径，站内返回按钮从这里取上一页。
  React.useEffect(() => {
    rememberPath(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  // 在飞牛宿主（或触屏设备）里，从左边缘向右滑就是 WebView 的"返回"手势。
  // 站内跳转已经压成 replace（见 appHistory），历史里只剩一条，
  // 手势没有可退的页面时宿主会直接关掉窗口，和橙子音乐一致。
  React.useEffect(() => {
    const host = (window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview;
    const touchFirst = window.matchMedia('(pointer: coarse)').matches;
    if (!host && !touchFirst) return;

    const onPopState = () => {
      if (consumeInternalBack()) return;
      exitApp();
      // 退出指令没生效时（普通标签页不允许脚本关窗）至少回到原页面，
      // 不让手势把用户带到上一页。
      window.history.go(1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  
  // Use selectors to prevent unnecessary re-renders when currentTime updates
  const user = useAuthStore(state => state.user);
  const sessionRevision = useAuthStore(state => state.sessionRevision);
  const setUser = useAuthStore(state => state.setUser);
  const logout = useAuthStore(state => state.logout);
  const serverUrl = useAuthStore(state => state.serverUrl);
  const credentialReminderIdentity = `${serverUrl}:${user?.id}`;
  const hasCurrentChapter = usePlayerStore(state => !!state.currentChapter);
  const setPlaybackSpeed = usePlayerStore(state => state.setPlaybackSpeed);
  const setIsExpanded = usePlayerStore(state => state.setIsExpanded);
  const setPluginToolMenuEnabled = useUiPreferencesStore(state => state.setPluginToolMenuEnabled);
  const setBookshelfProgressEnabled = useUiPreferencesStore(state => state.setBookshelfProgressEnabled);
  const { registry: pluginExtensionRegistry } = useClientExtensions();
  const { info: updateInfo } = useSystemUpdate(user?.role === 'admin');

  // Validate Token on Mount
  React.useEffect(() => {
    const token = useAuthStore.getState().token;
    const controller = new AbortController();
    const active = () => !controller.signal.aborted
      && useAuthStore.getState().sessionRevision === sessionRevision;
    const validateConnection = async () => {
      // Only a cold start without a cached session may block the screen.
      if (!useAuthStore.getState().user) setIsConnecting(true);
      setConnectionError(null);
      try {
        if (hasSessionRestoreLogged(token)) {
          const response = await apiClient.get('/api/me', { signal: controller.signal });
          if (!active()) return;
          setUser(response.data);
        } else {
          const sessionId = getBrowserSessionId();
          const response = await apiClient.post(
            '/api/auth/session-restore',
            { session_id: sessionId },
            { headers: { 'X-Ting-Session-Id': sessionId }, signal: controller.signal },
          );
          if (!active()) return;
          setUser(response.data.user);
          markSessionRestoreLogged(useAuthStore.getState().token);
        }
        setIsConnecting(false);
      } catch (err: unknown) {
        if (!active()) return;
        console.error('Connection validation failed', err);
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) {
          // The stored token is gone server-side; the cached shell is worthless now.
          logout();
          navigate('/login');
          return;
        }
        // A network hiccup keeps the cached page instead of trapping the reader
        // behind a full-screen error. Only a session without a cache has nothing
        // to paint, and only that case needs the retry screen.
        if (!useAuthStore.getState().user) setConnectionError('connection.failedMessage');
        setIsConnecting(false);
      }
    };

    if (token) {
      void validateConnection();
      return () => controller.abort();
    } else {
      const timer = window.setTimeout(() => setIsConnecting(false), 0);
      return () => {
        controller.abort();
        window.clearTimeout(timer);
      };
    }
  }, [sessionRevision, setUser, logout, navigate]);

  // Fetch and apply user settings
  React.useEffect(() => {
    if (user && !connectionError) {
      setPluginToolMenuEnabled(true);
      setBookshelfProgressEnabled(true);
      let active = true;
      loadClientSettings().then(settings => {
        if (!active) return;
        if (settings.theme) applyTheme(settings.theme);
        const speed = settings.playback_speed;
        if (speed) {
          setPlaybackSpeed(speed);
        }
        const language = settings.language || settings.settings_json?.language;
        if (language) {
          void setLanguage(normalizeLanguage(language), false);
        }
        setPluginToolMenuEnabled(
          settings.plugin_tool_menu_enabled
            ?? settings.settings_json?.plugin_tool_menu_enabled
            ?? true,
        );
        setBookshelfProgressEnabled(settings.bookshelf_progress_enabled ?? settings.settings_json?.bookshelf_progress_enabled ?? true);
      }).catch(err => { if (active) console.error('Failed to sync user settings', err); });
      return () => { active = false; };
    }
  }, [user, setPlaybackSpeed, connectionError, setLanguage, setPluginToolMenuEnabled, setBookshelfProgressEnabled, applyTheme]);

  React.useEffect(() => {
    if (!user || connectionError) return;
    apiClient.get('/api/system/time-zone')
      .then((response) => {
        if (typeof response.data?.time_zone === 'string') {
          setApplicationTimeZone(response.data.time_zone);
        }
      })
      .catch((error) => console.error('Failed to sync application time zone', error));
  }, [user, connectionError]);
  // A phone tap can be swallowed between pointerdown and click (scroll takeover,
  // long press, rapid taps on the bottom bar). The bar highlights on pointerdown,
  // so if the click never arrives the highlight sits on a page that was never
  // opened. Navigate on the press instead, and let the fallback timer below
  // release any highlight that outlives the navigation.
  const openTab = React.useCallback((path: string) => {
    if (location.pathname === path) return;
    setPendingMobileNav({ path, origin: location });
    navigate(path, { replace: true });
  }, [location, navigate]);

  // Pre-highlight never outlives its purpose: if the navigation did not land,
  // the bar falls back to the real location instead of staying on the old page.
  React.useEffect(() => {
    if (!pendingMobileNav) return;
    const timer = window.setTimeout(() => setPendingMobileNav(null), 1200);
    return () => window.clearTimeout(timer);
  }, [pendingMobileNav]);



  const menuItems = [
    { icon: <Home size={20} />, label: t('nav.home'), path: '/' },
    { icon: <Headphones size={20} />, label: t('nav.playerPage'), path: '/player' },
    { icon: <Library size={20} />, label: t('nav.bookshelf'), path: '/bookshelf', matches: ['/bookshelf', '/book/', '/series/', '/search'] },
    { icon: <ListMusic size={20} />, label: t('nav.playlists'), path: '/playlists', matches: ['/playlists'] },
    { icon: <User size={20} />, label: t('reader.settings'), path: '/mine', matches: ['/mine', '/history', '/bookmarks', '/favorites', '/personalization', '/notifications', '/statistics', '/admin/statistics', '/cache' ] },
  ] satisfies NavItem[];

  const adminItems = [
    { icon: <Database size={20} />, label: t('nav.libraries'), path: '/admin/libraries' },
    { icon: <Puzzle size={20} />, label: t('nav.plugins'), path: '/admin/plugins' },
    { icon: <Terminal size={20} />, label: t('nav.logs'), path: '/admin/logs' },
    { icon: <Users size={20} />, label: t('nav.users'), path: '/admin/users' },
    { icon: <ArrowUpCircle size={20} />, label: t('reader.systemUpdate'), path: '/about' },
  ] satisfies NavItem[];

  const pluginPageItems = (pluginExtensionRegistry.bySlot['app.sidebar_page'] || []).map((extension) => ({
    icon: <PluginExtensionIcon extension={extension} size={20} />,
    label: extension.title || extension.pluginName || extension.capability.id,
    path: `/plugin-pages/${encodeURIComponent(extension.pluginId)}/${encodeURIComponent(extension.capability.id)}`,
  })) satisfies NavItem[];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Connection Check / Loading Screen
  if (isConnecting || connectionError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 p-4">
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 text-center space-y-6 border border-slate-200 dark:border-slate-800">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 mb-2">
            <img src={getRuntimeAssetUrl('/logo.png')} alt={t('common.logoAlt')} className="w-10 h-10 object-contain" />
          </div>
          
          {isConnecting ? (
            <>
              <h2 className="text-xl font-bold dark:text-white">{t('connection.connectingTitle')}</h2>
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
              <p className="text-sm text-slate-500">{t('connection.connectingSubtitle')}</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('connection.failedTitle')}</h2>
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/10 p-3 rounded-lg border border-red-100 dark:border-red-900/20">
                {connectionError ? t(connectionError) : null}
              </p>
              <div className="space-y-3 pt-2">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors"
                >
                  {t('common.retry')}
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full py-2.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold rounded-xl transition-colors"
                >
                  {t('nav.logout')}
                </button>
              </div>
            </>
          )}

          {isConnecting && (
            <button
              onClick={handleLogout}
              className="mt-4 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium transition-colors"
            >
              {t('connection.cancelAndLogout')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // 预高亮只在“尚未发生导航”时有效；location 引用变了就自动回落到真实路径。
  const pendingMobilePath = pendingMobileNav && pendingMobileNav.origin === location
    ? pendingMobileNav.path
    : null;


  const renderNav = (item: NavItem, mobile = false) => {
    const activePath = mobile && pendingMobilePath ? pendingMobilePath : location.pathname;
    const active = item.path === '/'
      ? activePath === '/'
      : activePath === item.path || item.matches?.some(match => activePath.startsWith(match));
    return (
      <Link key={item.path} to={item.path} title={item.label}
        aria-current={active ? 'page' : undefined}
        onPointerDown={(event) => {
          if (!mobile) return;
          event.preventDefault();
          openTab(item.path);
        }}
        onClick={(event) => {
          if (!mobile) return;
          event.preventDefault();
          openTab(item.path);
        }}
        className={(mobile ? 'reader-tab' : 'reader-nav') + (active ? ' is-active' : '')}>
        {item.icon}<span>{item.label}</span>
      </Link>
    );
  };

  // The playback page is immersive: it owns the whole viewport, so the bottom
  // navigation bar is dropped instead of floating on top of the controls.
  const isImmersivePlayer = location.pathname === '/player';

  return (
    <div className={'reader-shell' + (isImmersivePlayer ? ' is-player-view' : '')}>
      <aside className="reader-sidebar" aria-label={t('nav.mainMenu')}>
        <Link to="/" className="reader-brand">
          <img src={getRuntimeAssetUrl('/logo.png')} alt="橙子听书图标" />
          <div><strong>橙子听书</strong></div>
        </Link>
        <nav aria-label={t('nav.mainMenu')}>
          {menuItems.map(item => renderNav(item))}
          {user?.role === 'admin' && <>
            <p className="reader-nav-label">{t('nav.admin')}</p>
            {adminItems.map(item => renderNav(item))}
          </>}
          {pluginPageItems.length > 0 && <>
            <p className="reader-nav-label">{t('nav.pluginPages')}</p>
            {pluginPageItems.map(item => renderNav(item))}
          </>}
        </nav>
        {updateInfo?.update_available && <Link to="/about" className="reader-update-badge" title={t('reader.updateFound')}>
          <span>{t('reader.updateFound') + ' v' + updateInfo.latest_version}</span>
        </Link>}
        <div className="reader-account">
          <Link to="/mine" className="reader-avatar" aria-label={t('reader.settings')}>{user?.username.charAt(0).toUpperCase()}</Link>
          <span className="reader-account-name">{user?.username}</span>
          <button type="button" onClick={handleLogout} className="reader-icon-button" aria-label={t('nav.logout')} title={t('nav.logout')}><LogOut size={17} /></button>
        </div>

      </aside>
      <div className="reader-workspace">
        <main id="main-content" className={'reader-content flex flex-col' + (hasCurrentChapter && !isMiniPlayerHidden ? ' has-mini-player' : '')}>
          <Suspense fallback={<ReaderPageSkeleton />}><Outlet /></Suspense>
        </main>
        <nav className="reader-tabs" aria-label={t('nav.mainMenu')}>{menuItems.map(item => renderNav(item, true))}</nav>
        {/* The floating bar leaves a strip of raw page background under it; a soft
            fade keeps scrolling covers from looking cut off at the screen edge. */}
        <div className="reader-tabs-fade" aria-hidden="true" />
        {hasCurrentChapter && <Suspense fallback={null}><Player /></Suspense>}
        {pluginExtensionRegistry.extensions.length > 0 && !location.pathname.startsWith('/plugin-pages') && <Suspense fallback={null}><PluginExtensionHost /></Suspense>}
        {user?.role === 'admin' && user.uses_default_admin_credentials &&
          dismissedDefaultCredentials !== credentialReminderIdentity && (
            <DefaultAdminCredentialsDialog
              onLater={() => setDismissedDefaultCredentials(credentialReminderIdentity)}
              onChangeCredentials={() => {
                setDismissedDefaultCredentials(credentialReminderIdentity);
                setIsExpanded(false);
                navigate('/admin/users');
              }} />
          )}
      </div>
    </div>
  );
};

export default Layout;
