import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { context } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePublicationAssets } from "./publication-assets.mjs";

test("CLI bootstraps missing generated data without requiring a checkout artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratum-assets-bootstrap-"));
  try {
    await writeFile(join(directory, "manifest.json"), '{"synthetic":true}\n');
    execFileSync(process.execPath, [
      fileURLToPath(new URL("./publication-assets.mjs", import.meta.url)),
      directory,
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "files.json"), "utf8")),
      {
        "manifest.json": '{"synthetic":true}\n',
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("asset generation preserves bytes and updates changed declarations deterministically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratum-assets-"));
  try {
    await writeFile(join(directory, "class.cls"), "upstream\r\nbytes\r\n");
    await writeFile(join(directory, "defaults.json"), '{"example":1}\n');
    const first = await generatePublicationAssets(directory);
    assert.equal(
      JSON.parse(first.contents)["class.cls"],
      "upstream\r\nbytes\r\n",
    );
    assert.equal(
      (await generatePublicationAssets(directory)).contents,
      first.contents,
    );
    await writeFile(join(directory, "defaults.json"), '{"example":2}\n');
    const second = await generatePublicationAssets(directory);
    assert.notEqual(second.contents, first.contents);
    assert.equal(
      await readFile(join(directory, "files.json"), "utf8"),
      second.contents,
    );
    assert.equal(second.paths.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generation refuses symlinks outside the standalone package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratum-assets-"));
  try {
    await writeFile(join(directory, "original.txt"), "example");
    await symlink(join(directory, "original.txt"), join(directory, "link.txt"));
    await assert.rejects(generatePublicationAssets(directory), /symlinks/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "development bundling discovers added and removed assets in package directories",
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "stratum-assets-watch-"));
    let build;
    let resolveBuild;
    let rejectBuild;
    const nextBuild = () =>
      new Promise((resolve, reject) => {
        resolveBuild = resolve;
        rejectBuild = reject;
      });
    try {
      await mkdir(join(directory, "vendor"));
      await generatePublicationAssets(directory);
      const first = nextBuild();
      build = await context({
        entryPoints: [join(directory, "files.json")],
        bundle: true,
        write: false,
        format: "esm",
        plugins: [
          {
            name: "watch-publication-assets",
            setup(builder) {
              builder.onLoad({ filter: /files\.json$/ }, async () => {
                const result = await generatePublicationAssets(directory);
                return {
                  contents: result.contents,
                  loader: "json",
                  watchFiles: result.paths,
                  watchDirs: result.directories,
                };
              });
              builder.onEnd((result) => {
                if (result.errors.length)
                  rejectBuild(new Error(result.errors[0].text));
                else resolveBuild(result.outputFiles[0].text);
              });
            },
          },
        ],
      });
      await build.watch();
      await first;
      const added = nextBuild();
      await writeFile(
        join(directory, "vendor", "added.cls"),
        "new synthetic class",
      );
      assert.match(await added, /new synthetic class/);
      const removed = nextBuild();
      await rm(join(directory, "vendor", "added.cls"));
      assert.doesNotMatch(await removed, /new synthetic class/);
    } finally {
      await build?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
