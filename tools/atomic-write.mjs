/* 规则发布使用同目录临时文件和 rename，避免主 rules.json 被截断。 */
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function writeFileAtomically(target, content) {
  const temporary = join(dirname(target), `.${target.split(/[\\/]/).pop()}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
