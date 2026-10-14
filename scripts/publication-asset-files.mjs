import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
export async function publicationAssets(directory) {
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
