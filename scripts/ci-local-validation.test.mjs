import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  sourceDigest,
  recordLocalValidation,
  hasLocalValidation,
  receiptFile,
} from "./ci-local-validation.mjs";

test("local success applies only to the exact snapshot, including unstaged changes and deletions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stratum-local-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(join(root, "source.ts"), "synthetic source");
  await symlink("source.ts", join(root, "alias.ts"));
  execFileSync("git", ["add", "source.ts"], { cwd: root });
  assert.equal(await hasLocalValidation(root), false);
  const digest = await sourceDigest(root);
  await recordLocalValidation(digest, root);
  assert.equal(await hasLocalValidation(root), true);
  // Staging the receipt must not change the snapshot it describes.
  execFileSync("git", ["add", receiptFile], { cwd: root });
  assert.equal(await hasLocalValidation(root), true);
  assert.deepEqual(
    Object.keys(
      JSON.parse(await readFile(join(root, receiptFile), "utf8")),
    ).sort(),
    ["sha256", "version"],
  );
  await chmod(join(root, "source.ts"), 0o755);
  assert.equal(await hasLocalValidation(root), false);
  await chmod(join(root, "source.ts"), 0o644);
  assert.equal(await hasLocalValidation(root), true);
  await writeFile(join(root, "source.ts"), "changed source");
  assert.equal(await hasLocalValidation(root), false);
  await assert.rejects(recordLocalValidation(digest, root), /Sources changed/);
  await writeFile(join(root, "source.ts"), "synthetic source");
  await writeFile(join(root, "new.test.ts"), "synthetic new test");
  assert.equal(await hasLocalValidation(root), false);
  await rm(join(root, "new.test.ts"));
  assert.equal(await hasLocalValidation(root), true);
  await rm(join(root, "source.ts"));
  assert.equal(await hasLocalValidation(root), false);
  await recordLocalValidation(await sourceDigest(root), root);
  execFileSync("git", ["add", "--all"], { cwd: root });
  assert.equal(await hasLocalValidation(root), true);
  await writeFile(join(root, receiptFile), "null");
  assert.equal(await hasLocalValidation(root), false);
  await writeFile(join(root, receiptFile), "invalid json");
  assert.equal(await hasLocalValidation(root), false);
});
