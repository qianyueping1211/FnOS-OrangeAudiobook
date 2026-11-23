import { create } from "zustand";
import { safeStorage } from "../utils/storage";

const sidebarCollapsedStorageKey = "ui.sidebar_collapsed.v1";
const onlineBooksStorageKey = "ui.online_books_enabled.v1";

type UiPreferencesStore = {
  sidebarCollapsed: boolean;
  pluginToolMenuEnabled: boolean;
  bookshelfProgressEnabled: boolean;
  /** 在线书籍总开关。以账号设置为准、各设备同步，本机只留一份作为启动时的缓存。关闭后不检索、也不显示任何在线书。 */
  onlineBooksEnabled: boolean;
  /** 在线书源对应的托管库 id，只在开关关闭时用来识别并隐藏在线书。 */
  sourceLibraryIds: string[];
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setPluginToolMenuEnabled: (enabled: boolean) => void;
  setBookshelfProgressEnabled: (enabled: boolean) => void;
  setOnlineBooksEnabled: (enabled: boolean) => void;
  setSourceLibraryIds: (ids: string[]) => void;
};

export const useUiPreferencesStore = create<UiPreferencesStore>((set, get) => ({
  sidebarCollapsed:
    safeStorage.getItem(sidebarCollapsedStorageKey) === "true",
  pluginToolMenuEnabled: true,
  bookshelfProgressEnabled: true,
  onlineBooksEnabled: safeStorage.getItem(onlineBooksStorageKey) !== "false",
  sourceLibraryIds: [],
  setSidebarCollapsed: (collapsed) => {
    safeStorage.setItem(sidebarCollapsedStorageKey, String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebarCollapsed: () => {
    const collapsed = !get().sidebarCollapsed;
    safeStorage.setItem(sidebarCollapsedStorageKey, String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },
  setPluginToolMenuEnabled: (enabled) =>
    set({ pluginToolMenuEnabled: enabled }),
  setBookshelfProgressEnabled: (enabled) =>
    set({ bookshelfProgressEnabled: enabled }),
  setOnlineBooksEnabled: (enabled) => {
    safeStorage.setItem(onlineBooksStorageKey, String(enabled));
    set({ onlineBooksEnabled: enabled });
  },
  setSourceLibraryIds: (ids) => set({ sourceLibraryIds: ids }),
}));
