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

import DefaultAdminCredentialsDialog from '../../features/auth/DefaultAdminCredentialsDialog';
import { isMiniPlayerHiddenPath } from '../../features/player/platform';
import PluginExtensionIcon from '../pluginExtensions/PluginExtensionIcon';
import LoadingSpinner from '../ui/LoadingSpinner';
import { useSystemUpdate } from '../../core/hooks/useSystemUpdate';

const Player = React.lazy(() => import('../../features/player/Player'));
const PluginExtensionHost = React.lazy(() => import('../pluginExtensions/PluginExtensionHost'));

type NavItem = {
  icon: React.ReactNode;
  label: string;
  path: string;
  matches?: string[];
};

const Layout: React.FC = () => {
  const { t } = useTranslation();
  const { setLanguage } = useAppLanguage();
  const { applyTheme } = useTheme();
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [dismissedDefaultCredentials, setDismissedDefaultCredentials] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isMiniPlayerHidden = isMiniPlayerHiddenPath(location.pathname);
  
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
      setIsConnecting(true);
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
        // Don't auto-logout immediately, give user a chance to see error or retry
        setConnectionError('connection.failedMessage');
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
  }, [sessionRevision, setUser]);

  // Fetch and apply user settings
  React.useEffect(() => {
    if (user && !isConnecting && !connectionError) {
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
  }, [user, setPlaybackSpeed, isConnecting, connectionError, setLanguage, setPluginToolMenuEnabled, setBookshelfProgressEnabled, applyTheme]);

  React.useEffect(() => {
    if (!user || isConnecting || connectionError) return;
    apiClient.get('/api/system/time-zone')
      .then((response) => {
        if (typeof response.data?.time_zone === 'string') {
          setApplicationTimeZone(response.data.time_zone);
        }
      })
      .catch((error) => console.error('Failed to sync application time zone', error));
  }, [user, isConnecting, connectionError]);


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

  const renderNav = (item: NavItem, mobile = false) => {
    const active = item.path === '/'
      ? location.pathname === '/'
      : location.pathname === item.path || item.matches?.some(match => location.pathname.startsWith(match));
    return (
      <Link key={item.path} to={item.path} title={item.label}
        aria-current={active ? 'page' : undefined}
        className={(mobile ? 'reader-tab' : 'reader-nav') + (active ? ' is-active' : '')}>
        {item.icon}<span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="reader-shell">
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
        <main id="main-content" className={'reader-content flex flex-col' + (hasCurrentChapter && !isMiniPlayerHidden ? ' has-mini-player' : '')}
          style={{ '--safe-bottom-with-player': '0px', '--safe-bottom-base': '0px' } as React.CSSProperties}>
          <Suspense fallback={<LoadingSpinner className="min-h-48" />}><Outlet /></Suspense>
        </main>
        <nav className="reader-tabs" aria-label={t('nav.mainMenu')}>{menuItems.map(item => renderNav(item, true))}</nav>
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
