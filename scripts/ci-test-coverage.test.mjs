import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coveredTests, testFiles, missingTests } from "./ci-test-coverage.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
test("plugin CI selects every test file, including nested browser tests", () => {
  const workflow = readFileSync(
    join(root, ".github/workflows/lint.yml"),
    "utf8",
  );
  const covered = coveredTests(workflow, root);
  assert.deepEqual(missingTests(testFiles(root), covered, root), []);
});
test("coverage guard detects omitted nested tests and follows script wrappers", () => {
  const root = mkdtempSync(join(tmpdir(), "stratum-ci-coverage-"));
  try {
    mkdirSync(join(root, "tests/browser"), { recursive: true });
    for (const file of ["tests/unit.test.ts", "tests/browser/panel.test.ts"])
      writeFileSync(join(root, file), "");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node scripts/run-quiet.mjs pnpm run test:verbose",
          "test:verbose": "node --test --import tsx tests/*.test.ts",
          "test:browser": "node --test --import tsx tests/browser/*.test.ts",
        },
      }),
    );
    const workflow = "jobs:\n  build:\n    steps:\n      - run: pnpm test\n";
    const missing = missingTests(
      testFiles(root),
      coveredTests(workflow, root),
      root,
    );
    assert.deepEqual(missing, ["tests/browser/panel.test.ts"]);
    const complete = workflow + "      - run: pnpm test:browser\n";
    assert.deepEqual(
      missingTests(testFiles(root), coveredTests(complete, root), root),
      [],
    );
    assert(
      coveredTests(complete, root).has(
        resolve(root, "tests/browser/panel.test.ts"),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
