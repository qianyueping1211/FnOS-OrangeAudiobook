import apiClient from './client';
import { useAuthStore } from '../stores/authStore';
import { createScopedMemo } from './sharedRead';

export type ClientSettings = {
  theme?: 'light' | 'dark' | 'system'; language?: string; playback_speed?: number; auto_preload?: boolean;
  plugin_tool_menu_enabled?: boolean; bookshelf_progress_enabled?: boolean; online_books_enabled?: boolean; home_layout?: unknown;
  settings_json?: {
    language?: string; home_layout?: unknown; bookshelf_cover_shape?: string; bookshelf_icon_size?: string;
    plugin_tool_menu_enabled?: boolean; bookshelf_progress_enabled?: boolean; online_books_enabled?: boolean;
  };
};
// One request serves the whole shell for the next few seconds: the layout, the
// player and the shelf all read the same payload right after a navigation.
export const loadClientSettings = createScopedMemo(
  async () => (await apiClient.get<ClientSettings>('/api/settings')).data,
  () => { const state = useAuthStore.getState(); return JSON.stringify([state.activeUrl, state.token, state.sessionRevision]); },
  15000,
);
