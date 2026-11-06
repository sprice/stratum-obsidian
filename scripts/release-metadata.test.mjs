import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validateReleaseMetadata } from "./release-metadata.mjs";

test("release metadata requires matching versions, tag, and minimum app mapping", (t) => {
  const root = mkdtempSync(join(tmpdir(), "stratum-release-metadata-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, value) =>
    writeFileSync(join(root, file), JSON.stringify(value));
  put("package.json", { version: "1.2.3" });
  put("manifest.json", { version: "1.2.3", minAppVersion: "1.0.0" });
  put("versions.json", { "1.2.3": "1.0.0" });
  assert.equal(validateReleaseMetadata(root, "1.2.3"), "1.2.3");
  assert.throws(() => validateReleaseMetadata(root, "1.2.4"), /agree/);
  put("package.json", { version: "1.2.4" });
  assert.throws(() => validateReleaseMetadata(root), /agree/);
  put("package.json", { version: "1.2.3" });
  put("versions.json", { "1.2.3": "0.9.0" });
  assert.throws(() => validateReleaseMetadata(root), /minAppVersion/);
});
