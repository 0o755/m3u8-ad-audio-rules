/* 处理采集器提交：输入和输出始终是 Probe SDK rules-v1。 */
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { mergeDocuments } from "./merge-rules.mjs";
import { parseDocumentBytes, serializeDocument } from "./rule-contract.mjs";
import { writeFileAtomically } from "./atomic-write.mjs";

const root = process.cwd();
const targetPath = join(root, "rules.json");
const submissionsPath = join(root, "submissions");
const archivePath = join(root, "archive", "submissions");
const rejectedPath = join(root, "rejected", "submissions");
const entries = await readdir(submissionsPath, { withFileTypes: true }).catch(() => []);
const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
let target = parseDocumentBytes(await readFile(targetPath));
for (const name of files) {
  const source = join(submissionsPath, name);
  try {
    const payload = JSON.parse(await readFile(source, "utf8"));
    const contribution = normalizeContribution(payload && payload.document ? payload.document : payload);
    const result = mergeDocuments(target, contribution);
    target = result.document;
    await mkdir(archivePath, { recursive: true });
    await rename(source, join(archivePath, name));
  } catch (error) {
    await mkdir(rejectedPath, { recursive: true });
    await rename(source, join(rejectedPath, name));
  }
}
if (files.length) await writeFileAtomically(targetPath, serializeDocument(target, true));
console.log(`processed=${files.length} rules=${target.rules.length} revision=${target.revision}`);

function normalizeContribution(document) {
  if (!document || typeof document !== "object") throw new Error("提交缺少规则文档");
  if (document.schemaVersion === 1) return document;
  // 仅兼容已经进入 submissions 的历史 v3 提交，公开文件始终写回 SDK v1。
  if (document.schemaVersion !== 3 || !document.algorithm
      || document.algorithm.id !== "spectral-sequence-v3" || !Array.isArray(document.rules)) {
    throw new Error("提交不是支持的规则协议");
  }
  const testUrls = document.testUrls || {};
  const testPositions = document.testPositionsMs || {};
  return {
    format: "ad-audio-probe-rules",
    schemaVersion: 1,
    revision: Number.isSafeInteger(document.revision) && document.revision > 0
      ? document.revision : 1,
    algorithm: "spectral-sequence-v1",
    rules: document.rules.map((rule) => {
      const converted = {
        id: rule.id,
        durationMs: rule.durationMs,
        anchorOffsetMs: rule.anchorOffsetMs,
        anchorDurationMs: rule.anchorDurationMs,
        fingerprints: (rule.fingerprints || []).map((item) => ({
          phaseMs: item.phaseMs === undefined ? item.offsetMs : item.phaseMs,
          hashes: item.hashes
        }))
      };
      const url = testUrls[rule.id];
      const position = testPositions[rule.id];
      if (typeof url === "string" && Number.isSafeInteger(position)) {
        converted.test = { url, adStartMs: position };
      }
      return converted;
    })
  };
}
