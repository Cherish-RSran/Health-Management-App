/**
 * 敏感字段加密（AES-256-GCM）
 *
 * 密钥来自云函数环境变量 FHR_ENC_KEY（64 位十六进制 = 32 字节）。
 * 未配置时使用开发默认值并只告警一次；**生产环境必须配置**。
 *
 * 存储格式：v1:<base64(iv)>:<base64(tag)>:<base64(cipher)>
 */

const crypto = require('crypto');

const DEV_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
let warned = false;

function getKey() {
  const hex = process.env.FHR_ENC_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (!warned) {
    warned = true;
    console.warn('[crypto] 未配置 FHR_ENC_KEY，正在使用开发默认密钥（请勿用于生产）');
  }
  return Buffer.from(DEV_KEY, 'hex');
}

/** 是否为密文格式 */
function isCipher(v) {
  return typeof v === 'string' && /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/.test(v);
}

/** 加密；空值原样返回（不加密空串，避免无意义密文） */
function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  if (isCipher(plain)) return plain; // 幂等：已是密文不再加密
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

/** 解密；非密文或解密失败时返回原值（保证老数据可读、不炸） */
function decrypt(v) {
  if (!isCipher(v)) return v === undefined || v === null ? '' : String(v);
  try {
    const parts = v.split(':');
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[crypto] 解密失败，按原文返回');
    return '';
  }
}

module.exports = { encrypt: encrypt, decrypt: decrypt, isCipher: isCipher, DEV_KEY: DEV_KEY };
