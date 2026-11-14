import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import apiClient from "../../core/api/client";
import type { Book } from "../../core/types";
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
  Settings,
  ArrowUpCircle,
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
  const currentChapter = usePlayerStore((state) => state.currentChapter);
  const [historySummary, setHistorySummary] = useState<HistorySummary>({ books: 0, chapters: 0, position_seconds: 0 });
  const [favorites, setFavorites] = useState<Book[]>([]);

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

  const listenedMinutes = Math.round(historySummary.position_seconds / 60);
  const listenedMetric = formatMinuteMetric(listenedMinutes);
  const recentBookCount = historySummary.books;
  return (
    <div className="reader-page reader-settings-page flex-1 min-h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex-1 space-y-6 max-w-5xl w-full mx-auto">
        <header className="reader-settings-title"><h1>{t('reader.settings')}</h1><p>{t('reader.tagline')}</p></header>
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
            {user?.role === "admin" && (
              <EntryItem
                to="/about"
                icon={<ArrowUpCircle size={22} />}
                title={t("reader.systemUpdate")}
                description={t("reader.systemUpdateDescription")}
                tone="text-primary-600 bg-primary-50 dark:bg-primary-900/20"
              />
            )}
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
            ? "var(--reader-playing-clearance)"
            : "var(--reader-base-clearance)",
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
