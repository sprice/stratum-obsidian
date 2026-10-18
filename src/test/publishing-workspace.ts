import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import type { App } from "obsidian";
import type * as Workspace from "../publish-workspace";
import { loadRuntime } from "./runtime-harness";

/** Exercise the production workspace against a local adapter with synthetic files. */
export function testPublishingWorkspace(
  created?: (directory: string) => void,
): Workspace.PublishWorkspace {
  return {
    async create() {
      const root = await fs.mkdtemp(join(tmpdir(), "stratum workspace "));
      class Adapter {
        getFullPath(path: string) {
          return join(root, path);
        }
        async mkdir(path: string) {
          await fs.mkdir(this.getFullPath(path), { recursive: true });
        }
        async stat(path: string) {
          return {
            type: (await fs.stat(this.getFullPath(path))).isDirectory()
              ? "folder"
              : "file",
          };
        }
        write(path: string, data: string) {
          return fs.writeFile(this.getFullPath(path), data);
        }
        writeBinary(path: string, data: ArrayBuffer) {
          return fs.writeFile(this.getFullPath(path), new Uint8Array(data));
        }
        async readBinary(path: string) {
          return Uint8Array.from(await fs.readFile(this.getFullPath(path)))
            .buffer;
        }
        rmdir(path: string) {
          return fs.rm(this.getFullPath(path), { recursive: true });
        }
      }
      try {
        const runtime = loadRuntime<typeof Workspace>(
          "publish-workspace.ts",
          { FileSystemAdapter: Adapter },
          { crypto: webcrypto, Uint8Array },
        );
        const job = await runtime
          .publishingWorkspace({
            vault: { adapter: new Adapter(), configDir: "CustomConfig" },
          } as unknown as App)
          .create();
        created?.(job.directory);
        return {
          ...job,
          async remove() {
            try {
              await job.remove();
              // Fixture cleanup must not hide a broken production remove().
              await assert.rejects(fs.access(job.directory), {
                code: "ENOENT",
              });
            } finally {
              await fs.rm(root, { recursive: true, force: true });
            }
          },
        };
      } catch (error) {
        await fs.rm(root, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
