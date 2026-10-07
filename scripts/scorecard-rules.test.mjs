import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cssFindings, decodingFindings } from "./scorecard-rules.mjs";

test("CSS rules catch nested declarations and ignore comments and strings", async () => {
  const findings =
    await cssFindings(`/* display: contents; color: red !important */
a { content: "!important; display: contents"; }
@media (prefers-reduced-motion: reduce) {
  a { transition: none !important; DISPLAY: /* reason */ CONTENTS; }
}`);
  assert.deepEqual(
    findings.map(({ rule, line }) => ({ rule, line })),
    [
      { rule: "css-important", line: 4 },
      { rule: "css-display-contents", line: 4 },
    ],
  );
  assert.ok(findings.every(({ column }) => column > 0));
  assert.deepEqual(
    await cssFindings("a { display: flex; transition: none; }"),
    [],
  );
  await assert.rejects(cssFindings("a {"));
});

test("decoding calls include globals, computed properties, buffers, and typed arrays", () => {
  for (const call of [
    'atob("asset")',
    'window.atob("asset")',
    'globalThis["atob"]?.("asset")',
    '(atob)("asset")',
    'Buffer.from("asset", "base64")',
    'Buffer["from"]("asset", `base64url`)',
    'new Buffer("asset", "base64")',
    'Uint8Array.fromBase64("asset")',
    'bytes.setFromBase64("asset")',
  ]) {
    const findings = decodingFindings(
      `// synthetic\n${call};`,
      "src/example.ts",
    );
    assert.equal(findings.length, 1, call);
    assert.equal(findings[0].line, 2);
    assert.equal(findings[0].column, 1);
    assert.equal(findings[0].rule, "base64-decoding");
  }
});

test("comments, text, raw bytes, and base64 encoding are allowed", () => {
  assert.deepEqual(
    decodingFindings(`
// atob("asset")
const label = 'Buffer.from("asset", "base64")';
const bytes = new Uint8Array([137, 80, 78, 71]);
Buffer.from(bytes).toString("base64");
Buffer.from("text", "utf8");
btoa("text");
`),
    [],
  );
});

test("CLI fails on production violations, reports locations, and excludes tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "stratum-scorecard-"));
  const script = fileURLToPath(
    new URL("./scorecard-rules.mjs", import.meta.url),
  );
  try {
    await mkdir(join(root, "src/test/browser"), { recursive: true });
    await writeFile(join(root, "styles.css"), "a { display: contents; }");
    await writeFile(join(root, "src/example.ts"), 'atob("synthetic");');
    await writeFile(
      join(root, "src/test/browser/fixture.ts"),
      'atob("fixture");',
    );
    const run = () =>
      spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    const failure = run();
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /styles\.css:1:5 css-display-contents/);
    assert.match(failure.stderr, /src\/example\.ts:1:1 base64-decoding/);
    assert.doesNotMatch(failure.stderr, /fixture/);
    await writeFile(join(root, "styles.css"), "a { display: flex; }");
    await writeFile(join(root, "src/example.ts"), "new Uint8Array([0, 1]);");
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /rules passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
