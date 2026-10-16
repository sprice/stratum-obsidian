import {
  installedTestResources,
  templateCacheSkip,
} from "./publishing-resource-cache";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compatibleMathTex } from "../publish-math-compat";
import { preparePublishMath } from "../publish-math";
import { aastexManuscript } from "../publication-package";
import { DEFAULT_PUBLISH_OPTIONS } from "../publish-options";
import { loadRuntime } from "./runtime-harness";
import {
  mathjaxParityExamples,
  mathjaxParityMarkdown,
} from "./fixtures/mathjax-parity";

test("MathJax loading directives select only supported built-in extensions", () => {
  assert.equal(
    compatibleMathTex(String.raw`\require{cancel}\cancel{x}`, 3),
    String.raw`\cancel{x}`,
  );
  assert.throws(
    () => compatibleMathTex(String.raw`\require{../private}`, 7),
    /line 7.*extension.*private/,
  );
  assert.throws(
    () => compatibleMathTex(String.raw`\require\input{x}`, 2),
    /line 2.*incomplete/,
  );
});

test("browser-only math gives a command and source line instead of a XeTeX failure", () => {
  for (const tex of [
    String.raw`\enclose{circle}{x}`,
    String.raw`\style{color:red}{x}`,
    String.raw`\unicode{x1F600}`,
  ]) {
    assert.throws(
      () => preparePublishMath(`Text\n\n$$${tex}$$`),
      /line 3.*uses .*vault image/,
    );
  }
  // Literal examples must remain literal, even when the command is unsupported.
  const literal = String.raw`Use \bbox in code: ` + "`$\\bbox[red]{x}$`";
  assert.equal(preparePublishMath(literal).markdown, literal);
  for (const command of ["input", "usepackage", "write", "csname"])
    assert.throws(() => preparePublishMath(`$\\${command}{x}$`), /unsupported/);
});

test("MathJax boxes and strike enclosures translate without interpreting arbitrary CSS", () => {
  assert.equal(
    compatibleMathTex(
      String.raw`\bbox[yellow,2px,border: 1px solid red]{\frac{x}{y}}`,
      1,
    ),
    String.raw`\stratummathbox{1.5bp}{0.75bp}{red}{yellow}{\frac{x}{y}}`,
  );
  assert.equal(
    compatibleMathTex(String.raw`\enclose{box,updiagonalstrike}{x}`, 1),
    String.raw`\cancel{\boxed{x}}`,
  );
  for (const tex of [
    String.raw`\bbox[border: 1px dashed red]{x}`,
    String.raw`\bbox[red]{x`,
    String.raw`\enclose{box}[mathcolor=red]{x}`,
  ])
    assert.throws(() => compatibleMathTex(tex, 5), /line 5/);
  assert.equal(
    compatibleMathTex(String.raw`\verb|\bbox| + x % \style{color:red}{x}`, 1),
    String.raw`\verb|\bbox| + x % \style{color:red}{x}`,
  );
});

test("enclosure names are restricted to the supported notation map", () => {
  for (const notation of ["toString", "constructor", "__proto__"])
    assert.throws(
      () => compatibleMathTex(`\\enclose{${notation}}{x}`, 4),
      /line 4.*enclose notation.*does not support/,
    );
});

test("colored math rows cover array gaps and preserve explicit overhangs", () => {
  assert.equal(
    compatibleMathTex(
      String.raw`\begin{array}{cc}\rowcolor{yellow}a&b\\c&d\end{array}`,
      1,
    ),
    String.raw`\begin{array}{cc}\rowcolor{yellow}[\arraycolsep][\arraycolsep]a&b\\c&d\end{array}`,
  );
  const explicit = String.raw`\begin{array}{cc}\rowcolor[rgb]{1,1,0}[2pt][3pt]a&b\end{array}`;
  assert.equal(compatibleMathTex(explicit, 1), explicit);
});

const require = createRequire(import.meta.url);

function tool(name: string): string {
  for (const candidate of [
    process.env[`STRATUM_TEST_${name.toUpperCase()}`],
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, [name === "pdftotext" ? "-v" : "--version"], {
        stdio: "ignore",
      });
      return candidate;
    } catch {
      /* Try the next installed tool. */
    }
  }
  return "";
}
const pandoc = tool("pandoc"),
  tectonic = tool("tectonic"),
  pdftotext = tool("pdftotext");

for (const template of ["General", "AASTeX"] as const)
  test(
    `Reading-view math examples compile and retain references in ${template} PDF`,
    {
      skip:
        !pandoc ||
        !tectonic ||
        !pdftotext ||
        (template === "AASTeX" && templateCacheSkip),
      timeout: 120_000,
    },
    async () => {
      const desktop = loadRuntime<typeof import("../publish-desktop")>(
        "publish-desktop.ts",
        { Platform: { isDesktopApp: true, isDesktop: true } },
        {
          TextDecoder,
          TextEncoder,
          Uint8Array,
          crypto,
          window: { require, setTimeout, clearTimeout },
        },
        "browser",
      );
      const math = preparePublishMath(mathjaxParityMarkdown);
      const html = `<html><body><h1>Math compatibility</h1>${math.restore(math.markdown).replace(/^## (.+)$/gm, "<h2>$1</h2>")}</body></html>`;
      const bytes = await desktop.convertPublication(
        html,
        [],
        "pdf",
        {
          pandoc,
          tectonic,
          ...(template === "AASTeX"
            ? { bibliographyCache: await installedTestResources() }
            : {}),
        },
        undefined,
        120_000,
        { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "", titleFont: "" },
        template === "AASTeX"
          ? {
              manuscript: aastexManuscript(
                "---\nstratum_publish:\n  authors:\n    - name: Example Author\n      email: author@example.test\n      affiliations: [Example Institute]\n---\n# Math compatibility\n\nSynthetic mathematical examples.",
                "body",
              ),
              abstractHtml: "",
              references: [],
            }
          : undefined,
      );
      assert.equal(
        new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)),
        "%PDF-",
      );
      const directory = await mkdtemp(join(tmpdir(), "stratum-math-parity-"));
      try {
        const path = join(directory, "comparison.pdf");
        await writeFile(path, new Uint8Array(bytes));
        const text = execFileSync(pdftotext, [path, "-"], { encoding: "utf8" });
        if (template === "AASTeX")
          assert.match(text, /Example Author/, "Author parsing is exercised");
        assert.ok(
          (text.match(/P1/g) ?? []).length >= 2,
          "The equation tag and its reference both survive",
        );
        assert.doesNotMatch(text, /\?\?/);
        if (template === "General")
          assert.match(
            text,
            /[\u{1D6C2}\u{1D736}]/u,
            "Bold Greek uses a bold mathematical glyph",
          );
        assert.doesNotMatch(
          text,
          /\([12]\)/,
          "No automatic equation numbers are introduced",
        );
        for (const { name } of mathjaxParityExamples)
          assert.ok(text.includes(name), `${name} survives`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
