import type { App, DataAdapter } from "obsidian";
import { readReferenceStore, REFERENCE_FILE } from "./citation-reference-store";
import { readCatalog } from "./publish-model";
import {
  pluginStorageDirectory,
  referenceStorePath,
  setPluginStorageDirectory,
} from "./plugin-storage-paths";

interface Copy {
  source: string;
  destination: string;
}
const same = (a: ArrayBuffer, b: ArrayBuffer) => {
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  return (
    left.length === right.length && left.every((byte, i) => byte === right[i])
  );
};

async function ensureDirectory(
  adapter: DataAdapter,
  directory: string,
): Promise<void> {
  const parts = directory.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join("/");
    if (!(await adapter.exists(path))) await adapter.mkdir(path);
  }
}

/** Copy first, verify both stores, then retire legacy files. Never merge conflicting history. */
export async function migratePluginStorage(
  app: App,
  directory?: string,
): Promise<void> {
  setPluginStorageDirectory(app, directory);
  const adapter = app.vault.adapter;
  const copies: Copy[] = [];
  const folders: string[] = [];
  const legacyPublished = `${app.vault.configDir}/stratum/published`;
  if (await adapter.exists(REFERENCE_FILE)) {
    readReferenceStore(await adapter.read(REFERENCE_FILE));
    copies.push({
      source: REFERENCE_FILE,
      destination: referenceStorePath(app),
    });
  }
  const visit = async (source: string, destination: string): Promise<void> => {
    const entries = await adapter.list(source);
    for (const entry of [...entries.files, ...entries.folders]) {
      const relative = entry.slice(source.length + 1);
      if (
        !entry.startsWith(`${source}/`) ||
        !relative ||
        /[\\/]/.test(relative) ||
        relative === "." ||
        relative === ".."
      )
        throw new Error(
          "Stratum storage migration found an invalid storage path. Existing files were retained.",
        );
    }
    if (source === legacyPublished) {
      const primary = `${source}/catalog.json`;
      const backup = `${source}/catalog.backup.json`;
      const migratedPrimary = `${destination}/catalog.json`;
      // Cleanup may have removed the legacy primary before an interruption.
      // Prefer that verified migrated primary over a leftover stale backup.
      const catalog = entries.files.includes(primary)
        ? primary
        : (await adapter.exists(migratedPrimary))
          ? migratedPrimary
          : backup;
      if (await adapter.exists(catalog))
        readCatalog(await adapter.read(catalog));
    }
    for (const file of entries.files) {
      copies.push({
        source: file,
        destination: `${destination}/${file.slice(source.length + 1)}`,
      });
    }
    for (const folder of entries.folders)
      await visit(folder, `${destination}/${folder.slice(source.length + 1)}`);
    folders.push(source);
  };
  if (await adapter.exists(legacyPublished))
    await visit(legacyPublished, `${pluginStorageDirectory(app)}/published`);

  // Preflight every collision before writing or removing either store.
  for (const copy of copies)
    if (await adapter.exists(copy.destination)) {
      if (
        !same(
          await adapter.readBinary(copy.source),
          await adapter.readBinary(copy.destination),
        )
      )
        throw new Error(
          "Stratum storage migration found conflicting saved data. Both locations were retained; resolve the conflict before reloading Stratum.",
        );
    }
  for (const copy of copies) {
    if (await adapter.exists(copy.destination)) continue;
    await ensureDirectory(
      adapter,
      copy.destination.slice(0, copy.destination.lastIndexOf("/")),
    );
    // Keep the reference temporary path stable so a crash can be retried or reset.
    const temporary =
      copy.source === REFERENCE_FILE
        ? `${copy.destination}.migration.tmp`
        : `${copy.destination}.migration-${crypto.randomUUID()}.tmp`;
    try {
      const bytes = await adapter.readBinary(copy.source);
      await adapter.writeBinary(temporary, bytes);
      if (!same(bytes, await adapter.readBinary(temporary)))
        throw new Error(
          "Stratum storage migration could not verify a copy. Original files were retained.",
        );
      await adapter.rename(temporary, copy.destination);
    } finally {
      if (await adapter.exists(temporary)) await adapter.remove(temporary);
    }
  }
  // A failed/interrupted copy leaves complete originals for the next load to retry.
  const verify = async (copy: Copy): Promise<void> => {
    if (
      !same(
        await adapter.readBinary(copy.source),
        await adapter.readBinary(copy.destination),
      )
    )
      throw new Error(
        "Stratum storage changed during migration. Saved data was preserved; reload Stratum to retry.",
      );
  };
  for (const copy of copies) await verify(copy);
  for (const copy of copies) {
    // Other files can change while earlier copies are being retired.
    await verify(copy);
    await adapter.remove(copy.source);
  }
  const removeEmptyDirectory = async (directory: string): Promise<void> => {
    try {
      const entries = await adapter.list(directory);
      if (!entries.files.length && !entries.folders.length)
        await adapter.rmdir(directory, false);
    } catch {
      // Some desktop adapters reject even empty non-recursive removals.
      // Verified data is already migrated; leftover empty folders must not block startup.
      // Never switch to recursive deletion: unlisted or newly added files must survive.
    }
  };
  for (const folder of folders) await removeEmptyDirectory(folder);
  const legacyDirectory = `${app.vault.configDir}/stratum`;
  if (await adapter.exists(legacyDirectory))
    await removeEmptyDirectory(legacyDirectory);
}
