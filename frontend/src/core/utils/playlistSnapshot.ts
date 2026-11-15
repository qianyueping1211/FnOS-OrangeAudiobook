import type { Playlist } from '../types';

// Opening a playlist used to show a blank spinner until the detail request
// came back. The list page already holds the whole playlist, so keep a one-item
// snapshot in sessionStorage and let the detail page paint it immediately while
// the authoritative copy refreshes in the background.
const KEY_PREFIX = 'playlist-snapshot:';
const MAX_SNAPSHOTS = 3;

const storage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const snapshotKeys = (store: Storage): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key && key.startsWith(KEY_PREFIX)) keys.push(key);
  }
  return keys;
};

export const cachePlaylistSnapshot = (playlist: Playlist): void => {
  const store = storage();
  if (!store || !playlist?.id) return;
  try {
    store.setItem(KEY_PREFIX + playlist.id, JSON.stringify(playlist));
    // Only the playlists opened recently matter; drop the rest so a long
    // session cannot grow this cache without bound.
    const keys = snapshotKeys(store).filter(key => key !== KEY_PREFIX + playlist.id);
    keys.slice(0, Math.max(0, keys.length - (MAX_SNAPSHOTS - 1))).forEach(key => store.removeItem(key));
  } catch {
    // Private mode or a full quota: the prefetch is best effort.
  }
};

export const readPlaylistSnapshot = (id?: string): Playlist | null => {
  const store = storage();
  if (!store || !id) return null;
  try {
    const raw = store.getItem(KEY_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Playlist;
    return parsed && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
};
