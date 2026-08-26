/* schema v3 规则合同：严格解析、规范化序列化和安全合并共用。 */
import { TextDecoder, TextEncoder } from "node:util";

export const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_RULES = 5000;
export const MAX_TOTAL_HASHES = 250000;
export const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const ALGORITHM = { id: "spectral-sequence-v3", sampleRate: 16000, windowMs: 512, hopMs: 256, bandCount: 16 };
const PHASES = [0, 64, 128, 192];

export function parseDocumentBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("规则文件大小无效");
  let source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  let document;
  try { document = JSON.parse(source); } catch { throw new Error("规则 JSON 语法无效"); }
  validateDocument(document);
  return normalizeDocument(document);
}

export function validateDocument(document) {
  if (!isObject(document)) throw new Error("规则根节点必须是对象");
  requireExactKeys(document, ["schemaVersion", "revision", "algorithm", "rules", "testUrls", "testPositionsMs"]);
  if (document.schemaVersion !== 3) throw new Error("不支持的规则协议版本");
  if (!Number.isSafeInteger(document.revision) || document.revision < 1 || document.revision > MAX_REVISION) {
    throw new Error("revision 必须是安全的正整数");
  }
  if (!isObject(document.algorithm) || JSON.stringify(document.algorithm) !== JSON.stringify(ALGORITHM)) {
    throw new Error("规则算法参数不受支持");
  }
  if (!Array.isArray(document.rules) || document.rules.length > MAX_RULES) throw new Error("规则数量超出上限");
  const ids = new Set();
  let totalHashes = 0;
  for (const rule of document.rules) {
    validateRule(rule);
    if (ids.has(rule.id)) throw new Error(`规则 ID 重复: ${rule.id}`);
    ids.add(rule.id);
    totalHashes += rule.fingerprints.reduce((sum, fingerprint) => sum + fingerprint.hashes.length, 0);
    if (totalHashes > MAX_TOTAL_HASHES) throw new Error("指纹总量超出上限");
  }
  validateMetadata(document, ids);
  validateConflicts(document.rules);
  return document;
}

export function normalizeDocument(document) {
  const rules = document.rules.map((rule) => ({
    ...rule,
    fingerprints: rule.fingerprints.slice().sort((a, b) => a.offsetMs - b.offsetMs)
      .map((fingerprint) => ({ offsetMs: fingerprint.offsetMs, hashes: fingerprint.hashes.slice() }))
  })).sort((a, b) => a.id.localeCompare(b.id));
  const output = { schemaVersion: 3, revision: document.revision, algorithm: { ...ALGORITHM }, rules };
  if (document.testUrls && Object.keys(document.testUrls).length) output.testUrls = { ...document.testUrls };
  if (document.testPositionsMs && Object.keys(document.testPositionsMs).length) output.testPositionsMs = { ...document.testPositionsMs };
  return output;
}

export function serializeDocument(document, pretty = false) {
  validateDocument(document);
  const normalized = normalizeDocument(document);
  const text = JSON.stringify(normalized, null, pretty ? 2 : 0) + (pretty ? "\n" : "");
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("规则文件超过 16 MiB");
  return text;
}

export function sameRuleContent(a, b) {
  return JSON.stringify({ ...a, test: undefined }) === JSON.stringify({ ...b, test: undefined });
}

export function endpoint(rule) {
  return rule.durationMs - rule.anchorOffsetMs;
}

function validateRule(rule) {
  if (!isObject(rule) || !hasOnly(rule, ["id", "durationMs", "anchorOffsetMs", "anchorDurationMs", "fingerprints"])) throw new Error("规则字段无效");
  if (typeof rule.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(rule.id)) throw new Error("规则 ID 无效");
  if (!Number.isSafeInteger(rule.durationMs) || rule.durationMs < 512) throw new Error(`规则时长无效: ${rule.id}`);
  if (!Number.isSafeInteger(rule.anchorOffsetMs) || rule.anchorOffsetMs < 0 || rule.anchorOffsetMs > rule.durationMs - 512) throw new Error(`规则锚点偏移无效: ${rule.id}`);
  if (!Number.isSafeInteger(rule.anchorDurationMs) || rule.anchorDurationMs < 512 || rule.anchorDurationMs > rule.durationMs - rule.anchorOffsetMs) throw new Error(`规则锚点时长无效: ${rule.id}`);
  if (!Array.isArray(rule.fingerprints) || rule.fingerprints.length !== 4) throw new Error(`规则必须包含四个指纹相位: ${rule.id}`);
  const offsets = new Set();
  for (const fingerprint of rule.fingerprints) {
    if (!isObject(fingerprint) || !hasOnly(fingerprint, ["offsetMs", "hashes"]) || !PHASES.includes(fingerprint.offsetMs) || offsets.has(fingerprint.offsetMs)) throw new Error(`规则指纹相位无效: ${rule.id}`);
    offsets.add(fingerprint.offsetMs);
    if (!Array.isArray(fingerprint.hashes) || fingerprint.hashes.length < 4 || fingerprint.hashes.length > 128) throw new Error(`规则指纹长度无效: ${rule.id}`);
    if (fingerprint.hashes.some((hash) => typeof hash !== "string" || !/^[0-9a-fA-F]{8}$/.test(hash))) throw new Error(`规则指纹哈希无效: ${rule.id}`);
  }
  if (offsets.size !== 4) throw new Error(`规则缺少指纹相位: ${rule.id}`);
}

function validateMetadata(document, ids) {
  for (const [key, value] of Object.entries(document.testUrls || {})) {
    if (!ids.has(key) || typeof value !== "string" || value.length === 0 || value.length > 8192) throw new Error("测试链接元数据无效");
    let url; try { url = new URL(value); } catch { throw new Error("测试链接 URL 无效"); }
    if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("测试链接必须是 HTTP(S)");
  }
  for (const [key, value] of Object.entries(document.testPositionsMs || {})) {
    if (!ids.has(key) || !Number.isSafeInteger(value) || value < 0) throw new Error("测试位置元数据无效");
  }
}

function validateConflicts(rules) {
  for (let left = 0; left < rules.length; left++) for (let right = left + 1; right < rules.length; right++) {
    const a = rules[left]; const b = rules[right];
    const ah = a.fingerprints.find((item) => item.offsetMs === 0).hashes;
    const bh = b.fingerprints.find((item) => item.offsetMs === 0).hashes;
    const length = Math.min(8, ah.length, bh.length);
    if (length >= 4 && ah.slice(0, length).every((hash, index) => hash.toLowerCase() === bh[index].toLowerCase())
        && Math.abs(endpoint(a) - endpoint(b)) > 250) throw new Error(`规则跳转终点冲突: ${a.id} / ${b.id}`);
  }
}

function requireExactKeys(value, keys) { if (!hasOnly(value, keys)) throw new Error("规则根节点包含未知字段"); }
function hasOnly(value, allowed) { return Object.keys(value).every((key) => allowed.includes(key)); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
