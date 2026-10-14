import { createHash } from "node:crypto";
import { publicationAssets } from "./publication-asset-files.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
export async function generateJournalAssets(
  directory = fileURLToPath(
    new URL("../src/publication-templates/journals/", import.meta.url),
  ),
) {
  const result = await publicationAssets(directory);
  const data = JSON.parse(result.contents);
  const provenance = JSON.parse(data["provenance.json"]);
  for (const [name, hash] of Object.entries(provenance.files)) {
    if (
      typeof data[name] !== "string" ||
      createHash("sha256").update(data[name]).digest("hex") !== hash
    )
      throw new Error(`Pinned journal asset changed: ${name}`);
  }
  const target = join(directory, "files.json");
  let previous = "";
  try {
    previous = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous !== result.contents) await writeFile(target, result.contents);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await generateJournalAssets();
