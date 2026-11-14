import apiClient from './client';
import { useAuthStore } from '../stores/authStore';
import { createScopedRead } from './sharedRead';

export type ClientSettings = {
  theme?: 'light' | 'dark' | 'system'; language?: string; playback_speed?: number;
  plugin_tool_menu_enabled?: boolean; bookshelf_progress_enabled?: boolean; home_layout?: unknown;
  settings_json?: {
    language?: string; home_layout?: unknown; bookshelf_cover_shape?: string; bookshelf_icon_size?: string;
    plugin_tool_menu_enabled?: boolean; bookshelf_progress_enabled?: boolean;
  };
};
export const loadClientSettings = createScopedRead(
  async () => (await apiClient.get<ClientSettings>('/api/settings')).data,
  () => { const state = useAuthStore.getState(); return JSON.stringify([state.activeUrl, state.token, state.sessionRevision]); },
);
