import pins from "./fixtures/registry-resources.json";
import * as fs from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { BibliographyCache } from "../publication-bibliography-cache";
import { resolveRegistryResources } from "../publication-registry";

export const templateCacheSkip = process.env.STRATUM_TEST_TEMPLATE_CACHE
  ? false
  : "Set STRATUM_TEST_TEMPLATE_CACHE to a verified local template cache for real-template PDF integration.";
const installations = new Map<string, Promise<BibliographyCache>>();
/** Real-PDF integration verifies local pinned resources; tests never contact the mirror. */
export function installedTestResources(
  family = "aastex",
): Promise<BibliographyCache> {
  const directory = process.env.STRATUM_TEST_TEMPLATE_CACHE;
  if (!directory) return Promise.reject(new Error(String(templateCacheSkip)));
  let installation = installations.get(family);
  installation ??= (async () => {
    const cache: BibliographyCache = {
      directory,
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
    await resolveRegistryResources(
      cache,
      (pins as Record<string, import("../publication-registry").RegistryPin>)[
        family
      ],
      () =>
        Promise.reject(
          new Error("Tests must not request template mirror resources."),
        ),
      (bytes, limit) => inflateRawSync(bytes, { maxOutputLength: limit }),
      undefined,
      false,
    );
    return cache;
  })();
  installations.set(family, installation);
  return installation;
}
