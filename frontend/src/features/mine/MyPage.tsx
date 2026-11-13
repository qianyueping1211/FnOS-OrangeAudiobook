import { apiErrorMessage } from '../../core/api/errors';
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import apiClient from "../../core/api/client";
import type { Book, User as UserInfo } from "../../core/types";
import type { HistorySummary } from "../../core/api/reading";
import { useAuthStore } from "../../core/stores/authStore";
import { usePlayerStore } from "../../core/stores/playerStore";
import { formatMinuteMetric } from "../../core/utils/duration";
import {
  ChevronRight,
  BarChart3,
  BookMarked,
  Download,
  Heart,
  History,
  LogOut,
  Save,
  Settings,
  User,
} from "lucide-react";

import { useClientExtensions } from '../../core/hooks/useClientExtensions';
import PluginExtensionIcon from '../../shared/pluginExtensions/PluginExtensionIcon';

const MyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore(state => state.logout);
  const { registry } = useClientExtensions();
  const pluginPages = registry.bySlot['app.sidebar_page'] || [];
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const currentChapter = usePlayerStore((state) => state.currentChapter);
  const [historySummary, setHistorySummary] = useState<HistorySummary>({ books: 0, chapters: 0, position_seconds: 0 });
  const [favorites, setFavorites] = useState<Book[]>([]);
  const [accountData, setAccountData] = useState({
    username: user?.username || "",
  });
  const [accountSaved, setAccountSaved] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const [recentRes, favoritesRes] =
        await Promise.allSettled([
          apiClient.get<HistorySummary>("/api/history/summary"),
          apiClient.get("/api/favorites"),
        ]);

      if (recentRes.status === "fulfilled") {
        setHistorySummary(recentRes.value.data);
      }
      if (favoritesRes.status === "fulfilled") {
        setFavorites(favoritesRes.value.data || []);
      }
    };

    fetchData();
    window.addEventListener("focus", fetchData);
    return () => window.removeEventListener("focus", fetchData);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountData((current) => ({
      ...current,
      username: user?.username || "",
    }));
  }, [user?.username]);

  const listenedMinutes = Math.round(historySummary.position_seconds / 60);
  const listenedMetric = formatMinuteMetric(listenedMinutes);
  const recentBookCount = historySummary.books;
  const userInitial = user?.username?.charAt(0).toUpperCase() || "U";

  const handleAccountUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextUsername = accountData.username.trim();

    if (!nextUsername) {
      alert(t("mine.usernameRequired"));
      return;
    }

    try {
      const updateData: Record<string, string> = {};
      if (nextUsername !== user?.username) {
        updateData.username = nextUsername;
      }

      if (Object.keys(updateData).length > 0) {
        const response = await apiClient.patch<UserInfo>("/api/me", updateData);
        setUser({ ...user, ...response.data });
      }

      setAccountData({ username: nextUsername });
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 1800);
    } catch (err: unknown) {
      const message =
        apiErrorMessage(err, t("mine.updateFailed"));
      alert(message);
    }
  };

  return (
    <div className="reader-page flex-1 min-h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex-1 space-y-6 max-w-5xl w-full mx-auto">
        <header className="reader-settings-title"><h1>{t('reader.settings')}</h1><p>{t('reader.tagline')}</p></header>
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 dark:bg-primary-900/30 text-primary-600 flex items-center justify-center text-2xl font-bold shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("nav.mine")}
              </p>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">
                {user?.username || t("mine.defaultUser")}
              </h2>
              <p className="text-sm text-slate-500 mt-1">{t("mine.intro")}</p>
            </div>
          </div>

          <form
            onSubmit={handleAccountUpdate}
            className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end"
          >
            <label className="block min-w-0">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {t("auth.username")}
              </span>
              <div className="relative mt-1.5">
                <User
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={17}
                />
                <input
                  type="text"
                  value={accountData.username}
                  onChange={(event) =>
                    setAccountData({
                      ...accountData,
                      username: event.target.value,
                    })
                  }
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white text-sm"
                />
              </div>
            </label>

            <div className="flex items-center gap-3">
              {accountSaved && (
                <span className="text-sm text-green-600 font-bold whitespace-nowrap">
                  {t("mine.accountUpdated")}
                </span>
              )}
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-500/20 transition-colors text-sm whitespace-nowrap"
              >
                <Save size={16} />
                {t("mine.save")}
              </button>
            </div>
          </form>


        </section>

        <section className="space-y-3">
          <SectionHeader title={t("mine.myContent")} />
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <EntryItem
              to="/history"
              icon={<History size={22} />}
              title={t("mine.historyTitle")}
              description={
                historySummary.chapters > 0
                  ? t("mine.historyDescription", {
                      books: recentBookCount,
                      chapters: historySummary.chapters,
                      durationValue: listenedMetric.value,
                      durationUnit: t(`mine.${listenedMetric.unit}Unit`),
                    })
                  : t("mine.historyEmptyDescription")
              }
              tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20"
            />
            <EntryItem
              to="/bookmarks"
              icon={<BookMarked size={22} />}
              title={t("bookmarks.title", "我的书签")}
              description={t("bookmarks.subtitle", "按书籍查看保存的位置和备注")}
              tone="text-amber-600 bg-amber-50 dark:bg-amber-900/20"
            />
            <EntryItem
              to="/favorites"
              icon={<Heart size={22} />}
              title={t("mine.favoritesTitle")}
              description={t("mine.favoritesDescription", {
                count: favorites.length,
              })}
              tone="text-red-500 bg-red-50 dark:bg-red-900/20"
            />
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader title={t("mine.settingsManagement")} />
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <EntryItem
              to="/personalization"
              icon={<Settings size={22} />}
              title={t("settings.title")}
              description={t("mine.personalizationDescription")}
              tone="text-blue-600 bg-blue-50 dark:bg-blue-900/20"
            />
            {user?.role === "admin" && (
              <EntryItem
                to="/cache"
                icon={<Download size={22} />}
                title={t("downloadsPage.title")}
                description={t("mine.cacheManagementDescription")}
                tone="text-sky-600 bg-sky-50 dark:bg-sky-900/20"
              />
            )}
            {user?.role === "admin" && (
              <EntryItem
                to="/statistics"
                icon={<BarChart3 size={22} />}
                title={t("mine.statisticsTitle")}
                description={t("mine.statisticsDescription")}
                tone="text-violet-600 bg-violet-50 dark:bg-violet-900/20"
              />
            )}
          </div>
        </section>

        {pluginPages.length > 0 && <section className="space-y-3">
          <SectionHeader title={t('nav.pluginPages')} />
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl overflow-hidden">
            {pluginPages.map(extension => <EntryItem key={extension.pluginId + ':' + extension.capability.id}
              to={'/plugin-pages/' + encodeURIComponent(extension.pluginId) + '/' + encodeURIComponent(extension.capability.id)}
              icon={<PluginExtensionIcon extension={extension} size={22} />} title={extension.title || extension.pluginName || extension.capability.id}
              description={t('nav.pluginPages')} tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20" />)}
          </div>
        </section>}
        <button className="reader-button w-full" type="button" onClick={() => { logout(); navigate('/login'); }}><LogOut size={17} />{t('reader.signOut')}</button>


      </div>

      <div
        className="shrink-0 transition-all duration-300"
        style={{
          height: currentChapter
            ? "var(--safe-bottom-with-player)"
            : "var(--safe-bottom-base)",
        }}
      />
    </div>
  );
};

const SectionHeader = ({ title }: { title: string }) => (
  <h2 className="px-1 text-sm font-black text-slate-500 dark:text-slate-400">
    {title}
  </h2>
);

const EntryItem = ({
  to,
  icon,
  title,
  description,
  tone,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: string;
}) => (
  <Link
    to={to}
    className="flex items-center justify-between gap-4 px-4 md:px-5 py-4 border-b border-slate-100 dark:border-slate-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
  >
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tone}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-slate-900 dark:text-white truncate">
          {title}
        </p>
        <p className="text-sm text-slate-500 truncate">{description}</p>
      </div>
    </div>
    <ChevronRight size={18} className="text-slate-300 shrink-0" />
  </Link>
);

export default MyPage;
