import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cssFindings, base64Findings } from "./scorecard-rules.mjs";

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
    'btoa("text")',
    'window["btoa"]?.("text")',
    "bytes.toBase64()",
    'Buffer.from(bytes).toString("base64")',
    'buffer["toString"](`base64url`)',
    'window.atob("asset")',
    'globalThis["atob"]?.("asset")',
    'globalThis["atob" as const]("asset")',
    'globalThis["atob" satisfies string]("asset")',
    '(atob)("asset")',
    '(atob satisfies Function)("asset")',
    '(<typeof atob>atob)("asset")',
    'Buffer.from("asset", "base64")',
    'Buffer.from("asset", "base64" satisfies BufferEncoding)',
    'Buffer.from("asset", <BufferEncoding>"base64")',
    'Buffer["from"]("asset", `base64url`)',
    'Buffer["from" satisfies string]("asset", "base64")',
    'globalThis["Buffer" as const]["from" as const]("asset", "base64")',
    'new Buffer("asset", "base64")',
    'Buffer("asset", "base64")',
    'Uint8Array.fromBase64("asset")',
    'bytes.setFromBase64("asset")',
  ]) {
    const findings = base64Findings(`// synthetic\n${call};`, "src/example.ts");
    assert.equal(findings.length, 1, call);
    assert.equal(findings[0].line, 2);
    assert.equal(findings[0].column, 1);
    assert.equal(findings[0].rule, "base64-runtime");
  }
});

test("comments, text, and raw bytes are allowed", () => {
  assert.deepEqual(
    base64Findings(`
// atob("asset")
const label = 'Buffer.from("asset", "base64")';
const bytes = new Uint8Array([137, 80, 78, 71]);
Buffer.from("text", "utf8");
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
    assert.match(failure.stderr, /src\/example\.ts:1:1 base64-runtime/);
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

test("CSS compatibility rejects multicolumn and clip-path but allows flex/grid gap", async () => {
  for (const property of [
    "column-gap",
    "columns",
    "column-count",
    "column-rule-width",
    "break-inside",
    "clip-path",
    "-webkit-clip-path",
    "-moz-column-count",
  ]) {
    const findings = await cssFindings(
      `@media screen { a { ${property}: initial; } }`,
    );
    assert.equal(findings.length, 1, property);
    assert.equal(
      findings[0].rule,
      property.includes("clip-path") ? "css-clip-path" : "css-multicolumn",
    );
  }
  assert.deepEqual(
    await cssFindings(
      'a { gap: 12px; clip: rect(0, 0, 0, 0); content: "column-gap: 2px; clip-path: none"; }',
    ),
    [],
  );
});

test("browser YAML bundle keeps binary tags as text without base64 calls", async () => {
  const { build } = await import("esbuild");
  const { scorecardBundlePlugin } = await import("./scorecard-bundle.mjs");
  const result = await build({
    stdin: {
      contents: 'export { parseDocument } from "yaml";',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    outfile: "yaml.js",
    plugins: [scorecardBundlePlugin()],
  });
  const code = result.outputFiles[0].text;
  assert.deepEqual(base64Findings(code, "yaml.js"), []);
  const { parseDocument } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const source = "title: Synthetic\nattachment: !!binary SGVsbG8= # keep\n";
  const doc = parseDocument(source, { keepSourceTokens: true });
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(doc.warnings, []);
  assert.equal(doc.toJS().attachment, "SGVsbG8=");
  doc.set("title", "Edited");
  assert.match(doc.toString(), /attachment: !!binary SGVsbG8= # keep/);
});

test("bundle guard fails on base64 calls introduced by dependencies", async () => {
  const { build } = await import("esbuild");
  const { scorecardBundlePlugin } = await import("./scorecard-bundle.mjs");
  await assert.rejects(
    build({
      stdin: { contents: 'import "synthetic-dependency";' },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      logLevel: "silent",
      plugins: [
        scorecardBundlePlugin(),
        {
          name: "synthetic-dependency",
          setup(build) {
            build.onResolve({ filter: /^synthetic-dependency$/ }, () => ({
              path: "synthetic-dependency",
              namespace: "fixture",
            }));
            build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: 'console.log(btoa("synthetic"));',
            }));
          },
        },
      ],
    }),
    /Runtime base64 call in bundle/,
  );
});

test("bundled publication edits preserve binary tags and unrelated note bytes", async () => {
  const { build } = await import("esbuild");
  const { scorecardBundlePlugin } = await import("./scorecard-bundle.mjs");
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/publication-metadata.ts", import.meta.url)),
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    outfile: "metadata.js",
    plugins: [scorecardBundlePlugin()],
  });
  const {
    changePublicationAuthors,
    changePublicationProperty,
    publicationYaml,
  } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const source = [
    "---",
    "title: Synthetic",
    "attachment: !!binary SGVsbG8= # keep root",
    "stratum_publish:",
    "  authors:",
    "    - name: Alex",
    "      custom: !!binary SGVsbG8= # keep author",
    "---",
    "Untouched body.",
    "",
  ].join("\r\n");
  const apply = ({ from, to, insert }) =>
    source.slice(0, from) + insert + source.slice(to);
  const renamed = apply(
    changePublicationAuthors(source, {
      type: "field",
      author: 0,
      key: "name",
      value: "Morgan",
    }),
  );
  assert.equal(renamed, source.replace("name: Alex", "name: Morgan"));
  const retitled = apply(
    changePublicationProperty(source, { key: "title", value: "Edited" }),
  );
  assert.equal(retitled, source.replace("title: Synthetic", "title: Edited"));
  for (const operation of [
    { type: "add" },
    { type: "add-affiliation", author: 0 },
  ]) {
    const next = apply(changePublicationAuthors(source, operation));
    assert.ok(next.startsWith(source.slice(0, source.indexOf("  authors:"))));
    assert.ok(next.endsWith("---\r\nUntouched body.\r\n"));
    assert.ok(next.includes("custom: !!binary SGVsbG8= # keep author"));
    assert.doesNotMatch(next, /(?<!\r)\n/);
    assert.equal(publicationYaml(next).properties.attachment, "SGVsbG8=");
  }
});
