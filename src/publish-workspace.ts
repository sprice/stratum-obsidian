import { FileSystemAdapter, type App } from "obsidian";
import { pluginStorageDirectory } from "./plugin-storage-paths";

export interface PublishJob {
  directory: string;
  write(name: string, data: string | Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  remove(): Promise<void>;
}
export interface PublishWorkspace {
  create(): Promise<PublishJob>;
}

/** Compiler files are isolated per job and accessed through the vault adapter. */
export function publishingWorkspace(app: App): PublishWorkspace {
  return {
    async create() {
      const adapter = app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter))
        throw new Error("Publishing requires a local desktop vault.");
      const root = `${pluginStorageDirectory(app)}/tmp`;
      // mkdir is shared by concurrent jobs; another job may create it first.
      try {
        await adapter.mkdir(root);
      } catch (error) {
        if ((await adapter.stat(root))?.type !== "folder") throw error;
      }
      const directory = `${root}/${crypto.randomUUID()}`;
      await adapter.mkdir(directory);
      const file = (name: string) => {
        if (
          !name ||
          name === "." ||
          name === ".." ||
          name.includes("\0") ||
          /[/\\]/.test(name)
        )
          throw new Error("Invalid publishing workspace filename.");
        return `${directory}/${name}`;
      };
      return {
        directory: adapter.getFullPath(directory),
        async write(name, data) {
          if (typeof data === "string") await adapter.write(file(name), data);
          else
            await adapter.writeBinary(file(name), Uint8Array.from(data).buffer);
        },
        async read(name) {
          return new Uint8Array(await adapter.readBinary(file(name)));
        },
        remove: () => adapter.rmdir(directory, true),
      };
    },
  };
}
