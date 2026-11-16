// 反向校验打好的 .tr 包：解 magic、解 zstd、解 tar、核对 .trpack/package.json 的文件表。
// 用法：node plugins/verify-tr.mjs plugins/ximalaya-book-source/dist/ximalaya-book-source-1.0.0.tr

import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const MAGIC = Buffer.from([0x54, 0x52, 0x50, 0x41, 0x43, 0x4b, 0x00, 0x01]);

function parseTar(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\u0000.*$/, "");
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString("ascii").trim() || "0", 8);
    const checksumField = header.subarray(148, 156);
    const expected = parseInt(checksumField.toString("ascii").replace(/\u0000/g, "").trim() || "0", 8);
    const copy = Buffer.from(header);
    copy.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of copy) sum += byte;
    if (sum !== expected) throw new Error(`tar 校验和不符: ${name} (${sum} != ${expected})`);
    const dataStart = offset + 512;
    entries.set(name, buffer.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const file = process.argv[2];
if (!file) throw new Error("用法: node plugins/verify-tr.mjs <package.tr>");

const raw = fs.readFileSync(file);
if (!raw.subarray(0, 8).equals(MAGIC)) throw new Error("magic 不符，不是 .tr 包");
const tar = zlib.zstdDecompressSync(raw.subarray(8));
const entries = parseTar(tar);
const manifestBytes = entries.get(".trpack/package.json");
if (!manifestBytes) throw new Error("包内缺少 .trpack/package.json");
const manifest = JSON.parse(manifestBytes.toString("utf8"));

if (manifest.format !== "ting-reader.trpack" || manifest.format_version !== 1) {
  throw new Error("package.json 的 format 不正确");
}
const payload = [...entries.keys()].filter((name) => name !== ".trpack/package.json");
const declared = manifest.files.map((item) => item.path);
if (payload.length !== declared.length) {
  throw new Error(`文件数不一致: 包内 ${payload.length}, 清单 ${declared.length}`);
}
for (const item of manifest.files) {
  const bytes = entries.get(item.path);
  if (!bytes) throw new Error(`清单里的 ${item.path} 不在包里`);
  if (bytes.length !== item.size) throw new Error(`${item.path} 大小不符`);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== item.sha256) throw new Error(`${item.path} sha256 不符`);
}
if (!payload.includes("plugin.yml")) throw new Error("包内缺少 plugin.yml");
if (!payload.includes(manifest.entry_point)) throw new Error("包内缺少 entry_point");

console.log(`OK ${manifest.plugin_id} ${manifest.plugin_version}`);
console.log(`runtime=${manifest.runtime} entry=${manifest.entry_point}`);
for (const item of manifest.files) console.log(`  ${item.path}  ${item.size} bytes`);
