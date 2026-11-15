import { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

const hourlyChecks = new Map<string, number>();

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
        if (data.has_token && Date.now() / 1000 - (data.checked_at || 0) >= 3600
          && Date.now() - (hourlyChecks.get(identity) || 0) >= 3600_000) {
          if (hourlyChecks.size > 20) hourlyChecks.clear();
          hourlyChecks.set(identity, Date.now());
          const result = await apiClient.post<UpdateInfo>('/api/system/updates/check', {}, { signal: controller.signal });
          if (!controller.signal.aborted) setInfo(result.data);
        }
      } catch { /* Manual checks surface errors in the update panel. */ }
    };
    const changed = () => { void refresh(controller.signal).catch(() => {}); };
    // The hourly re-check reaches the public release API. Launching it right at
    // startup stole a connection (and a backend worker) from the first paint,
    // so the first check now waits for the shell to settle.
    const kickoff = window.setTimeout(() => { void check(); }, 8000);
    const timer = window.setInterval(check, 3600_000);
    window.addEventListener('ting-updates-changed', changed);
    return () => {
      controller.abort();
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      window.removeEventListener('ting-updates-changed', changed);
    };
  }, [enabled, identity, refresh]);
  return { info: enabled ? info : null, refresh, setInfo };
}
