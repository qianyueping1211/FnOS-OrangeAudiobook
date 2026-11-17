// 真接口回归 + 契约严格校验。
// 宿主用 serde(deny_unknown_fields) 反序列化插件的返回值，可空字段还要求"必须出现、可以是 null"，
// 少一个 key 就是真机上的 "missing field `x`" 红字。这里把同一套规则搬到本地，先自己过一遍。
import { search, detail, list_chapters, resolve_audio } from "file:///D:/Documents/Learn/GitHub/FnOS-OrangeAudiobook/plugins/ximalaya-book-source/plugin.js";

const STRING_NULLABLE = [
  "id", "source_url", "author", "narrator", "cover_url", "intro", "subtitle",
  "publisher", "language", "genre", "published_date", "isbn", "asin",
  "chapter_title_template",
];
const NUMBER_NULLABLE = { published_year: "u16", duration: "u64", score: "f64" };
const BOOL_NULLABLE = ["explicit", "abridged"];
const RESULT_FIELDS = [
  "title", ...STRING_NULLABLE, ...Object.keys(NUMBER_NULLABLE), ...BOOL_NULLABLE,
  "tags", "chapter_titles",
];

function fail(message) {
  throw new Error(message);
}

function assertNullable(obj, key, path, kind, byteLimit = 512) {
  if (!(key in obj)) fail(`${path}: missing field '${key}'`);
  const value = obj[key];
  if (value === null) return;
  if (kind === "string") {
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > byteLimit) {
      fail(`${path}.${key}: bad string ${JSON.stringify(value).slice(0, 120)}`);
    }
    if (/<[a-z!/]/i.test(value)) fail(`${path}.${key}: 仍带 HTML 标签`);
  } else if (kind === "bool") {
    if (typeof value !== "boolean") fail(`${path}.${key}: bad bool`);
  } else if (kind === "u16") {
    if (!Number.isInteger(value) || value < 0 || value > 65535) fail(`${path}.${key}: bad u16`);
  } else if (kind === "u64") {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${path}.${key}: bad u64`);
  } else if (kind === "f64") {
    if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${path}.${key}: bad score`);
  }
}

function assertStringArray(obj, key, path, maxItems, maxBytes) {
  if (!(key in obj)) fail(`${path}: missing field '${key}'`);
  const value = obj[key];
  if (!Array.isArray(value)) fail(`${path}.${key}: not an array`);
  if (value.length > maxItems) fail(`${path}.${key}: too many items`);
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim() || Buffer.byteLength(entry, "utf8") > maxBytes) {
      fail(`${path}.${key}: bad entry ${JSON.stringify(entry)}`);
    }
  }
}

function assertResult(result, path) {
  if (!result || typeof result !== "object") fail(`${path}: not an object`);
  for (const key of Object.keys(result)) {
    if (!RESULT_FIELDS.includes(key)) fail(`${path}: unknown field '${key}'`);
  }
  if (typeof result.title !== "string" || !result.title.trim() ||
      Buffer.byteLength(result.title, "utf8") > 512) {
    fail(`${path}: bad title`);
  }
  for (const key of STRING_NULLABLE) {
    assertNullable(result, key, path, "string", key === "intro" ? 4000 : 512);
  }
  for (const [key, kind] of Object.entries(NUMBER_NULLABLE)) assertNullable(result, key, path, kind);
  for (const key of BOOL_NULLABLE) assertNullable(result, key, path, "bool");
  assertStringArray(result, "tags", path, 64, 256);
  assertStringArray(result, "chapter_titles", path, 500, 512);
  if (result.id === null && result.source_url === null) {
    // 契约允许，但书源必须能回到源书，这里只是提示。
    console.warn(`${path}: 既无 id 也无 source_url`);
  }
}

const CHAPTER_FIELDS = ["id", "title", "index", "duration", "source_url"];

function assertChapter(chapter, path) {
  for (const key of Object.keys(chapter)) {
    if (!CHAPTER_FIELDS.includes(key)) fail(`${path}: unknown field '${key}'`);
  }
  if (typeof chapter.id !== "string" || !chapter.id.trim() ||
      Buffer.byteLength(chapter.id, "utf8") > 512) fail(`${path}: bad id`);
  if (typeof chapter.title !== "string" || !chapter.title.trim() ||
      Buffer.byteLength(chapter.title, "utf8") > 512) fail(`${path}: bad title`);
  if (!Number.isInteger(chapter.index) || chapter.index < 0) fail(`${path}: bad index`);
  assertNullable(chapter, "duration", path, "u64");
  assertNullable(chapter, "source_url", path, "string");
}

function assertPage(data, path) {
  const fields = ["items", "page", "page_size", "total", "has_more"];
  for (const key of Object.keys(data)) {
    if (!fields.includes(key)) fail(`${path}: unknown field '${key}'`);
  }
  if (!Number.isInteger(data.page) || data.page < 1) fail(`${path}: bad page`);
  if (!Number.isInteger(data.page_size) || data.page_size < 1 || data.page_size > 100) {
    fail(`${path}: bad page_size`);
  }
  if (!Array.isArray(data.items) || data.items.length > data.page_size) fail(`${path}: bad items`);
  for (const key of ["total", "has_more"]) {
    if (!(key in data)) fail(`${path}: missing field '${key}'`);
  }
  if (data.total !== null && (!Number.isSafeInteger(data.total) || data.total < 0)) {
    fail(`${path}: bad total`);
  }
  if (data.has_more !== null && typeof data.has_more !== "boolean") fail(`${path}: bad has_more`);
}

function assertOk(response, path) {
  if (!response || response.ok !== true) {
    fail(`${path}: plugin returned failure ${JSON.stringify(response?.error ?? response)}`);
  }
  return response.data;
}

const checks = [];
function step(name, fn) { checks.push({ name, fn }); }

step("search 首页", async () => {
  const data = assertOk(
    await search({ title: "论语", page: 1, page_size: 20, author: null, narrator: null, filters: {} }),
    "search",
  );
  assertPage(data, "search");
  data.items.forEach((item, index) => assertResult(item, `search.items[${index}]`));
  if (data.items.length === 0) fail("search 没有结果");
  return `items=${data.items.length} has_more=${data.has_more}`;
});

step("search 每一页", async () => {
  for (const page of [1, 2, 3]) {
    const data = assertOk(
      await search({ title: "故事", page, page_size: 30, author: null, narrator: null, filters: {} }),
      `search p${page}`,
    );
    assertPage(data, `search p${page}`);
    data.items.forEach((item, index) => assertResult(item, `search p${page}.items[${index}]`));
    if (page === 1 && data.items.length === 0) fail("search p1 没有结果");
  }
  return "3 页通过";
});

step("detail 免费长专辑", async () => {
  const data = assertOk(await detail({ id: "260744", url: null }), "detail");
  for (const key of Object.keys(data)) {
    if (!["metadata", "chapters_complete", "chapters"].includes(key)) {
      fail(`detail: unknown field '${key}'`);
    }
  }
  assertResult(data.metadata, "detail.metadata");
  if (typeof data.chapters_complete !== "boolean") fail("detail: bad chapters_complete");
  if (!Array.isArray(data.chapters)) fail("detail: chapters not array");
  data.chapters.forEach((chapter, index) => assertChapter(chapter, `detail.chapters[${index}]`));
  if (data.chapters.length === 0) fail("detail 没有章节");
  return `chapters=${data.chapters.length}`;
});

step("detail 付费专辑", async () => {
  const data = assertOk(await detail({ id: "30488059", url: null }), "detail paid");
  assertResult(data.metadata, "detail paid metadata");
  data.chapters.forEach((chapter, index) => assertChapter(chapter, `detail paid chapters[${index}]`));
  return `chapters=${data.chapters.length}`;
});

step("list_chapters 多页", async () => {
  for (const page of [1, 2, 5]) {
    const data = assertOk(
      await list_chapters({ source: { id: "260744", url: null }, page, page_size: 100 }),
      `chapters p${page}`,
    );
    assertPage(data, `chapters p${page}`);
    data.items.forEach((chapter, index) => assertChapter(chapter, `chapters p${page}.items[${index}]`));
  }
  return "3 页通过";
});

step("resolve_audio 免费章节", async () => {
  const page = assertOk(
    await list_chapters({ source: { id: "260744", url: null }, page: 1, page_size: 5 }),
    "resolve 取样",
  );
  assertPage(page, "resolve 取样");
  const chapter = page.items[0];
  if (!chapter) fail("没有可用章节");
  const data = assertOk(await resolve_audio({ chapter_id: chapter.id }), "resolve_audio");
  for (const key of Object.keys(data)) {
    if (!["type", "url", "headers", "expires_at", "seekable", "mime"].includes(key)) {
      fail(`resolve_audio: unknown field '${key}'`);
    }
  }
  if (!["proxy", "direct"].includes(data.type)) fail(`resolve_audio: bad type ${data.type}`);
  if (typeof data.url !== "string" || !data.url.startsWith("http") || data.url.length > 8192) {
    fail("resolve_audio: bad url");
  }
  if (!(data.expires_at === null || typeof data.expires_at === "string")) {
    fail("resolve_audio: bad expires_at");
  }
  if (typeof data.seekable !== "boolean") fail("resolve_audio: bad seekable");
  if (!(data.mime === null || typeof data.mime === "string")) fail("resolve_audio: bad mime");
  if (!data.headers || typeof data.headers !== "object") fail("resolve_audio: bad headers");
  const response = await fetch(data.url, { headers: { ...data.headers, Range: "bytes=0-1023" } });
  if (!response.ok && response.status !== 206 && response.status !== 200) {
    fail(`resolve_audio: 直链不可播 HTTP ${response.status}`);
  }
  const head = await response.arrayBuffer();
  if (head.byteLength === 0) fail("resolve_audio: 直链返回 0 字节");
  return `${data.mime} ${response.status} ${head.byteLength}B`;
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    console.log(`ok   ${name} :: ${await fn()}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name} :: ${error.message}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
if (failed > 0) process.exitCode = 1;
