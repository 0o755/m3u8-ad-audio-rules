/* 合并规则提交：重复跳过，内容或跳转终点冲突拒绝，不覆盖稳定规则。 */
import { parseDocumentBytes, serializeDocument, sameRuleContent, endpoint } from "./rule-contract.mjs";

export function mergeDocuments(target, contribution) {
  const base = parseDocumentBytes(Buffer.from(JSON.stringify(target)));
  const incoming = parseDocumentBytes(Buffer.from(JSON.stringify(contribution)));
  const rules = base.rules.map((rule) => structuredClone(rule));
  const byId = new Map(rules.map((rule, index) => [rule.id, index]));
  const added = []; const duplicates = []; const rejected = [];
  for (const candidate of incoming.rules) {
    const existingIndex = byId.get(candidate.id);
    if (existingIndex !== undefined) {
      const existing = rules[existingIndex];
      if (sameRuleContent(existing, candidate)) duplicates.push(candidate.id);
      else rejected.push({ id: candidate.id, reason: "same-id-content-conflict" });
      continue;
    }
    const conflict = rules.find((rule) => prefixConflict(rule, candidate));
    if (conflict) {
      rejected.push({ id: candidate.id, reason: `jump-target-conflict:${conflict.id}` });
      continue;
    }
    byId.set(candidate.id, rules.length);
    rules.push(structuredClone(candidate));
    added.push(candidate.id);
  }
  const next = { ...base, rules, revision: added.length ? base.revision + 1 : base.revision };
  for (const key of ["testUrls", "testPositionsMs"]) {
    const values = { ...(base[key] || {}) };
    Object.assign(values, incoming[key] || {});
    if (Object.keys(values).length) next[key] = values;
  }
  serializeDocument(next);
  return { document: next, added, duplicates, rejected };
}

function prefixConflict(a, b) {
  const ah = a.fingerprints.find((item) => item.offsetMs === 0).hashes;
  const bh = b.fingerprints.find((item) => item.offsetMs === 0).hashes;
  const length = Math.min(8, ah.length, bh.length);
  return length >= 4 && ah.slice(0, length).every((hash, index) => hash.toLowerCase() === bh[index].toLowerCase())
    && Math.abs(endpoint(a) - endpoint(b)) > 250;
}
