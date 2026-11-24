/**
 * 敏感字段加密（浏览器版）
 *
 * 与云函数版保持**完全相同的调用签名**（encrypt / decrypt / isCipher），
 * 这样 actions 里所有加密逻辑一行都不用改。
 *
 * ⚠️ 说明清楚它是什么、不是什么：
 *   - 云函数版用 AES-256-GCM，密钥来自环境变量 FHR_ENC_KEY；
 *   - 浏览器里没有同步的 AES，WebCrypto 全是异步的，改成同步会牵动整条调用链；
 *   - 所以这里用「RC4 流密码 + 本机随机密钥」，密钥存在 App 私有存储里。
 *   - 它的作用是**避免手机号/身份证以明文落盘**（导出 JSON、备份文件里看不到明文），
 *     不是对抗拿到整机的攻击者 —— 单机应用也做不到后者。
 *
 * 密钥一旦生成就不再更换：换密钥 = 已加密内容永久解不开（与云函数版同约束）。
 * 存储格式沿用 v1:<iv>:<tag>:<cipher>，tag 是明文校验和，用于判断解密是否成功。
 */

const KEY_STORE = 'fhr.enckey';

let cachedKey = null;

function randomBytes(n) {
  const out = new Uint8Array(n);
  const g = globalThis.crypto;
  if (g && g.getRandomValues) g.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
  return s;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 取（或首次生成）本机密钥，32 字节 */
function getKey() {
  if (cachedKey) return cachedKey;
  let hex = '';
  try {
    hex = localStorage.getItem(KEY_STORE) || '';
  } catch (e) {
    hex = '';
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    hex = toHex(randomBytes(32));
    try {
      localStorage.setItem(KEY_STORE, hex);
    } catch (e) {
      // 存不下就只在内存里用，功能不中断（代价是重开 App 后旧密文解不开）
      console.warn('[crypto] 无法持久化密钥，仅本次会话有效');
    }
  }
  cachedKey = fromHex(hex);
  return cachedKey;
}

/** 是否为密文格式 */
function isCipher(v) {
  return typeof v === 'string'
    && /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/.test(v);
}

/** RC4 密钥调度 */
function rc4Schedule(key) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  return s;
}

/** RC4 流 */
function rc4Stream(key, len) {
  const s = rc4Schedule(key);
  const out = new Uint8Array(len);
  let i = 0, j = 0;
  for (let n = 0; n < len; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[n] = s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** 明文校验和（8 字节），用于判断解密是否成功 */
function checksum(bytes) {
  const out = new Uint8Array(8);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i]; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + bytes[i] * (i + 7)) >>> 0;
    out[i % 8] ^= (h1 ^ h2) & 0xff;
  }
  return out;
}

function utf8(str) {
  return new TextEncoder().encode(String(str));
}

/** 加密；空值原样返回；已是密文则不再加密（幂等） */
function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  if (isCipher(plain)) return plain;
  try {
    const iv = randomBytes(12);
    const data = utf8(plain);
    const stream = rc4Stream(concat(getKey(), iv), data.length);
    const enc = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) enc[i] = data[i] ^ stream[i];
    return 'v1:' + b64encode(iv) + ':' + b64encode(checksum(data)) + ':' + b64encode(enc);
  } catch (e) {
    console.error('[crypto] 加密失败', e);
    return '';
  }
}

/** 解密；非密文原样返回，解密失败返回空串 */
function decrypt(v) {
  if (!isCipher(v)) return v === undefined || v === null ? '' : String(v);
  try {
    const parts = v.split(':');
    const iv = b64decode(parts[1]);
    const tag = b64decode(parts[2]);
    const enc = b64decode(parts[3]);
    const stream = rc4Stream(concat(getKey(), iv), enc.length);
    const data = new Uint8Array(enc.length);
    for (let i = 0; i < enc.length; i++) data[i] = enc[i] ^ stream[i];
    const tag2 = checksum(data);
    for (let i = 0; i < tag.length; i++) {
      if (tag[i] !== tag2[i]) {
        console.error('[crypto] 校验失败，按空值返回');
        return '';
      }
    }
    return new TextDecoder().decode(data);
  } catch (e) {
    console.error('[crypto] 解密失败', e);
    return '';
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const DEV_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export const __exports = { encrypt, decrypt, isCipher, DEV_KEY };
export { encrypt, decrypt, isCipher, DEV_KEY };
export default __exports;
