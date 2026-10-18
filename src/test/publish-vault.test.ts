import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./runtime-harness";
import type * as VaultFiles from "../publish-vault";
class File {
  constructor(public path: string) {}
}
class Folder {
  constructor(public path: string) {}
}
const { publishedVaultFiles, pdfFolder } = loadRuntime<typeof VaultFiles>(
  "publish-vault.ts",
  { TFile: File, TFolder: Folder },
);
function fixture() {
  const entries = new Map<string, File | Folder>();
  const bytes = new Map<string, ArrayBuffer>();
  const trashed: string[] = [];
  const app = {
    vault: {
      configDir: "CustomConfig",
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      createFolder: (path: string) => {
        entries.set(path, new Folder(path));
        return Promise.resolve();
      },
      createBinary: (path: string, content: ArrayBuffer) => {
        if (entries.has(path))
          return Promise.reject(new Error("File already exists"));
        entries.set(path, new File(path));
        bytes.set(path, content);
        return Promise.resolve();
      },
      delete: (file: File) => {
        entries.delete(file.path);
        bytes.delete(file.path);
        return Promise.resolve();
      },
    },
    fileManager: {
      trashFile: (file: File) => {
        trashed.push(file.path);
        entries.delete(file.path);
        bytes.delete(file.path);
        return Promise.resolve();
      },
    },
  };
  return {
    app,
    entries,
    bytes,
    trashed,
    files: publishedVaultFiles(app as never, () => "Exports/Papers"),
  };
}
test("vault file operations create folders lazily and use Obsidian's configured trash", async () => {
  const f = fixture();
  assert.equal(f.entries.size, 0);
  const bytes = new Uint8Array([1, 2]).buffer;
  await f.files.create("Exports/Papers/Synthetic.pdf", bytes);
  assert.ok(f.entries.get("Exports") instanceof Folder);
  assert.ok(f.entries.get("Exports/Papers") instanceof Folder);
  assert.equal(f.bytes.get("Exports/Papers/Synthetic.pdf"), bytes);
  await assert.rejects(
    f.files.create("Exports/Papers/Synthetic.pdf", new ArrayBuffer(1)),
    /exists/,
  );
  assert.equal(f.bytes.get("Exports/Papers/Synthetic.pdf"), bytes);
  await f.files.trash("Exports/Papers/Synthetic.pdf");
  assert.deepEqual(f.trashed, ["Exports/Papers/Synthetic.pdf"]);
});
test("PDF folders reject hidden, external, traversal and custom config paths", async () => {
  const f = fixture();
  for (const path of [
    "../outside",
    "/absolute",
    "C:\\outside",
    ".hidden/docs",
    "Exports/../Other",
    "CustomConfig",
    "customconfig/cache",
    "Exports//Papers",
    "Exports/.hidden",
  ]) {
    assert.throws(() => pdfFolder(f.app as never, path));
    await assert.rejects(
      f.files.create(`${path}/Synthetic.pdf`, new ArrayBuffer(1)),
    );
  }
  assert.equal(f.entries.size, 0);
  assert.equal(pdfFolder(f.app as never, " Exports/Papers "), "Exports/Papers");
  f.entries.set("Exports", new File("Exports"));
  await assert.rejects(
    f.files.create("Exports/Papers/Synthetic.pdf", new ArrayBuffer(1)),
    /occupied/,
  );
});
