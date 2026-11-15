// The hero paints "樊登：孔子传" straight from the listening history, but the
// history row only carries the book id, the title and the cover. Remembering
// the narrator this device last saw for that book keeps the headline whole on
// the very first frame, instead of the name appearing a moment after the title
// and shoving the line sideways.
const KEY = 'ting-reader.hero-credit.v1';
// Only the books this reader actually resumes are worth keeping; a small cap
// stops the map from growing with the whole library.
const LIMIT = 40;

type CreditMap = Record<string, string>;

const readMap = (): CreditMap => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const map: CreditMap = {};
    for (const [bookId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) map[bookId] = value;
    }
    return map;
  } catch {
    return {};
  }
};

export const readHeroCredit = (bookId?: string | null): string | undefined => {
  if (!bookId) return undefined;
  return readMap()[bookId];
};

export const rememberHeroCredit = (bookId?: string | null, narrator?: string | null) => {
  if (!bookId || !narrator) return;
  const name = narrator.trim();
  if (!name) return;
  const map = readMap();
  if (map[bookId] === name) return;
  const next: CreditMap = { ...map, [bookId]: name };
  const keys = Object.keys(next);
  if (keys.length > LIMIT) {
    for (const key of keys.slice(0, keys.length - LIMIT)) delete next[key];
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the name simply reappears when the book loads.
  }
};
