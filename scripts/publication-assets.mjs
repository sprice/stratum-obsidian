import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageDirectory = fileURLToPath(
  new URL("../src/publication-templates/aastex/", import.meta.url),
);
export async function publicationAssets(directory = packageDirectory) {
  const assets = {};
  const paths = [];
  const directories = [];
  async function collect(relative = "") {
    directories.push(join(directory, relative));
    const entries = await readdir(join(directory, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Publication assets cannot contain symlinks.");
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile() && name !== "files.json") {
        paths.push(join(directory, name));
        assets[name] = await readFile(join(directory, name), "utf8");
      }
    }
  }
  await collect();
  return {
    contents: `${JSON.stringify(assets, null, 2)}\n`,
    paths,
    directories,
  };
}
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
)
  await generatePublicationAssets(process.argv[2]);
