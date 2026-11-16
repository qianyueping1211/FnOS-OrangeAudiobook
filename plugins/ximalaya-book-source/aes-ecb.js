// 喜马拉雅播放地址用 AES-128-ECB + PKCS#7 加密，密钥公开在网页播放器里。
// 插件沙箱没有 Node 的 crypto，WebCrypto 也不支持 ECB，所以这里自带一份纯 JS 解密。
// 实现只用 GF(2^8) 运算现场生成 S 盒，避免手抄 512 个常量抄错。

const xtime = (a) => ((a & 0x80) ? (((a << 1) ^ 0x1b) & 0xff) : ((a << 1) & 0xff));

const gmul = (a, b) => {
  let result = 0;
  let left = a & 0xff;
  let right = b & 0xff;
  while (right) {
    if (right & 1) result ^= left;
    left = xtime(left);
    right >>= 1;
  }
  return result & 0xff;
};

const ginv = (a) => {
  if (a === 0) return 0;
  let result = 1;
  let base = a & 0xff;
  let exponent = 254;
  while (exponent) {
    if (exponent & 1) result = gmul(result, base);
    base = gmul(base, base);
    exponent >>= 1;
  }
  return result;
};

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
for (let value = 0; value < 256; value += 1) {
  const inverse = ginv(value);
  const rotated =
    inverse ^
    (((inverse << 1) | (inverse >> 7)) & 0xff) ^
    (((inverse << 2) | (inverse >> 6)) & 0xff) ^
    (((inverse << 3) | (inverse >> 5)) & 0xff) ^
    (((inverse << 4) | (inverse >> 4)) & 0xff) ^
    0x63;
  SBOX[value] = rotated;
  INV_SBOX[rotated] = value;
}

function expandKey(key) {
  const words = new Uint32Array(44);
  for (let index = 0; index < 4; index += 1) {
    words[index] =
      (key[index * 4] << 24) |
      (key[index * 4 + 1] << 16) |
      (key[index * 4 + 2] << 8) |
      key[index * 4 + 3];
  }
  let rcon = 1;
  for (let index = 4; index < 44; index += 1) {
    let temp = words[index - 1];
    if (index % 4 === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      temp =
        (SBOX[(temp >>> 24) & 0xff] << 24) |
        (SBOX[(temp >>> 16) & 0xff] << 16) |
        (SBOX[(temp >>> 8) & 0xff] << 8) |
        SBOX[temp & 0xff];
      temp = (temp ^ (rcon << 24)) >>> 0;
      rcon = xtime(rcon);
    }
    words[index] = (words[index - 4] ^ temp) >>> 0;
  }
  return words;
}

function addRoundKey(state, words, round) {
  for (let column = 0; column < 4; column += 1) {
    const keyword = words[round * 4 + column];
    state[column * 4] ^= (keyword >>> 24) & 0xff;
    state[column * 4 + 1] ^= (keyword >>> 16) & 0xff;
    state[column * 4 + 2] ^= (keyword >>> 8) & 0xff;
    state[column * 4 + 3] ^= keyword & 0xff;
  }
}

function invShiftRows(state) {
  for (let row = 1; row < 4; row += 1) {
    const values = [
      state[row],
      state[4 + row],
      state[8 + row],
      state[12 + row],
    ];
    for (let column = 0; column < 4; column += 1) {
      state[column * 4 + row] = values[(column - row + 4) % 4];
    }
  }
}

function invSubBytes(state) {
  for (let index = 0; index < 16; index += 1) {
    state[index] = INV_SBOX[state[index]];
  }
}

function invMixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const base = column * 4;
    const a0 = state[base];
    const a1 = state[base + 1];
    const a2 = state[base + 2];
    const a3 = state[base + 3];
    state[base] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    state[base + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    state[base + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    state[base + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

function decryptBlock(keyWords, block) {
  const state = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) state[index] = block[index];

  addRoundKey(state, keyWords, 10);
  for (let round = 9; round >= 1; round -= 1) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, keyWords, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, keyWords, 0);
  return state;
}

function pkcs7Strip(bytes) {
  if (bytes.length === 0) return bytes;
  const padding = bytes[bytes.length - 1];
  if (padding < 1 || padding > 16 || padding > bytes.length) return bytes;
  return bytes.subarray(0, bytes.length - padding);
}

/**
 * 解密一段 AES-128-ECB 密文。keyHex 是 32 个十六进制字符（16 字节）。
 * 输入是 base64url 字符串或字节数组，返回 UTF-8 明文。
 */
export function decryptAes128EcbBase64(keyHex, base64Url) {
  const key = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    key[index] = parseInt(keyHex.slice(index * 2, index * 2 + 2), 16);
  }
  const normalized = String(base64Url).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const cipher = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    cipher[index] = binary.charCodeAt(index);
  }
  if (cipher.length === 0 || cipher.length % 16 !== 0) {
    throw new Error("喜马拉雅播放地址的密文长度异常");
  }

  const keyWords = expandKey(key);
  const plain = new Uint8Array(cipher.length);
  for (let offset = 0; offset < cipher.length; offset += 16) {
    plain.set(decryptBlock(keyWords, cipher.subarray(offset, offset + 16)), offset);
  }
  const unpadded = pkcs7Strip(plain);
  let text = "";
  for (let index = 0; index < unpadded.length; index += 1) {
    text += String.fromCharCode(unpadded[index]);
  }
  try {
    return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
}
