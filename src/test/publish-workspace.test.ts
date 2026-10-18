import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { testPublishingWorkspace } from "./publishing-workspace";

test("compiler workspaces round-trip text and binary files and reject escaping filenames", async () => {
  const job = await testPublishingWorkspace().create();
  try {
    assert.match(
      job.directory,
      /CustomConfig[/\\]plugins[/\\]stratum[/\\]tmp[/\\]/,
    );
    await job.write("document.tex", "Synthetic α");
    assert.equal(
      new TextDecoder().decode(await job.read("document.tex")),
      "Synthetic α",
    );
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await job.write("asset-0.png", bytes.subarray(1, 3));
    assert.deepEqual(Array.from(await job.read("asset-0.png")), [1, 2]);
    for (const name of [
      "../note.md",
      "/note.md",
      "sub/file",
      "sub\\file",
      ".",
      "..",
      "",
    ]) {
      await assert.rejects(job.write(name, "invalid"), /Invalid publishing/);
      await assert.rejects(job.read(name), /Invalid publishing/);
    }
  } finally {
    await job.remove();
  }
  await assert.rejects(access(job.directory));
});
