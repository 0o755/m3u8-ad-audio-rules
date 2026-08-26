/* Probe SDK rules-v1 合同：规则仓库和自动合并流程共用严格校验。 */
import { TextDecoder, TextEncoder } from "node:util";

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_RULES = 1024;
export const MAX_TOTAL_HASHES = 65536;
export const MAX_REVISION = Number.MAX_SAFE_INTEGER;
export const PHASES = [0, 64, 128, 192];
const FORMAT = "ad-audio-probe-rules";
const ALGORITHM = "spectral-sequence-v1";

export function parseDocumentBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("规则文件大小无效");
  let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let document;
  try { document = JSON.parse(text); } catch { throw new Error("规则 JSON 语法无效"); }
  validateDocument(document);
  return normalizeDocument(document);
}

export function validateDocument(document) {
  if (!isObject(document)) throw new Error("规则根节点必须是对象");
  if (!hasOnly(document, ["format", "schemaVersion", "revision", "algorithm", "rules"])) {
    throw new Error("规则根节点包含未知字段");
  }
  if (document.format !== FORMAT || document.schemaVersion !== 1
      || document.algorithm !== ALGORITHM) throw new Error("规则协议或算法不受支持");
  if (!Number.isSafeInteger(document.revision) || document.revision < 1) {
    throw new Error("revision 必须是安全的正整数");
  }
  if (!Array.isArray(document.rules) || document.rules.length > MAX_RULES) {
    throw new Error("规则数量超出上限");
  }
  const ids = new Set();
  let totalHashes = 0;
  for (const rule of document.rules) {
    validateRule(rule);
    if (!ids.add(rule.id)) throw new Error(`规则 ID 重复: ${rule.id}`);
    totalHashes += rule.fingerprints.reduce((sum, item) => sum + item.hashes.length, 0);
    if (totalHashes > MAX_TOTAL_HASHES) throw new Error("指纹总量超出上限");
  }
  validateConflicts(document.rules);
  return document;
}

export function normalizeDocument(document) {
  return {
    format: FORMAT,
    schemaVersion: 1,
    revision: document.revision,
    algorithm: ALGORITHM,
    rules: document.rules.map((rule) => ({
      id: rule.id,
      durationMs: rule.durationMs,
      anchorOffsetMs: rule.anchorOffsetMs,
      anchorDurationMs: rule.anchorDurationMs,
      fingerprints: rule.fingerprints.slice().sort((a, b) => a.phaseMs - b.phaseMs)
        .map((item) => ({ phaseMs: item.phaseMs, hashes: item.hashes.slice() })),
      ...(rule.test ? { test: { url: rule.test.url, adStartMs: rule.test.adStartMs } } : {})
    })).sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function serializeDocument(document, pretty = false) {
  validateDocument(document);
  const text = JSON.stringify(normalizeDocument(document), null, pretty ? 2 : 0) + (pretty ? "\n" : "");
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("规则文件超过 4 MiB");
  return text;
}

export function sameRuleContent(left, right) {
  return JSON.stringify({ id: left.id, durationMs: left.durationMs,
    anchorOffsetMs: left.anchorOffsetMs, anchorDurationMs: left.anchorDurationMs,
    fingerprints: left.fingerprints }) === JSON.stringify({ id: right.id,
    durationMs: right.durationMs, anchorOffsetMs: right.anchorOffsetMs,
    anchorDurationMs: right.anchorDurationMs, fingerprints: right.fingerprints });
}

export function endpoint(rule) { return rule.durationMs - rule.anchorOffsetMs; }

function validateRule(rule) {
  if (!isObject(rule) || !hasOnly(rule, ["id", "durationMs", "anchorOffsetMs", "anchorDurationMs", "fingerprints", "test"])) throw new Error("规则字段无效");
  if (typeof rule.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(rule.id)) throw new Error("规则 ID 无效");
  if (!Number.isSafeInteger(rule.durationMs) || rule.durationMs < 5000 || rule.durationMs > 600000) throw new Error(`规则时长无效: ${rule.id}`);
  if (!Number.isSafeInteger(rule.anchorOffsetMs) || rule.anchorOffsetMs < 0 || rule.anchorOffsetMs > rule.durationMs - 5000) throw new Error(`规则锚点偏移无效: ${rule.id}`);
  if (rule.anchorDurationMs !== 5000 || !Array.isArray(rule.fingerprints) || rule.fingerprints.length !== 4) throw new Error(`规则锚点无效: ${rule.id}`);
  const phases = new Set();
  for (const item of rule.fingerprints) {
    if (!isObject(item) || !hasOnly(item, ["phaseMs", "hashes"]) || !PHASES.includes(item.phaseMs) || !phases.add(item.phaseMs)) throw new Error(`规则相位无效: ${rule.id}`);
    const expected = Math.floor((5000 - item.phaseMs - 512) / 256) + 1;
    if (!Array.isArray(item.hashes) || item.hashes.length !== expected) throw new Error(`规则指纹长度无效: ${rule.id}`);
    if (item.hashes.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{8}$/.test(hash))) throw new Error(`规则指纹哈希无效: ${rule.id}`);
  }
  if (phases.size !== 4) throw new Error(`规则缺少相位: ${rule.id}`);
  if (rule.test !== undefined) {
    if (!isObject(rule.test) || !hasOnly(rule.test, ["url", "adStartMs"]) || typeof rule.test.url !== "string" || rule.test.url.length === 0 || rule.test.url.length > 8192 || !Number.isSafeInteger(rule.test.adStartMs) || rule.test.adStartMs < 0 || rule.test.adStartMs > MAX_REVISION - rule.durationMs) throw new Error(`规则测试元数据无效: ${rule.id}`);
    let url; try { url = new URL(rule.test.url); } catch { throw new Error(`规则测试链接无效: ${rule.id}`); }
    if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error(`规则测试链接无效: ${rule.id}`);
  }
}

function validateConflicts(rules) {
  for (let left = 0; left < rules.length; left++) for (let right = left + 1; right < rules.length; right++) {
    const a = rules[left]; const b = rules[right];
    const ah = a.fingerprints.find((item) => item.phaseMs === 0).hashes;
    const bh = b.fingerprints.find((item) => item.phaseMs === 0).hashes;
    const length = Math.min(8, ah.length, bh.length);
    if (length >= 4 && ah.slice(0, length).every((hash, index) => hash === bh[index]) && Math.abs(endpoint(a) - endpoint(b)) > 250) throw new Error(`规则跳转终点冲突: ${a.id} / ${b.id}`);
  }
}

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasOnly(value, keys) { return Object.keys(value).every((key) => keys.includes(key)); }
