/* 批量处理 Worker 写入的 submissions：有效规则合并，重复归档，冲突或无效规则拒绝。 */
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseDocumentBytes, serializeDocument } from "./rule-contract.mjs";
import { mergeDocuments } from "./merge-rules.mjs";
import { writeFileAtomically } from "./atomic-write.mjs";

const root = resolve(process.cwd());
const target = join(root, "rules.json");
const submissionDirectory = join(root, "submissions");
const archiveDirectory = join(root, "archive", "submissions");
const rejectedDirectory = join(root, "rejected", "submissions");
const files = (await readdir(submissionDirectory, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name)).map((entry) => entry.name);
let document = parseDocumentBytes(await readFile(target));
let changed = false;
for (const name of files) {
  const source = join(submissionDirectory, name);
  const destinationBase = join(archiveDirectory, name);
  try {
    const payload = JSON.parse(await readFile(source, "utf8"));
    const contribution = payload && payload.document ? payload.document : payload;
    const result = mergeDocuments(document, contribution);
    if (result.added.length) { document = result.document; changed = true; }
    await mkdir(dirname(destinationBase), { recursive: true });
    await rename(source, destinationBase);
  } catch (error) {
    const destination = join(rejectedDirectory, name);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    await writeFile(`${destination}.reason.txt`, String(error.message || error), "utf8");
  }
}
if (changed) await writeFileAtomically(target, serializeDocument(document, true));
console.log(`processed=${files.length} rules=${document.rules.length} revision=${document.revision}`);
