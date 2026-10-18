import { TFile, TFolder, type App } from "obsidian";
import { publicationFolder } from "./publish-model";
import type { PublishedFiles } from "./publish-store";

export function pdfFolder(app: App, value: unknown): string {
  const folder = publicationFolder(value);
  const config = app.vault.configDir.toLowerCase();
  if (
    folder.toLowerCase() === config ||
    folder.toLowerCase().startsWith(`${config}/`)
  )
    throw new Error("Choose a folder outside Obsidian's configuration folder.");
  return folder;
}

export function publishedVaultFiles(
  app: App,
  folder: () => string,
): PublishedFiles {
  const file = (path: string): TFile => {
    const result = app.vault.getAbstractFileByPath(path);
    if (!(result instanceof TFile))
      throw new Error("The published PDF is unavailable.");
    return result;
  };
  return {
    folder: () => pdfFolder(app, folder()),
    async create(path, bytes) {
      const parts = path.split("/");
      pdfFolder(app, parts.slice(0, -1).join("/"));
      for (let i = 1; i < parts.length; i++) {
        const directory = parts.slice(0, i).join("/");
        const existing = app.vault.getAbstractFileByPath(directory);
        if (existing && !(existing instanceof TFolder))
          throw new Error("The PDF folder is occupied by a file.");
        if (!existing) await app.vault.createFolder(directory);
      }
      await app.vault.createBinary(path, bytes);
    },
    async trash(path) {
      await app.fileManager.trashFile(file(path));
    },
  };
}
