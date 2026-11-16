// 把插件目录打成 Ting Reader 的 .tr 包。
// 容器格式：8 字节 magic "TRPACK" + 0x00 0x01，后面是 zstd 压缩的 tar。
// tar 里除插件文件外，还有 .trpack/package.json 描述每个文件的路径、大小和 sha256。
// 未签名包也能安装（宿主会走"未信任发布者"的确认流程），所以这里不生成签名。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MAGIC = Buffer.from([0x54, 0x52, 0x50, 0x41, 0x43, 0x4b, 0x00, 0x01]);
const MANIFEST_PATH = ".trpack/package.json";

function padTo(buffer, size) {
  const remainder = buffer.length % size;
  return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(size - remainder)]);
}

function tarHeader(name, size, mode = 0o644) {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 100, "utf8");
  header.write(mode.toString(8).padStart(7, "0") + " ", 100, 8, "ascii");
  header.write("0000000 ", 108, 8, "ascii"); // uid
  header.write("0000000 ", 116, 8, "ascii"); // gid
  header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "ascii");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + " ", 136, 12, "ascii");
  header.write("ustar\u000000", 257, 8, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  header.write("0000000 ", 329, 8, "ascii");
  header.write("0000000 ", 337, 8, "ascii");
  header.write("0", 156, 1, "ascii"); // 普通文件
  // 校验和：先把 checksum 字段写成空格，算完再填。
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\u0000 ", 148, 8, "ascii");
  return header;
}

function buildTar(entries) {
  const parts = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry.path, entry.bytes.length));
    parts.push(padTo(entry.bytes, 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function walk(sourceDir, relative = "") {
  const result = [];
  // Build output and packaging metadata never travel inside the package.
  const skip = ['.trpack', 'dist'];
  for (const name of fs.readdirSync(path.join(sourceDir, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${name.name}` : name.name;
    if (skip.includes(next) || next.endsWith('.tr')) continue;
    const full = path.join(sourceDir, next);
    if (name.isDirectory()) result.push(...walk(sourceDir, next));
    else if (name.isFile()) result.push(next);
  }
  return result;
}

function readPluginYaml(sourceDir) {
  const text = fs.readFileSync(path.join(sourceDir, "plugin.yml"), "utf8");
  const pick = (key) => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text);
    if (!match) throw new Error(`plugin.yml 缺少 ${key}`);
    return match[1].trim().replace(/^["']|["']$/g, "");
  };
  const runtime = /^runtime:\s*(.+)$/m.test(text)
    ? /^runtime:\s*(.+)$/m.exec(text)[1].trim()
    : null;
  return {
    id: pick("id"),
    version: pick("version"),
    entry: pick("entry_point"),
    runtime,
  };
}

function packTr(sourceDir, outputPath) {
  const meta = readPluginYaml(sourceDir);
  const files = walk(sourceDir);

  const entries = files.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(sourceDir, relativePath));
    return {
      path: relativePath,
      bytes,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });

  const manifest = {
    format: "ting-reader.trpack",
    format_version: 1,
    plugin_id: meta.id,
    plugin_version: meta.version,
    runtime: meta.runtime,
    entry_point: meta.entry,
    files: entries.map((entry) => ({
      path: entry.path,
      size: entry.size,
      sha256: entry.sha256,
    })),
  };

  if (!entries.some((entry) => entry.path === "plugin.yml")) {
    throw new Error("插件目录缺少 plugin.yml");
  }
  if (!entries.some((entry) => entry.path === meta.entry)) {
    throw new Error(`插件目录缺少 entry_point ${meta.entry}`);
  }

  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const tar = buildTar([
    { path: MANIFEST_PATH, bytes: manifestBytes },
    ...entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
  ]);
  const compressed = zlib.zstdCompressSync(tar, {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: 12 },
  });
  const output = Buffer.concat([MAGIC, compressed]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  return { manifest, bytes: output.length };
}

if (process.argv[2]) {
  const sourceDir = path.resolve(process.argv[2]);
  const outputPath = path.resolve(
    process.argv[3] || path.join(sourceDir, "dist", `${path.basename(sourceDir)}.tr`),
  );
  const { manifest, bytes } = packTr(sourceDir, outputPath);
  console.log(
    `${manifest.plugin_id} ${manifest.plugin_version} -> ${outputPath} (${bytes} bytes, ${manifest.files.length} files)`,
  );
}
