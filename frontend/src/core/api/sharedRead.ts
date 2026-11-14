/** Coalesce concurrent reads only; never retain a response after it settles. */
export function createScopedRead<T>(read: () => Promise<T>, scope: () => string) {
  const pending = new Map<string, Promise<T>>();
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
