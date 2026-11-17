// 这个插件用到的 SDK 片段，取自 Ting Reader 的 embedded_sdk.mjs（协议 2.0.4）。
// 只保留书源需要的部分，插件包内自带，不依赖宿主的全局对象。

// 契约里 ScraperResult 的可空字段都是"必须出现、可以是 null"，
// 少一个 key 宿主就会报 missing field。搜索和详情共用这一份清单。
const NULLABLE_FIELDS = [
  "id", "source_url", "author", "narrator", "cover_url", "intro",
  "subtitle", "publisher", "language", "genre", "published_year",
  "published_date", "isbn", "asin", "explicit", "abridged", "duration",
  "score", "chapter_title_template",
];
const TRIMMED_FIELDS = [
  "id", "source_url", "author", "narrator", "cover_url", "intro",
  "subtitle", "publisher", "language", "genre", "published_date",
  "isbn", "asin", "chapter_title_template",
];

function publishResult(source) {
  if (!source || typeof source.title !== "string" || !source.title.trim()) {
    throw new TypeError("Book source result requires a title");
  }
  const item = { title: source.title.trim() };
  for (const field of NULLABLE_FIELDS) {
    item[field] = source[field] ?? null;
  }
  for (const field of TRIMMED_FIELDS) {
    if (typeof item[field] === "string") item[field] = item[field].trim() || null;
  }
  item.tags = Array.isArray(source.tags) ? [...new Set(source.tags
    .filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
  item.chapter_titles = Array.isArray(source.chapter_titles) ? source.chapter_titles : [];
  return item;
}

// 搜索解析结果转成宿主能接受的 SearchPage：可空字段显式为 null，未知数组为 []。
export function publishSearch(parsed, request) {
  if (!parsed || !Array.isArray(parsed.items) ||
      !Number.isInteger(request?.page) || request.page < 1 ||
      !Number.isInteger(request?.page_size) || request.page_size < 1 || request.page_size > 100) {
    throw new TypeError("Invalid metadata search page");
  }
  const items = parsed.items.slice(0, request.page_size).map(publishResult);
  return {
    items,
    page: request.page,
    page_size: request.page_size,
    total: Number.isSafeInteger(parsed.total) && parsed.total >= 0 ? parsed.total : null,
    has_more: parsed.has_more === true || parsed.has_more === false
      ? parsed.has_more : null,
  };
}

// 详情里的 metadata 和搜索结果同构，宿主用同一份结构校验，所以也走一次补齐。
export function publishDetailMetadata(source) {
  return publishResult(source);
}

export function success(data) { return { ok: true, data }; }

export function failure(code, message, context) {
  return { ok: false, error: {
    code, message, details: null, retryable: false,
    plugin_id: context.plugin_id, capability_id: context.capability_id,
    operation: context.operation, request_id: context.request_id,
  } };
}
