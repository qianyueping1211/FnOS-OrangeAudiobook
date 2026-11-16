const parts = (version?: string): number[] => {
  const text = (version || '').trim().replace(/^v/i, '');
  // 只有纯数字段才算版本；"unknown"、空串之类一律当作没有版本，免得被比成 0。
  if (!/^\d+(\.\d+)*$/.test(text)) return [];
  return text.split('.').map(part => Number.parseInt(part, 10));
};

/**
 * candidate 是否比 base 新：逐段数字比较，缺位按 0。
 * 用来判断「装好的版本」是否真的比我正在跑的前端新，从而决定要不要提示重新载入。
 */
export const isNewerVersion = (candidate?: string, base?: string): boolean => {
  const left = parts(candidate);
  const right = parts(base);
  if (!left.length || !right.length) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
};
