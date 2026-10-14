import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateJournalAssets } from "./journal-assets.mjs";
test("journal generation preserves pinned upstream bytes and rejects altered assets before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journal-assets-"));
  try {
    const content = "Original class notice\r\nUnmodified bytes\r\n";
    await mkdir(join(directory, "example"));
    const asset = join(directory, "example/class.cls");
    await writeFile(asset, content);
    await writeFile(
      join(directory, "provenance.json"),
      JSON.stringify({
        files: {
          "example/class.cls": createHash("sha256")
            .update(content)
            .digest("hex"),
        },
      }),
    );
    await generateJournalAssets(directory);
    const generated = await readFile(join(directory, "files.json"), "utf8");
    assert.equal(JSON.parse(generated)["example/class.cls"], content);
    await writeFile(asset, content + "Changed");
    await assert.rejects(
      generateJournalAssets(directory),
      /Pinned journal asset changed/,
    );
    assert.equal(
      await readFile(join(directory, "files.json"), "utf8"),
      generated,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
