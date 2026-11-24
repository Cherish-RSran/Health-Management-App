/**
 * 口令哈希（PBKDF2-HMAC-SHA256）
 *
 * 为什么不用平台自带的 crypto：
 *   - 云函数里 Node 有 crypto.pbkdf2Sync；
 *   - 浏览器里 WebCrypto 的 deriveBits **只有异步版本**，而本项目整条调用链是同步的，
 *     改成异步会牵动所有 action。
 *   所以这里手写一份**纯 JS、零依赖、同步**的 PBKDF2，两端跑同一份代码，
 *   保证「在安卓上注册的密码」能直接在小程序（云函数）里验证通过。
 *
 * 参数：10000 轮迭代（OWASP 对 PBKDF2-HMAC-SHA256 的最低建议是 600k，但那是服务器级场景；
 * 这里是手机端纯 JS，10000 轮约耗时 100~300ms，在「防拖库」与「登录不卡顿」之间取平衡。
 * 想更安全就调大 ITERATIONS，已有账号不受影响——迭代次数存在每条记录里。）
 *
 * 存储格式：pbkdf2$<轮数>$<salt-hex>$<hash-hex>
 */

const ITERATIONS = 10000;
const KEY_LEN = 32;

/* ============ SHA-256（纯 JS） ============ */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256(msg) {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) << 6;   // 补位后长度（64 的倍数）
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

/* ============ HMAC-SHA256 ============ */
function hmac(key, msg) {
  const BLOCK = 64;
  let k = key;
  if (k.length > BLOCK) k = sha256(k);
  const pad = new Uint8Array(BLOCK);
  pad.set(k, 0);
  const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = pad[i] ^ 0x36;
    opad[i] = pad[i] ^ 0x5c;
  }
  return sha256(catBytes(opad, sha256(catBytes(ipad, msg))));
}

function catBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/* ============ 编码工具 ============ */
function utf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
  const s = unescape(encodeURIComponent(String(str)));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
  return s;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
  return out;
}

/** 随机数（Node 与浏览器都用 crypto.getRandomValues / randomBytes 的兜底实现） */
function randomHex(n) {
  const out = new Uint8Array(n);
  const g = (typeof globalThis !== 'undefined') ? globalThis.crypto : null;
  if (g && g.getRandomValues) g.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return toHex(out);
}

/* ============ PBKDF2 ============ */
function pbkdf2(password, saltHex, iterations, dkLen) {
  const pwd = utf8(password);
  const salt = catBytes(utf8(saltHex), new Uint8Array([0, 0, 0, 1])); // S || INT(1)
  let u = hmac(pwd, salt);
  const t = u.slice(0);
  for (let i = 1; i < iterations; i++) {
    u = hmac(pwd, u);
    for (let j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return t.slice(0, dkLen);
}

/** 生成存储串 */
function hashPassword(password, iterations) {
  const iter = iterations || ITERATIONS;
  const salt = randomHex(16);
  return 'pbkdf2$' + iter + '$' + salt + '$' + toHex(pbkdf2(password, salt, iter, KEY_LEN));
}

/** 校验；兼容「旧数据没加盐/没有前缀」的情况一律判失败 */
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.indexOf('pbkdf2$') !== 0) return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iter = parseInt(parts[1], 10);
  if (!iter || iter <= 0) return false;
  const expect = parts[3];
  const actual = toHex(pbkdf2(password, parts[2], iter, KEY_LEN));
  if (actual.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual.charCodeAt(i) ^ expect.charCodeAt(i));
  return diff === 0;
}

/** 口令强度：只做长度与复杂度下限，错误信息交给调用方 */
function checkStrength(password) {
  const p = String(password || '');
  if (p.length < 6) return { ok: false, reason: '密码至少 6 位' };
  if (p.length > 64) return { ok: false, reason: '密码最多 64 位' };
  if (/^\d+$/.test(p)) return { ok: false, reason: '密码不能全是数字' };
  return { ok: true, reason: '' };
}

/**
 * 手机号查找用的确定性哈希。
 * 手机号不能明文存，但要能「按手机号查账号」——AES-GCM 带随机 IV 不具确定性，
 * 所以单独存一个 PBKDF2 摘要用于检索。固定盐 + 10000 轮，
 * 使得「拿到库去撞某个手机号」的代价高到不划算（10^10 候选 × 10^4 轮）。
 */
const PHONE_LOOKUP_SALT = 'fhr-phone-lookup-v1';
function phoneLookupHash(phone) {
  return 'lk$' + toHex(pbkdf2(String(phone || ''), PHONE_LOOKUP_SALT, 10000, KEY_LEN));
}

module.exports = {
  ITERATIONS: ITERATIONS,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  checkStrength: checkStrength,
  phoneLookupHash: phoneLookupHash,
  randomHex: randomHex,
  sha256Hex: function (s) { return toHex(sha256(utf8(s))); }
};
