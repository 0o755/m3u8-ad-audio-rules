/* 校验唯一公开 rules.json，失败时非零退出。 */
import { readFile } from "node:fs/promises";
import { parseDocumentBytes } from "./rule-contract.mjs";

const file = process.argv[2] ?? "rules.json";
const document = parseDocumentBytes(await readFile(file));
console.log(`rules.json valid: revision=${document.revision}, rules=${document.rules.length}`);
