import { publicationAssets as collectPublicationAssets } from "./publication-asset-files.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageDirectory = fileURLToPath(
  new URL("../src/publication-templates/aastex/", import.meta.url),
);
export const publicationAssets = (directory = packageDirectory) =>
  collectPublicationAssets(directory);
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
