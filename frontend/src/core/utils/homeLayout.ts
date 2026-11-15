import { safeStorage } from './storage';

export type HomeLayoutSettings = {
  showHero: boolean;
  showStats: boolean;
  showRecommended: boolean;
  showRecent: boolean;
  showRecentlyAdded: boolean;
  showCollections: boolean;
};

export const DEFAULT_HOME_LAYOUT: HomeLayoutSettings = {
  showHero: true,
  showStats: true,
  showRecommended: true,
  showRecent: true,
  showRecentlyAdded: true,
  showCollections: true,
};

export const normalizeHomeLayout = (value: unknown): HomeLayoutSettings => {
  const source = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};

  return {
    showHero: typeof source.show_hero === 'boolean' ? source.show_hero : DEFAULT_HOME_LAYOUT.showHero,
    showStats: typeof source.show_stats === 'boolean' ? source.show_stats : DEFAULT_HOME_LAYOUT.showStats,
    showRecommended: typeof source.show_recommended === 'boolean' ? source.show_recommended : DEFAULT_HOME_LAYOUT.showRecommended,
    showRecent: typeof source.show_recent === 'boolean' ? source.show_recent : DEFAULT_HOME_LAYOUT.showRecent,
    showRecentlyAdded: typeof source.show_recently_added === 'boolean' ? source.show_recently_added : DEFAULT_HOME_LAYOUT.showRecentlyAdded,
    showCollections: typeof source.show_collections === 'boolean' ? source.show_collections : DEFAULT_HOME_LAYOUT.showCollections,
  };
};

export const serializeHomeLayout = (value: HomeLayoutSettings) => ({
  show_hero: value.showHero,
  show_stats: value.showStats,
  show_recommended: value.showRecommended,
  show_recent: value.showRecent,
  show_recently_added: value.showRecentlyAdded,
  show_collections: value.showCollections,
});

// The first frame cannot wait for /api/settings, so the last layout this device
// settled on is remembered locally. Without it the home page painted every section
// at the defaults and then yanked the ones the reader had switched off - a
// flash of "recently added" that vanished a moment later.
const HOME_LAYOUT_CACHE_KEY = 'home_layout_cache';

export const readCachedHomeLayout = (): HomeLayoutSettings | null => {
  const raw = safeStorage.getItem(HOME_LAYOUT_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return normalizeHomeLayout(parsed);
  } catch {
    // A corrupted cache must never keep the page from painting.
  }
  return null;
};

export const cacheHomeLayout = (value: HomeLayoutSettings) => {
  safeStorage.setItem(HOME_LAYOUT_CACHE_KEY, JSON.stringify(serializeHomeLayout(value)));
};
