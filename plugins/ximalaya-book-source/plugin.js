// 喜马拉雅书源：搜索、专辑详情、章节列表和播放地址解析。
// 全部使用公开接口：搜索走 search.ximalaya.com，详情走 www.ximalaya.com 的 revision 接口，
// 章节走 mobile.ximalaya.com 的专辑接口；播放地址是加密的，用 aes-ecb.js 就地解密。
// 免费章节不登录也能听；会员或已购买的内容由源站接口自行判定，插件不做任何绕过。

import { success, publishSearch, publishDetailMetadata } from "./sdk.mjs";
import { decryptAes128EcbBase64 } from "./aes-ecb.js";

const WEB = "https://www.ximalaya.com";
// 网页播放器里公开的播放地址解密密钥（AES-128，32 个十六进制字符）。
const PLAY_KEY = "aaad3e4fd540b0f79dca95606e72bf93";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const MAX_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 20000;

async function getJson(url) {
  let timer = null;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: WEB + "/",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`喜马拉雅接口返回 HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("喜马拉雅接口请求超时");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function trimmed(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function coverUrl(raw) {
  const value = trimmed(raw);
  if (!value) return null;
  let url = value.startsWith("//") ? "https:" + value : value.replace(/^http:/, "https:");
  // 去掉源站自带的图片处理参数，统一要 290×290 的方图。
  url = url.split("!")[0];
  return `${url}!op_type=3&columns=290&rows=290`;
}

function finishedLabel(value) {
  return String(value) === "2" ? "完结" : "连载";
}

const HTML_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", middot: "\u00b7",
  bull: "\u2022", times: "\u00d7", ensp: " ", emsp: " ", thinsp: " ",
};

// 源站简介是编辑器导出的 HTML，直接塞给宿主会满屏标签，先压成纯文本。
function htmlToText(value) {
  let text = trimmed(value);
  if (!text) return "";
  if (!/[<&]/.test(text)) return text.replace(/\s+/g, " ");
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  text = text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point) : match;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? match;
  });
  return text
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function introText(value, max = 800) {
  const text = htmlToText(value).replace(/\n+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function albumIdOf(input) {
  const direct = trimmed(input && (input.id || input.book_id));
  const digits = /(\d{4,})/.exec(direct);
  if (digits) return digits[1];
  const fromUrl = albumIdFromUrl(trimmed(input && input.url));
  if (fromUrl) return fromUrl;
  throw new Error("没有拿到喜马拉雅专辑 ID");
}

function albumIdFromUrl(url) {
  const match = /album\/(\d+)/.exec(url || "");
  return match ? match[1] : "";
}

function chapterFromTrack(track, index) {
  const trackId = trimmed(track && track.trackId);
  if (!trackId) return null;
  const duration = Number(track.duration);
  return {
    id: trackId,
    title: trimmed(track.title) || `第 ${index + 1} 集`,
    index,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    source_url: `${WEB}/sound/${trackId}`,
  };
}

/**
 * 章节列表：主接口用 mobile/v1/album/track（正序），返回 list 与 maxPageId。
 * 主接口对少数专辑会报“已下架”，这时退到 others/ca 接口再取一次。
 */
async function fetchTrackPage(albumId, page, pageSize) {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const main = await getJson(
    `https://mobile.ximalaya.com/mobile/v1/album/track?albumId=${albumId}` +
      `&pageId=${page}&pageSize=${size}&isAsc=false&device=android`,
  );
  const mainData = (main && main.data) || {};
  const mainList = Array.isArray(mainData.list) ? mainData.list : [];
  if (Number(main && main.ret) === 0 && (mainList.length > 0 || page > 1)) {
    return {
      tracks: mainList,
      maxPage: Math.max(page, Number(mainData.maxPageId) || page),
      total: Number(mainData.totalCount) || 0,
    };
  }

  const backup = await getJson(
    `https://mobile.ximalaya.com/mobile/others/ca/album/track/${albumId}/false/${page}/${size}`,
  );
  const backupList =
    backup && backup.tracks && Array.isArray(backup.tracks.list) ? backup.tracks.list : [];
  if (!backupList.length && page === 1) {
    throw new Error(
      `喜马拉雅没有返回这个专辑的章节：${trimmed(backup && backup.msg) || "接口没有数据"}`,
    );
  }
  const album = (backup && backup.album) || {};
  const total = Number(album.tracks) || 0;
  return {
    tracks: backupList,
    maxPage: Math.max(page, Math.ceil(total / size) || page),
    total,
  };
}

async function fetchAlbumInfo(albumId) {
  const json = await getJson(`${WEB}/revision/album/v1/simple?albumId=${albumId}`);
  const info = (json && json.data && json.data.albumPageMainInfo) || {};
  return {
    title: trimmed(info.albumTitle),
    anchor: trimmed(info.anchorName),
    cover: coverUrl(info.cover),
    intro: introText(info.richIntro) || introText(info.shortIntro),
    finished: finishedLabel(info.isFinished),
  };
}

export async function search(request) {
  const title = trimmed(request && request.title);
  if (!title) throw new Error("请先输入要搜索的书名");
  const page = Number(request.page) || 1;
  const rows = Math.min(Math.max(1, Number(request.page_size) || 20), 100);

  const json = await getJson(
    `https://search.ximalaya.com/front/v1?core=album&kw=${encodeURIComponent(title)}` +
      `&page=${page}&rows=${rows}&spellchecker=true&condition=relation` +
      `&device=android&version=9.0.75&paidFilter=false`,
  );
  const body = (json && json.response) || {};
  const docs = Array.isArray(body.docs) ? body.docs : [];
  const totalPage = Math.max(page, Number(body.totalPage) || page);

  const items = docs
    .filter((doc) => doc && trimmed(doc.id))
    .map((doc) => {
      const albumId = trimmed(doc.id);
      const anchor = trimmed(doc.nickname);
      const episodes = Number(doc.tracks) || 0;
      const tags = [finishedLabel(doc.is_finished)];
      if (episodes > 0) tags.push(`${episodes} 集`);
      if (doc.is_paid) tags.push("付费");
      return {
        id: albumId,
        source_url: `${WEB}/album/${albumId}`,
        title: trimmed(doc.title) || `喜马拉雅专辑 ${albumId}`,
        author: anchor || "喜马拉雅",
        narrator: anchor || null,
        cover_url: coverUrl(doc.cover_path),
        intro: introText(doc.custom_title) || introText(doc.intro),
        genre: trimmed(doc.category_name) || null,
        duration: null,
        tags,
      };
    });

  return success(
    publishSearch(
      { items, total: null, has_more: page < totalPage },
      request,
    ),
  );
}

export async function detail(input) {
  const albumId = albumIdOf(input);
  const info = await fetchAlbumInfo(albumId);
  const firstPage = await fetchTrackPage(albumId, 1, MAX_PAGE_SIZE);

  const chapters = firstPage.tracks
    .map((track, index) => chapterFromTrack(track, index))
    .filter(Boolean);

  return success({
    metadata: publishDetailMetadata({
      id: albumId,
      source_url: `${WEB}/album/${albumId}`,
      title: info.title || `喜马拉雅专辑 ${albumId}`,
      author: info.anchor || "喜马拉雅",
      narrator: info.anchor || null,
      cover_url: info.cover,
      intro: info.intro,
      genre: null,
      tags: [info.finished, `${firstPage.total} 集`].filter(Boolean),
      duration: null,
    }),
    // 整套目录可能上千集，这里只给首批，其余交给 list_chapters 按页取。
    chapters_complete: false,
    chapters,
  });
}

export async function list_chapters(input) {
  const albumId = albumIdOf(input && input.source);
  const page = Math.max(1, Number(input && input.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(input && input.page_size) || 100), MAX_PAGE_SIZE);
  const data = await fetchTrackPage(albumId, page, pageSize);
  const startIndex = (page - 1) * pageSize;

  return success({
    items: data.tracks
      .map((track, offset) => chapterFromTrack(track, startIndex + offset))
      .filter(Boolean),
    page,
    page_size: pageSize,
    total: data.total > 0 ? data.total : null,
    has_more: page < data.maxPage,
  });
}

export async function resolve_audio(input) {
  const chapterId = trimmed(input && input.chapter_id).replace(/^xm:/, "");
  if (!chapterId) throw new Error("没有拿到要播放的章节 ID");

  const json = await getJson(
    `${WEB}/mobile-playpage/track/v3/baseInfo/${Date.now()}` +
      `?device=web&trackId=${chapterId}&trackQualityLevel=1`,
  );
  const track = (json && json.trackInfo) || {};
  const list = Array.isArray(track.playUrlList) ? track.playUrlList : [];
  if (list.length === 0) {
    throw new Error(
      "这一集需要喜马拉雅的会员或购买后才能听（免费章节可以直接播放）",
    );
  }

  // 优先 64k 的 m4a，其次 64k 的 mp3，再退到更低的码率。
  const preferred = ["M4A_64", "MP3_64", "M4A_24", "MP3_32"];
  let picked = null;
  for (const type of preferred) {
    const found = list.find((entry) => trimmed(entry && entry.type) === type);
    if (found) {
      picked = found;
      break;
    }
  }
  if (!picked) picked = list[0];

  const audioUrl = decryptAes128EcbBase64(PLAY_KEY, trimmed(picked.url));
  if (!audioUrl.startsWith("http")) {
    throw new Error("喜马拉雅播放地址解密失败，源站可能修改了加密方式");
  }

  return success({
    type: "proxy",
    url: audioUrl,
    headers: { Referer: WEB + "/", "User-Agent": UA },
    expires_at: null,
    seekable: true,
    mime: trimmed(picked.type).startsWith("M4A") ? "audio/mp4" : "audio/mpeg",
  });
}
