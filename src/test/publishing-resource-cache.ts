import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import type { BibliographyCache } from "../publication-bibliography-cache";
import { loadRuntime } from "./runtime-harness";
const require = createRequire(import.meta.url);
let installation: Promise<BibliographyCache> | undefined;
/** Real-PDF tests install the same official, pinned resources as the manager. */
export function installedTestResources(): Promise<BibliographyCache> {
  installation ??= (async () => {
    const cache: BibliographyCache = {
      directory: ".test-artifacts/publishing-resources",
      adapter: {
        exists: (path) =>
          fs.access(path).then(
            () => true,
            () => false,
          ),
        stat: async (path) => {
          try {
            const value = await fs.stat(path);
            return {
              type: value.isDirectory()
                ? ("folder" as const)
                : ("file" as const),
              size: value.size,
              ctime: value.ctimeMs,
              mtime: value.mtimeMs,
            };
          } catch {
            return null;
          }
        },
        mkdir: async (path) => {
          await fs.mkdir(path, { recursive: true });
        },
        readBinary: async (path) =>
          Uint8Array.from(await fs.readFile(path)).buffer,
        writeBinary: (path, bytes) => fs.writeFile(path, new Uint8Array(bytes)),
        rename: (from, to) => fs.rename(from, to),
        remove: (path) => fs.rm(path),
      },
    };
    const runtime = loadRuntime<typeof import("../publication-resources")>(
      "publication-resources.ts",
      { Platform: { isDesktop: true, isDesktopApp: true } },
      {
        TextDecoder,
        TextEncoder,
        Uint8Array,
        crypto: webcrypto,
        window: { require, setTimeout, clearTimeout },
      },
    );
    await runtime.installedAastexResources(cache);
    return cache;
  })();
  return installation;
}
