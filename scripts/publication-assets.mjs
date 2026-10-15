import { publicationAssets as collectPublicationAssets } from "./publication-asset-files.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageDirectory = fileURLToPath(
  new URL("../src/publication-templates/aastex/", import.meta.url),
);
export const publicationAssets = async (directory = packageDirectory) => {
  const result = await collectPublicationAssets(directory);
  if (resolve(directory) !== resolve(packageDirectory)) return result;
  const assets = JSON.parse(result.contents);
  for (const name of Object.keys(assets))
    if (name.endsWith(".cls")) delete assets[name];
  return { ...result, contents: `${JSON.stringify(assets, null, 2)}\n` };
};
export async function generatePublicationAssets(directory = packageDirectory) {
  const result = await publicationAssets(directory);
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

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await generatePublicationAssets(process.argv[2]);
  if (!process.argv[2])
    await (await import("./journal-assets.mjs")).generateJournalAssets();
}
