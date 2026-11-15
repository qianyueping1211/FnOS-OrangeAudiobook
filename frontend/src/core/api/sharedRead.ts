/** Coalesce concurrent reads only; never retain a response after it settles. */
export function createScopedRead<T>(read: () => Promise<T>, scope: () => string) {  const pending = new Map<string, Promise<T>>();
  return () => {
    const key = scope();
    const existing = pending.get(key);
    if (existing) return existing;
    const request = read().then(value => {
      if (scope() !== key) throw new Error('Read belongs to an obsolete session');
      return value;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    pending.set(key, request);
    return request;
  };
}

/**
 * Like createScopedRead, but a settled answer is reused for a short window. The
 * shell asks for the same settings from several places during one navigation
 * (layout, player, shelf); without this each of them opened its own request.
 * Failures are dropped immediately so a retry is never blocked by a bad answer.
 */
export function createScopedMemo<T>(read: () => Promise<T>, scope: () => string, ttlMs = 15000) {
  const entries = new Map<string, { at: number; promise: Promise<T> }>();
  return () => {
    const key = scope();
    const entry = entries.get(key);
    if (entry && Date.now() - entry.at <= ttlMs) return entry.promise;
    const record = { at: Date.now(), promise: read() };
    entries.set(key, record);
    record.promise.catch(() => {
      if (entries.get(key) === record) entries.delete(key);
    });
    return record.promise;
  };
}
