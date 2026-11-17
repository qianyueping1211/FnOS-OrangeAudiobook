import { useCallback, useEffect } from "react";
import apiClient from "../api/client";
import { useUiPreferencesStore } from "../stores/uiPreferencesStore";

type MaybeOnline = { library_type?: string; library_id?: string | null };

let loadingIds = false;

/** 读出在线书源的托管库 id；只在「在线书籍」关闭时才需要。 */
export const loadSourceLibraryIds = async (): Promise<void> => {
  if (loadingIds) return;
  loadingIds = true;
  try {
    const { data } = await apiClient.get<{ id: string; library_type: string }[]>("/api/libraries");
    useUiPreferencesStore
      .getState()
      .setSourceLibraryIds((data || []).filter((library) => library.library_type === "source").map((library) => library.id));
  } catch {
    // 读不到就保持原样，下一次打开页面再试。
  } finally {
    loadingIds = false;
  }
};

/** 开关关闭时，这条记录是不是在线书（不该显示）。非组件代码里用它。 */
export const isOnlineBookHidden = (item: MaybeOnline | null | undefined): boolean => {
  if (!item) return false;
  const { onlineBooksEnabled, sourceLibraryIds } = useUiPreferencesStore.getState();
  if (onlineBooksEnabled) return false;
  return item.library_type === "source" || (!!item.library_id && sourceLibraryIds.includes(item.library_id));
};

/** 组件里用：返回一个“这条要不要藏起来”的判断函数，开关或库列表变化时会更新。 */
export const useOnlineBookFilter = (): ((item: MaybeOnline | null | undefined) => boolean) => {
  const enabled = useUiPreferencesStore((state) => state.onlineBooksEnabled);
  const ids = useUiPreferencesStore((state) => state.sourceLibraryIds);
  useEffect(() => {
    if (!enabled) void loadSourceLibraryIds();
  }, [enabled]);
  return useCallback(
    (item) => {
      if (!item || enabled) return false;
      return item.library_type === "source" || (!!item.library_id && ids.includes(item.library_id));
    },
    [enabled, ids],
  );
};
