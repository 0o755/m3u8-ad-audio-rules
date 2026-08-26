/* 合并 Probe SDK rules-v1：不转换协议，不覆盖已有规则，不吞掉测试元数据。 */
import { endpoint, normalizeDocument, parseDocumentBytes, sameRuleContent, serializeDocument } from "./rule-contract.mjs";

export function mergeDocuments(target, contribution) {
  const base = parseDocumentBytes(new TextEncoder().encode(JSON.stringify(target)));
  const incoming = parseDocumentBytes(new TextEncoder().encode(JSON.stringify(contribution)));
  const rules = base.rules.map((rule) => structuredClone(rule));
  const byId = new Map(rules.map((rule, index) => [rule.id, index]));
  const added = []; const duplicates = []; const rejected = [];
  for (const candidate of incoming.rules) {
    const index = byId.get(candidate.id);
    if (index !== undefined) {
      const existing = rules[index];
      if (!sameRuleContent(existing, candidate)) rejected.push({ id: candidate.id, reason: "same-id-content-conflict" });
      else {
        if (candidate.test) existing.test = structuredClone(candidate.test);
        duplicates.push(candidate.id);
      }
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
  const next = normalizeDocument({ ...base, rules, revision: added.length ? base.revision + 1 : base.revision });
  serializeDocument(next);
  return { document: next, added, duplicates, rejected };
}

function prefixConflict(left, right) {
  const a = left.fingerprints.find((item) => item.phaseMs === 0).hashes;
  const b = right.fingerprints.find((item) => item.phaseMs === 0).hashes;
  const length = Math.min(8, a.length, b.length);
  return length >= 4 && a.slice(0, length).every((hash, index) => hash === b[index]) && Math.abs(endpoint(left) - endpoint(right)) > 250;
}
