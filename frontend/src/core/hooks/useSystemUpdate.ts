import { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

const hourlyChecks = new Map<string, number>();

// 顶栏角标和设置里的更新面板各自开一份 hook。缓存让「点进系统更新」时先有内容
// 再刷新，也避免同一刻发两次 status 请求（后端每次都要起一个 sudo 子进程）。
const cachedInfo = new Map<string, UpdateInfo>();
const inFlight = new Map<string, Promise<UpdateInfo>>();
const STORAGE_PREFIX = 'ting-update-info:';

const storageKey = (identity: string) => STORAGE_PREFIX + identity;

const readCache = (identity: string): UpdateInfo | null => {
  const remembered = cachedInfo.get(identity);
  if (remembered) return remembered;
  try {
    const raw = window.sessionStorage.getItem(storageKey(identity));
    if (!raw) return null;
    const value = JSON.parse(raw) as UpdateInfo;
    cachedInfo.set(identity, value);
    return value;
  } catch {
    return null;
  }
};

const writeCache = (identity: string, value: UpdateInfo) => {
  cachedInfo.set(identity, value);
  try {
    window.sessionStorage.setItem(storageKey(identity), JSON.stringify(value));
  } catch {
    // 存储不可用时只用内存缓存，不影响功能。
  }
};

export type UpdateInfo = {
  current_version: string;
  latest_version?: string;
  tag?: string;
  notes?: string;
  published?: string;
  checked_at?: number;
  has_token: boolean;
  update_available: boolean;
  installer: { network?: string; state: string; message?: string; progress?: number; version?: string };
};

export const notifyUpdateChanged = () => window.dispatchEvent(new Event('ting-updates-changed'));

type Entry = { identity: string; value: UpdateInfo };

export function useSystemUpdate(enabled: boolean, deferMs = 8000) {
  const identity = useAuthStore(state => state.serverUrl + ':' + state.user?.id);
  // 读缓存发生在渲染里而不是 effect 里：换用户或首次进页面都能立刻拿到内容。
  const [entry, setEntry] = useState<Entry | null>(() => {
    const remembered = enabled ? readCache(identity) : null;
    return remembered ? { identity, value: remembered } : null;
  });
  const info = enabled ? (entry?.identity === identity ? entry.value : readCache(identity)) : null;
  const commit = useCallback((value: UpdateInfo) => {
    writeCache(identity, value);
    setEntry({ identity, value });
  }, [identity]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    let pending = inFlight.get(identity);
    if (!pending) {
      pending = apiClient.get<UpdateInfo>('/api/system/updates', { signal })
        .then(result => result.data)
        .finally(() => { inFlight.delete(identity); });
      inFlight.set(identity, pending);
    }
    const data = await pending;
    commit(data);
    return data;
  }, [identity, commit]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const data = await refresh(controller.signal);
        if (data.has_token && Date.now() / 1000 - (data.checked_at || 0) >= 3600
          && Date.now() - (hourlyChecks.get(identity) || 0) >= 3600_000) {
          if (hourlyChecks.size > 20) hourlyChecks.clear();
          hourlyChecks.set(identity, Date.now());
          const result = await apiClient.post<UpdateInfo>('/api/system/updates/check', {}, { signal: controller.signal });
          if (!controller.signal.aborted) commit(result.data);
        }
      } catch { /* Manual checks surface errors in the update panel. */ }
    };
    const changed = () => { void refresh(controller.signal).catch(() => {}); };
    // 顶栏只要一个角标，第一个请求没必要抢首页首屏的连接，等外壳落定再发；
    // 设置里的更新面板传 0，进去就立刻拿真实状态。
    const kickoff = window.setTimeout(() => { void check(); }, Math.max(0, deferMs));
    const timer = window.setInterval(check, 3600_000);
    window.addEventListener('ting-updates-changed', changed);
    return () => {
      controller.abort();
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      window.removeEventListener('ting-updates-changed', changed);
    };
  }, [enabled, identity, refresh, commit, deferMs]);
  return { info, refresh, setInfo: commit };
}
