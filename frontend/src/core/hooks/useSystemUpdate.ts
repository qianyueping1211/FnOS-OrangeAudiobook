import { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

export type UpdateInfo = {
  current_version: string;
  latest_version?: string;
  tag?: string;
  notes?: string;
  published?: string;
  checked_at?: number;
  has_token: boolean;
  update_available: boolean;
  installer: { state: string; message?: string; progress?: number; version?: string };
};

export const notifyUpdateChanged = () => window.dispatchEvent(new Event('ting-updates-changed'));

export function useSystemUpdate(enabled: boolean) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const identity = useAuthStore(state => state.serverUrl + ':' + state.user?.id);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const { data } = await apiClient.get<UpdateInfo>('/api/system/updates', { signal });
    setInfo(data);
    return data;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const data = await refresh(controller.signal);
        if (data.has_token && Date.now() / 1000 - (data.checked_at || 0) >= 3600) {
          const result = await apiClient.post<UpdateInfo>('/api/system/updates/check', {}, { signal: controller.signal });
          if (!controller.signal.aborted) setInfo(result.data);
        }
      } catch { /* Manual checks surface errors in the update panel. */ }
    };
    const changed = () => { void refresh(controller.signal).catch(() => {}); };
    void check();
    const timer = window.setInterval(check, 3600_000);
    window.addEventListener('ting-updates-changed', changed);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('ting-updates-changed', changed); };
  }, [enabled, identity, refresh]);
  return { info: enabled ? info : null, refresh, setInfo };
}
